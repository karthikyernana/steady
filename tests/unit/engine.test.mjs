import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeData, mvdPicks, suggestTimeFrom, RULES } from '../../js/core/engine.js';
import { dateKey, keyAdd } from '../../js/core/util.js';

const NOW = new Date(2026, 9, 16, 12, 0);
const today = dateKey(NOW);
let n = 0;
const task = (daysAgo, { done = true, hour = 22, dur = 15, title = 'Write post' } = {}) => {
  const k = keyAdd(today, -daysAgo); const [y, m, d] = k.split('-').map(Number);
  return { id: `t${n++}`, title, dueDate: k, durationMin: dur, priority: 2, status: done ? 'done' : 'skipped', doneAt: done ? new Date(y, m - 1, d, hour, 10).getTime() : null, updatedAt: 1 };
};

test('learns the best 2-hour window', () => {
  const tasks = [];
  for (let i = 1; i <= 12; i++) tasks.push(task(i, { hour: 21 }), task(i, { hour: 22 }));
  tasks.push(task(3, { hour: 10 }));
  const a = analyzeData({ tasks }, NOW);
  assert.equal(a.best.start, 21);
  assert.match(a.remember.find(r => r.k === 'hours').text, /9–11 PM/);
});
test('says it is still learning with too little data', () => {
  const a = analyzeData({ tasks: [task(1)] }, NOW);
  assert.equal(a.enough, false); assert.equal(a.remember[0].k, 'learning');
});
test('slump: two low days of the last three triggers a minimum viable day', () => {
  const tasks = [];
  for (let i = 4; i <= 20; i++) tasks.push(task(i), task(i));
  for (let i = 1; i <= 2; i++) tasks.push(task(i, { done: false }), task(i, { done: false }), task(i, { done: false }), task(i, { hour: 9 }));
  const a = analyzeData({ tasks }, NOW);
  assert.equal(a.slump?.reason, 'missed');
});
test('slump: away for 2+ days', () => {
  const tasks = []; for (let i = 3; i <= 12; i++) tasks.push(task(i));
  assert.equal(analyzeData({ tasks }, NOW).slump?.reason, 'away');
});
test('no slump on a steady run', () => {
  const tasks = []; for (let i = 1; i <= 14; i++) tasks.push(task(i), task(i));
  assert.equal(analyzeData({ tasks }, NOW).slump, null);
});
test('streak counts consecutive active days', () => {
  const tasks = []; for (let i = 1; i <= 5; i++) tasks.push(task(i));
  tasks.push(task(8));
  const a = analyzeData({ tasks }, NOW);
  assert.equal(a.streak.current, 5); assert.equal(a.streak.longest, 5);
});
test('load cap follows recent output', () => {
  const tasks = []; for (let i = 1; i <= 14; i++) for (let j = 0; j < 4; j++) tasks.push(task(i));
  const a = analyzeData({ tasks }, NOW);
  assert.equal(Math.round(a.avgDone), 4); assert.equal(a.loadCap, Math.round(4 * RULES.LOAD_FACTOR) + 1);
});
test('minimum viable day picks at most 3 tiny tasks', () => {
  const open = [{ id: 1, durationMin: 90, priority: 3 }, { id: 2, durationMin: 10, priority: 2 }, { id: 3, durationMin: 20, priority: 2 }, { id: 4, durationMin: 5, priority: 1 }, { id: 5, durationMin: 25, priority: 2 }];
  assert.deepEqual(mvdPicks(open).map(t => t.id), [4, 2, 3]);
  assert.deepEqual(mvdPicks([{ id: 9, durationMin: 120, priority: 2 }]).map(t => t.id), [9]);
});
test('suggests a reminder time from similar completed tasks', () => {
  const tasks = [task(1, { title: 'LinkedIn post', hour: 18 }), task(2, { title: 'linkedin carousel', hour: 18 }), task(3, { title: 'LinkedIn comments', hour: 19 })];
  const s = suggestTimeFrom('linkedin', tasks, analyzeData({ tasks }, NOW));
  assert.equal(s.time, '18:15'); assert.match(s.why, /usually/);
});

import { todayLine } from '../../js/core/voice.js';
test('voice: reacts to state', () => {
  const at = (h) => new Date(2026, 9, 16, h, 0);
  const a = { today: '2026-10-16', best: { start: 21 }, streak: { current: 0 }, slump: null };
  assert.match(todayLine({ now: at(9), total: 0, a }), /one thing/);
  assert.match(todayLine({ now: at(19), total: 3, open: 2, done: 1, a }), /best hours start at 9 PM/);
  assert.match(todayLine({ now: at(21), total: 3, open: 2, done: 1, a }), /in your best hours/);
  assert.match(todayLine({ now: at(20), total: 2, open: 0, done: 2, a }), /All 2 done/);
  assert.match(todayLine({ now: at(10), total: 2, open: 2, a: { ...a, slump: { reason: 'away' } } }), /Welcome back/);
  assert.match(todayLine({ now: new Date(2026, 9, 17, 0, 30), total: 2, open: 1, done: 1, a, profile: { sleep: '01:00' } }), /late/);
});
