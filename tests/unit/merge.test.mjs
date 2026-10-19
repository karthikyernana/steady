import test from 'node:test';
import assert from 'node:assert/strict';
import { pick, merge, prune } from '../../js/core/merge.js';

const C = ['tasks', 'goals', 'thoughts', 'checkins', 'meta'];
const t = (id, updatedAt, extra = {}) => ({ id, updatedAt, title: id, ...extra });

test('last write wins per record', () => {
  assert.equal(pick(t('a', 1), t('a', 2)).updatedAt, 2);
  assert.equal(pick(t('a', 5), t('a', 2)).updatedAt, 5);
});
test('tombstone wins a tie; ties are deterministic both ways', () => {
  const live = t('a', 3), dead = { id: 'a', deleted: true, updatedAt: 3 };
  assert.equal(pick(live, dead), dead); assert.equal(pick(dead, live), dead);
  const x = t('a', 3, { title: 'x' }), y = t('a', 3, { title: 'y' });
  assert.deepEqual(pick(x, y), pick(y, x));
});
test('offline edits on two devices converge', () => {
  const base = { tasks: { s: t('s', 10) }, thoughts: { th: t('th', 10) } };
  const A = structuredClone(base); A.tasks.a = t('a', 20); A.tasks.s = t('s', 21, { status: 'done' });
  const B = structuredClone(base); B.tasks.b = t('b', 22); B.thoughts.th = { id: 'th', deleted: true, updatedAt: 23 }; B.tasks.s = t('s', 24, { title: 'edited' });
  const m1 = merge(A, B, C); const m2 = merge(B, A, C);
  assert.deepEqual(m1.merged, m2.merged);
  assert.deepEqual(Object.keys(m1.merged.tasks).sort(), ['a', 'b', 's']);
  assert.equal(m1.merged.tasks.s.title, 'edited');
  assert.equal(m1.merged.thoughts.th.deleted, true);
  assert.equal(m1.remoteDirty, true);
  assert.deepEqual(m1.toLocal.tasks.map(r => r.id).sort(), ['b', 's']);
});
test('identical sides are not dirty', () => {
  const x = { tasks: { a: t('a', 1) } };
  const m = merge(x, structuredClone(x), C);
  assert.equal(m.remoteDirty, false); assert.equal(m.toLocal.tasks.length, 0);
});
test('old tombstones are pruned, recent ones kept', () => {
  const now = 1_000 * 864e5;
  const colls = { tasks: { old: { id: 'old', deleted: true, updatedAt: now - 91 * 864e5 }, recent: { id: 'recent', deleted: true, updatedAt: now - 5 * 864e5 }, live: t('live', 1) } };
  prune(colls, now);
  assert.deepEqual(Object.keys(colls.tasks).sort(), ['live', 'recent']);
});
