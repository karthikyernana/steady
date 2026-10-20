// /api/agent/chat + chats against a real local Postgres (non-superuser role, so FORCE RLS applies) and the AI mock
// (Groq-compatible tool calling). Needs TEST_DATABASE_URL (this file wipes that database's public schema).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createMock } from '../mocks/ai-mock.mjs';

const DB = process.env.TEST_DATABASE_URL;
if (!DB) test('chat api tests skipped (no TEST_DATABASE_URL)', () => {});
else {
  let base, srv, mock;
  const dayIST = (off = 0) => new Date(Date.now() + 5.5 * 36e5 + off * 864e5).toISOString().slice(0, 10);
  before(async () => {
    process.env.DATABASE_URL = DB;
    mock = createMock(); const mp = await mock.listen();
    Object.assign(process.env, { GROQ_API_KEY: 'gq-test', GROQ_BASE_URL: `http://127.0.0.1:${mp}/openai/v1`, GEMINI_API_KEY: 'gm-test', GEMINI_BASE_URL: `http://127.0.0.1:${mp}`, AGENT_DAILY_CAP: '12' });
    delete process.env.CF_ACCOUNT_ID; delete process.env.CF_API_TOKEN;
    const { getPool } = await import('../../server/db.js');
    await getPool().query('drop schema public cascade; create schema public;');
    await (await import('../../server/migrate.js')).migrate();
    const { handle } = await import('../../server/routes.js');
    srv = createServer(handle);
    base = await new Promise(r => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));
  });
  after(async () => { srv?.close(); await mock?.close(); await (await import('../../server/db.js')).closePool(); });

  const jar = { a: '', b: '' };
  const call = async (who, method, path, body, { headers = {} } = {}) => {
    const r = await fetch(`${base}/api/${path}`, { method, headers: { 'x-steady': '1', 'content-type': 'application/json', ...(jar[who] ? { cookie: jar[who] } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) jar[who] = sc.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const push = (who, records) => call(who, 'POST', 'sync/push', { records: records.map(([coll, data]) => ({ coll, id: data.id, updatedAt: Date.now(), schemaVersion: 2, data: { ...data, updatedAt: Date.now() } })) });
  const ask = (who, message, chatId) => call(who, 'POST', 'agent/chat', { message, chatId, tz: 'Asia/Kolkata' });

  test('config advertises chat providers without keys; chat needs a session and CSRF', async () => {
    const c = await call('a', 'GET', 'config');
    assert.deepEqual(c.body.chat, { on: true, providers: ['groq', 'groq-20b', 'gemini', 'groq-qwen'] });
    assert.ok(!JSON.stringify(c.body).includes('gq-test'));
    assert.equal((await ask('a', 'hi')).status, 401);
    assert.equal((await call('a', 'GET', 'agent/chats')).status, 401);
    await call('a', 'POST', 'auth/signup', { email: 'a@example.com', password: 'password-a-123' });
    await call('b', 'POST', 'auth/signup', { email: 'b@example.com', password: 'password-b-123' });
    const r = await fetch(`${base}/api/agent/chat`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: jar.a }, body: '{"message":"hi"}' });
    assert.equal(r.status, 403, 'no X-Steady header');
    assert.equal((await ask('a', '   ')).status, 400);
    assert.equal((await ask('a', 'x'.repeat(1001))).status, 413);
  });

  test('a question runs read-only tools under RLS and returns text + resolved cards (numbers from rows)', async () => {
    await push('a', [['money', { id: 'ma1', kind: 'expense', amount: 250, category: 'Food', note: 'Lunch', date: dayIST() }], ['money', { id: 'ma2', kind: 'expense', amount: 80, category: 'Transport', date: dayIST() }]]);
    await push('b', [['money', { id: 'mb1', kind: 'expense', amount: 77777, category: 'Secret', date: dayIST() }], ['thoughts', { id: 'tb1', text: 'bob private idea about rockets', tags: [], createdAt: Date.now() }]]);
    const before = (await call('a', 'GET', 'sync/pull?since=0')).body.records.length;
    const r = await ask('a', 'how much did I spend this month?');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.provider, 'groq'); assert.ok(r.body.chatId);
    assert.match(r.body.message.text, /₹330 across 2 entries/);
    const [stat, donut, ...rest] = r.body.message.cards;
    assert.equal(rest.length, 0, 'the unknown "Script" component was dropped');
    assert.equal(stat.component, 'Stat'); assert.equal(stat.data.value, 330); assert.equal(stat.data.display, '₹330');
    assert.deepEqual(donut.data.points.map(p => [p.label, p.value]), [['Food', 250], ['Transport', 80]]);
    const all = JSON.stringify(r.body);
    assert.ok(!all.includes('999999') && !all.includes('123456') && !all.includes('Fake'), 'numbers the model wrote into cards are gone');
    assert.ok(!all.includes('77777') && !all.includes('Secret'), 'user B\'s rows are invisible to user A');
    assert.ok(!all.includes('alert('), 'nothing executable survives');
    assert.equal((await call('a', 'GET', 'sync/pull?since=0')).body.records.length, before, 'chat never writes records');
    const toolMsgs = mock.calls.filter(c => c.provider === 'groq').at(-1).body.messages.filter(m => m.role === 'tool');
    assert.ok(toolMsgs.length && !toolMsgs.some(m => m.content.includes('77777')));
  });

  test('stored cards hold queries, not numbers; reopening re-resolves from current data', async () => {
    const r = await ask('a', 'spending by category this week');
    const { query, withOwner } = await import('../../server/db.js');
    const ownerA = (await query("select id from owners where email = 'a@example.com'")).rows[0].id;
    const row = await withOwner(ownerA, async c => (await c.query("select cards from agent_messages where role = 'assistant' order by id desc limit 1")).rows[0]);
    assert.equal(row.cards[0].query.tool, 'query_money');
    assert.ok(row.cards[0].query.params.from && !('range' in row.cards[0].query.params), 'relative period frozen to real days');
    assert.ok(!JSON.stringify(row.cards).match(/"(display|points|data|values)"|":\s*-?\d/), JSON.stringify(row.cards));
    await push('a', [['money', { id: 'ma3', kind: 'expense', amount: 20, category: 'Food', date: dayIST() }]]);
    const g = await call('a', 'GET', `agent/chats/${r.body.chatId}`);
    assert.equal(g.status, 200);
    assert.deepEqual(g.body.messages.map(m => m.role), ['user', 'assistant']);
    assert.equal(g.body.messages[1].cards[0].data.value, 350, 'same spec, today\'s data');
  });

  test('search_thoughts and every other tool stay inside the owner (RLS)', async () => {
    const r = await ask('a', 'what did I write about rockets?');
    assert.equal(r.status, 200);
    const tl = r.body.message.cards.find(c => c.component === 'Timeline');
    assert.equal(tl.data.items.length, 0); assert.match(r.body.message.text, /Nothing written/);
    const rb = await ask('b', 'what did I write about rockets?');
    assert.equal(rb.body.message.cards.find(c => c.component === 'Timeline').data.items.length, 1, 'B finds B\'s own thought');
    // B cannot read, continue or delete A's chat
    const chats = (await call('a', 'GET', 'agent/chats')).body.chats;
    assert.equal((await call('b', 'GET', `agent/chats/${chats[0].id}`)).status, 404);
    assert.equal((await ask('b', 'more', chats[0].id)).status, 404);
    assert.equal((await call('b', 'DELETE', `agent/chats/${chats[0].id}`)).status, 404);
    assert.equal((await call('b', 'GET', 'agent/chats')).body.chats.length, 1);
    // and at the database level, with A's owner id set, B's rows simply do not exist
    const { withOwner, query } = await import('../../server/db.js');
    const ids = Object.fromEntries((await query('select email, id from owners')).rows.map(x => [x.email, x.id]));
    const seen = await withOwner(ids['a@example.com'], async c => ({
      chats: (await c.query('select owner_id from agent_chats')).rows, msgs: (await c.query('select owner_id from agent_messages')).rows,
      recs: (await c.query("select data from records where data->>'id' = 'mb1'")).rows }));
    assert.ok(seen.chats.length && seen.chats.every(x => x.owner_id === ids['a@example.com']));
    assert.ok(seen.msgs.every(x => x.owner_id === ids['a@example.com'])); assert.equal(seen.recs.length, 0);
    await assert.rejects(withOwner(ids['a@example.com'], c => c.query("insert into agent_messages (chat_id, owner_id, role, text) select id, $1, 'user', 'x' from agent_chats limit 1", [ids['b@example.com']])), /row-level security/);
  });

  test('history: follow-ups continue a chat; list, open and delete', async () => {
    const first = await ask('a', 'show my goals');
    const id = first.body.chatId;
    const next = await ask('a', 'and my tasks due soon?', id);
    assert.equal(next.body.chatId, id);
    const sent = mock.calls.filter(c => c.provider === 'groq').at(-1).body.messages;
    assert.ok(sent.some(m => m.role === 'assistant' && /cards shown: ProgressList/.test(m.content)), 'earlier turns (and their card queries) are context');
    const list = (await call('a', 'GET', 'agent/chats')).body.chats;
    assert.equal(list[0].id, id); assert.equal(list[0].title, 'show my goals');
    assert.equal((await call('a', 'GET', `agent/chats/${id}`)).body.messages.length, 4);
    assert.equal((await call('a', 'DELETE', `agent/chats/${id}`)).status, 200);
    assert.equal((await call('a', 'GET', `agent/chats/${id}`)).status, 404);
    assert.equal((await call('a', 'DELETE', 'agent/chats/not-a-uuid')).status, 404);
    const { query, withOwner } = await import('../../server/db.js');
    const ownerA = (await query("select id from owners where email = 'a@example.com'")).rows[0].id;
    assert.equal(await withOwner(ownerA, async c => (await c.query('select count(*)::int n from agent_messages where chat_id = $1', [id])).rows[0].n), 0, 'messages go with the chat');
    assert.equal((await query('select count(*)::int n from agent_messages')).rows[0].n, 0, 'and without an owner in scope, RLS shows nothing at all');
  });

  test('short cache: the same first question on unchanged data is answered without a model call or a cap count', async () => {
    const n = async () => (await (await import('../../server/db.js')).query("select coalesce(sum(n), 0)::int n from agent_usage_total where kind = 'chat'")).rows[0].n;
    const c0 = await n(); mock.calls.length = 0;
    const a = await ask('a', 'How am I doing on my streak?');
    const b = await ask('a', 'how am i doing on my  streak?');
    assert.equal(a.body.cached, false); assert.equal(b.body.cached, true);
    assert.notEqual(a.body.chatId, b.body.chatId);
    assert.equal(mock.calls.filter(c => c.provider).length, 2, 'two model rounds for the first ask, none for the cached one');
    assert.equal(await n(), c0 + 1);
    assert.deepEqual(b.body.message.cards.map(c => c.component), a.body.message.cards.map(c => c.component));
    await push('a', [['tasks', { id: 'ta1', title: 'Gym', status: 'done', dueDate: dayIST(), doneAt: Date.now() }]]);
    assert.equal((await ask('a', 'How am I doing on my streak?')).body.cached, false, 'new data → new answer');
  });

  test('router fallback end to end: Groq 429 → Gemini answers', async () => {
    mock.state.chat.groq = 429;
    try {
      const r = await ask('a', 'how much did I spend this week?');
      assert.equal(r.status, 200); assert.equal(r.body.provider, 'gemini');
      mock.state.chat.gemini = 500;
      const { query } = await import('../../server/db.js');
      const n = async () => (await query("select coalesce(sum(n), 0)::int n from agent_usage_total where kind = 'chat'")).rows[0].n;
      const c0 = await n();
      const f = await ask('a', 'how much did I spend today?');
      assert.equal(f.status, 502); assert.match(f.body.error, /could not reach a model/);
      assert.equal(await n(), c0, 'a turn no model could answer is refunded');
    } finally { mock.state.chat = { groq: 200, gemini: 200, cloudflare: 200 }; }
  });

  test('per-user daily cap (AGENT_DAILY_CAP), counted in the database', async () => {
    let last;
    for (let i = 0; i < 13; i++) last = await ask('b', `goals please ${i}`);
    assert.equal(last.status, 429); assert.match(last.body.error, /daily limit for chat \(12\)/);
    assert.equal((await ask('a', 'goals please, from A')).status, 200, 'a separate counter per user');
  });

  test('no provider configured: a calm 503, nothing counted', async () => {
    const keep = [process.env.GROQ_API_KEY, process.env.GEMINI_API_KEY];
    delete process.env.GROQ_API_KEY; delete process.env.GEMINI_API_KEY;
    try {
      const r = await ask('a', 'anything');
      assert.equal(r.status, 503); assert.match(r.body.error, /isn't set up/);
      assert.deepEqual((await call('a', 'GET', 'config')).body.chat, { on: false, providers: [] });
    } finally { [process.env.GROQ_API_KEY, process.env.GEMINI_API_KEY] = keep; }
  });
}
