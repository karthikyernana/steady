// Chat agent tools (phase 1): READ-ONLY views over the signed-in user's own records.
// Every tool runs inside withOwner() (server/chat.js), so Postgres row-level security scopes each statement to this
// owner; nothing here can see another user's rows or write anything. Tools are also the only source of numbers for
// cards (server/chat-cards.js resolves a card by running its stored query through these same functions).
//
//   tool                  params (all optional unless noted)                                  result
//   query_tasks           status, range|from/to, date_field, goal, group_by, limit             count, groups?, items
//   query_goals           goal                                                                 count, milestones_*, progress, goals
//   query_money           kind, range|from/to, category, payee, group_by, limit                total, count, avg_per_day, groups?, items
//   query_thoughts        range|from/to, tag, kind, group_by, limit                            count, groups?, items
//   search_thoughts       query (required), limit                                              count, items   (ILIKE + simple full-text)
//   get_insights_summary  -                                                                    streaks, rates, best window/day, spend, learned
//
// To add a tool: add a TOOLS entry (description, JSON-schema params, clean(), run(), fields) and a test. See docs/AGENT.md.
import { analyzeData } from '../js/core/engine.js';
import { overview } from '../js/core/overview.js';
import { fmtHour, DAYS } from '../js/core/util.js';
import { hybridSearch, rankInMemory, SEARCH_COLLS } from './chat-search.js';

export const MAX_ROWS = 5000;          // per collection per request; a personal tracker stays far below this
const DAY = 864e5;

// ---------------------------------------------------------------- dates in the user's zone
const fmts = new Map();
function zoneFmt(tz) {
  if (!fmts.has(tz)) fmts.set(tz, new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
  return fmts.get(tz);
}
export function safeTz(tz) { try { new Intl.DateTimeFormat('en-CA', { timeZone: tz }); return tz; } catch { return 'Asia/Kolkata'; } }
export function zoned(ms, tz) {
  const p = Object.fromEntries(zoneFmt(tz).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: +p.hour % 24, minute: +p.minute };
}
export const addDays = (k, n) => { const d = new Date(`${k}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const wdOf = k => (new Date(`${k}T12:00:00Z`).getUTCDay() + 6) % 7;        // Mon = 0
const mondayOf = k => addDays(k, -wdOf(k));
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY);
export const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);
const WD_LABEL = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dayLabel = k => `${+k.slice(8)} ${MON[+k.slice(5, 7) - 1]}`;

export const RANGES = ['today', 'yesterday', 'tomorrow', 'this_week', 'last_week', 'next_7_days', 'last_7_days', 'last_30_days', 'last_90_days', 'this_month', 'last_month', 'this_year', 'all'];
// A preset or explicit from/to → { from, to } (inclusive day keys) or null for "all". Spans are capped at ~2 years.
export function resolveRange(p, today, fallback = 'last_30_days') {
  let from = isDate(p.from) ? p.from : null, to = isDate(p.to) ? p.to : null;
  if (from || to) {
    from ||= addDays(to, -30); to ||= today;
    if (from > to) [from, to] = [to, from];
    if (daysBetween(from, to) > 731) from = addDays(to, -731);
    return { from, to };
  }
  const r = RANGES.includes(p.range) ? p.range : fallback;
  const y = today.slice(0, 4), m = today.slice(0, 7);
  switch (r) {
    case 'all': return null;
    case 'today': return { from: today, to: today };
    case 'yesterday': { const d = addDays(today, -1); return { from: d, to: d }; }
    case 'tomorrow': { const d = addDays(today, 1); return { from: d, to: d }; }
    case 'this_week': return { from: mondayOf(today), to: addDays(mondayOf(today), 6) };
    case 'last_week': { const s = addDays(mondayOf(today), -7); return { from: s, to: addDays(s, 6) }; }
    case 'next_7_days': return { from: today, to: addDays(today, 6) };
    case 'last_7_days': return { from: addDays(today, -6), to: today };
    case 'last_90_days': return { from: addDays(today, -89), to: today };
    case 'this_month': return { from: `${m}-01`, to: addDays(`${addMonth(m, 1)}-01`, -1) };
    case 'last_month': { const lm = addMonth(m, -1); return { from: `${lm}-01`, to: addDays(`${m}-01`, -1) }; }
    case 'this_year': return { from: `${y}-01-01`, to: `${y}-12-31` };
    default: return { from: addDays(today, -29), to: today };
  }
}
const addMonth = (mk, n) => { const [y, m] = mk.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const inRange = (k, r) => !r || (k && k >= r.from && k <= r.to);

// ---------------------------------------------------------------- param cleaning (model input is untrusted)
const clip = (s, n) => { const v = String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(); return v.length > n ? v.slice(0, n - 1) + '…' : v; };
const oneOf = (v, xs, d) => (xs.includes(v) ? v : d);
const int = (v, lo, hi, d) => { const n = Math.round(+v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const strOpt = (v, n) => (typeof v === 'string' && v.trim() ? clip(v, n) : undefined);
function rangeParams(p) {
  const o = {};
  if (isDate(p.from)) o.from = p.from;
  if (isDate(p.to)) o.to = p.to;
  if (!o.from && !o.to && RANGES.includes(p.range)) o.range = p.range;
  return o;
}
const drop = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

// ---------------------------------------------------------------- loading
// `sql(text, params)` runs one statement in its own short withOwner() transaction (RLS: app.owner_id = this user), so no
// transaction is held open while a model is thinking. Each collection is read once per request.
export function dataAccess(sql) {
  const cache = new Map();
  const load = coll => {
    if (!cache.has(coll)) cache.set(coll, sql(
      'select id, data from records where owner_id = app_owner() and coll = $1 and not deleted order by updated_at desc limit $2', [coll, MAX_ROWS])
      .then(r => r.rows.map(x => ({ ...x.data, id: x.id }))));
    return cache.get(coll);
  };
  return { load, sql };
}

// ---------------------------------------------------------------- grouping helpers
// Every day of the period, zero days included (a chart must show the gaps). An open period ("all") spans the first to
// the last day that has data. Spans over 400 days stay sparse.
function fillDays(range, map) {
  if (!range) { const ks = [...map.keys()].filter(isDate).sort(); if (!ks.length) return []; range = { from: ks[0], to: ks.at(-1) }; }
  if (daysBetween(range.from, range.to) > 400) return null;
  const out = []; for (let k = range.from; k <= range.to; k = addDays(k, 1)) out.push(k);
  return out.map(k => ({ key: k, label: dayLabel(k), short: WD_LABEL[wdOf(k)], ...(map.get(k) || {}) }));
}
// Every Monday of the period (weeks with nothing logged included).
function fillWeeks(range, map) {
  if (!range || daysBetween(range.from, range.to) > 740) return null;
  const out = []; for (let k = mondayOf(range.from); k <= range.to; k = addDays(k, 7)) out.push(k);
  return out.map(k => ({ key: k, label: `Week of ${dayLabel(k)}`, short: dayLabel(k), ...(map.get(k) || {}) }));
}
function group(rows, keyOf, range, by, ys) {
  const map = new Map();
  for (const r of rows) {
    const k = keyOf(r); if (k == null || k === '') continue;
    const g = map.get(k) || Object.fromEntries(ys.map(y => [y, 0]));
    g.count = (g.count || 0) + 1;
    if (ys.includes('sum')) g.sum = Math.round(((g.sum || 0) + (+r.amount || 0)) * 100) / 100;
    map.set(k, g);
  }
  const zero = Object.fromEntries(ys.map(y => [y, 0]));
  if (by === 'day') { const filled = fillDays(range, map); if (filled) return filled.map(g => ({ ...zero, ...g })); }
  if (by === 'week') { const filled = fillWeeks(range, map); if (filled) return filled.map(g => ({ ...zero, ...g })); }
  if (by === 'weekday') return WD_LABEL.map((l, i) => ({ key: String(i), label: l, ...zero, ...(map.get(String(i)) || {}) }));
  if (by === 'hour') return [...Array(24).keys()].map(h => ({ key: String(h), label: fmtHour(h).replace(' ', ''), ...zero, ...(map.get(String(h)) || {}) }));
  const out = [...map.entries()].map(([key, g]) => ({ key, label: labelFor(by, key), ...zero, ...g }));
  if (['day', 'week', 'month'].includes(by)) return out.sort((a, b) => a.key.localeCompare(b.key));
  return out.sort((a, b) => (b.sum ?? b.count) - (a.sum ?? a.count) || a.key.localeCompare(b.key));
}
function labelFor(by, key) {
  if (by === 'day') return dayLabel(key);
  if (by === 'week') return `Week of ${dayLabel(key)}`;
  if (by === 'month') return `${MON[+key.slice(5, 7) - 1]} ${key.slice(0, 4)}`;
  if (by === 'mood') return ['', 'Low', 'Meh', 'Okay', 'Good', 'Great'][+key] || key;
  return key;
}

// ---------------------------------------------------------------- tools
const RANGE_SCHEMA = {
  range: { type: 'string', enum: RANGES, description: 'Preset period (user\'s zone); or from/to.' },
  from: { type: 'string', description: 'YYYY-MM-DD' },
  to: { type: 'string', description: 'YYYY-MM-DD' },
};
const LIMIT = d => ({ type: 'integer', minimum: 1, maximum: 50, description: `default ${d}` });

function matchGoal(goals, q) {
  if (!q) return null;
  const s = String(q).toLowerCase();
  return goals.find(g => g.id === q) || goals.find(g => (g.title || '').toLowerCase() === s) || goals.find(g => (g.title || '').toLowerCase().includes(s)) || { id: '__none__', title: q };
}
const thoughtItem = (t, tz) => ({ id: t.id, date: t.createdAt ? zoned(t.createdAt, tz).date : null, text: clip(t.text, 220), tags: (t.tags || []).slice(0, 8), mood: t.mood ?? null, kind: t.kind || 'note' });

const cleanColls = v => { const xs = (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []).map(x => String(x).toLowerCase()).filter(x => SEARCH_COLLS.includes(x)); return xs.length ? [...new Set(xs)] : undefined; };
// the day a record belongs to (for period filters and display)
const recordDay = (coll, d, tz) => (coll === 'money' ? d.date || null : coll === 'tasks' ? (d.doneAt ? zoned(d.doneAt, tz).date : d.dueDate || null) : d.createdAt ? zoned(d.createdAt, tz).date : null);
function searchItem(r, tz) {
  const d = r.data, date = recordDay(r.coll, d, tz);
  if (r.coll === 'tasks') return drop({ id: r.id, coll: 'tasks', date, text: clip(d.title, 160), status: d.status || 'open', due: d.dueDate || undefined });
  if (r.coll === 'money') return drop({ id: r.id, coll: 'money', date, text: clip(d.note || d.payee || d.category || 'Money', 120), amount: +d.amount || 0, kind: d.kind || 'expense', category: d.category || 'Other', payee: d.payee || undefined });
  return drop({ id: r.id, coll: 'thoughts', date, text: clip(d.text, 220), tags: (d.tags || []).slice(0, 8), kind: d.kind || 'note' });
}
// Hybrid retrieval through SQL when the request has a database transaction (ctx.tx); in-memory ranking otherwise.
async function runSearch(load, p, { tz, today, tx }, colls, shape) {
  const q = (p.query || '').trim();
  if (q.length < 2) return { query: q, count: 0, items: [], error: 'query must be at least 2 characters, e.g. {"query": "pricing"}' };
  const range = p.range || p.from || p.to ? resolveRange(p, today) : null;
  let rows, via;
  if (tx) ({ rows, used: via } = await hybridSearch(tx, q, { colls, limit: 40 }));
  else {
    const all = (await Promise.all(colls.map(async c => (await load(c)).map(d => ({ coll: c, ...d }))))).flat();
    rows = rankInMemory(all, q).slice(0, 40).map(d => ({ coll: d.coll, id: d.id, data: d })); via = ['memory'];
  }
  rows = rows.filter(r => !range || inRange(recordDay(r.coll, r.data, tz), range));
  return drop({ query: q, range: range || undefined, collections: colls, count: rows.length, items: rows.slice(0, p.limit || 8).map(r => shape(r, tz)), via });
}

export const TOOLS = {
  query_tasks: {
    description: 'Count and list tasks by status and period (done: day finished; else due day). group_by for charts.',
    parameters: { type: 'object', properties: {
      status: { type: 'string', enum: ['open', 'done', 'skipped', 'any'] }, ...RANGE_SCHEMA,
      date_field: { type: 'string', enum: ['due', 'done'] },
      goal: { type: 'string', description: 'goal title or id' },
      group_by: { type: 'string', enum: ['none', 'day', 'weekday', 'hour', 'goal', 'status'] }, limit: LIMIT(20),
    } },
    clean: p => drop({ status: oneOf(p.status, ['open', 'done', 'skipped', 'any'], 'any'), ...rangeParams(p), date_field: oneOf(p.date_field, ['due', 'done'], undefined),
      goal: strOpt(p.goal, 90), group_by: oneOf(p.group_by, ['none', 'day', 'weekday', 'hour', 'goal', 'status'], undefined), limit: p.limit != null ? int(p.limit, 1, 50, 20) : undefined }),
    fields: { scalars: { count: 'number' }, items: ['title', 'status', 'due', 'time', 'done_on', 'goal', 'priority'], ys: ['count'], groupBys: ['day', 'weekday', 'hour', 'goal', 'status'] },
    async run(load, p, { today, tz }) {
      const [tasks, goals] = await Promise.all([load('tasks'), load('goals')]);
      const status = p.status || 'any';
      const field = p.date_field || (status === 'done' ? 'done' : 'due');
      const range = resolveRange(p, today, p.range || p.from || p.to ? undefined : status === 'open' ? 'all' : 'last_7_days');
      const g = matchGoal(goals, p.goal);
      const gTitle = new Map(goals.map(x => [x.id, x.title]));
      const dayOf = t => (field === 'done' ? (t.doneAt ? zoned(t.doneAt, tz).date : null) : t.dueDate || null);
      const rows = tasks.filter(t => (status === 'any' || (t.status || 'open') === status) && (!g || t.goalId === g.id) && (!range || inRange(dayOf(t), range)));
      rows.sort((a, b) => (field === 'done' ? (b.doneAt || 0) - (a.doneAt || 0) : (a.dueDate || '9').localeCompare(b.dueDate || '9') || (a.dueTime || '99').localeCompare(b.dueTime || '99')));
      const by = p.group_by && p.group_by !== 'none' ? p.group_by : null;
      const keyOf = { day: dayOf, weekday: t => { const d = dayOf(t); return d ? String(wdOf(d)) : null; },
        hour: t => (field === 'done' && t.doneAt ? String(zoned(t.doneAt, tz).hour) : t.dueTime ? String(+t.dueTime.slice(0, 2)) : null),
        goal: t => (t.goalId ? gTitle.get(t.goalId) || 'Goal' : 'No goal'), status: t => t.status || 'open' }[by];
      return drop({
        range, status, date_field: field, goal: g ? g.title : undefined, count: rows.length,
        groups: by ? group(rows, keyOf, range, by, ['count']) : undefined,
        items: rows.slice(0, p.limit || 20).map(t => drop({ id: t.id, title: clip(t.title, 120), status: t.status || 'open', due: t.dueDate || null, time: t.dueTime || null,
          done_on: t.doneAt ? zoned(t.doneAt, tz).date : null, goal: t.goalId ? gTitle.get(t.goalId) || null : null, priority: t.priority || 2 })),
      });
    },
  },

  query_goals: {
    description: 'The user\'s goals with weekly milestones and progress (milestones done / total), plus tasks finished for each goal this week.',
    parameters: { type: 'object', properties: { goal: { type: 'string', description: 'Goal id or title (omit for all goals).' } } },
    clean: p => drop({ goal: strOpt(p.goal, 90) }),
    fields: { scalars: { count: 'number', milestones_done: 'number', milestones_total: 'number', progress: 'percent' }, items: ['title', 'target', 'done', 'total', 'progress'], ys: [], groupBys: [] },
    async run(load, p, { today, tz }) {
      const [goals, tasks] = await Promise.all([load('goals'), load('tasks')]);
      const g = matchGoal(goals, p.goal);
      const ws = mondayOf(today);
      const list = goals.filter(x => !x.archived && (!g || x.id === g.id)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const week = new Map();
      for (const t of tasks) if (t.status === 'done' && t.doneAt && t.goalId) { const d = zoned(t.doneAt, tz).date; if (d >= ws && d <= today) week.set(t.goalId, (week.get(t.goalId) || 0) + 1); }
      const out = list.map(x => { const ms = x.milestones || []; const done = ms.filter(m => m.done).length;
        return { id: x.id, title: clip(x.title, 120), target: x.target || null, why: clip(x.why, 160) || null, done, total: ms.length, progress: ms.length ? Math.round((done / ms.length) * 1000) / 1000 : 0,
          tasks_done_this_week: week.get(x.id) || 0, milestones: ms.slice(0, 12).map(m => ({ title: clip(m.title, 90), week: m.week || null, done: !!m.done })) }; });
      const md = out.reduce((s, x) => s + x.done, 0), mt = out.reduce((s, x) => s + x.total, 0);
      return { count: out.length, milestones_done: md, milestones_total: mt, progress: mt ? Math.round((md / mt) * 1000) / 1000 : 0, goals: out, items: out };
    },
  },

  query_money: {
    description: 'Money logged (₹): total, count, avg_per_day for a period (default this month), filters, group_by with sums. A calendar month of expenses also returns budget {limit, left, used_pct} if set.',
    parameters: { type: 'object', properties: {
      kind: { type: 'string', enum: ['expense', 'income', 'any'] }, ...RANGE_SCHEMA,
      category: { type: 'string' }, payee: { type: 'string' },
      group_by: { type: 'string', enum: ['none', 'day', 'week', 'month', 'category', 'payee'] }, limit: LIMIT(15),
    } },
    clean: p => drop({ kind: oneOf(p.kind, ['expense', 'income', 'any'], 'expense'), ...rangeParams(p), category: strOpt(p.category, 40), payee: strOpt(p.payee, 60),
      group_by: oneOf(p.group_by, ['none', 'day', 'week', 'month', 'category', 'payee'], undefined), limit: p.limit != null ? int(p.limit, 1, 50, 15) : undefined }),
    fields: { scalars: { total: 'inr', count: 'number', avg_per_day: 'inr' }, items: ['date', 'kind', 'amount', 'category', 'payee', 'note'], ys: ['sum', 'count'], groupBys: ['day', 'week', 'month', 'category', 'payee'] },
    async run(load, p, { today }) {
      const money = await load('money');
      const kind = p.kind || 'expense';
      const range = resolveRange(p, today, 'this_month');
      const cat = p.category?.toLowerCase(), pay = p.payee?.toLowerCase();
      const rows = money.filter(m => (kind === 'any' || (m.kind || 'expense') === kind) && inRange(m.date, range)
        && (!cat || (m.category || 'Other').toLowerCase() === cat) && (!pay || (m.payee || '').toLowerCase().includes(pay)));
      rows.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
      const total = Math.round(rows.reduce((s, m) => s + (+m.amount || 0), 0) * 100) / 100;
      const span = range ? Math.max(1, daysBetween(range.from, range.to > today ? today : range.to) + 1) : Math.max(1, new Set(rows.map(m => m.date)).size);
      const by = p.group_by && p.group_by !== 'none' ? p.group_by : null;
      const keyOf = { day: m => m.date, week: m => (m.date ? mondayOf(m.date) : null), month: m => (m.date || '').slice(0, 7) || null, category: m => m.category || 'Other', payee: m => m.payee || null }[by];
      // monthly budget (Money > Budget): only for a single calendar month of expenses
      let budget;
      if (kind === 'expense' && range && range.from.slice(0, 7) === range.to.slice(0, 7) && range.from.endsWith('-01')) {
        const b = (await load('meta')).find(m => m.id === 'budgets') || {};
        const limit = cat ? +Object.entries(b.categories || {}).find(([k]) => k.toLowerCase() === cat)?.[1] || 0 : +b.total || 0;
        if (limit > 0) budget = { limit, left: Math.round((limit - total) * 100) / 100, used_pct: Math.round((total / limit) * 100) };
      }
      return drop({
        range, kind, category: p.category, payee: p.payee, total, count: rows.length, avg_per_day: Math.round((total / span) * 100) / 100, budget,
        groups: by ? group(rows, keyOf, range, by, ['sum', 'count']) : undefined,
        items: rows.slice(0, p.limit || 15).map(m => ({ id: m.id, date: m.date || null, kind: m.kind || 'expense', amount: +m.amount || 0, category: m.category || 'Other', payee: m.payee || null, note: clip(m.note, 80) })),
      });
    },
  },

  query_thoughts: {
    description: 'Thoughts (notes, ideas, journal) in a period (default last 30 days), by tag or kind; group_by for charts.',
    parameters: { type: 'object', properties: { ...RANGE_SCHEMA, tag: { type: 'string', description: 'without #' }, kind: { type: 'string', enum: ['note', 'idea', 'journal'] },
      group_by: { type: 'string', enum: ['none', 'day', 'tag', 'mood', 'kind'] }, limit: LIMIT(10) } },
    clean: p => drop({ ...rangeParams(p), tag: strOpt(p.tag, 40)?.replace(/^#/, '').toLowerCase(), kind: oneOf(p.kind, ['note', 'idea', 'journal'], undefined),
      group_by: oneOf(p.group_by, ['none', 'day', 'tag', 'mood', 'kind'], undefined), limit: p.limit != null ? int(p.limit, 1, 50, 10) : undefined }),
    fields: { scalars: { count: 'number' }, items: ['date', 'text', 'tags', 'mood', 'kind'], ys: ['count'], groupBys: ['day', 'tag', 'mood', 'kind'] },
    async run(load, p, { today, tz }) {
      const thoughts = await load('thoughts');
      const range = resolveRange(p, today, 'last_30_days');
      const day = t => (t.createdAt ? zoned(t.createdAt, tz).date : null);
      const rows = thoughts.filter(t => inRange(day(t), range) && (!p.tag || (t.tags || []).includes(p.tag)) && (!p.kind || (t.kind || 'note') === p.kind))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      const by = p.group_by && p.group_by !== 'none' ? p.group_by : null;
      let groups;
      if (by === 'tag') { const exp = rows.flatMap(t => (t.tags || []).map(tag => ({ tag }))); groups = group(exp, x => x.tag, range, 'tag', ['count']); }
      else if (by) groups = group(rows, { day, mood: t => String(t.mood ?? 3), kind: t => t.kind || 'note' }[by], range, by, ['count']);
      return drop({ range, tag: p.tag, kind: p.kind, count: rows.length, groups, items: rows.slice(0, p.limit || 10).map(t => thoughtItem(t, tz)) });
    },
  },

  search: {
    description: 'Find thoughts, tasks and money notes by words or meaning (full-text + fuzzy + semantic), best first.',
    parameters: { type: 'object', properties: {
      query: { type: 'string', description: 'a few key words' },
      collections: { type: 'array', items: { type: 'string', enum: SEARCH_COLLS }, description: 'default all' },
      ...RANGE_SCHEMA, limit: LIMIT(8),
    }, required: ['query'] },
    clean: p => drop({ query: strOpt(p.query, 100) || '', collections: cleanColls(p.collections), ...rangeParams(p), limit: p.limit != null ? int(p.limit, 1, 20, 8) : undefined }),
    fields: { scalars: { count: 'number' }, items: ['coll', 'date', 'text', 'amount', 'status', 'tags'], ys: [], groupBys: [] },
    run: (load, p, ctx) => runSearch(load, p, ctx, p.collections || SEARCH_COLLS, searchItem),
  },

  // 1.5 name, kept as an alias (stored cards and older prompts use it): the same hybrid search over thoughts only
  search_thoughts: {
    description: 'Search only the user\'s thoughts (same ranking as search). Prefer search.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Words to look for.' }, limit: LIMIT(8) }, required: ['query'] },
    clean: p => drop({ query: strOpt(p.query, 100) || '', limit: p.limit != null ? int(p.limit, 1, 50, 8) : undefined }),
    fields: { scalars: { count: 'number' }, items: ['date', 'text', 'tags', 'mood', 'kind'], ys: [], groupBys: [] },
    run: (load, p, ctx) => runSearch(load, p, ctx, ['thoughts'], (r, tz) => thoughtItem({ ...r.data, id: r.id }, tz)),
  },

  get_insights_summary: {
    description: 'Insights: streaks, completion rates, best hours/weekday, usual load, this vs last week, spending, milestones, learned patterns.',
    parameters: { type: 'object', properties: {} },
    clean: () => ({}),
    fields: { scalars: { streak_current: 'days', streak_longest: 'days', done_this_week: 'number', done_last_week: 'number', rate_last_7: 'percent', rate_last_30: 'percent',
      avg_done_per_day: 'number', spent_this_week: 'inr', spent_last_week: 'inr', spent_month: 'inr', milestones_done: 'number', milestones_total: 'number', thoughts_month: 'number' }, items: [], ys: [], groupBys: [] },
    async run(load, p, { tz, at }) {
      const [tasks, goals, money, thoughts, checkins] = await Promise.all(['tasks', 'goals', 'money', 'thoughts', 'checkins'].map(load));
      // engine.js / overview.js read local-time getters; shift every timestamp so "local" means the user's zone here
      const sh = ms => shiftToZone(ms, tz);
      const S = xs => xs.map(x => ({ ...x, doneAt: x.doneAt ? sh(x.doneAt) : x.doneAt, createdAt: x.createdAt ? sh(x.createdAt) : x.createdAt, updatedAt: x.updatedAt ? sh(x.updatedAt) : x.updatedAt }));
      const now = new Date(sh(at));
      const a = analyzeData({ tasks: S(tasks), checkins: S(checkins), thoughts: S(thoughts), goals }, now);
      const o = overview({ tasks: S(tasks), goals, money, thoughts: S(thoughts) }, now);
      const r = x => (x == null ? null : Math.round(x * 1000) / 1000);
      return {
        streak_current: a.streak.current, streak_longest: a.streak.longest, done_this_week: o.doneWeek, done_last_week: o.doneLastWeek,
        rate_last_7: r(a.last7), rate_last_30: r(a.last30), avg_done_per_day: Math.round(a.avgDone * 10) / 10, usual_daily_load: a.loadCap,
        best_window: a.best.start !== null && a.best.share >= 0.25 ? `${fmtHour(a.best.start)}–${fmtHour((a.best.start + 2) % 24)}` : null,
        best_day: a.bestDay ? DAYS[a.bestDay.i] : null, lightest_day: a.worstDay ? DAYS[a.worstDay.i] : null, slump: a.slump?.text || null,
        spent_this_week: Math.round(o.spentWeek * 100) / 100, spent_last_week: Math.round(o.spentLastWeek * 100) / 100, spent_month: Math.round(o.spentMonth * 100) / 100,
        top_categories_month: o.cats.map(([c, v]) => ({ category: c, sum: Math.round(v * 100) / 100 })),
        milestones_done: o.msDone, milestones_total: o.msTotal, thoughts_month: o.thoughtsMonth, top_tags: o.topTags.map(([t, n]) => ({ tag: t, count: n })),
        learned: a.remember.map(x => x.text), enough_data: a.enough,
      };
    },
  },
};
export const TOOL_NAMES = Object.keys(TOOLS);

// ms → ms whose *process-local* wall clock equals the wall clock in tz (engine.js uses getHours()/getDate()).
export function shiftToZone(ms, tz) {
  const z = zoned(ms, tz);
  const wall = Date.UTC(+z.date.slice(0, 4), +z.date.slice(5, 7) - 1, +z.date.slice(8, 10), z.hour, z.minute) + (ms % 60000 + 60000) % 60000;
  return wall + new Date(wall).getTimezoneOffset() * 60000;
}

// OpenAI-style tool schemas for the model.
// search_thoughts stays callable (stored 1.5 cards, salvaged calls) but is not offered: search covers it.
export const OFFERED = TOOL_NAMES.filter(n => n !== 'search_thoughts');
export const toolSchemas = () => OFFERED.map(name => ({ type: 'function', function: { name, description: TOOLS[name].description, parameters: TOOLS[name].parameters } }));

// Run one tool. `ctx` = { load, sql, today, tz, at } (see dataAccess). Unknown tool / bad params never throw at the model: they come back as { error }.
export async function runTool(name, params, ctx) {
  const t = TOOLS[name];
  if (!t) return { error: `unknown tool ${String(name).slice(0, 40)}` };
  const p = t.clean(params && typeof params === 'object' ? params : {});
  return t.run(ctx.load, p, ctx);
}
