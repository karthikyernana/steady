// A stand-in for Sarvam (STT + chat completions) and Gemini (generateContent), for tests and local QA without keys.
// The LLM endpoints answer with Steady's own rules planner run on the prompt they receive, so the reply depends on the
// real utterance + context (refs and all) exactly the way a model's would, and every HTTP code path is exercised.
//   node tests/mocks/ai-mock.mjs 8791          → standalone (point SARVAM_BASE_URL / GEMINI_BASE_URL at it)
import { createServer } from 'node:http';
import { rulesPlan } from '../../js/core/agent.js';
import { ruleTag } from '../../js/core/journal.js';
// journal: tag with the rules tagger; reflect with a fixed set of views keyed off the digest
const journalReply = (system, text) => {
  if (/file each one/.test(system)) return { entries: [...text.matchAll(/^\[([^\]]+)\] (.*)$/gm)].map(m => ({ id: m[1], ...ruleTag(m[2]) })) };
  const metric = /Metrics \(id: [^)]*\): ([^:;]+):/.exec(text)?.[1]?.trim();
  return { headline: 'Learning showed up most this fortnight, and your mood rises on gym days.', prompt: 'What made today’s DSA session click?',
    cards: [{ kind: 'balance', area: null, metric: null, title: 'Where your days went', text: 'Mostly learning and building.' },
      ...(metric && metric !== 'none.' ? [{ kind: 'metric', area: 'learning', metric, title: 'Tracked', text: 'Mock metric card.' }] : []),
      { kind: 'mood', area: null, metric: null, title: 'How you felt', text: 'Mock mood.' }, { kind: 'streak', area: 'learning', metric: null, title: 'Learning streak', text: 'Mock streak.' }] };
};

export function createMock({ transcript = process.env.MOCK_TRANSCRIPT || 'spent 250 on lunch at swiggy and finished the DSA problems, remind me to call amma tomorrow at 6pm' } = {}) {
  const calls = [];
  const state = { transcript, geminiStatus: 200, thinkingUnsupported: false, sarvamMode: 'stream' };
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
      const sys = body.systemInstruction?.parts?.[0]?.text || '', userText = body.contents?.[0]?.parts?.[0]?.text || '';
      const out = /journal/i.test(sys) && !/capture agent/.test(sys) ? journalReply(sys, userText) : planFrom(userText);
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
    json(404, { error: { message: 'not mocked' } });
  });
  return { server, calls, state, listen: port => new Promise(r => server.listen(port || 0, '127.0.0.1', () => r(server.address().port))), close: () => new Promise(r => server.close(r)) };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const m = createMock();
  const port = await m.listen(+process.argv[2] || 8791);
  console.log(`ai mock on http://127.0.0.1:${port}`);
}
