import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overview, vs } from '../../js/core/overview.js';

const today = new Date(2026, 9, 21, 12); // Wed 21 Oct 2026
const at = (d, h = 10) => new Date(2026, 9, d, h).getTime();
test('week, month, goals, thoughts in one pass (same numbers as Android OverviewTest)', () => {
  const o = overview({
    tasks: [{ status: 'done', doneAt: at(21), goalId: 'g1' }, { status: 'done', doneAt: at(20) }, { status: 'done', doneAt: at(14) }, { status: 'done', doneAt: at(1) }, { status: 'open' }],
    goals: [{ id: 'g1', title: 'Get placed', milestones: [{ done: true }, { done: false }] }],
    money: [{ amount: 200, date: '2026-10-21', category: 'Food' }, { amount: 100, date: '2026-10-19', category: 'Travel' }, { amount: 50, date: '2026-10-13', category: 'Food' },
      { amount: 5000, date: '2026-10-21', category: 'Salary', kind: 'income' }, { amount: 90, date: '2026-09-10', category: 'Food' }, { amount: 999, date: '2026-09-25', category: 'Food' }],
    thoughts: [{ tags: ['dsa'], mood: 4, createdAt: at(21) }, { tags: ['dsa', 'job'], mood: 2, createdAt: at(18) }, { mood: 5, createdAt: new Date(2026, 7, 1).getTime() }],
  }, today);
  assert.equal(o.doneWeek, 2); assert.equal(o.doneLastWeek, 1);
  assert.deepEqual([o.goals[0].done, o.goals[0].total, o.goals[0].tasksWeek], [1, 2, 1]);
  assert.equal(o.spentWeek, 300); assert.equal(o.spentLastWeek, 50); assert.equal(o.spentMonth, 350); assert.equal(o.spentLastMonthSameDay, 90);
  assert.deepEqual(o.cats[0], ['Food', 250]);
  assert.equal(o.thoughtsMonth, 2); assert.deepEqual(o.topTags[0], ['dsa', 2]); assert.equal(o.moodAvg, 3);
  assert.equal(vs(1, 'last week'), '+1 vs last week'); assert.equal(vs(0, 'last week'), 'same as last week');
});

test('money comparison line', async () => {
  const { vsMoney } = await import('../../js/core/overview.js');
  assert.equal(vsMoney(250), '₹250 more than last week');
  assert.equal(vsMoney(-1200, 'last month by today'), '₹1,200 less than last month by today');
  assert.equal(vsMoney(0.4), 'same as last week');
});
