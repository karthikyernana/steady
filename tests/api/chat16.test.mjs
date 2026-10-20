// Chat 1.6 against a real local Postgres + the AI mock: suggestions stored and returned, the server attaching a card
// to a text-only data answer, the starter (no model call), hybrid search across collections under RLS, and the
// embedding back-fill (only where pgvector is installed; skipped quietly otherwise). Needs TEST_DATABASE_URL
// (this file wipes that database's public schema).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createMock } from '../mocks/ai-mock.mjs';

const DB = process.env.TEST_DATABASE_URL;
if (!DB) test('chat 1.6 api tests skipped (no TEST_DATABASE_URL)', () => {});
else {
  let base, srv, mock;
  const dayIST = (off = 0) => new Date(Date.now() + 5.5 * 36e5 + off * 864e5).toISOString().slice(0, 10);
  before(async () => {
    process.env.DATABASE_URL = DB;
    mock = createMock(); const mp = await mock.listen();
    Object.assign(process.env, { GROQ_API_KEY: 'gq-test', GROQ_BASE_URL: `http://127.0.0.1:${mp}/openai/v1`, GEMINI_API_KEY: 'gm-test', GEMINI_BASE_URL: `http://127.0.0.1:${mp}`, AGENT_DAILY_CAP: '40' });
    const { getPool } = await import('../../server/db.js');
    await getPool().query('drop schema public cascade; create schema public;');
    await (await import('../../server/migrate.js')).migrate();
    const { handle } = await import('../../server/routes.js');
    srv = createServer(handle);
    base = await new Promise(r => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));
  });
  after(async () => { srv?.close(); await mock?.close(); await (await import('../../server/db.js')).closePool(); });

  const jar = { a: '', b: '' };
  const call = async (who, method, path, body) => {
    const r = await fetch(`${base}/api/${path}`, { method, headers: { 'x-steady': '1', 'content-type': 'application/json', ...(jar[who] ? { cookie: jar[who] } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) jar[who] = sc.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const push = (who, records) => call(who, 'POST', 'sync/push', { records: records.map(([coll, data]) => ({ coll, id: data.id, updatedAt: Date.now(), schemaVersion: 2, data: { ...data, updatedAt: Date.now() } })) });
  const ask = (who, message, chatId) => call(who, 'POST', 'agent/chat', { message, chatId, tz: 'Asia/Kolkata' });

  test('setup: two users with data', async () => {
    await call('a', 'POST', 'auth/signup', { email: 'a16@example.com', password: 'password-a-123' });
    await call('b', 'POST', 'auth/signup', { email: 'b16@example.com', password: 'password-b-123' });
    const now = Date.now();
    assert.equal((await push('a', [
      ['tasks', { id: 'ta1', title: 'Gym', status: 'done', dueDate: dayIST(), doneAt: now - 60_000 }],
      ['tasks', { id: 'ta2', title: 'Renew visa documents', notes: 'passport photo', status: 'open', dueDate: dayIST() }],
      ['money', { id: 'ma1', kind: 'expense', amount: 250, category: 'Food', payee: 'Swiggy', note: 'Lunch biryani', date: dayIST() }],
      ['thoughts', { id: 'ha1', text: 'pricing idea for the app #steady', tags: ['steady'], createdAt: now }],
      ['goals', { id: 'ga1', title: 'Internship by Dec', milestones: [{ id: 'm1', title: 'Portfolio', done: true }] }],
    ])).status, 200);
    await push('b', [['tasks', { id: 'tb1', title: 'Visa interview prep', status: 'open', dueDate: dayIST() }]]);
  });

  test('a text-only answer about data gets a card from the server; suggestions are always there', async () => {
    const r = await ask('a', 'How many tasks done today?');
    assert.equal(r.status, 200);
    const m = r.body.message;
    assert.equal(m.meta.autoCards, 1, JSON.stringify(m));
    assert.equal(m.cards[0].component, 'Stat'); assert.equal(m.cards[0].data.value, 1);
    assert.equal(m.cards[0].data.compare.label, 'yesterday'); assert.equal(m.cards[0].data.trend.points.length, 7);
    assert.ok(Array.isArray(m.suggestions) && m.suggestions.length >= 2 && m.suggestions.every(s => s.length <= 40));
    assert.deepEqual(r.body.user.suggestions, []);
    const g = await call('a', 'GET', `agent/chats/${r.body.chatId}`);
    assert.deepEqual(g.body.messages[1].suggestions, m.suggestions, 'stored with the message');
    assert.equal(g.body.messages[1].cards[0].component, 'Stat');
  });

  test('model suggestions are validated (figures, overlong dropped) and kept on the cached reply', async () => {
    const r = await ask('a', 'find visa passport');
    const m = r.body.message;
    assert.deepEqual(m.suggestions, ['Show more like this']);
    const tl = m.cards.find(c => c.component === 'Timeline');
    assert.deepEqual(tl.data.items.map(x => x.title), ['Renew visa documents'], 'A sees only A\'s task');
    const again = await ask('a', 'find visa passport');
    assert.equal(again.body.cached, true); assert.deepEqual(again.body.message.suggestions, ['Show more like this']);
    const rb = await ask('b', 'find visa passport');
    assert.deepEqual(rb.body.message.cards[0].data.items.map(x => x.title), ['Visa interview prep'], 'B sees only B\'s');
    const money = await ask('a', 'search for biryani');
    assert.match(money.body.message.cards[0].data.items[0].sub, /Food/);
    const fuzzy = await ask('a', 'search for pricng');
    assert.equal(fuzzy.body.message.cards[0]?.data.items[0]?.title, 'pricing idea for the app #steady', 'trigram finds a typo');
  });

  test('starter: headline card + chips from the data, no model call, owner-scoped', async () => {
    mock.calls.length = 0;
    const s = await call('a', 'GET', 'agent/chat/starter?tz=Asia/Kolkata');
    assert.equal(s.status, 200);
    assert.equal(mock.calls.filter(c => c.provider).length, 0, 'no model call');
    assert.equal(s.body.text, '1 of 2 tasks done today.');
    assert.deepEqual(s.body.cards.map(c => c.component), ['Stat', 'Stat']);
    assert.equal(s.body.cards[0].data.value, 1); assert.equal(s.body.cards[1].data.value, 250);
    assert.ok(s.body.suggestions.length >= 3 && s.body.suggestions.length <= 4 && s.body.suggestions.every(x => x.length <= 40));
    assert.ok(s.body.suggestions.includes("What's left for today?"));
    const sb = await call('b', 'GET', 'agent/chat/starter');
    assert.equal(sb.body.text, '0 of 1 tasks done today.');
    assert.equal((await fetch(`${base}/api/agent/chat/starter`)).status, 401);
  });

  test('embeddings back-fill lazily where pgvector exists (else everything still works)', async () => {
    const { query } = await import('../../server/db.js');
    const has = (await query("select to_regclass('record_embeddings') is not null ok")).rows[0].ok;
    if (!has) { assert.ok(true, 'pgvector not installed: lexical + fuzzy search only'); return; }
    await ask('a', 'goals please');
    const { withOwner } = await import('../../server/db.js');
    const ownerA = (await query("select id from owners where email = 'a16@example.com'")).rows[0].id;
    const n = await withOwner(ownerA, async c => (await c.query('select count(*)::int n from record_embeddings')).rows[0].n);
    assert.ok(n >= 3, `embedded ${n}`);
    assert.equal((await query('select count(*)::int n from record_embeddings')).rows[0].n, 0, 'FORCE RLS: invisible without an owner');
    // semantic search joins in, and the vector list is part of the fusion
    const { hybridSearch } = await import('../../server/chat-search.js');
    const r = await hybridSearch(fn => withOwner(ownerA, fn), 'visa passport');
    assert.ok(r.used.includes('vector'), r.used.join());
    assert.equal(r.rows[0].id, 'ta2');
  });
}
