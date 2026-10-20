// Everything Insights shows besides task patterns, in one pass per collection (O(n), no per-day rescans).
// Pure: same data + same "today" → same numbers. Mirrors android core/Overview.kt; tests in tests/unit/overview.test.mjs.
import { dateKey, fromKey, addDays, weekStart } from './util.js';
import { fmtINR } from './money.js';

export function overview({ tasks = [], goals = [], money = [], thoughts = [] }, today = new Date()) {
  const todayK = dateKey(today);
  const ws = weekStart(today), wsK = dateKey(ws), lwsK = dateKey(addDays(ws, -7));
  const y = today.getFullYear(), m = today.getMonth();
  const msK = dateKey(new Date(y, m, 1));
  const lmLen = new Date(y, m, 0).getDate();
  const lmStart = dateKey(new Date(y, m - 1, 1)), lmSameDay = dateKey(new Date(y, m - 1, Math.min(today.getDate(), lmLen)));
  const d30 = dateKey(addDays(fromKey(todayK), -29));

  let doneWeek = 0, doneLastWeek = 0; const goalWeek = new Map();
  for (const t of tasks) {
    if (t.status !== 'done' || !t.doneAt) continue;
    const k = dateKey(new Date(t.doneAt));
    if (k >= wsK && k <= todayK) { doneWeek++; if (t.goalId) goalWeek.set(t.goalId, (goalWeek.get(t.goalId) || 0) + 1); }
    else if (k >= lwsK && k < wsK) doneLastWeek++;
  }
  const gs = goals.filter(g => !g.archived).map(g => { const ms = g.milestones || []; return { id: g.id, title: g.title, done: ms.filter(x => x.done).length, total: ms.length, tasksWeek: goalWeek.get(g.id) || 0 }; });
  let spentWeek = 0, spentLastWeek = 0, spentMonth = 0, spentLastMonthSameDay = 0; const cat = new Map();
  for (const x of money) {
    if (x.kind === 'income') continue; const d = x.date || '', v = +x.amount || 0;
    if (d >= wsK && d <= todayK) spentWeek += v; else if (d >= lwsK && d < wsK) spentLastWeek += v;
    if (d >= msK && d <= todayK) { spentMonth += v; cat.set(x.category || 'Other', (cat.get(x.category || 'Other') || 0) + v); }
    else if (d >= lmStart && d <= lmSameDay) spentLastMonthSameDay += v;
  }
  let thoughtsMonth = 0, moodSum = 0; const tagN = new Map();
  for (const t of thoughts) {
    if (!t.createdAt || dateKey(new Date(t.createdAt)) < d30) continue;
    thoughtsMonth++; moodSum += t.mood ?? 3; for (const tg of t.tags || []) tagN.set(tg, (tagN.get(tg) || 0) + 1);
  }
  const top = (mp, n) => [...mp.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  return {
    doneWeek, doneLastWeek, goals: gs, msDone: gs.reduce((s, g) => s + g.done, 0), msTotal: gs.reduce((s, g) => s + g.total, 0),
    spentWeek, spentLastWeek, spentMonth, spentLastMonthSameDay, cats: top(cat, 4),
    thoughtsMonth, topTags: top(tagN, 6), moodAvg: thoughtsMonth ? moodSum / thoughtsMonth : null,
  };
}

export const vs = (diff, what) => diff > 0 ? `+${diff} vs ${what}` : diff < 0 ? `−${-diff} vs ${what}` : `same as ${what}`;
/** "₹120 more than last week" / "₹40 less than …" / "same as …" (mirrors Overview.vsMoney). */
export const vsMoney = (diff, what = 'last week') =>
  Math.abs(diff) < 1 ? `same as ${what}` : diff > 0 ? `${fmtINR(diff)} more than ${what}` : `${fmtINR(-diff)} less than ${what}`;
