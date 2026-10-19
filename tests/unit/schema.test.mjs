import test from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA_VERSION, readDoc, makeDoc, migrateCollections, NewerSchemaError, normalize, MIGRATIONS } from '../../js/core/schema.js';

test('every version up to current has a migration step', () => {
  for (let v = 1; v <= SCHEMA_VERSION; v++) assert.equal(typeof MIGRATIONS[v], 'function', `missing migration ${v}`);
});
test('legacy v0 doc ("schema" key, task without status) migrates without losing records', () => {
  const legacy = { app: 'steady', data: { tasks: { a: { id: 'a', updatedAt: 1, title: 'x', doneAt: 5 }, b: { id: 'b', updatedAt: 1, title: 'y' } }, goals: {}, extra: 1 } };
  const out = readDoc(legacy);
  assert.equal(out.tasks.a.status, 'done'); assert.equal(out.tasks.b.status, 'open');
  assert.equal(out.tasks.a.title, 'x'); assert.equal(Object.keys(out.tasks).length, 2);
});
test('unknown fields survive (forward compatible)', () => {
  const out = readDoc(makeDoc({ tasks: { a: { id: 'a', updatedAt: 1, title: 'x', futureField: 42 } } }));
  assert.equal(out.tasks.a.futureField, 42);
});
test('newer schema is refused instead of being overwritten', () => {
  assert.throws(() => readDoc({ schemaVersion: SCHEMA_VERSION + 1, data: {} }), NewerSchemaError);
});
test('arrays (exports from other tools) are accepted', () => {
  const out = readDoc({ schemaVersion: 1, data: { thoughts: [{ id: 't1', updatedAt: 2, text: 'hi' }] } });
  assert.equal(out.thoughts.t1.text, 'hi'); assert.deepEqual(out.thoughts.t1.tags, []);
});
test('invalid records are dropped, tombstones stay minimal', () => {
  assert.equal(normalize('tasks', { id: 1, updatedAt: 1 }), null);
  assert.deepEqual(normalize('tasks', { id: 'a', updatedAt: 3, deleted: true, title: 'gone' }), { id: 'a', deleted: true, updatedAt: 3 });
});
test('migration is idempotent', () => {
  const once = migrateCollections({ tasks: { a: { id: 'a', updatedAt: 1 } } }, 0);
  assert.deepEqual(migrateCollections(once, SCHEMA_VERSION), once);
});
