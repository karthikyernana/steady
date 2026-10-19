// /api/agent/* + money sync against a real local Postgres (non-superuser role, so RLS applies) and the AI mock.
// Needs TEST_DATABASE_URL (this file wipes that database's public schema). Run: npm run test:api
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createMock } from '../mocks/ai-mock.mjs';

const DB = process.env.TEST_DATABASE_URL;
if (!DB) test('agent api tests skipped (no TEST_DATABASE_URL)', () => {});
else {
  let base, srv, mock;
  before(async () => {
    process.env.DATABASE_URL = DB;
    mock = createMock({ transcript: 'spent 250 on lunch at swiggy and finished the DSA problems' });
    const mp = await mock.listen();
    Object.assign(process.env, { SARVAM_BASE_URL: `http://127.0.0.1:${mp}`, GEMINI_BASE_URL: `http://127.0.0.1:${mp}`, SARVAM_API_KEY: 'sv-test', GEMINI_API_KEY: 'gm-test', AGENT_DAILY_LIMIT: '6' });
    const { getPool } = await import('../../server/db.js');
    await getPool().query('drop schema public cascade; create schema public;');
    await (await import('../../server/migrate.js')).migrate();
    const { handle } = await import('../../server/routes.js');
    srv = createServer(handle);
    base = await new Promise(r => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));
  });
  after(async () => { srv?.close(); await mock?.close(); await (await import('../../server/db.js')).closePool(); });

  const jar = { a: '', b: '' };
  const call = async (who, method, path, body, { raw, headers = {} } = {}) => {
    const r = await fetch(`${base}/api/${path}`, { method, headers: { 'x-steady': '1', ...(raw ? { 'content-type': 'application/octet-stream' } : { 'content-type': 'application/json' }), ...(jar[who] ? { cookie: jar[who] } : {}), ...headers },
      body: raw || (body ? JSON.stringify(body) : undefined) });
    const sc = r.headers.get('set-cookie'); if (sc) jar[who] = sc.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const context = { tz: 'Asia/Kolkata', tasks: [{ id: 'task-dsa', title: 'DSA: 2 problems', due: '2026-10-19' }], goals: [], money: [], categories: [], thoughts: [], profile: { name: 'K' } };

  test('config advertises voice + provider without leaking keys', async () => {
    const r = await call('a', 'GET', 'config');
    assert.deepEqual(r.body.agent, { voice: true, llm: 'gemini', fallback: 'sarvam' });
    assert.ok(!JSON.stringify(r.body).includes('sv-test') && !JSON.stringify(r.body).includes('gm-test'));
  });
  test('agent routes need a session and the CSRF header', async () => {
    assert.equal((await call('a', 'POST', 'agent/plan', { text: 'x' })).status, 401);
    assert.equal((await call('a', 'POST', 'agent/transcribe', null, { raw: Buffer.from('abc') })).status, 401);
    await call('a', 'POST', 'auth/signup', { email: 'a@example.com', password: 'password-a-123' });
    await call('b', 'POST', 'auth/signup', { email: 'b@example.com', password: 'password-b-123' });
    const r = await fetch(`${base}/api/agent/plan`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: jar.a }, body: '{"text":"x"}' });
    assert.equal(r.status, 403);
  });
  test('transcribe: raw audio bytes in, transcript out (Sarvam mock)', async () => {
    const wav = readFileSync(new URL('../fixtures/voice-te-mixed.wav', import.meta.url));
    const r = await call('a', 'POST', 'agent/transcribe', null, { raw: wav, headers: { 'x-audio-type': 'audio/wav' } });
    assert.equal(r.status, 200); assert.match(r.body.transcript, /lunch/); assert.equal(r.body.model, 'saaras:v3');
    const stt = mock.calls.find(c => c.path === '/speech-to-text'); assert.equal(stt.size > wav.length, true);
  });
  test('plan: drafts with real ids, nothing written to the account', async () => {
    const before = (await call('a', 'GET', 'sync/pull?since=0')).body.records.length;
    const r = await call('a', 'POST', 'agent/plan', { text: 'spent 250 on lunch at swiggy and finished the DSA problems', context, tz: 'Asia/Kolkata' });
    assert.equal(r.status, 200); assert.equal(r.body.provider, 'gemini');
    assert.deepEqual(r.body.drafts.map(d => d.type), ['money', 'complete']);
    assert.equal(r.body.drafts[1].f.taskId, 'task-dsa'); assert.equal(r.body.drafts[0].f.amount, 250);
    assert.equal((await call('a', 'GET', 'sync/pull?since=0')).body.records.length, before, 'planning never writes data');
    assert.equal((await call('a', 'POST', 'agent/plan', { text: '   ', context })).status, 400);
  });
  test('learn: corrections are stored per user (RLS) and fed back into the next prompt', async () => {
    const before = { type: 'money', key: 'a1', evidence: 'rapido 80', f: { kind: 'expense', amount: 80, category: 'Other', payee: 'Rapido', note: 'Rapido', date: '2026-10-19' } };
    const r = await call('a', 'POST', 'agent/learn', { pairs: [{ before, after: { ...before, f: { ...before.f, category: 'Transport' } } }] });
    assert.equal(r.status, 200); assert.deepEqual(r.body.memory.corrections, [{ word: 'rapido', category: 'Transport' }]);
    assert.deepEqual((await call('b', 'GET', 'agent/memory')).body.memory.corrections, [], 'other users never see it');
    mock.calls.length = 0;
    await call('a', 'POST', 'agent/plan', { text: 'rapido 90', context });
    const prompt = mock.calls.find(c => c.path.includes('generateContent')).body.contents[0].parts[0].text;
    assert.match(prompt, /rapido → Transport/); assert.match(prompt, /Rapido → Transport/);
    assert.equal((await call('a', 'POST', 'agent/memory/reset')).status, 200);
    assert.equal((await call('a', 'GET', 'agent/memory')).body.memory.accepted, 0);
  });
  test('money records sync like every other collection', async () => {
    const rec = { coll: 'money', id: 'm1', updatedAt: 10, schemaVersion: 2, data: { id: 'm1', updatedAt: 10, kind: 'expense', amount: 250, category: 'Food', date: '2026-10-19' } };
    assert.equal((await call('a', 'POST', 'sync/push', { records: [rec] })).body.applied, 1);
    const pa = (await call('a', 'GET', 'sync/pull?since=0')).body.records.find(r => r.coll === 'money');
    assert.equal(pa.data.amount, 250); assert.equal(pa.schemaVersion, 2);
    assert.equal((await call('b', 'GET', 'sync/pull?since=0')).body.records.filter(r => r.coll === 'money').length, 0, 'RLS keeps it private');
  });
  test('daily usage cap per user', async () => {
    let last;
    for (let i = 0; i < 7; i++) last = await call('b', 'POST', 'agent/plan', { text: 'note: test', context });
    assert.equal(last.status, 429); assert.match(last.body.error, /daily limit/);
    assert.equal((await call('a', 'POST', 'agent/plan', { text: 'note: still fine', context })).status, 200, 'a separate counter per user');
  });
  test('all-users daily ceiling (open sign-ups cannot multiply the bill)', async () => {
    const { query } = await import('../../server/db.js');
    const day = (await query("select (now() at time zone 'Asia/Kolkata')::date::text d")).rows[0].d;
    process.env.AGENT_GLOBAL_DAILY_LIMIT = '3';
    try {
      await query("insert into agent_usage_total (day, kind, n) values ($1, 'plan', 3) on conflict (day, kind) do update set n = 3", [day]);
      const r = await call('a', 'POST', 'agent/plan', { text: 'note: over the ceiling', context });
      assert.equal(r.status, 429); assert.match(r.body.error, /resting for today/);
    } finally { delete process.env.AGENT_GLOBAL_DAILY_LIMIT; }
  });
  test('voice off: transcribe says so without spending the quota', async () => {
    const { query } = await import('../../server/db.js');
    const n = async () => (await query("select coalesce(sum(n), 0)::int n from agent_usage_total where kind = 'stt'")).rows[0].n;
    const before = await n(); const key = process.env.SARVAM_API_KEY; delete process.env.SARVAM_API_KEY;
    try {
      const r = await call('a', 'POST', 'agent/transcribe', null, { raw: Buffer.from('abc'), headers: { 'x-audio-type': 'audio/webm' } });
      assert.equal(r.status, 501); assert.match(r.body.error, /not set up/);
      assert.deepEqual((await call('a', 'GET', 'config')).body.agent, { voice: false, llm: 'gemini', fallback: 'rules' });
    } finally { process.env.SARVAM_API_KEY = key; }
    assert.equal(await n(), before);
    const big = await call('a', 'POST', 'agent/transcribe', null, { raw: Buffer.alloc(4_000_001), headers: { 'x-audio-type': 'audio/webm' } });
    assert.equal(big.status, 413);
  });
  test('learn ignores prototype-polluting keys', async () => {
    const pair = (category, payee) => ({ before: { type: 'money', f: { category: 'Food' } }, after: { type: 'money', f: { category, payee, amount: 10, kind: 'expense' } } });
    const r = await call('a', 'POST', 'agent/learn', { pairs: [pair('__proto__', 'x'), pair('Food', '__proto__'), pair('constructor', 'Constructor')] });
    assert.equal(r.status, 200);
    assert.ok(!r.body.memory.categories.some(c => /proto|constructor/i.test(c.name)));
    assert.ok(!r.body.memory.payees.some(p => /proto/i.test(p.name)));
    assert.equal({}.polluted, undefined);
  });
}
