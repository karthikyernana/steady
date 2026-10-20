// Chat client rules (js/core/chat-ui.js): calm error text, history order with pending chats, bottom-follow, no duplicates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { friendlyError, stripDebug, historyItems, atBottom, appendUnique, BUSY } from '../../js/core/chat-ui.js';

test('raw provider text never reaches the screen', () => {
  const raw = { status: 502, message: 'I could not reach a model right now. Try again in a minute. [groq 429: Rate limit reached for model openai/gpt-oss-120b … | gemini 503: overloaded]' };
  assert.deepEqual(friendlyError(raw), { msg: BUSY, retry: true });
  assert.equal(friendlyError({ status: 500, message: 'TypeError: Cannot read properties of undefined (reading "id")' }).msg, BUSY);
  assert.equal(friendlyError({ status: 504, message: '' }).msg, BUSY);
  assert.equal(friendlyError({ status: 418, message: '[cloudflare 401: bad token]' }).msg, BUSY);
  for (const e of [raw, { status: 429, message: 'groq 429: {"error":"rate_limit_exceeded"}' }]) {
    const m = friendlyError(e).msg; assert.ok(!/\[|groq|429|\{/.test(m), m);
  }
});
test('stripDebug removes bracketed debug detail, even unclosed', () => {
  assert.equal(stripDebug('Busy. [groq 429: x] Try later. [gemini'), 'Busy. Try later.');
  assert.equal(stripDebug(null), '');
});
test('safe server lines pass through, with the right Try again', () => {
  assert.deepEqual(friendlyError({ status: 429, message: "That's the daily limit for chat (60). It resets at midnight." }), { msg: "That's the daily limit for chat (60). It resets at midnight.", retry: false });
  assert.equal(friendlyError({ status: 429, message: 'Rate limit reached (mock)' }).msg, BUSY);
  assert.equal(friendlyError({ status: 413, message: 'Keep it under 1000 characters.' }).msg, 'Keep it under 1000 characters.');
  assert.equal(friendlyError({ status: 413, message: 'Keep it under 1000 characters.' }).retry, false);
  assert.equal(friendlyError({ status: 404, message: 'That chat is gone.' }).gone, true);
  assert.equal(friendlyError({ status: 503, message: "Chat isn't set up on this Steady yet. Everything else works as usual." }).off, true);
  assert.equal(friendlyError({ status: 0 }, true).msg, 'Couldn’t reach Steady. Try again in a moment.');
  assert.equal(friendlyError({ status: 0 }, false).offline, true);
});
test('history: last activity first, pending chats included and flagged', () => {
  const list = [{ id: 'a', title: 'Old', updatedAt: 100 }, { id: 'b', title: 'Newer', updatedAt: 200 }];
  const convs = [{ key: 'c1', id: 'a', title: 'Old', pending: { text: 'q' }, updatedAt: 300, msgs: [] }, { key: 'c2', id: null, pending: { text: 'brand new question' }, updatedAt: 250, msgs: [] },
    { key: 'c3', id: null, pending: null, msgs: [] }, { key: 'c4', id: 'b', unread: true, updatedAt: 0, msgs: [{}] }];
  const out = historyItems(list, convs, { b: 'Renamed' });
  assert.deepEqual(out.map(x => [x.id || x.key, x.pending, x.unread, x.title]), [['a', true, false, 'Old'], ['c2', true, false, 'brand new question'], ['b', false, true, 'Renamed']]);
  assert.deepEqual(historyItems(null, []), []);
});
test('bottom-follow and de-duplication', () => {
  assert.equal(atBottom(552, 1000, 400), true); assert.equal(atBottom(400, 1000, 400), false);
  const msgs = [{ id: '1' }, { id: '2' }];
  appendUnique(msgs, { id: '2' }, { id: '3' }, null, { id: '3' });
  assert.deepEqual(msgs.map(m => m.id), ['1', '2', '3']);
});
