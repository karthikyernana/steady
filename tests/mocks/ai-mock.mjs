// A stand-in for Sarvam (STT + chat completions) and Gemini (generateContent), for tests and local QA without keys.
// Also the chat agent's OpenAI-compatible tool-calling providers (Groq, Gemini's OpenAI layer, Cloudflare Workers AI):
// see chatCompletion() below. It picks tools from keywords in the question, deterministically, then replies with cards.
// The LLM endpoints answer with Steady's own rules planner run on the prompt they receive, so the reply depends on the
// real utterance + context (refs and all) exactly the way a model's would, and every HTTP code path is exercised.
//   node tests/mocks/ai-mock.mjs 8791          → standalone (point SARVAM_BASE_URL / GEMINI_BASE_URL at it)
import { createServer } from 'node:http';
import { rulesPlan } from '../../js/core/agent.js';

export function createMock({ transcript = process.env.MOCK_TRANSCRIPT || 'spent 250 on lunch at swiggy and finished the DSA problems, remind me to call amma tomorrow at 6pm' } = {}) {
  const calls = [];
  const state = { transcript, geminiStatus: 200, thinkingUnsupported: false, sarvamMode: 'stream', chat: { groq: 200, gemini: 200, cloudflare: 200 }, chatDelayMs: 0 };   // chatDelayMs: a slow model (each chat completion waits that long)
  const planFrom = text => {
    const ctx = /CONTEXT_JSON:\n([\s\S]*?)\n\nUTTERANCE:/.exec(text); const utt = /UTTERANCE:\n<<<([\s\S]*)>>>/.exec(text);
    return rulesPlan(utt ? utt[1] : '', { prompt: JSON.parse(ctx ? ctx[1] : '{}') });
  };
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://x');
    const call = { method: req.method, path: url.pathname, headers: req.headers, size: raw.length };
    calls.push(call);
    const json = (status, body) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
    if (url.pathname === '/speech-to-text') {
      const body = raw.toString('latin1');
      call.fields = Object.fromEntries([...body.matchAll(/name="([^"]+)"\r\n\r\n([^\r]*)\r\n/g)].map(m => [m[1], m[2]]));
      call.hasFile = /name="file"; filename="speech\.\w+"/.test(body);
      if (!req.headers['api-subscription-key']) return json(403, { error: { message: 'Invalid or missing authentication credentials' } });
      return json(200, { request_id: 'mock', transcript: state.transcript, language_code: 'en-IN' });
    }
    const m = /^\/v1beta\/models\/([^/:]+):generateContent$/.exec(url.pathname);
    if (m) {
      const body = JSON.parse(raw.toString('utf8')); call.body = body; call.model = m[1];
      if (!req.headers['x-goog-api-key']) return json(403, { error: { message: 'API key not valid' } });
      if (state.geminiStatus !== 200) return json(state.geminiStatus, { error: { message: 'mock failure' } });
      if (state.thinkingUnsupported && body.generationConfig?.thinkingConfig) return json(400, { error: { message: 'Thinking level is not supported for this model.' } });
      const out = planFrom(body.contents?.[0]?.parts?.[0]?.text || '');
      return json(200, { candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(out) }] }, finishReason: 'STOP' }] });
    }
    if (url.pathname === '/v1/chat/completions') {
      const body = JSON.parse(raw.toString('utf8')); call.body = body;
      if (!req.headers['api-subscription-key']) return json(403, { error: { message: 'Invalid or missing authentication credentials' } });
      const out = planFrom(body.messages?.find(x => x.role === 'user')?.content || '');
      // pretty-printed and then the whitespace run-on seen from the real model, to prove the client stops early
      const text = JSON.stringify(out, null, 2).replace(/\n\}$/, '') + (state.sarvamMode === 'runaway' ? ' \n'.repeat(400) : '\n}');
      if (!body.stream) return json(200, { choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: text } }] });
      res.setHeader('content-type', 'text/event-stream');
      for (let i = 0; i < text.length; i += 40) res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text.slice(i, i + 40) } }] })}\n\n`);
      res.end('data: [DONE]\n\n'); return;
    }
    const chatPath = url.pathname === '/openai/v1/chat/completions' ? 'groq' : url.pathname === '/v1beta/openai/chat/completions' ? 'gemini'
      : /^\/client\/v4\/accounts\/[^/]+\/ai\/v1\/chat\/completions$/.test(url.pathname) ? 'cloudflare' : null;
    if (chatPath) {
      const body = JSON.parse(raw.toString('utf8')); call.body = body; call.provider = chatPath;
      if (!/^Bearer \S+/.test(req.headers.authorization || '')) return json(401, { error: { message: 'Invalid API Key' } });
      // slow mode: the first user message containing "slow" (or every call while chatDelayMs > 0) waits, so tests can switch chats mid-answer
      const slowMs = state.chatDelayMs || (/\bslow\b/i.test(JSON.stringify(body.messages?.filter(x => x.role === 'user').at(-1)?.content || '')) ? 2500 : 0);
      if (slowMs) await new Promise(r => setTimeout(r, Math.min(60_000, slowMs)));
      const st = state.chat[chatPath];
      if (st !== 200) return json(st, { error: { message: st === 429 ? 'Rate limit reached (mock)' : 'mock failure' } });
      return json(200, { id: 'mock', object: 'chat.completion', model: body.model, choices: [{ index: 0, finish_reason: 'tool_calls', message: chatCompletion(body) }] });
    }
    if (url.pathname === '/__mock/state' && req.method === 'POST') { Object.assign(state, JSON.parse(raw.toString('utf8') || '{}')); return json(200, { ok: true, state }); }
    json(404, { error: { message: 'not mocked' } });
  });
  return { server, calls, state, listen: port => new Promise(r => server.listen(port || 0, '127.0.0.1', () => r(server.address().port))), close: () => new Promise(r => server.close(r)) };
}

// ---------------------------------------------------------------- chat agent mock (OpenAI-compatible tool calling)
// Round 1: tool calls chosen from keywords in the last user message. Round 2 (tool results present, or reply forced):
// the reply tool with text quoting a real tool figure, and cards that carry QUERIES plus a few deliberately bad bits
// (made-up numbers, an unknown component) that the server must drop.
let seq = 0;
const tc = (name, args) => ({ id: `call_${++seq}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
export function chatCompletion(body) {
  const msgs = body.messages || [];
  const lastUser = msgs.map((m, i) => [m, i]).filter(([m]) => m.role === 'user').at(-1) || [{ content: '' }, -1];
  let u = String(lastUser[0].content || '').toLowerCase();
  // "show me that visually / as a graph": a follow-up that names no subject means the previous question, drawn as a chart
  if (/visual|graph|chart|plot/.test(u) && !/spen|money|goal|task|due|wrote|thought|idea|streak/.test(u)) {
    const prev = msgs.slice(0, lastUser[1]).filter(m => m.role === 'user').at(-1);
    u = `${String(prev?.content || '').toLowerCase()} trend`;
  }
  const after = msgs.slice(lastUser[1] + 1);
  const results = after.filter(m => m.role === 'tool').map(m => { const call = after.flatMap(a => a.tool_calls || []).find(c => c.id === m.tool_call_id); return { name: call?.function.name, out: JSON.parse(m.content) }; });
  const forced = body.tool_choice?.function?.name === 'reply';
  if (/loop forever/.test(u) && !forced) return { role: 'assistant', content: '', tool_calls: [tc('query_tasks', { status: 'open' })] };
  if (/just text/.test(u)) return { role: 'assistant', content: 'Plain words only, no tools.' };
  if (!results.length && !forced) {
    const calls = [];
    const all = /everything/.test(u);
    if (all || /spen|money|₹|expense|categor|trend|table/.test(u)) calls.push(tc('query_money', { range: /week/.test(u) ? 'this_week' : 'this_month', group_by: 'category' }));
    if (all || /goal|milestone/.test(u)) calls.push(tc('query_goals', {}));
    if (all || /task|todo|due|today/.test(u)) calls.push(tc('query_tasks', { status: 'open', range: 'next_7_days' }));
    const about = /about ([\p{L}\d]+)/u.exec(u);
    if (all || about || /wrote|thought|idea/.test(u)) calls.push(tc('search_thoughts', { query: about?.[1] || 'idea' }));
    if (all || /streak|insight|pattern|how am i/.test(u)) calls.push(tc('get_insights_summary', {}));
    if (calls.length) return { role: 'assistant', content: '', tool_calls: calls };
    return { role: 'assistant', content: '', tool_calls: [tc('reply', { text: 'Ask me about your tasks, goals, money or thoughts.' })] };
  }
  const got = Object.fromEntries(results.map(r => [r.name, r.out]));
  const text = [], cards = [];
  if (got.query_money) {
    const m = got.query_money;
    text.push(m.count ? `You spent ₹${m.total} across ${m.count} entries.` : 'No spending logged for that period yet.');
    const trend = /trend/.test(u), table = /table/.test(u);
    if (!trend && !table) cards.push({ component: 'Stat', title: 'Spent', value: 999999, query: { tool: 'query_money', params: { range: /week/.test(u) ? 'this_week' : 'this_month' } }, bind: { value: 'total', label: 'spent' },
      compare: { params: { range: /week/.test(u) ? 'last_week' : 'last_month' }, label: /week/.test(u) ? 'last week' : 'last month' } });
    if (!trend && !table) cards.push({ component: 'Donut', title: 'By category', data: { points: [{ label: 'Fake', value: 123456 }] }, values: [1, 2, 3], query: { tool: 'query_money', params: { range: /week/.test(u) ? 'this_week' : 'this_month', group_by: 'category' } }, bind: { y: 'sum' } });
    cards.push({ component: 'Script', code: 'alert(1)' });
    if (trend) {
      cards.push({ component: 'Line', title: 'Spending by day', query: { tool: 'query_money', params: { range: 'last_30_days', group_by: 'day' } }, bind: { y: 'sum' } });
      cards.push({ component: 'Bar', title: 'Spending by category', query: { tool: 'query_money', params: { range: 'this_month', group_by: 'category' } }, bind: { y: 'sum' } });
    }
    if (table) {
      cards.push({ component: 'Table', title: 'Latest spends', query: { tool: 'query_money', params: { range: 'this_month', limit: 5 } }, bind: { rows: 'items', columns: ['date', 'note', 'category', 'amount'] } });
    }
  }
  if (got.query_goals) { text.push(got.query_goals.count ? `${got.query_goals.count} goals on the go.` : 'No goals yet.'); cards.push({ component: 'ProgressList', title: 'Goals', query: { tool: 'query_goals', params: {} } }); }
  if (got.query_tasks) { text.push(`${got.query_tasks.count} open tasks coming up.`); cards.push({ component: 'TaskList', title: 'Coming up', query: { tool: 'query_tasks', params: { status: 'open', range: 'next_7_days' } } }); }
  if (got.search_thoughts) { text.push(got.search_thoughts.count ? `Found ${got.search_thoughts.count} thoughts.` : 'Nothing written about that yet.'); cards.push({ component: 'Timeline', title: 'What you wrote', query: { tool: 'search_thoughts', params: { query: got.search_thoughts.query } } }); }
  if (got.get_insights_summary) {
    text.push(`Your streak is ${got.get_insights_summary.streak_current} days.`);
    cards.push({ component: 'Stat', title: 'Streak', query: { tool: 'get_insights_summary', params: {} }, bind: { value: 'streak_current' } });
    cards.push({ component: 'Heatmap', title: 'Finished per day', query: { tool: 'query_tasks', params: { status: 'done', range: 'last_90_days' } }, bind: { y: 'count' } });
    cards.push({ component: 'Callout', tone: 'good', text: 'Small days still count.' });
    cards.push({ component: 'Note', title: 'A thought', text: 'Keep the next step tiny.' });
  }
  if (!text.length) text.push('I checked, but there is nothing there yet.');
  // "everything" asks for more cards than a reply may carry: the server keeps the first MAX_CARDS
  return { role: 'assistant', content: '', tool_calls: [tc('reply', { text: text.join(' '), cards })] };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const m = createMock();
  const port = await m.listen(+process.argv[2] || 8791);
  console.log(`ai mock on http://127.0.0.1:${port}`);
}
