// Which tasks belong to a calendar day, for Today's day navigation (‹ ›, swipe, ←/→) and the "Yesterday · N done" row.
// Pure: no DOM, no store. Mirrors android core/DayHistory.kt (keep the two in step; tests: tests/unit/history.test.mjs
// and android DayHistoryTest.kt).
//
// Rules (a task lands on at most one list per day):
//  - done: on the LOCAL day of doneAt (the day you actually did it). A done task with no doneAt falls back to dueDate.
//    doneAt is epoch ms (UTC instant); it is turned into a day in the device zone, or in `tz` when given, never by
//    slicing an ISO string (that is the UTC day, which is one day early for anything done before 05:30 IST).
//  - skipped: on its dueDate (skipping and "let go" keep the original date; there is no skippedAt).
//  - moved: on a PAST day, a task that was due that day but did not get done there: still open (it waits in Today's
//    carry-over), carried forward (carriedFrom = that day), or done on a later day. Shown as "moved to today",
//    "moved to Thu, 22 Oct" or "done today".
//  - open: on today or a future day, the open tasks planned for it.
import { dateKey, keyAdd, fromKey, DAYS, DAYS_SHORT, MONTHS } from './util.js';

const KEY = /^\d{4}-\d{2}-\d{2}$/;
export const isDayKey = k => typeof k === 'string' && KEY.test(k) && !Number.isNaN(fromKey(k).getTime()) && dateKey(fromKey(k)) === k;

/** epoch ms (number or numeric string, or an ISO string) -> "YYYY-MM-DD" in `tz` (IANA) or the device zone. */
export function localDay(ts, tz = null) {
  if (ts === null || ts === undefined || ts === '') return null;
  const ms = typeof ts === 'number' ? ts : /^\d+$/.test(String(ts)) ? Number(ts) : Date.parse(ts);
  if (!Number.isFinite(ms)) return null;
  if (tz) {
    try {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(new Date(ms)).map(x => [x.type, x.value]));
      return `${p.year}-${p.month}-${p.day}`;
    } catch { /* unknown zone: device zone */ }
  }
  return dateKey(new Date(ms));
}

/** The day a done task counts for (null for a task that is not done). */
export const doneDay = (t, tz = null) => (t?.status === 'done' ? localDay(t.doneAt, tz) || t.dueDate || null : null);

const byTime = (a, b) => (a.dueTime || '99:99').localeCompare(b.dueTime || '99:99') || (b.priority || 2) - (a.priority || 2) || (a.createdAt || 0) - (b.createdAt || 0);
const byDone = (a, b) => (a.doneAt || a.updatedAt || 0) - (b.doneAt || b.updatedAt || 0);

/**
 * Everything that happened on (or is planned for) `day`.
 * returns { day, kind: 'past'|'today'|'future', done, skipped, moved: [{ task, to, how }], open, total }
 * how: 'open' (still open, waiting in today's carry-over), 'carried' (moved forward to `to`), 'done' (done later, on `to`).
 */
export function dayTasks(tasks, day, { today, tz = null } = {}) {
  today = today || dateKey(new Date());
  const kind = day < today ? 'past' : day === today ? 'today' : 'future';
  const done = [], skipped = [], moved = [], open = [];
  for (const t of tasks || []) {
    if (!t || t.deleted) continue;
    const due = t.dueDate || null, from = t.carriedFrom || null;
    if (t.status === 'done') {
      const dd = doneDay(t, tz);
      if (dd === day) done.push(t);
      else if (kind === 'past' && dd && dd > day && (due === day || from === day)) moved.push({ task: t, to: dd, how: 'done' });
      continue;
    }
    if (t.status === 'skipped') {
      if (due === day) skipped.push(t);
      else if (kind === 'past' && from === day && due && due > day) moved.push({ task: t, to: due, how: 'carried' });
      continue;
    }
    // open
    if (due === day) {
      if (kind === 'past') { if (!t.letGo) moved.push({ task: t, to: today, how: 'open' }); }
      else open.push(t);
    } else if (kind === 'past' && from === day && due && due > day) moved.push({ task: t, to: due, how: 'carried' });
  }
  done.sort(byDone); skipped.sort(byTime); open.sort(byTime);
  moved.sort((a, b) => byTime(a.task, b.task));
  return { day, kind, done, skipped, moved, open, total: done.length + skipped.length + moved.length + open.length };
}

/** Did anything get done or skipped that day? (The "Yesterday" row shows only then.) */
export const hadActivity = r => !!r && r.done.length + r.skipped.length > 0;

/** "3 done · 1 skipped · 1 moved", "2 planned", or a calm empty line. */
export function summaryLine(r) {
  const bits = [];
  if (r.done.length) bits.push(`${r.done.length} done`);
  if (r.skipped.length) bits.push(`${r.skipped.length} skipped`);
  if (r.moved.length) bits.push(`${r.moved.length} moved`);
  if (r.open.length) bits.push(`${r.open.length} ${r.kind === 'future' ? 'planned' : 'open'}`);
  if (bits.length) return bits.join(' · ');
  return r.kind === 'future' ? 'Nothing planned yet.' : r.kind === 'today' ? 'Nothing here yet.' : 'Nothing logged this day.';
}

/** Short day label relative to `today`: Today / Yesterday / Tomorrow / "Mon, 19 Oct" (+ year when not this year). */
export function dayLabel(k, today) {
  if (k === today) return 'Today';
  if (k === keyAdd(today, -1)) return 'Yesterday';
  if (k === keyAdd(today, 1)) return 'Tomorrow';
  const d = fromKey(k);
  return `${DAYS_SHORT[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}${d.getFullYear() !== fromKey(today).getFullYear() ? ` ${d.getFullYear()}` : ''}`;
}

/** The note on a moved row: "moved to today", "moved to Thu, 22 Oct", "done today", "done Thu, 22 Oct". */
export function movedLabel(m, today) {
  const where = dayLabel(m.to, today);
  if (m.how === 'done') return `done ${where === 'Today' || where === 'Yesterday' || where === 'Tomorrow' ? where.toLowerCase() : where}`;
  return `moved to ${where === 'Today' || where === 'Tomorrow' ? where.toLowerCase() : where}`;
}

/** Big title for a day page: "Yesterday", "Tomorrow", or the weekday ("Monday"). */
export function dayTitle(k, today) {
  if (k === keyAdd(today, -1)) return 'Yesterday';
  if (k === keyAdd(today, 1)) return 'Tomorrow';
  return DAYS[fromKey(k).getDay()];
}

/** "3 days ago" / "in 4 days" / '' for today, yesterday and tomorrow. */
export function dayDistance(k, today) {
  const n = Math.round((fromKey(k) - fromKey(today)) / 864e5);
  if (Math.abs(n) <= 1) return '';
  return n < 0 ? `${-n} days ago` : `in ${n} days`;
}

/** The day in a Today hash ("#/today?d=2026-10-20"); null means today. An invalid or today's date is null. */
export function dayFromHash(hash, today) {
  const m = String(hash || '').match(/^#\/today\?(?:.*&)?d=([^&]+)/);
  const k = m ? decodeURIComponent(m[1]) : null;
  return k && isDayKey(k) && k !== today ? k : null;
}
export const hashForDay = (k, today) => (!k || k === today ? '#/today' : `#/today?d=${k}`);

/** How far day navigation goes: a year back, 60 days forward. */
export const RANGE = { back: 366, forward: 60 };
export function clampDay(k, today) {
  const lo = keyAdd(today, -RANGE.back), hi = keyAdd(today, RANGE.forward);
  return k < lo ? lo : k > hi ? hi : k;
}
