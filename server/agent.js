// Voice agent, server side. Keys live only here (Vercel env); the browser never sees them.
//   STT:  Sarvam Saaras (POST {SARVAM_BASE_URL}/speech-to-text, multipart)        needs SARVAM_API_KEY
//   LLM:  Gemini generateContent with a strict JSON response schema                needs GEMINI_API_KEY   (primary)
//         Sarvam chat completions (OpenAI-compatible, json_schema)                 needs SARVAM_API_KEY   (fallback)
//         rules: deterministic on-server planner (js/core/agent.js)                no key                 (last resort)
// Whatever the provider returns goes through validatePlan(); nothing is written to the user's data here.
import { query, withOwner } from './db.js';
import { RESPONSE_SCHEMA, compactContext, buildPrompt, validatePlan, rulesPlan, learn, emptyMemory, zonedNow, MAX_TEXT } from '../js/core/agent.js';

const env = k => process.env[k] || '';
const SARVAM = () => (env('SARVAM_BASE_URL') || 'https://api.sarvam.ai').replace(/\/+$/, '');
const GEMINI = () => (env('GEMINI_BASE_URL') || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
export const GEMINI_MODEL = () => env('GEMINI_MODEL') || 'gemini-3.8-flash';
export const SARVAM_LLM_MODEL = () => env('SARVAM_LLM_MODEL') || 'sarvam-105b';
export const STT_MODEL = () => env('SARVAM_STT_MODEL') || 'saaras:v3';
const STT_MODE = () => env('SARVAM_STT_MODE') || 'codemix';     // English words stay English, Telugu stays in Telugu script
const DAILY = () => +(env('AGENT_DAILY_LIMIT') || 200);
const GLOBAL_DAILY = () => +(env('AGENT_GLOBAL_DAILY_LIMIT') || 3000);   // all users together, per kind (open sign-ups)

export function agentConfig() {
  const llm = env('GEMINI_API_KEY') ? 'gemini' : env('SARVAM_API_KEY') ? 'sarvam' : 'rules';
  return { voice: !!env('SARVAM_API_KEY'), llm, fallback: llm === 'gemini' && env('SARVAM_API_KEY') ? 'sarvam' : llm === 'rules' ? null : 'rules' };
}

class AgentError extends Error { constructor(status, msg) { super(msg); this.status = status; this.public = true; } }

// ---------------------------------------------------------------- usage cap (per owner, per day, per kind)
export async function countUse(ownerId, kind) {
  const day = zonedNow('Asia/Kolkata').date;
  const n = await withOwner(ownerId, async c => (await c.query(
    `insert into agent_usage (owner_id, day, kind, n) values (app_owner(), $1, $2, 1)
     on conflict (owner_id, day, kind) do update set n = agent_usage.n + 1 returning n`, [day, kind])).rows[0].n);
  if (n > DAILY()) throw new AgentError(429, `That's the daily limit for the voice agent (${DAILY()}). It resets at midnight.`);
  const total = (await query(
    `insert into agent_usage_total (day, kind, n) values ($1, $2, 1)
     on conflict (day, kind) do update set n = agent_usage_total.n + 1 returning n`, [day, kind])).rows[0].n;
  if (total > GLOBAL_DAILY()) throw new AgentError(429, 'The voice agent is resting for today. It resets at midnight; typing still works.');
}

// ---------------------------------------------------------------- memory
export async function getMemory(ownerId) {
  const rows = await withOwner(ownerId, async c => (await c.query('select data from agent_memory where owner_id = app_owner()')).rows);
  return { ...emptyMemory(), ...(rows[0]?.data || {}) };
}
export async function saveMemory(ownerId, data) {
  await withOwner(ownerId, c => c.query(
    `insert into agent_memory (owner_id, data, updated_at) values (app_owner(), $1, now())
     on conflict (owner_id) do update set data = excluded.data, updated_at = now()`, [JSON.stringify(data)]));
}
export async function resetMemory(ownerId) { await withOwner(ownerId, c => c.query('delete from agent_memory where owner_id = app_owner()')); }
export function memorySummary(m) {
  return {
    accepted: m.accepted || 0, edited: m.edited || 0,
    categories: Object.entries(m.categories || {}).slice(0, 12).map(([name, n]) => ({ name, n })),
    payees: Object.values(m.payees || {}).slice(0, 12).map(p => ({ name: p.name, category: p.category })),
    corrections: (m.corrections || []).slice(0, 12).map(x => ({ word: x.w, category: x.c })),
  };
}

// ---------------------------------------------------------------- STT (Sarvam Saaras)
const AUDIO_TYPES = /^audio\/(webm|ogg|mp4|mpeg|mp3|wav|x-wav|wave|aac|m4a|x-m4a|flac|amr)(;.*)?$/i;
export async function transcribe(buf, mime) {
  if (!env('SARVAM_API_KEY')) throw new AgentError(501, 'Voice is not set up on this Steady yet (SARVAM_API_KEY). You can still type.');
  if (!buf?.length) throw new AgentError(400, 'No audio received.');
  if (buf.length > 4_000_000) throw new AgentError(413, 'That recording is too long. Keep it under 30 seconds.');
  const type = AUDIO_TYPES.test(mime || '') ? mime.split(';')[0] : 'audio/webm';
  const ext = { 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/aac': 'aac', 'audio/flac': 'flac', 'audio/amr': 'amr' }[type] || 'webm';
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type }), `speech.${ext}`);
  fd.append('model', STT_MODEL());
  if (STT_MODEL() === 'saaras:v3') fd.append('mode', STT_MODE());   // `mode` is a saaras:v3 parameter
  fd.append('language_code', env('SARVAM_STT_LANGUAGE') || 'unknown');
  const t0 = Date.now();
  // One quiet retry for a busy (429) or flaky (5xx / network) moment: several quick turns in a row shouldn't surface an error.
  let res, j = {};
  for (let attempt = 0; attempt < 2; attempt++) {
    try { res = await fetch(`${SARVAM()}/speech-to-text`, { method: 'POST', headers: { 'api-subscription-key': env('SARVAM_API_KEY') }, body: fd, signal: AbortSignal.timeout(20_000) }); }
    catch (e) { if (attempt) throw new AgentError(502, `Speech service did not answer (${e.name === 'TimeoutError' ? 'timeout' : 'network'}). Try again or type it.`); await new Promise(r => setTimeout(r, 600)); continue; }
    j = await res.json().catch(() => ({}));
    if (res.ok || attempt || !(res.status === 429 || res.status >= 500)) break;
    console.warn('[stt] retrying after', res.status);
    await new Promise(r => setTimeout(r, res.status === 429 ? 900 : 500));
  }
  if (!res.ok) { console.warn('[stt]', res.status, JSON.stringify(j).slice(0, 300)); throw new AgentError(res.status === 429 ? 429 : 502, res.status === 429 ? 'The speech service is busy. Try again in a moment.' : "Couldn't transcribe that. Try again or type it."); }
  return { transcript: String(j.transcript || '').trim().slice(0, MAX_TEXT), language: j.language_code || null, ms: Date.now() - t0, model: STT_MODEL() };
}

// ---------------------------------------------------------------- LLM providers
// Gemini accepts JSON-Schema type arrays with "null" but not null inside enum: strip it.
function geminiSchema(s) {
  if (Array.isArray(s)) return s.map(geminiSchema);
  if (!s || typeof s !== 'object') return s;
  const o = {};
  for (const [k, v] of Object.entries(s)) o[k] = k === 'enum' ? v.filter(x => x !== null) : k === 'additionalProperties' ? undefined : geminiSchema(v);
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}
export function parseJsonLoose(text) {
  const t = String(text || '').replace(/^\uFEFF/, '').trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(t); if (fenced) { try { return JSON.parse(fenced[1]); } catch { /* fall through */ } }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* fall through */ } }
  const salvaged = salvageActions(t);
  if (salvaged) return salvaged;
  throw new AgentError(502, 'The model replied with something that was not JSON.');
}
// Keep every COMPLETE action object from a truncated reply (a cut-off last action is dropped, never guessed).
export function salvageActions(t) {
  const k = t.indexOf('"actions"'); if (k < 0) return null;
  const a = t.indexOf('[', k); if (a < 0) return null;
  const out = []; let depth = 0, inStr = false, esc = false, start = -1;
  for (let i = a + 1; i < t.length; i++) {
    const ch = t[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}') { depth--; if (depth === 0 && start >= 0) { try { out.push(JSON.parse(t.slice(start, i + 1))); } catch { /* skip */ } start = -1; } }
    else if (ch === ']' && depth === 0) break;
  }
  return out.length ? { language: 'other', clarification: null, actions: out } : null;
}

async function gemini(system, user, { thinking = env('GEMINI_THINKING') || 'low' } = {}) {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 4096, responseMimeType: 'application/json', responseJsonSchema: geminiSchema(RESPONSE_SCHEMA),
      ...(thinking && thinking !== 'off' ? { thinkingConfig: { thinkingLevel: thinking } } : {}) },
  };
  const res = await fetch(`${GEMINI()}/v1beta/models/${encodeURIComponent(GEMINI_MODEL())}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env('GEMINI_API_KEY') }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  const j = await res.json().catch(() => ({}));
  if (res.status === 400 && thinking !== 'off' && /thinking/i.test(JSON.stringify(j))) return gemini(system, user, { thinking: 'off' }); // model without thinking levels
  if (!res.ok) throw new AgentError(502, `gemini ${res.status}: ${String(j.error?.message || '').slice(0, 160)}`);
  const parts = j.candidates?.[0]?.content?.parts || [];
  const text = parts.filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('');
  if (!text) throw new AgentError(502, `gemini returned no text (${j.candidates?.[0]?.finishReason || 'unknown'})`);
  return parseJsonLoose(text);
}

// Scans streamed JSON: 'done' when the top-level object closed; 'stalled' when the model finished the actions array but
// keeps emitting whitespace instead of the closing brace (seen with sarvam-105b + strict schema). Either way we stop early.
export function jsonProgress(t) {
  let depth = 0, inStr = false, esc = false, started = false, lastSig = '', trailingWs = 0;
  for (const ch of t) {
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; trailingWs = 0; continue; }
    if (ch === '"') { inStr = true; trailingWs = 0; lastSig = ch; continue; }
    if (ch === '{' || ch === '[') { depth++; started = true; } else if (ch === '}' || ch === ']') depth--;
    if (/\s/.test(ch)) trailingWs++; else { trailingWs = 0; lastSig = ch; }
    if (started && depth === 0) return 'done';
  }
  if (started && depth === 1 && lastSig === ']' && trailingWs > 24) return 'stalled';
  if (started && trailingWs > 80) return 'stalled';                       // whitespace runaway anywhere: stop, salvage what is complete
  return 'partial';
}
export function closeJson(t) { const s = t.trimEnd(); return jsonProgress(s) === 'done' ? s : s.replace(/,\s*$/, '') + '}'; }

// json_object by default: measured faster (~2-4 s vs 8-20 s) and steadier than strict json_schema on sarvam-105b,
// which tends to run on with whitespace. SARVAM_JSON_MODE=schema switches back to schema-constrained decoding.
async function sarvam(system, user, { strict = false } = {}) {
  const body = {
    model: SARVAM_LLM_MODEL(), temperature: 0.2, max_tokens: 2500, stream: true,
    reasoning_effort: env('SARVAM_REASONING') ? env('SARVAM_REASONING') : null,    // null = no hidden reasoning: ~3x faster here
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: strict ? { type: 'json_schema', json_schema: { name: 'steady_actions', schema: RESPONSE_SCHEMA, strict: true } } : { type: 'json_object' },
  };
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 25_000);
  let res;
  try {
    res = await fetch(`${SARVAM()}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'api-subscription-key': env('SARVAM_API_KEY') }, body: JSON.stringify(body), signal: ctl.signal });
  } catch (e) { clearTimeout(timer); throw new AgentError(502, `sarvam: ${e.name}`); }
  if (!res.ok) {
    clearTimeout(timer);
    const j = await res.json().catch(() => ({}));
    if (res.status === 400 && strict) return sarvam(system, user, { strict: false });   // schema feature not accepted: plain JSON mode
    throw new AgentError(502, `sarvam ${res.status}: ${String(j.error?.message || '').slice(0, 160)}`);
  }
  let text = '', buf = '';
  const dec = new TextDecoder();
  try {
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('event-stream')) { const j = await res.json(); text = j.choices?.[0]?.message?.content || ''; }
    else {
      outer: for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim(); if (data === '[DONE]') break outer;
          try { text += JSON.parse(data).choices?.[0]?.delta?.content || ''; } catch { /* keep-alive or partial */ }
        }
        const st = jsonProgress(text);
        if (st !== 'partial') { ctl.abort(); break; }
      }
    }
  } catch (e) { if (e.name !== 'AbortError') throw new AgentError(502, `sarvam stream: ${e.message}`); }
  finally { clearTimeout(timer); }
  if (!text.trim()) throw new AgentError(502, 'sarvam returned no content');
  try { return parseJsonLoose(closeJson(text)); }
  catch (e) { if (env('AGENT_DEBUG')) console.warn('[sarvam raw]', JSON.stringify(text.slice(0, 400)), '…', JSON.stringify(text.slice(-300))); throw e; }
}

// Try the configured provider, fall back down the chain. Returns { raw, provider, errors }.
export async function runModel(text, compact) {
  const { system, user } = buildPrompt(text, compact);
  const chain = [];
  if (env('GEMINI_API_KEY')) chain.push(['gemini', () => gemini(system, user)]);
  if (env('SARVAM_API_KEY') && env('AGENT_SARVAM_LLM') !== 'off') {
    const strict = env('SARVAM_JSON_MODE') === 'schema';
    const p = buildPrompt(text, compact, { shapeHint: !strict });
    chain.push(['sarvam', () => sarvam(p.system, p.user, { strict })]);
  }
  chain.push(['rules', async () => rulesPlan(text, compact)]);
  const errors = [];
  for (const [name, fn] of chain) {
    try { return { raw: await fn(), provider: name, errors }; }
    catch (e) { errors.push(`${name}: ${e.message}`); console.warn('[agent]', name, e.message); }
  }
  throw new AgentError(502, 'The agent could not understand that right now.');
}

export async function plan(ownerId, { text, context, tz }) {
  const utter = String(text || '').trim().slice(0, MAX_TEXT);
  if (!utter) throw new AgentError(400, 'Say or type something first.');
  const memory = await getMemory(ownerId);
  const now = zonedNow(typeof tz === 'string' ? tz : 'Asia/Kolkata');
  const compact = compactContext(context, memory, now);
  const t0 = Date.now();
  const { raw, provider, errors } = await runModel(utter, compact);
  const known = Object.keys(memory.categories || {});
  const v = validatePlan(raw, compact, { known });
  return { ...v, provider, fellBack: errors.length > 0, ms: Date.now() - t0, today: now.date };
}

export async function learnFrom(ownerId, pairs) {
  const m = learn(await getMemory(ownerId), pairs);
  await saveMemory(ownerId, m);
  return memorySummary(m);
}

export { AgentError };
