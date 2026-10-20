// Day history rules (js/core/history.js). Runs with TZ=Asia/Kolkata (npm test). Mirrors android DayHistoryTest.kt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { localDay, doneDay, dayTasks, hadActivity, summaryLine, movedLabel, dayLabel, dayTitle, dayDistance, dayFromHash, hashForDay, clampDay, isDayKey } from '../../js/core/history.js';

const TODAY = '2026-10-21';
const IST = (iso) => Date.parse(iso + '+05:30');      // a wall-clock time in India as epoch ms
const T = (o) => ({ id: o.id || Math.random().toString(36).slice(2), title: o.title || o.id || 't', priority: 2, dueTime: null, status: 'open', doneAt: null, createdAt: 1, updatedAt: 1, ...o });
const ids = xs => xs.map(x => (x.task || x).id);

test('localDay: epoch ms to the local day, never the UTC day', () => {
  assert.equal(localDay(IST('2026-10-21T00:30:00')), '2026-10-21');           // 19:00 UTC on the 20th
  assert.equal(new Date(IST('2026-10-21T00:30:00')).toISOString().slice(0, 10), '2026-10-20'); // the bug we avoid
  assert.equal(localDay(IST('2026-10-20T23:59:00')), '2026-10-20');
  assert.equal(localDay(String(IST('2026-10-20T10:00:00'))), '2026-10-20');   // numeric string
  assert.equal(localDay('2026-10-20T20:00:00Z'), '2026-10-21');               // ISO string -> IST day
  assert.equal(localDay(null), null);
  assert.equal(localDay('nope'), null);
});

test('localDay with an explicit zone', () => {
  const ms = Date.parse('2026-10-20T20:00:00Z');
  assert.equal(localDay(ms, 'Asia/Kolkata'), '2026-10-21');
  assert.equal(localDay(ms, 'America/Los_Angeles'), '2026-10-20');
  assert.equal(localDay(ms, 'UTC'), '2026-10-20');
  assert.equal(localDay(ms, 'Not/AZone'), '2026-10-21');    // falls back to the device zone (IST in tests)
});

test('doneDay: doneAt wins, dueDate is the fallback', () => {
  assert.equal(doneDay(T({ status: 'done', dueDate: '2026-10-19', doneAt: IST('2026-10-20T09:00:00') })), '2026-10-20');
  assert.equal(doneDay(T({ status: 'done', dueDate: '2026-10-19', doneAt: null })), '2026-10-19');
  assert.equal(doneDay(T({ status: 'open', dueDate: '2026-10-19' })), null);
});

test('the reported case: yesterday\'s done task shows on yesterday, and Yesterday has activity', () => {
  const t = T({ id: 'hark', title: 'Send chat about business to hark', status: 'done', dueDate: '2026-10-20', doneAt: IST('2026-10-20T21:40:00') });
  const y = dayTasks([t], '2026-10-20', { today: TODAY });
  assert.equal(y.kind, 'past');
  assert.deepEqual(ids(y.done), ['hark']);
  assert.ok(hadActivity(y));
  assert.equal(summaryLine(y), '1 done');
  assert.deepEqual(ids(dayTasks([t], TODAY, { today: TODAY }).done), []);
});

test('done just after midnight IST lands on the new day (not the UTC day before)', () => {
  const t = T({ id: 'late', status: 'done', dueDate: '2026-10-20', doneAt: IST('2026-10-21T00:20:00') });
  assert.deepEqual(ids(dayTasks([t], TODAY, { today: TODAY }).done), ['late']);
  const y = dayTasks([t], '2026-10-20', { today: TODAY });
  assert.deepEqual(ids(y.done), []);
  assert.equal(y.moved[0].how, 'done');
  assert.equal(movedLabel(y.moved[0], TODAY), 'done today');
});

test('a past day: done, skipped, carried and still-open tasks', () => {
  const D = '2026-10-19';
  const xs = [
    T({ id: 'd1', status: 'done', dueDate: D, doneAt: IST('2026-10-19T08:00:00') }),
    T({ id: 'd2', status: 'done', dueDate: D, doneAt: IST('2026-10-19T18:00:00') }),
    T({ id: 'early', status: 'done', dueDate: '2026-10-22', doneAt: IST('2026-10-19T12:00:00') }), // done ahead of time
    T({ id: 's1', status: 'skipped', dueDate: D }),
    T({ id: 'letgo', status: 'skipped', dueDate: D, letGo: true }),
    T({ id: 'open', status: 'open', dueDate: D }),
    T({ id: 'carried', status: 'open', dueDate: TODAY, carriedFrom: D, carried: true }),
    T({ id: 'later', status: 'open', dueDate: '2026-10-23', carriedFrom: D }),
    T({ id: 'other', status: 'done', dueDate: '2026-10-18', doneAt: IST('2026-10-18T10:00:00') }),
    T({ id: 'gone', status: 'done', dueDate: D, doneAt: IST('2026-10-19T10:00:00'), deleted: true }),
  ];
  const r = dayTasks(xs, D, { today: TODAY });
  assert.deepEqual(ids(r.done), ['d1', 'early', 'd2']);          // in the order they were done
  assert.deepEqual(ids(r.skipped).sort(), ['letgo', 's1']);
  assert.deepEqual(ids(r.moved).sort(), ['carried', 'later', 'open']);
  assert.deepEqual(r.open, []);
  const m = Object.fromEntries(r.moved.map(x => [x.task.id, movedLabel(x, TODAY)]));
  assert.equal(m.open, 'moved to today');
  assert.equal(m.carried, 'moved to today');
  assert.equal(m.later, 'moved to Fri, 23 Oct');
  assert.equal(summaryLine(r), '3 done · 2 skipped · 3 moved');
});

test('each task appears on exactly one list of a day', () => {
  const D = '2026-10-20';
  const xs = [T({ id: 'a', status: 'done', dueDate: D, carriedFrom: D, doneAt: IST('2026-10-20T10:00:00') }), T({ id: 'b', status: 'open', dueDate: D, carriedFrom: D })];
  const r = dayTasks(xs, D, { today: TODAY });
  const all = [...ids(r.done), ...ids(r.skipped), ...ids(r.moved), ...ids(r.open)];
  assert.deepEqual(all.sort(), ['a', 'b']);
});

test('today and future days list open planned tasks; no moved list', () => {
  const xs = [T({ id: 'p1', dueDate: '2026-10-24', dueTime: '09:00' }), T({ id: 'p0', dueDate: '2026-10-24', dueTime: '07:00' }), T({ id: 'x', dueDate: '2026-10-25' })];
  const f = dayTasks(xs, '2026-10-24', { today: TODAY });
  assert.equal(f.kind, 'future');
  assert.deepEqual(ids(f.open), ['p0', 'p1']);
  assert.equal(summaryLine(f), '2 planned');
  assert.equal(summaryLine(dayTasks([], '2026-10-24', { today: TODAY })), 'Nothing planned yet.');
  assert.equal(summaryLine(dayTasks([], '2026-10-01', { today: TODAY })), 'Nothing logged this day.');
  assert.equal(hadActivity(dayTasks(xs, '2026-10-20', { today: TODAY })), false);
});

test('only open tasks yesterday is not "activity"', () => {
  const r = dayTasks([T({ id: 'o', dueDate: '2026-10-20' })], '2026-10-20', { today: TODAY });
  assert.equal(hadActivity(r), false);
  assert.equal(r.moved.length, 1);
});

test('labels', () => {
  assert.equal(dayLabel('2026-10-20', TODAY), 'Yesterday');
  assert.equal(dayLabel('2026-10-22', TODAY), 'Tomorrow');
  assert.equal(dayLabel('2026-10-19', TODAY), 'Mon, 19 Oct');
  assert.equal(dayLabel('2025-12-31', TODAY), 'Wed, 31 Dec 2025');
  assert.equal(dayTitle('2026-10-20', TODAY), 'Yesterday');
  assert.equal(dayTitle('2026-10-19', TODAY), 'Monday');
  assert.equal(dayDistance('2026-10-18', TODAY), '3 days ago');
  assert.equal(dayDistance('2026-10-25', TODAY), 'in 4 days');
  assert.equal(dayDistance('2026-10-20', TODAY), '');
});

test('hash routing', () => {
  assert.equal(dayFromHash('#/today?d=2026-10-20', TODAY), '2026-10-20');
  assert.equal(dayFromHash('#/today?x=1&d=2026-10-20', TODAY), '2026-10-20');
  assert.equal(dayFromHash('#/today?d=2026-10-21', TODAY), null);   // today itself
  assert.equal(dayFromHash('#/today?d=2026-02-30', TODAY), null);   // not a real date
  assert.equal(dayFromHash('#/today', TODAY), null);
  assert.equal(dayFromHash('#/goals?d=2026-10-20', TODAY), null);
  assert.equal(hashForDay('2026-10-20', TODAY), '#/today?d=2026-10-20');
  assert.equal(hashForDay(TODAY, TODAY), '#/today');
  assert.equal(clampDay('2020-01-01', TODAY), '2025-10-20');
  assert.equal(clampDay('2030-01-01', TODAY), '2026-12-20');
  assert.ok(isDayKey('2026-10-20') && !isDayKey('2026-1-2'));
});

test('across DST: a US-zone device still gets local days (explicit zone)', () => {
  // 2026-11-01 is the US DST end; 23:30 PDT on Oct 31 is 06:30 UTC Nov 1
  const ms = Date.parse('2026-11-01T06:30:00Z');
  assert.equal(localDay(ms, 'America/Los_Angeles'), '2026-10-31');
  const t = T({ id: 'us', status: 'done', dueDate: '2026-10-31', doneAt: ms });
  assert.deepEqual(ids(dayTasks([t], '2026-10-31', { today: '2026-11-02', tz: 'America/Los_Angeles' }).done), ['us']);
});
