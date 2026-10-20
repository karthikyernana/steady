// Chat retrieval (1.6): hybrid search over the user's tasks, thoughts and money, built to stay fast as data grows.
//
//   lexical   Postgres full-text (to_tsvector 'simple', OR of prefix terms, ts_rank) on record_search_text(coll, data)
//   fuzzy     pg_trgm word_similarity (typos, partial words: "pricng" → "pricing")
//   semantic  pgvector cosine distance on Gemini embeddings (optional: only when the extension, the table and the
//             embedding API are all available; a 429 or timeout just leaves it out of this search)
//   fusion    reciprocal rank fusion (k = 60): score = Σ 1 / (k + rank) over the lists a record appears in
//
// Every statement runs through the caller's withOwner() transaction, so FORCE RLS on `records` / `record_embeddings`
// scopes it to this user. Indexes: db/migrations/0010_chat_search.sql. Embeddings are back-filled lazily, a small batch
// per chat turn, in parallel with the model call (never blocking it). See docs/AGENT.md "Search (RAG)".
import { createHash } from 'node:crypto';

const env = k => process.env[k] || '';
export const SEARCH_COLLS = ['thoughts', 'tasks', 'money'];
export const RRF_K = 60;
const LIST = 30;                  // candidates per retriever
export const EMBED_DIMS = 768;
const BACKFILL_BATCH = 16;

// ---------------------------------------------------------------- query terms
// Words → a safe tsquery string: each term letters/digits only, prefix-matched, OR-ed ("pric:* | idea:*").
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'about', 'what', 'did', 'i', 'my', 'me', 'is', 'it', 'was', 'with', 'at', 'from', 'that', 'this', 'write', 'wrote', 'say', 'said']);
export function terms(q) {
  const ws = (String(q || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(w => w.length > 1);
  const keep = ws.filter(w => !STOP.has(w));
  return [...new Set(keep.length ? keep : ws)].slice(0, 8);
}
export const tsQuery = q => terms(q).map(w => `${w}:*`).join(' | ');

// Reciprocal rank fusion of ranked lists of keys. Returns [{ key, score, hits }] best first (ties: first list wins).
export function rrf(lists, k = RRF_K) {
  const m = new Map();
  lists.forEach((list, li) => list.forEach((key, i) => {
    const e = m.get(key) || { key, score: 0, hits: 0, first: li * 1000 + i };
    e.score += 1 / (k + i + 1); e.hits++; m.set(key, e);
  }));
  return [...m.values()].sort((a, b) => b.score - a.score || a.first - b.first).map(({ key, score, hits }) => ({ key, score: Math.round(score * 1e5) / 1e5, hits }));
}

// The same text the SQL function record_search_text() indexes (kept in step for the in-memory fallback and hashing).
export function searchText(coll, d) {
  if (!d) return '';
  const j = (...xs) => xs.filter(x => x != null && x !== '').map(String).join(' ');
  if (coll === 'tasks') return j(d.title, d.notes, d.note);
  if (coll === 'thoughts') return j(d.text, Array.isArray(d.tags) ? d.tags.join(' ') : null);
  if (coll === 'money') return j(d.note, d.payee, d.category);
  return '';
}

// In-memory ranking (unit tests, and the path when the database cannot be reached by SQL): term + substring matching.
export function rankInMemory(rows, q) {
  const ts = terms(q), whole = String(q || '').toLowerCase().trim();
  return rows.map(r => {
    const t = searchText(r.coll, r).toLowerCase();
    let s = whole.length > 2 && t.includes(whole) ? 3 : 0;
    for (const w of ts) if (new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u').test(t)) s += 1;
    return { r, s };
  }).filter(x => x.s > 0).sort((a, b) => b.s - a.s).map(x => x.r);
}

// ---------------------------------------------------------------- embeddings (Gemini, optional)
let embedParkedUntil = 0;
let vectorTable = null;           // null = unknown, true/false once checked (per warm instance)
export const resetSearchState = () => { embedParkedUntil = 0; vectorTable = null; };
export const embedOn = () => !!env('GEMINI_API_KEY') && env('AGENT_EMBED') !== 'off' && Date.now() > embedParkedUntil;
const sha = s => createHash('sha256').update(s).digest('hex').slice(0, 32);

// texts → [Float[768]] or null (unavailable / quota / timeout: the caller just goes without)
export async function embed(texts, task = 'RETRIEVAL_DOCUMENT', timeoutMs = 4000) {
  if (!embedOn() || !texts.length) return null;
  const model = env('AGENT_EMBED_MODEL') || 'gemini-embedding-001';
  const base = (env('GEMINI_BASE_URL') || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
  const key = env('GEMINI_API_KEY').split(',')[0].trim();
  try {
    const res = await fetch(`${base}/v1beta/models/${model}:batchEmbedContents`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ requests: texts.map(t => ({ model: `models/${model}`, content: { parts: [{ text: String(t).slice(0, 2000) }] }, taskType: task, outputDimensionality: EMBED_DIMS })) }),
      signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) { embedParkedUntil = Date.now() + (res.status === 429 ? 5 : 30) * 60_000; return null; }
    const j = await res.json();
    const out = (j.embeddings || []).map(e => e.values);
    return out.length === texts.length && out.every(v => Array.isArray(v) && v.length === EMBED_DIMS) ? out : null;
  } catch { embedParkedUntil = Date.now() + 60_000; return null; }
}
const vecLit = v => `[${v.map(x => (+x).toFixed(6)).join(',')}]`;

async function hasVectorTable(q) {
  if (vectorTable === null) {
    try { vectorTable = !!(await q("select to_regclass('record_embeddings') is not null ok")).rows[0]?.ok; } catch { vectorTable = false; }
  }
  return vectorTable;
}

// Embed up to BACKFILL_BATCH records that have no (or a stale) embedding. `tx(fn)` = withOwner(ownerId, fn).
// Two short statements around one embedding call; returns how many were stored. Never throws.
export async function backfillEmbeddings(tx) {
  try {
    if (!embedOn()) return 0;
    const todo = await tx(async c => {
      if (!(await hasVectorTable(t => c.query(t)))) return [];
      return (await c.query(`select r.coll, r.id, record_search_text(r.coll, r.data) doc, e.hash
        from records r left join record_embeddings e on e.owner_id = r.owner_id and e.coll = r.coll and e.id = r.id
        where r.owner_id = app_owner() and r.coll in ('tasks', 'thoughts', 'money') and not r.deleted
          and length(record_search_text(r.coll, r.data)) > 2
        order by r.updated_at desc limit 400`)).rows.filter(r => r.hash !== sha(r.doc)).slice(0, BACKFILL_BATCH);
    });
    if (!todo.length) return 0;
    const vs = await embed(todo.map(r => r.doc), 'RETRIEVAL_DOCUMENT', 8000);
    if (!vs) return 0;
    await tx(async c => {
      for (let i = 0; i < todo.length; i++) {
        await c.query(`insert into record_embeddings (owner_id, coll, id, hash, embedding) values (app_owner(), $1, $2, $3, $4::vector)
          on conflict (owner_id, coll, id) do update set hash = excluded.hash, embedding = excluded.embedding, updated_at = now()`, [todo[i].coll, todo[i].id, sha(todo[i].doc), vecLit(vs[i])]);
      }
    });
    return todo.length;
  } catch (e) { console.warn('[chat] embedding backfill skipped:', e.message); return 0; }
}

// ---------------------------------------------------------------- hybrid search (SQL)
// Returns { rows: [{ coll, id, data, score, via }], used: ['fts','trgm','vector'] }. `tx(fn)` runs fn(client) under RLS.
export async function hybridSearch(tx, q, { colls = SEARCH_COLLS, limit = 20 } = {}) {
  const want = colls.filter(c => SEARCH_COLLS.includes(c));
  const tq = tsQuery(q), text = String(q || '').trim().slice(0, 100);
  if (!want.length || !text) return { rows: [], used: [] };
  // the query embedding is fetched while the lexical queries run; it is only used if it arrives in time
  const vecP = embedOn() && vectorTable !== false ? embed([text], 'RETRIEVAL_QUERY', 1500).catch(() => null) : Promise.resolve(null);
  const WHERE = `owner_id = app_owner() and coll in ('tasks', 'thoughts', 'money') and not deleted and coll = any($2::text[])`;
  return tx(async c => {
    const lists = [], used = [], byKey = new Map();
    const take = (name, rows) => { used.push(name); lists.push(rows.map(r => { const k = `${r.coll}/${r.id}`; if (!byKey.has(k)) byKey.set(k, { coll: r.coll, id: r.id, data: r.data, via: [] }); byKey.get(k).via.push(name); return k; })); };
    if (tq) {
      take('fts', (await c.query(`select coll, id, data from records, to_tsquery('simple', $1) q
        where ${WHERE} and to_tsvector('simple'::regconfig, record_search_text(coll, data)) @@ q
        order by ts_rank(to_tsvector('simple'::regconfig, record_search_text(coll, data)), q) desc, updated_at desc limit ${LIST}`, [tq, want])).rows);
    }
    if (text.length >= 3) {
      await c.query("select set_config('pg_trgm.word_similarity_threshold', '0.35', true)");
      take('trgm', (await c.query(`select coll, id, data from records
        where ${WHERE} and $1 <% record_search_text(coll, data)
        order by word_similarity($1, record_search_text(coll, data)) desc, updated_at desc limit ${LIST}`, [text, want])).rows);
    }
    const vec = await vecP;
    if (vec && await hasVectorTable(t => c.query(t))) {
      try {
        await c.query('savepoint vec');
        take('vector', (await c.query(`select r.coll, r.id, r.data from record_embeddings e join records r on r.owner_id = e.owner_id and r.coll = e.coll and r.id = e.id
          where e.owner_id = app_owner() and e.coll = any($2::text[]) and not r.deleted and (e.embedding <=> $1::vector) < $3
          order by e.embedding <=> $1::vector limit ${LIST}`, [vecLit(vec[0]), want, +(env('AGENT_VECTOR_MAX_DIST') || 0.5)])).rows);
        await c.query('release savepoint vec');
      } catch (e) { await c.query('rollback to savepoint vec').catch(() => {}); console.warn('[chat] vector search skipped:', e.message); }
    }
    const rows = rrf(lists).slice(0, limit).map(({ key, score }) => ({ ...byKey.get(key), score }));
    return { rows, used };
  });
}
