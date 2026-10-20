// Adaptive engine. Pure, rule-based, on-device, explainable. No AI API, no storage or DOM access.
// Every rule and threshold is documented in docs/ADAPTIVE_ENGINE.md; keep the two in step.
import { dateKey, keyAdd, fromKey, DAYS, fmtHour, fromMin, toMin, fmtTime } from './util.js';

export const RULES = Object.freeze({
  MIN_DATA: 6,              // completions before any pattern is claimed
  HOUR_WINDOW: 2,           // hours in the "best window"
  HOUR_LOOKBACK_DAYS: 60,
  WINDOW_MIN_SHARE: 0.25,   // window must hold >= 25% of completions to be stated
  WEEKDAY_LOOKBACK_DAYS: 56,
  WEEKDAY_MIN_PLANNED: 3,
  WEEKDAY_MIN_GAP: 0.15,
  LOAD_LOOKBACK_DAYS: 14,
  LOAD_FACTOR: 1.25,        // cap = round(avg * 1.25) + 1, min 3
  SLUMP_AWAY_DAYS: 2,
  SLUMP_LOW_RATE: 0.34,
  SLUMP_LOW_DAYS: 2,        // of the last 3
  SLUMP_LOW_ENERGY: 2,      // avg energy of last 3 check-ins (needs >= 2)
  ENERGY_RATIO: 1.4,
  SHORT_TASK_MIN: 20, LONG_TASK_MIN: 45, SIZE_GAP: 0.15,
  SELFCARE_MIN_N: 6, SELFCARE_GAP: 0.1,
  MVD_MAX: 3, MVD_TINY_MIN: 30,
  SUGGEST_MIN_SIMILAR: 3,
});

const MIN_DATA = RULES.MIN_DATA;

// data: { tasks, checkins, thoughts } arrays of live (non-deleted) records.
// The evening check-in is retired from the UI (v1.4); old check-ins still count toward streaks and the slump signal.
export function analyzeData(data, now = new Date()) {
  const today = dateKey(now);
  const tasks = data.tasks || [];
  const checkins = data.checkins || [];
  const thoughts = data.thoughts || [];

  // ---- per-day ledger ----
  const daily = new Map();
  const day = k => { if (!daily.has(k)) daily.set(k, { planned: 0, done: 0, skipped: 0, doneMin: 0 }); return daily.get(k); };
  for (const t of tasks) {
    if (!t.dueDate || t.dueDate > today) continue;
    const d = day(t.dueDate);
    d.planned++;
    if (t.status === 'done') d.done++;
    if (t.status === 'skipped') d.skipped++;
  }
  // a completion counts on the day it happened (for heatmap / streak)
  const doneOn = new Map();
  const hourHist = new Array(24).fill(0);
  const doneTasks = tasks.filter(t => t.status === 'done' && t.doneAt);
  for (const t of doneTasks) {
    const d = new Date(t.doneAt);
    const k = dateKey(d);
    doneOn.set(k, (doneOn.get(k) || 0) + 1);
    if (k >= keyAdd(today, -60)) hourHist[d.getHours()]++;
  }
  const checkinBy = new Map(checkins.map(c => [c.date, c]));

  // ---- best window (2h sliding) ----
  const totalH = hourHist.reduce((a, b) => a + b, 0);
  let best = { start: null, share: 0, count: 0 };
  if (totalH >= MIN_DATA) {
    for (let h = 0; h < 24; h++) {
      const c = hourHist[h] + hourHist[(h + 1) % 24];
      if (c > best.count) best = { start: h, count: c, share: c / totalH };
    }
  }

  // ---- weekday rates (last 8 weeks) ----
  const wdPlanned = new Array(7).fill(0), wdDone = new Array(7).fill(0);
  for (const [k, d] of daily) {
    if (k < keyAdd(today, -56) || k === today) continue;
    const wd = fromKey(k).getDay();
    wdPlanned[wd] += d.planned; wdDone[wd] += d.done;
  }
  const wdRate = wdPlanned.map((p, i) => (p ? wdDone[i] / p : null));
  const rated = wdRate.map((r, i) => ({ r, i, p: wdPlanned[i] })).filter(x => x.r !== null && x.p >= 3);
  const bestDay = rated.length >= 3 ? rated.reduce((a, b) => (b.r > a.r ? b : a)) : null;
  const worstDay = rated.length >= 3 ? rated.reduce((a, b) => (b.r < a.r ? b : a)) : null;

  // ---- recent rates ----
  const rateOver = n => {
    let p = 0, d = 0;
    for (let i = 1; i <= n; i++) { const x = daily.get(keyAdd(today, -i)); if (x) { p += x.planned; d += x.done; } }
    return p ? d / p : null;
  };
  const last3 = rateOver(3), last7 = rateOver(7), last30 = rateOver(30);

  let doneLast14 = 0, activeDays14 = 0;
  for (let i = 1; i <= 14; i++) { const c = doneOn.get(keyAdd(today, -i)) || 0; doneLast14 += c; if (c) activeDays14++; }
  const avgDone = activeDays14 ? doneLast14 / Math.max(activeDays14, 7) : 0;
  const loadCap = Math.max(3, Math.round(avgDone * 1.25) + 1);

  // ---- slump detection ----
  let lastActive = null;
  for (const t of doneTasks) if (!lastActive || t.doneAt > lastActive) lastActive = t.doneAt;
  for (const c of checkins) if (!lastActive || (c.updatedAt || 0) > lastActive) lastActive = c.updatedAt;
  const daysAway = lastActive ? Math.round((fromKey(today) - fromKey(dateKey(new Date(lastActive)))) / 864e5) : null;
  let lowDays = 0;
  for (let i = 1; i <= 3; i++) { const x = daily.get(keyAdd(today, -i)); if (x && x.planned && x.done / x.planned < 0.34) lowDays++; }
  const energies = [1, 2, 3].map(i => checkinBy.get(keyAdd(today, -i))?.energy).filter(Boolean);
  const lowEnergy = energies.length >= 2 && energies.reduce((a, b) => a + b, 0) / energies.length <= 2;
  let slump = null;
  if (daysAway !== null && daysAway >= 2) slump = { reason: 'away', text: `It's been ${daysAway} days. No catching up needed.` };
  else if (lowDays >= 2) slump = { reason: 'missed', text: 'The last few days were heavy.' };
  else if (lowEnergy) slump = { reason: 'energy', text: 'Your energy has been low lately.' };

  // ---- streaks: a day counts if you finished something or checked in ----
  const activeDay = k => (doneOn.get(k) || 0) > 0 || checkinBy.has(k);
  let current = 0;
  let k = activeDay(today) ? today : keyAdd(today, -1);
  while (activeDay(k)) { current++; k = keyAdd(k, -1); }
  let longest = 0, run = 0;
  const allKeys = [...new Set([...doneOn.keys(), ...checkinBy.keys()])].sort();
  if (allKeys.length) {
    for (let x = allKeys[0]; x <= today; x = keyAdd(x, 1)) { if (activeDay(x)) { run++; longest = Math.max(longest, run); } else run = 0; }
  }

  // ---- energy vs output ----
  const energyVsOutput = checkins.filter(c => c.energy).map(c => ({ date: c.date, energy: c.energy, done: doneOn.get(c.date) || 0 }));
  const byEnergy = [1, 2, 3, 4, 5].map(e => { const xs = energyVsOutput.filter(p => p.energy === e); return xs.length ? xs.reduce((a, b) => a + b.done, 0) / xs.length : null; });

  // ---- duration effect ----
  const shortT = tasks.filter(t => t.durationMin && t.durationMin <= 20 && t.dueDate < today);
  const longT = tasks.filter(t => t.durationMin && t.durationMin > 45 && t.dueDate < today);
  const rateOf = xs => (xs.length ? xs.filter(t => t.status === 'done').length / xs.length : null);

  // ---- self-care -> next day ----
  const withCare = [], noCare = [];
  for (const c of checkins) {
    const nx = daily.get(keyAdd(c.date, 1));
    if (!nx || !nx.planned) continue;
    ((c.selfCare || '').trim() ? withCare : noCare).push(nx.done / nx.planned);
  }
  const avg = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  // ---- time-of-day buckets ----
  const buckets = [
    { label: 'Morning', from: 5, to: 12 }, { label: 'Afternoon', from: 12, to: 17 },
    { label: 'Evening', from: 17, to: 21 }, { label: 'Night', from: 21, to: 29 },
  ].map(b => ({ ...b, count: hourHist.reduce((a, c, h) => a + (((h >= b.from && h < b.to) || (h + 24 >= b.from && h + 24 < b.to)) ? c : 0), 0) }));

  const res = {
    today, daily, doneOn, hourHist, totalH, best, wdRate, wdPlanned, bestDay, worstDay,
    last3, last7, last30, avgDone, loadCap, slump, daysAway,
    streak: { current, longest }, energyVsOutput, byEnergy, buckets,
    durationEffect: { short: rateOf(shortT), long: rateOf(longT), nShort: shortT.length, nLong: longT.length },
    selfCare: { with: avg(withCare), without: avg(noCare), n: withCare.length + noCare.length },
    checkinCount14: [...Array(14)].filter((_, i) => checkinBy.has(keyAdd(today, -i - 1))).length,
    thoughtsCount: thoughts.length, enough: doneTasks.length >= MIN_DATA,
  };
  res.remember = remember(res);
  return res;
}

const pct = x => `${Math.round(x * 100)}%`;
const windowLabel = h => `${fmtHour(h)} and ${fmtHour((h + 2) % 24)}`.replace(/ AM and (\d+) AM/, '–$1 AM').replace(/ PM and (\d+) PM/, '–$1 PM');

function remember(a) {
  const out = [];
  if (!a.enough) {
    out.push({ k: 'learning', text: "I'm still learning you. After a few days of finishing things, the patterns show up here." });
    return out;
  }
  if (a.best.start !== null && a.best.share >= 0.25)
    out.push({ k: 'hours', text: `You finish most of your tasks between ${windowLabel(a.best.start)}.`, detail: `${pct(a.best.share)} of completions in the last 60 days.` });
  if (a.bestDay && a.worstDay && a.bestDay.i !== a.worstDay.i && a.bestDay.r - a.worstDay.r >= 0.15)
    out.push({ k: 'days', text: `${DAYS[a.bestDay.i]}s are your strongest day. ${DAYS[a.worstDay.i]}s run lighter.`, detail: `${pct(a.bestDay.r)} vs ${pct(a.worstDay.r)} of planned tasks done.` });
  if (a.avgDone >= 1)
    out.push({ k: 'load', text: `You usually finish about ${Math.round(a.avgDone)} things a day. Planning around ${a.loadCap} keeps days winnable.`, detail: 'Based on the last 14 days.' });
  const de = a.durationEffect;
  if (de.short !== null && de.long !== null && de.nShort >= 5 && de.nLong >= 3 && de.short - de.long >= 0.15)
    out.push({ k: 'size', text: `Small tasks stick. Under 20 minutes you finish ${pct(de.short)}; over 45 minutes, ${pct(de.long)}.`, detail: 'Break big ones down.' });
  if (a.streak.longest >= 3)
    out.push({ k: 'streak', text: a.streak.current >= 2 ? `You're on a ${a.streak.current}-day run. Your best so far is ${a.streak.longest}.` : `Your best run so far is ${a.streak.longest} days in a row. One small thing today starts the next one.` });
  return out;
}

// Suggest a time for a task: similar past tasks first, then his best window.
export function suggestTimeFrom(title, tasks, a) {
  const words = (title || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4);
  if (words.length) {
    const mins = tasks
      .filter(t => t.status === 'done' && t.doneAt && words.some(w => t.title.toLowerCase().includes(w)))
      .map(t => { const d = new Date(t.doneAt); return d.getHours() * 60 + d.getMinutes(); })
      .sort((x, y) => x - y);
    if (mins.length >= 3) {
      const med = mins[Math.floor(mins.length / 2)];
      return { time: fromMin(Math.round(med / 15) * 15), why: 'when you usually do this' };
    }
  }
  if (a.best.start !== null) return { time: fromMin(a.best.start * 60 + 30), why: 'your best hours' };
  return null;
}

// Minimum viable day: 1-3 tiny things instead of the full list.
export function mvdPicks(openToday) {
  const sorted = [...openToday].sort((x, y) => (x.durationMin || 15) - (y.durationMin || 15) || y.priority - x.priority);
  const tiny = sorted.filter(t => (t.durationMin || 15) <= 30).slice(0, 3);
  return tiny.length ? tiny : sorted.slice(0, 1);
}

export function tinyFromGoals(goals = []) {
  const out = [];
  for (const g of goals) {
    const a = (g.actions || [])[0];
    if (a) out.push(`${a.title} (just 5 minutes)`);
  }
  if (!out.length) out.push('Drink a glass of water and plan tomorrow in one line', 'Five minutes on the thing that matters most');
  return out.slice(0, 2);
}
