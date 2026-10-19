// Server-side agent pipeline against a local mock of Sarvam + Gemini (no keys, no network, no database).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMock } from '../mocks/ai-mock.mjs';
import { transcribe, runModel, agentConfig, parseJsonLoose } from '../../server/agent.js';
import { buildContext, compactContext, validatePlan, zonedNow } from '../../js/core/agent.js';

let mock;
const ctx = buildContext({ tasks: [{ id: 'task-dsa', title: 'DSA: 2 problems', status: 'open', dueDate: '2026-10-19', createdAt: 1 }], goals: [], money: [], thoughts: [], profile: {} }, { today: '2026-10-19' });
const C = compactContext(ctx, null, zonedNow('Asia/Kolkata', new Date('2026-10-19T09:30:00Z')));
const UTT = 'spent 250 on lunch and finished the DSA problems';
const keys = (g, s) => { if (g) process.env.GEMINI_API_KEY = g; else delete process.env.GEMINI_API_KEY; if (s) process.env.SARVAM_API_KEY = s; else delete process.env.SARVAM_API_KEY; };

before(async () => {
  mock = createMock({ transcript: 'ఈరోజు lunch కి 250 ఖర్చు' });
  const port = await mock.listen();
  process.env.GEMINI_BASE_URL = process.env.SARVAM_BASE_URL = `http://127.0.0.1:${port}`;
});
after(() => mock.close());

test('config reports the provider chain', () => {
  keys('g', 's'); assert.deepEqual(agentConfig(), { voice: true, llm: 'gemini', fallback: 'sarvam' });
  keys(null, 's'); assert.deepEqual(agentConfig(), { voice: true, llm: 'sarvam', fallback: 'rules' });
  keys(null, null); assert.deepEqual(agentConfig(), { voice: false, llm: 'rules', fallback: null });
});

test('Gemini: strict JSON schema request, key in header, validated drafts back', async () => {
  keys('gem-key', null); mock.calls.length = 0;
  const r = await runModel(UTT, C);
  assert.equal(r.provider, 'gemini');
  const call = mock.calls.find(c => c.path.includes('generateContent'));
  assert.equal(call.model, 'gemini-3.8-flash'); assert.equal(call.headers['x-goog-api-key'], 'gem-key');
  const gc = call.body.generationConfig;
  assert.equal(gc.responseMimeType, 'application/json'); assert.equal(gc.thinkingConfig.thinkingLevel, 'low');
  const s = JSON.stringify(gc.responseJsonSchema); assert.ok(!s.includes('additionalProperties') && !/"enum":\[[^\]]*null/.test(s), 'Gemini schema has no null enums');
  assert.match(call.body.systemInstruction.parts[0].text, /Telugu/);
  assert.deepEqual(validatePlan(r.raw, C).drafts.map(d => d.type), ['money', 'complete']);
});

test('Gemini: retries without thinking when the model rejects thinking levels', async () => {
  keys('gem-key', null); mock.state.thinkingUnsupported = true; mock.calls.length = 0;
  const r = await runModel(UTT, C); mock.state.thinkingUnsupported = false;
  assert.equal(r.provider, 'gemini'); assert.equal(mock.calls.filter(c => c.path.includes('generateContent')).length, 2);
});

test('Gemini down → Sarvam sarvam-105b (streamed, schema, no hidden reasoning)', async () => {
  keys('gem-key', 'sv-key'); mock.state.geminiStatus = 503; mock.calls.length = 0;
  const r = await runModel(UTT, C); mock.state.geminiStatus = 200;
  assert.equal(r.provider, 'sarvam'); assert.equal(r.errors.length, 1);
  const call = mock.calls.find(c => c.path === '/v1/chat/completions');
  assert.equal(call.body.model, 'sarvam-105b'); assert.equal(call.body.stream, true); assert.equal(call.body.reasoning_effort, null);
  assert.equal(call.body.response_format.type, 'json_object', 'json_object + the shape spelled out: faster and steadier on sarvam-105b');
  assert.match(call.body.messages[0].content, /The key is "type"/); assert.equal(call.headers['api-subscription-key'], 'sv-key');
  assert.deepEqual(validatePlan(r.raw, C).drafts.map(d => d.type), ['money', 'complete']);
});

test('Sarvam strict-schema mode: whitespace run-on is cut off early and the complete actions are kept', async () => {
  keys(null, 'sv-key'); mock.state.sarvamMode = 'runaway'; process.env.SARVAM_JSON_MODE = 'schema'; mock.calls.length = 0;
  const t0 = Date.now(); const r = await runModel(UTT, C); mock.state.sarvamMode = 'stream'; delete process.env.SARVAM_JSON_MODE;
  assert.equal(mock.calls.find(c => c.path === '/v1/chat/completions').body.response_format.type, 'json_schema');
  assert.equal(r.provider, 'sarvam'); assert.ok(Date.now() - t0 < 3000);
  assert.equal(validatePlan(r.raw, C).drafts.length, 2);
});

test('no keys at all → rules provider, same output contract', async () => {
  keys(null, null);
  const r = await runModel(UTT, C);
  assert.equal(r.provider, 'rules'); assert.deepEqual(validatePlan(r.raw, C).drafts.map(d => d.type), ['money', 'complete']);
});

test('loose JSON: fences, prose, truncation', () => {
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonLoose('Sure! {"a":1} hope that helps'), { a: 1 });
  assert.equal(parseJsonLoose('{"actions":[{"type":"money","amount":5},{"type":"tas').actions.length, 1);
  assert.throws(() => parseJsonLoose('nope'));
});

test('STT: Saaras v3 multipart (file + model + codemix + auto language)', async () => {
  keys(null, 'sv-key'); mock.calls.length = 0;
  const wav = readFileSync(new URL('../fixtures/voice-te-mixed.wav', import.meta.url));
  const r = await transcribe(wav, 'audio/wav');
  assert.equal(r.transcript, 'ఈరోజు lunch కి 250 ఖర్చు');
  const call = mock.calls.find(c => c.path === '/speech-to-text');
  assert.ok(call.hasFile); assert.deepEqual(call.fields, { model: 'saaras:v3', mode: 'codemix', language_code: 'unknown' });
  assert.equal(call.headers['api-subscription-key'], 'sv-key');
});

test('STT: refuses without a key, empty audio, or oversized audio', async () => {
  keys(null, null); await assert.rejects(transcribe(Buffer.from('x'), 'audio/webm'), e => e.status === 501);
  keys(null, 'sv'); await assert.rejects(transcribe(Buffer.alloc(0), 'audio/webm'), e => e.status === 400);
  await assert.rejects(transcribe(Buffer.alloc(4_100_000), 'audio/webm'), e => e.status === 413);
});
