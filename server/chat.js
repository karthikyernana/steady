// Chat agent (phase 1): one agent answers questions about the user's own data with READ-ONLY tools and replies with
// { text, cards }. See docs/AGENT.md.
//
//   POST /api/agent/chat  { chatId?, message, tz? }
//     → per-user daily cap (agent_usage kind 'chat')   → short cache (same first question, same data, same day)
//     → model router: Groq gpt-oss-120b → Gemini Flash-Lite → Cloudflare Workers AI (each optional by env, all
//       OpenAI-compatible tool calling) → ≤ MAX_TOOL_STEPS rounds of read-only tool calls under RLS → reply tool
//     → cards validated (server/chat-cards.js) and stored as QUERY specs → resolved from real rows for the response
//   GET /api/agent/chats, GET /api/agent/chats/:id (cards re-resolved from current data), DELETE /api/agent/chats/:id
import { createHash } from 'node:crypto';
import { withOwner } from './db.js';
import { AgentError, countUse, refundUse } from './agent.js';
import { toolSchemas, runTool, dataAccess, zoned, safeTz, TOOL_NAMES, TOOLS, addDays } from './chat-tools.js';
import { validateCards, resolveCards, describeCard, COMPONENTS, hasDataCard, pickCards, cleanSuggestions, fallbackSuggestions, MAX_CARDS } from './chat-cards.js';
import { systemPrompt } from './chat-prompt.js';
import { backfillEmbeddings } from './chat-search.js';
export { systemPrompt };

const env = k => process.env[k] || '';
export const MAX_TOOL_STEPS = 5;           // rounds of tool calls per turn; the round after that must reply
export const MAX_MESSAGE = 1000;
const HISTORY = 12;                        // earlier messages the model sees
const CACHE_MS = () => +(env('AGENT_CHAT_CACHE_MS') || 10 * 60_000);
export const CHAT_CAP = () => +(env('AGENT_DAILY_CAP') || 60);

// ---------------------------------------------------------------- model router (free tiers, all OpenAI-compatible)
// Every (provider, model, key) is one entry; keys may be comma-separated to rotate. A 429 parks that entry for its
// retry-after (default 60 s, per warm instance) and the turn moves on at once. Order: strongest free model first.
const keys = k => env(k).split(',').map(x => x.trim()).filter(Boolean);
const base_ = (k, d) => (env(k) || d).replace(/\/+$/, '');
const cooldown = new Map();                                  // entry name -> until (ms)
export const parkProvider = (name, ms) => cooldown.set(name, Date.now() + Math.max(5_000, Math.min(ms || 60_000, 10 * 60_000)));
export const resetCooldowns = () => cooldown.clear();
export function providers() {
  const out = [];
  const add = (name, url, ks, model, extra = {}) => { if (model === 'off') return; ks.forEach((key, i) => out.push({ name: i ? `${name}#${i + 1}` : name, url, key, model, extra })); };
  const groq = `${base_('GROQ_BASE_URL', 'https://api.groq.com/openai/v1')}/chat/completions`, gk = keys('GROQ_API_KEY');
  const reasoning = { reasoning_effort: env('GROQ_REASONING') || 'low' };
  add('groq', groq, gk, env('GROQ_MODEL') || 'openai/gpt-oss-120b', reasoning);
  add('cerebras', `${base_('CEREBRAS_BASE_URL', 'https://api.cerebras.ai/v1')}/chat/completions`, keys('CEREBRAS_API_KEY'), env('CEREBRAS_MODEL') || 'gpt-oss-120b', { reasoning_effort: 'low' });
  // same Groq key, other models: each has its own free per-minute token budget
  add('groq-20b', groq, gk, env('GROQ_FALLBACK_MODEL') || 'openai/gpt-oss-20b', reasoning);
  add('openrouter', `${base_('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1')}/chat/completions`, keys('OPENROUTER_API_KEY'), env('OPENROUTER_MODEL') || 'nvidia/nemotron-3-super-120b-a12b:free');
  if (env('AGENT_CHAT_GEMINI') !== 'off') add('gemini', `${base_('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com')}/v1beta/openai/chat/completions`, keys('GEMINI_API_KEY'), env('AGENT_GEMINI_MODEL') || 'gemini-2.5-flash', { reasoning_effort: 'none' });
  // JoinGonka gateway (OpenAI-compatible, paid credits): DeepSeek V4 Flash handles tool calls reliably (GLM did not)
  add('gonka', `${base_('GONKA_BASE_URL', 'https://gate.joingonka.ai/v1')}/chat/completions`, keys('GONKA_API_KEY'), env('GONKA_MODEL') || 'deepseek-ai/DeepSeek-V4-Flash-0731');
  add('groq-qwen', groq, gk, env('GROQ_THIRD_MODEL') || 'qwen/qwen3.8-27b');
  if (env('CF_ACCOUNT_ID')) add('cloudflare', `${base_('CF_BASE_URL', 'https://api.cloudflare.com/client/v4')}/accounts/${encodeURIComponent(env('CF_ACCOUNT_ID'))}/ai/v1/chat/completions`, keys('CF_API_TOKEN'), env('CF_MODEL') || '@cf/meta/llama-3.3-70b-instruct-fp8-fast');
  return out;
}
export const chatConfig = () => { const p = providers(); return { on: p.length > 0, providers: p.map(x => x.name) }; };

const REPLY_TOOL = { type: 'function', function: { name: 'reply', description: 'Send your final answer to the user. Always finish with this.',
  parameters: { type: 'object', properties: {
    text: { type: 'string', description: '1-2 short sentences in plain words that interpret the cards. No markdown.' },
    suggestions: { type: 'array', items: { type: 'string' }, description: '2-3 follow-up questions the user may tap next, each 40 characters or less.' },
    cards: { type: 'array', description: 'Cards that show the answer (see <cards> in the instructions).', items: { type: 'object', properties: {
      component: { type: 'string', enum: COMPONENTS }, title: { type: 'string' }, text: { type: 'string' }, tone: { type: 'string', enum: ['info', 'good', 'warn'] },
      query: { type: 'object', properties: { tool: { type: 'string', enum: TOOL_NAMES }, params: { type: 'object' } } }, bind: { type: 'object' }, compare: { type: 'object' } } } },
  }, required: ['text'] } } };

class ProviderError extends Error { constructor(msg, status = 0) { super(msg); this.status = status; } }
// gpt-oss on Groq sometimes emits a call to a tool that isn't offered (often "json"), which Groq rejects with 400
// tool_use_failed and hands back the attempted generation. Salvage it: a known tool stays that tool, anything carrying
// {text, cards} becomes the reply; otherwise retry once.
export function salvage(failed) {
  if (!failed) return null;
  const raw = typeof failed === 'string' ? failed : JSON.stringify(failed);
  const m = /\{[\s\S]*\}/.exec(raw);
  let o = null; try { o = JSON.parse(m ? m[0] : raw); } catch { return null; }
  if (Array.isArray(o)) o = o[0];
  if (!o || typeof o !== 'object') return null;
  const name = String(o.name || o.function?.name || o.recipient_name || '').replace(/^functions\./, '');
  let args = o.arguments ?? o.parameters ?? o.function?.arguments ?? (name ? null : o);
  if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = null; } }
  if (!args || typeof args !== 'object') return null;
  const call = (n, a) => ({ content: '', tool_calls: [{ id: `salv_${Date.now().toString(36)}`, type: 'function', function: { name: n, arguments: JSON.stringify(a) } }] });
  if (name && TOOL_NAMES.includes(name)) return call(name, args);
  if (typeof args.text === 'string') return call('reply', { text: args.text, cards: Array.isArray(args.cards) ? args.cards : [], suggestions: Array.isArray(args.suggestions) ? args.suggestions : [] });
  return null;
}

async function complete(p, messages, { force = false } = {}) {
  const body = { model: p.model, messages, tools: [...toolSchemas(), REPLY_TOOL], tool_choice: force ? { type: 'function', function: { name: 'reply' } } : 'auto',
    temperature: 0.2, max_tokens: 1200, ...p.extra };
  for (let attempt = 0; ; attempt++) {
    let res;
    try { res = await fetch(p.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(+(env('AGENT_CHAT_TIMEOUT_MS') || 15_000)) }); }
    catch (e) { throw new ProviderError(`${p.name}: ${e.name === 'TimeoutError' ? 'timeout' : 'network'}`); }
    const j = await res.json().catch(() => null);
    if (!res.ok) {
      const failed = j?.error?.code === 'tool_use_failed' || /tool call validation failed/i.test(j?.error?.message || '');
      if (res.status === 400 && failed) { const s = salvage(j?.error?.failed_generation); if (s) return s; if (attempt < 1) continue; }
      if ((res.status === 503 || res.status === 500) && attempt < 1) { await new Promise(r => setTimeout(r, 600)); continue; }
      if (res.status === 429) parkProvider(p.name, (+res.headers.get('retry-after') || 0) * 1000);
      throw new ProviderError(`${p.name} ${res.status}: ${String(j?.error?.message || (Array.isArray(j) ? j[0]?.error?.message : '') || '').slice(0, 160)}`, res.status);
    }
    const msg = j?.choices?.[0]?.message || j?.result?.choices?.[0]?.message;
    if (!msg) throw new ProviderError(`${p.name}: no message`);
    return msg;
  }
}

// ---------------------------------------------------------------- the loop
const parseArgs = s => { if (s && typeof s === 'object') return s; try { return JSON.parse(s || '{}'); } catch { return null; } };
function fromContent(content) {
  const t = String(content || '').trim();
  if (!t) return null;
  const m = /\{[\s\S]*\}/.exec(t.replace(/^```(?:json)?|```$/g, ''));
  if (m) { const j = parseArgs(m[0]); if (j && typeof j.text === 'string') return j; }
  return { text: t, cards: [] };
}

// Tool results go back to the model compactly (they are re-sent on every later round and count against free-tier
// per-minute token limits; one oversized round makes a provider reject the whole request): record ids are dropped
// (the model never needs them; cards resolve from raw results), and long lists are halved, with a note saying so, until
// the result fits its share of the round budget. Always valid JSON.
const ROUND_BUDGET = 7000, RESULT_MIN = 1500, RESULT_MAX = 4000;
const noIds = xs => (Array.isArray(xs) ? xs.map(x => { if (!x || typeof x !== 'object') return x; const { id, ...rest } = x; return rest; }) : xs);
export function compactResult(out, max = RESULT_MAX) {
  if (!out || typeof out !== 'object') return JSON.stringify(out ?? null).slice(0, max);
  const o = { ...out };
  for (const k of ['items', 'goals', 'groups']) if (Array.isArray(o[k])) o[k] = noIds(o[k]);
  if (Array.isArray(o.goals) && Array.isArray(o.items)) delete o.items;          // query_goals sends the same list twice
  for (const k of ['items', 'goals', 'groups']) {
    while (Array.isArray(o[k]) && o[k].length > 3 && JSON.stringify(o).length > max) { o[k] = o[k].slice(0, Math.ceil(o[k].length / 2)); o.truncated = `${k} cut to ${o[k].length}; narrow the period or filters for more`; }
  }
  const j = JSON.stringify(o);
  return j.length <= max ? j : JSON.stringify({ error: 'result too large', hint: 'use a shorter period, a filter or group_by' });
}
const shareOf = n => Math.max(RESULT_MIN, Math.min(RESULT_MAX, Math.floor(ROUND_BUDGET / Math.max(1, n))));

// One turn with one provider: plan → act (tool calls, independent ones in parallel) → observe, ≤ MAX_TOOL_STEPS rounds,
// then the reply tool. Returns { text, cards (raw), suggestions (raw), steps, tools, calls }.
async function turn(p, base, ctx) {
  const messages = [...base];
  const used = [], ran = [];
  for (let step = 0; step <= MAX_TOOL_STEPS; step++) {
    const msg = await complete(p, messages, { force: step === MAX_TOOL_STEPS });
    const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls.filter(c => c?.function?.name) : [];
    const reply = calls.find(c => c.function.name === 'reply');
    if (reply) {
      const a = parseArgs(reply.function.arguments);
      if (!a || typeof a.text !== 'string') throw new ProviderError(`${p.name}: malformed reply`);
      return { text: a.text, cards: a.cards, suggestions: a.suggestions, steps: step, tools: used, calls: ran };
    }
    if (!calls.length) {
      const r = fromContent(msg.content);
      if (!r) throw new ProviderError(`${p.name}: empty answer`);
      return { ...r, steps: step, tools: used, calls: ran };
    }
    if (step === MAX_TOOL_STEPS) break;
    const batch = calls.slice(0, 6);
    messages.push({ role: 'assistant', content: msg.content || '', tool_calls: batch });
    // independent calls of one round run in parallel (they share the request's per-collection read cache)
    const outs = await Promise.all(batch.map(async c => {
      const name = c.function.name, args = parseArgs(c.function.arguments);
      if (!TOOL_NAMES.includes(name)) return { error: `unknown tool ${String(name).slice(0, 40)}; use one of ${TOOL_NAMES.join(', ')}` };
      if (!args) return { error: 'arguments were not valid JSON' };
      try {
        const params = TOOLS[name].clean(args);
        const out = await runTool(name, params, ctx);
        used.push(name); ran.push({ name, params, out });
        return out;
      } catch (e) { console.warn('[chat] tool failed', name, e.message); return { error: 'could not read that data right now' }; }
    }));
    batch.forEach((c, i) => messages.push({ role: 'tool', tool_call_id: c.id, content: compactResult(outs[i], shareOf(batch.length)) }));
  }
  return { text: 'I looked through your data but could not put an answer together. Try asking it a simpler way.', cards: [], steps: MAX_TOOL_STEPS, tools: used, calls: ran };
}

// Try each configured provider in order; a provider that errors (quota 429, 5xx, timeout, malformed) hands the whole turn to the next.
export async function runChain(base, ctx, list = providers()) {
  const errors = [], started = Date.now(), budget = +(env('AGENT_CHAT_BUDGET_MS') || 40_000);
  const now = Date.now(), ready = list.filter(p => !(cooldown.get(p.name) > now));
  for (const p of (ready.length ? ready : list)) {
    if (Date.now() - started > budget) { errors.push(`${p.name}: skipped (time budget)`); continue; }
    try { return { ...(await turn(p, base, ctx)), provider: p.name, errors }; }
    catch (e) { if (!(e instanceof ProviderError)) throw e; errors.push(e.message); console.warn('[chat]', e.message); }
  }
  const err = new AgentError(502, 'I could not reach a model right now. Try again in a minute.');
  // coarse, safe reasons per provider (no provider text): lets ops tell quota from bad output without AGENT_DEBUG
  err.reasons = errors.map(m => { const [name] = m.split(/[ :]/); const code = /\b429\b/.test(m) ? 'rate_limited' : /timeout/.test(m) ? 'timeout' : /time budget/.test(m) ? 'skipped'
    : /malformed|empty answer|no message/.test(m) ? 'bad_output' : /\b400\b/.test(m) ? 'rejected' : /\b5\d\d\b/.test(m) ? 'provider_down' : /\b40[13]\b/.test(m) ? 'auth' : 'error'; return `${name}:${code}`; });
  if (env('AGENT_DEBUG')) err.message += ` [${errors.join(' | ').slice(0, 900)}]`;
  throw err;
}

// ---------------------------------------------------------------- storage helpers (all under RLS)
const nowParts = tz => { const at = Date.now(); const z = zoned(at, tz); const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(new Date(at));
  return { at, tz, date: z.date, time: `${String(z.hour).padStart(2, '0')}:${String(z.minute).padStart(2, '0')}`, weekday: wd }; };
export const toolCtx = (ownerId, now) => ({ ...dataAccess((text, params) => withOwner(ownerId, c => c.query(text, params))), tx: fn => withOwner(ownerId, fn), today: now.date, tz: now.tz, at: now.at });
const titleFrom = m => { const t = m.replace(/\s+/g, ' ').trim(); return t.length > 60 ? `${t.slice(0, 59)}…` : t; };
const msgOut = (r, cards) => ({ id: String(r.id), role: r.role, text: r.text, cards, suggestions: r.role === 'assistant' && Array.isArray(r.suggestions) ? r.suggestions : [], createdAt: new Date(r.created_at).getTime(), meta: r.meta || {} });

const resolver = ctx => cards => resolveCards(cards, (tool, params) => runTool(tool, params, ctx), { today: ctx.today });

// ---------------------------------------------------------------- profile context (bounded, one SQL statement)
// A compact picture of the user's data for the prompt, the same size whatever the data size: counts per collection,
// today's tasks, ≤ 6 active goal titles, ≤ 5 tags, ≤ 5 spend categories this month, whether a budget is set.
// Aggregated in Postgres (no rows come back), so it costs one short statement per turn.
const dayStartMs = (date, tz) => { const guess = Date.parse(`${date}T00:00:00Z`); const z = zoned(guess, tz); const wall = Date.parse(`${z.date}T${String(z.hour).padStart(2, '0')}:${String(z.minute).padStart(2, '0')}:00Z`); return guess - (wall - guess); };
export async function profileContext(ctx) {
  const start = dayStartMs(ctx.today, ctx.tz), end = dayStartMs(addDays(ctx.today, 1), ctx.tz);
  const OWN = 'owner_id = app_owner() and not deleted';
  const { rows } = await ctx.sql(`select
    (select coalesce(json_object_agg(coll, n), '{}') from (select coll, count(*) n from records where ${OWN} group by coll) a) counts,
    (select count(*) from records where ${OWN} and coll = 'tasks' and data->>'status' = 'done' and data->>'doneAt' ~ '^[0-9]+$' and (data->>'doneAt')::bigint >= $2 and (data->>'doneAt')::bigint < $3) done_today,
    (select count(*) from records where ${OWN} and coll = 'tasks' and coalesce(data->>'status', 'open') = 'open' and data->>'dueDate' = $1) open_today,
    (select count(*) from records where ${OWN} and coll = 'tasks' and coalesce(data->>'status', 'open') = 'open' and data->>'dueDate' < $1) overdue,
    (select coalesce(json_agg(t), '[]') from (select data->>'title' t from records where ${OWN} and coll = 'goals' and coalesce(data->>'archived', 'false') <> 'true'
       order by case when data->>'order' ~ '^-?[0-9.]+$' then (data->>'order')::numeric end nulls last limit 6) g) goals,
    (select coalesce(json_agg(tag), '[]') from (select tag from records, jsonb_array_elements_text(case when jsonb_typeof(data->'tags') = 'array' then data->'tags' else '[]'::jsonb end) tag
       where ${OWN} and coll = 'thoughts' group by tag order by count(*) desc, tag limit 5) t) tags,
    (select coalesce(json_agg(c), '[]') from (select coalesce(data->>'category', 'Other') c from records where ${OWN} and coll = 'money' and coalesce(data->>'kind', 'expense') = 'expense'
       and data->>'date' >= $4 and data->>'date' <= $1 group by 1 order by sum(case when data->>'amount' ~ '^-?[0-9.]+$' then (data->>'amount')::numeric else 0 end) desc limit 5) m) categories,
    (select count(*) > 0 from records where ${OWN} and coll = 'meta' and id = 'budgets' and coalesce(data->>'total', '0') not in ('0', '')) budget`,
  [ctx.today, start, end, `${ctx.today.slice(0, 7)}-01`]);
  const r = rows[0] || {};
  return { counts: r.counts || {}, today: { done: +r.done_today || 0, open: +r.open_today || 0, overdue: +r.overdue || 0 }, goals: r.goals || [], tags: r.tags || [], categories: r.categories || [], budget: !!r.budget };
}

// Final reply → stored specs + suggestions. If the answer is about data (tools ran) but carries no data card, the
// deterministic UI layer attaches the best card(s) for the calls that were made (pickCards). Exported for tests.
export function finishReply(reply, { today, asked }) {
  let { cards, dropped } = validateCards(reply.cards, { today });
  let auto = 0;
  if (!hasDataCard(cards) && reply.calls?.length) {
    const extra = validateCards(pickCards(reply.calls), { today }).cards;
    auto = extra.length;
    cards = validateCards([...extra, ...cards], { today }).cards.slice(0, MAX_CARDS);
  }
  let suggestions = cleanSuggestions(reply.suggestions, { asked });
  if (!suggestions.length && reply.tools?.length) suggestions = fallbackSuggestions(reply.tools, asked);
  return { cards, dropped, auto, suggestions };
}

export async function chat(ownerId, { chatId, message, tz }) {
  const text = String(message ?? '').replace(/\u0000/g, '').trim();
  if (!text) throw new AgentError(400, 'Type a question first.');
  if (text.length > MAX_MESSAGE) throw new AgentError(413, `Keep it under ${MAX_MESSAGE} characters.`);
  if (chatId != null && !/^[0-9a-f-]{36}$/i.test(String(chatId))) throw new AgentError(400, 'Unknown chat.');
  const list = providers();
  if (!list.length) throw new AgentError(503, "Chat isn't set up on this Steady yet. Everything else works as usual.");
  const now = nowParts(safeTz(typeof tz === 'string' ? tz : 'Asia/Kolkata'));
  const t0 = Date.now();

  // 1. history + cache key (only a chat's first question is cached: the answer then depends on nothing but the question,
  //    the user's data, and the day)
  const { history, cacheKey, cached } = await withOwner(ownerId, async c => {
    let history = [];
    if (chatId) {
      const ch = (await c.query('select id from agent_chats where id = $1 and owner_id = app_owner()', [chatId])).rows[0];
      if (!ch) throw new AgentError(404, 'That chat is gone.');
      history = (await c.query('select role, text, cards from agent_messages where chat_id = $1 and owner_id = app_owner() order by id desc limit $2', [chatId, HISTORY])).rows.reverse();
    }
    if (history.length) return { history };
    const seq = (await c.query('select coalesce(max(seq), 0)::text s from records where owner_id = app_owner()')).rows[0].s;
    const cacheKey = createHash('sha256').update(JSON.stringify([text.toLowerCase().replace(/\s+/g, ' '), seq, now.date, now.tz])).digest('hex');
    const hit = (await c.query(`select text, cards, meta, suggestions from agent_messages where owner_id = app_owner() and role = 'assistant' and cache_key = $1
      and created_at > now() - make_interval(secs => $2) order by id desc limit 1`, [cacheKey, CACHE_MS() / 1000])).rows[0];
    return { history, cacheKey, cached: hit || null };
  });

  // 2. the model (skipped on a cache hit, which is not counted against the cap). One request-scoped data context is
  //    shared by the profile, every tool call of every provider attempt, and card resolution (each collection is read
  //    at most once per request). Embedding back-fill runs alongside the model call and never delays the reply much.
  const ctx = toolCtx(ownerId, now);
  let reply, backfill = null;
  if (cached) reply = { text: cached.text, cards: cached.cards, suggestions: cached.suggestions || [], provider: cached.meta?.provider || null, steps: 0, tools: [], cached: true, errors: [] };
  else {
    await countUse(ownerId, 'chat', { limit: CHAT_CAP(), what: 'chat' });
    backfill = backfillEmbeddings(fn => withOwner(ownerId, fn));
    const profile = await profileContext(ctx).catch(e => { console.warn('[chat] profile skipped:', e.message); return null; });
    const base = [{ role: 'system', content: systemPrompt(now, profile) },
      ...history.map(h => ({ role: h.role, content: h.role === 'assistant' && h.cards?.length ? `${h.text}\n[cards shown: ${h.cards.map(describeCard).join('; ')}]` : h.text })),
      { role: 'user', content: text }];
    try { reply = await runChain(base, ctx, list); }
    catch (e) { if (e.status === 502) await refundUse(ownerId, 'chat').catch(() => {}); throw e; }
  }
  const replyText = String(reply.text || '').replace(/\u0000/g, '').trim().slice(0, 2000) || 'Here is what I found.';
  const { cards, dropped, auto, suggestions } = reply.cached ? { cards: reply.cards || [], dropped: [], auto: 0, suggestions: reply.suggestions } : finishReply(reply, { today: now.date, asked: text });
  const meta = { provider: reply.provider, steps: reply.steps, tools: reply.tools, ms: Date.now() - t0, ...(reply.cached ? { cached: true } : {}), ...(dropped.length ? { dropped } : {}), ...(auto ? { autoCards: auto } : {}), ...(reply.errors?.length ? { fellBack: reply.errors.length } : {}) };

  // 3. store, then resolve the cards from real rows (fresh reads, after the reply is saved)
  const saved = await withOwner(ownerId, async c => {
    let id = chatId, title;
    if (!id) {
      const r = (await c.query('insert into agent_chats (owner_id, title) values (app_owner(), $1) returning id, title', [titleFrom(text)])).rows[0];
      id = r.id; title = r.title;
    } else title = (await c.query('update agent_chats set updated_at = now() where id = $1 and owner_id = app_owner() returning title', [id])).rows[0]?.title;
    const u = (await c.query("insert into agent_messages (chat_id, owner_id, role, text) values ($1, app_owner(), 'user', $2) returning id, role, text, created_at, meta", [id, text])).rows[0];
    const a = (await c.query(`insert into agent_messages (chat_id, owner_id, role, text, cards, meta, cache_key, suggestions) values ($1, app_owner(), 'assistant', $2, $3, $4, $5, $6)
      returning id, role, text, created_at, meta, suggestions`, [id, replyText, JSON.stringify(cards), JSON.stringify(meta), cacheKey || null, JSON.stringify(suggestions || [])])).rows[0];
    return { id, title, u, a };
  });
  const resolved = await resolver(ctx)(cards);
  if (backfill) await Promise.race([backfill, new Promise(r => setTimeout(r, 1500))]);
  return { chatId: saved.id, title: saved.title, user: msgOut(saved.u, []), message: msgOut(saved.a, resolved), provider: reply.provider, cached: !!reply.cached };
}

export async function listChats(ownerId) {
  const rows = await withOwner(ownerId, async c => (await c.query(
    `select ch.id, ch.title, ch.created_at, ch.updated_at,
       (select text from agent_messages m where m.chat_id = ch.id and m.owner_id = app_owner() and m.role = 'assistant' order by m.id desc limit 1) as preview
     from agent_chats ch where ch.owner_id = app_owner() order by ch.updated_at desc limit 100`)).rows);
  return { chats: rows.map(r => ({ id: r.id, title: r.title, preview: (r.preview || '').slice(0, 120), createdAt: new Date(r.created_at).getTime(), updatedAt: new Date(r.updated_at).getTime() })) };
}

export async function getChat(ownerId, id, tz) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new AgentError(404, 'That chat is gone.');
  const now = nowParts(safeTz(typeof tz === 'string' ? tz : 'Asia/Kolkata'));
  const { ch, rows } = await withOwner(ownerId, async c => {
    const ch = (await c.query('select id, title, created_at, updated_at from agent_chats where id = $1 and owner_id = app_owner()', [id])).rows[0];
    if (!ch) throw new AgentError(404, 'That chat is gone.');
    const rows = (await c.query('select id, role, text, cards, meta, suggestions, created_at from agent_messages where chat_id = $1 and owner_id = app_owner() order by id desc limit 100', [id])).rows.reverse();
    return { ch, rows };
  });
  const resolve = resolver(toolCtx(ownerId, now));          // one data read per collection for the whole chat
  const messages = [];
  for (const r of rows) messages.push(msgOut(r, r.role === 'assistant' ? await resolve(r.cards || []) : []));
  return { chat: { id: ch.id, title: ch.title, createdAt: new Date(ch.created_at).getTime(), updatedAt: new Date(ch.updated_at).getTime() }, messages };
}

export async function renameChat(ownerId, id, title) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new AgentError(404, 'That chat is gone.');
  const t = String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!t) throw new AgentError(400, 'Give the chat a name.');
  const n = await withOwner(ownerId, async c => (await c.query('update agent_chats set title = $2 where id = $1 and owner_id = app_owner()', [id, t])).rowCount);
  if (!n) throw new AgentError(404, 'That chat is gone.');
  return { id, title: t };
}

export async function deleteChat(ownerId, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new AgentError(404, 'That chat is gone.');
  const n = await withOwner(ownerId, async c => (await c.query('delete from agent_chats where id = $1 and owner_id = app_owner()', [id])).rowCount);
  if (!n) throw new AgentError(404, 'That chat is gone.');
  return { deleted: true };
}

// ---------------------------------------------------------------- starter (empty-chat state, no model call)
// GET /api/agent/chat/starter → { text, cards: [resolved], suggestions: [string] }. Deterministic: a headline built from
// the user's own figures (today's tasks, else this week's spending, else goals) and 3–4 chips that fit what they track.
export async function starter(ownerId, { tz } = {}) {
  const now = nowParts(safeTz(typeof tz === 'string' ? tz : 'Asia/Kolkata'));
  const ctx = toolCtx(ownerId, now);
  const p = await profileContext(ctx);
  const c = p.counts || {}, t = p.today;
  const specs = [], chips = [];
  let text = '';
  const planned = t.done + t.open;
  if (planned > 0) {
    specs.push({ component: 'Stat', title: 'Today', query: { tool: 'query_tasks', params: { status: 'done', range: 'today' } }, bind: { value: 'count', label: 'tasks done today' } });
    text = t.open ? `${t.done} of ${planned} tasks done today.` : `All ${planned} of today's tasks are done.`;
  }
  if (+c.money > 0) {
    const [wk, lw] = await Promise.all([runTool('query_money', { range: 'this_week' }, ctx), runTool('query_money', { range: 'last_week' }, ctx)]);
    if (wk.total > 0 || lw.total > 0) {
      specs.push({ component: 'Stat', title: 'Spent this week', query: { tool: 'query_money', params: { range: 'this_week' } }, bind: { value: 'total', label: 'spent this week' } });
      if (!text) text = wk.total > lw.total ? 'Spending this week is already past last week.' : 'Here is your week so far.';
    }
  }
  if (!specs.length && (p.goals || []).length) { specs.push({ component: 'ProgressList', title: 'Your goals', query: { tool: 'query_goals', params: {} } }); text = 'Here is where your goals stand.'; }
  if (t.open > 0) chips.push("What's left for today?");
  else if (+c.tasks > 0) chips.push('How did my week go?');
  if (t.overdue > 0) chips.push('Which tasks are overdue?');
  if (+c.money > 0) chips.push('Spending this week vs last');
  if ((p.goals || []).length) chips.push('Which goal is behind?');
  if (+c.thoughts > 0) chips.push('What did I write this week?');
  if (chips.length < 3) chips.push('When do I get most done?', 'Show my week at a glance');
  const { cards } = validateCards(specs.slice(0, 2), { today: now.date });
  return { text, cards: await resolver(ctx)(cards), suggestions: cleanSuggestions(chips, { max: 4 }) };
}
