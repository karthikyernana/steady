// Generative-UI cards for the chat agent: a FIXED component kit, A2UI-shaped (a flat list of components, each with an id,
// a component name, a few presentational props and a data binding). Two rules make it safe:
//
//   1. Cards store a QUERY, never numbers. A data card names a read-only tool + params (server/chat-tools.js) and which
//      field to show/plot. Numbers are computed from the user's real rows every time the card is resolved (when the reply
//      is sent and whenever the chat is opened again). Any number the model puts in a card is not part of the schema and
//      is dropped by validateCard(), so it can never reach the screen.
//   2. Nothing executable. Cards are plain data; clients render each component natively (SVG/CSS on web, Compose on
//      Android). No HTML, markdown, code or URLs from the model are ever rendered.
//
// Spec (what is stored):   { id, component, title?, query?: { tool, params }, bind?: {...}, compare?: { params }, text?, tone? }
// Resolved (what clients get): spec fields + { data: {...} } computed by resolveCards(); see docs/AGENT.md for every shape.
import { TOOLS, resolveRange, isDate, dayLabel, addDays } from './chat-tools.js';
import { fmtINR } from '../js/core/money.js';

export const COMPONENTS = ['Stat', 'Line', 'Bar', 'Donut', 'Heatmap', 'ProgressList', 'TaskList', 'Timeline', 'Table', 'Note', 'Callout'];
export const MAX_CARDS = 4;
export const TONES = ['info', 'good', 'warn'];
const CANON = Object.fromEntries(COMPONENTS.map(c => [c.toLowerCase(), c]));
const CHART_TOOLS = { Line: ['query_money', 'query_tasks', 'query_thoughts'], Bar: ['query_money', 'query_tasks', 'query_thoughts'], Donut: ['query_money', 'query_tasks', 'query_thoughts'],
  Heatmap: ['query_tasks', 'query_money', 'query_thoughts'] };
const LINE_BY = ['day', 'week', 'month'];
const DONUT_BY = ['category', 'payee', 'status', 'goal', 'tag', 'mood', 'kind'];
export const TIMELINE_TOOLS = ['query_tasks', 'query_money', 'query_thoughts', 'search', 'search_thoughts'];
// Figures inside free text (₹250, Rs 40, 35%) are exactly what must come from a query instead: such text cards are dropped.
const FIGURE = /(₹|\brs\.?|\binr)\s?\d|\d\s?%|\d+\s?(rupees|percent)\b/i;

const clip = (s, n) => { const v = String(s ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').trim(); return v.length > n ? v.slice(0, n - 1) + '…' : v; };
// markdown marks go, but a #tag the user wrote ("… a fixed audit #clients") keeps its #: only heading/quote marks at
// the start of a line and a # that starts no word are stripped
const plain = s => String(s ?? '').replace(/<[^>]*>/g, '').replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '').replace(/^[ \t]{0,3}>[ \t]?/gm, '')
  .replace(/#+(?![\p{L}\p{N}])/gu, '').replace(/[*_`]+/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

// Freeze a relative period ("this_week") into real days at the moment the reply is made, so reopening the chat later
// shows the same period (with whatever the data for that period is now).
const RANGED = ['query_tasks', 'query_money', 'query_thoughts'];
const defaultRange = (tool, p) => (tool === 'query_money' ? 'this_month' : tool === 'query_tasks' ? (p.status === 'open' ? 'all' : 'last_7_days') : 'last_30_days');
function freeze(params, today, tool) {
  if (!RANGED.includes(tool)) return { ...params };
  const p = { ...params };
  const has = 'range' in p || 'from' in p || 'to' in p;
  const preset = has ? p.range : defaultRange(tool, p);
  delete p.range; delete p.from; delete p.to;
  const r = preset === 'all' ? null : resolveRange(has ? params : { range: preset }, today, defaultRange(tool, params));
  if (r) { p.from = r.from; p.to = r.to; } else p.range = 'all';
  return p;
}

// The period just before a frozen one, same length: today → yesterday, a Mon–Sun week → the week before, a calendar
// month → the month before. Returns { params: { from, to }, label } or null (an open period has no "before").
export function previousPeriod(p, today) {
  if (!isDate(p.from) || !isDate(p.to)) return null;
  const span = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5) + 1;
  if (p.from > today) return null;
  const days = span(p.from, p.to);
  // a period still running (this week, this month) is compared with the same number of days of the one before
  const ongoing = p.to > today, elapsed = ongoing ? span(p.from, today) : days;
  if (p.from.endsWith('-01') && addDays(p.to, 1).endsWith('-01') && p.from.slice(0, 7) === p.to.slice(0, 7)) {
    const end = addDays(p.from, -1), from = `${end.slice(0, 7)}-01`;
    const to = ongoing ? [addDays(from, elapsed - 1), end].sort()[0] : end;
    return { params: { from, to }, label: ongoing ? 'last month to date' : 'last month' };
  }
  const from = addDays(p.from, -days), to = addDays(from, elapsed - 1);
  const monday = (new Date(`${p.from}T12:00:00Z`).getUTCDay() + 6) % 7 === 0;
  const label = days === 1 ? (p.from === today ? 'yesterday' : 'day before') : days === 7 && monday ? (ongoing ? 'same point last week' : 'last week') : `previous ${days} days`;
  return { params: { from, to }, label };
}

// One card: returns { card } (repaired) or { error } (dropped). `today` = YYYY-MM-DD in the user's zone.
export function validateCard(raw, { today, index = 0 } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'not an object' };
  const component = CANON[String(raw.component ?? raw.type ?? '').toLowerCase()];
  if (!component) return { error: `unknown component ${clip(raw.component ?? raw.type, 30)}` };
  const card = { id: `c${index + 1}`, component };
  const title = clip(plain(raw.title), 60); if (title && !FIGURE.test(title)) card.title = title;

  if (component === 'Note' || component === 'Callout') {
    const text = clip(plain(raw.text ?? raw.body), component === 'Note' ? 600 : 300);
    if (!text) return { error: 'empty text' };
    if (FIGURE.test(text) || FIGURE.test(title)) return { error: 'figures in free text (use a data card)' };
    card.text = text;
    if (component === 'Callout') card.tone = TONES.includes(raw.tone) ? raw.tone : 'info';
    return { card };
  }

  const q = raw.query && typeof raw.query === 'object' ? raw.query : null;
  const toolName = q?.tool ?? raw.tool;
  const tool = TOOLS[toolName];
  if (!tool) return { error: `unknown or missing tool ${clip(toolName, 40)}` };
  let params = tool.clean(q?.params && typeof q.params === 'object' ? q.params : {});
  const bind = raw.bind && typeof raw.bind === 'object' ? raw.bind : {};
  const f = tool.fields;

  switch (component) {
    case 'Stat': {
      const value = Object.hasOwn(f.scalars, bind.value) ? bind.value : Object.keys(f.scalars)[0];
      card.bind = { value };
      const label = clip(plain(bind.label ?? raw.label), 40); if (label && !FIGURE.test(label)) card.bind.label = label;
      delete params.group_by; delete params.limit;
      if (raw.compare && typeof raw.compare === 'object' && toolName !== 'get_insights_summary') {
        const cp = tool.clean({ ...params, ...(raw.compare.params && typeof raw.compare.params === 'object' ? raw.compare.params : {}) });
        delete cp.group_by; delete cp.limit;
        card.compare = { params: freeze(cp, today, toolName) };
        const cl = clip(plain(raw.compare.label), 30); if (cl && !FIGURE.test(cl)) card.compare.label = cl;
      } else if (RANGED.includes(toolName) && raw.compare !== false) {
        // a figure means more next to the one before it: compare with the period of the same length just before
        const prev = previousPeriod(freeze(params, today, toolName), today);
        if (prev) card.compare = { params: tool.clean({ ...params, from: prev.params.from, to: prev.params.to, range: undefined }), label: prev.label };
      }
      break;
    }
    case 'Line': case 'Bar': case 'Donut': case 'Heatmap': {
      if (!CHART_TOOLS[component].includes(toolName)) return { error: `${component} cannot plot ${toolName}` };
      let by = params.group_by;
      if (component === 'Heatmap') by = 'day';
      else if (component === 'Line' && !LINE_BY.includes(by)) by = 'day';
      else if (component === 'Donut' && !DONUT_BY.includes(by)) by = toolName === 'query_money' ? 'category' : toolName === 'query_tasks' ? 'status' : 'tag';
      else if (!by || by === 'none') by = toolName === 'query_money' ? 'category' : 'day';
      if (!f.groupBys.includes(by)) return { error: `${toolName} cannot group by ${by}` };
      params = { ...params, group_by: by }; delete params.limit;
      if (component === 'Heatmap' && !params.range && !params.from && !params.to) params.range = 'last_90_days';
      if ((component === 'Bar' || component === 'Line') && by === 'day') {
        // a one-day chart is a single bar: show the 7 days that end on that day instead
        const r = resolveRange(params, today, defaultRange(toolName, params));
        if (r && r.from === r.to) { params = { ...params, from: addDays(r.to, -6), to: r.to }; delete params.range; }
      }
      card.bind = { y: f.ys.includes(bind.y) ? bind.y : f.ys[0] };
      break;
    }
    case 'ProgressList':
      if (toolName !== 'query_goals') return { error: 'ProgressList needs query_goals' };
      break;
    case 'TaskList':
      if (toolName !== 'query_tasks') return { error: 'TaskList needs query_tasks' };
      params = { ...params, limit: Math.min(params.limit || 8, 20) }; delete params.group_by;
      break;
    case 'Timeline':
      if (!TIMELINE_TOOLS.includes(toolName)) return { error: `Timeline cannot show ${toolName}` };
      params = { ...params, limit: Math.min(params.limit || 8, 20) }; delete params.group_by;
      break;
    case 'Table': {
      const rows = bind.rows === 'groups' && f.groupBys.length ? 'groups' : 'items';
      if (rows === 'groups' && (!params.group_by || params.group_by === 'none')) params = { ...params, group_by: f.groupBys[0] };
      const allowed = rows === 'groups' ? ['label', ...f.ys] : f.items;
      if (!allowed.length) return { error: `${toolName} has no rows for a table` };
      let cols = (Array.isArray(bind.columns) ? bind.columns : []).filter(c => allowed.includes(c));
      cols = [...new Set(cols)].slice(0, 4);
      if (!cols.length) cols = allowed.slice(0, 3);
      card.bind = { rows, columns: cols };
      params = { ...params, limit: Math.min(params.limit || 10, 20) };
      break;
    }
  }
  card.query = { tool: toolName, params: freeze(params, today, toolName) };
  return { card };
}

// A reply's cards: strict, repaired, at most MAX_CARDS. Returns { cards, dropped: [{ index, reason }] }.
export function validateCards(raw, opts = {}) {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
  const cards = [], dropped = [];
  list.slice(0, 12).forEach((c, i) => {
    if (cards.length >= MAX_CARDS) { dropped.push({ index: i, reason: 'too many cards' }); return; }
    const r = validateCard(c, { ...opts, index: cards.length });
    if (r.card) cards.push(r.card); else dropped.push({ index: i, reason: r.error });
  });
  return { cards, dropped };
}

// ---------------------------------------------------------------- resolving (numbers come from here, from real rows)
export function fmt(v, type) {
  if (v == null || Number.isNaN(v)) return '–';
  switch (type) {
    case 'inr': return fmtINR(Math.round(v * 100) / 100);
    case 'percent': return `${Math.round(v * 100)}%`;
    case 'days': return `${v} ${v === 1 ? 'day' : 'days'}`;
    default: return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
  }
}
const yType = (tool, y) => (y === 'sum' && tool === 'query_money' ? 'inr' : 'number');
const STAT_LABEL = { total: 'spent', count: 'items', avg_per_day: 'a day on average', streak_current: 'day streak', streak_longest: 'longest streak', done_this_week: 'done this week',
  done_last_week: 'done last week', rate_last_7: 'of planned tasks done, last 7 days', rate_last_30: 'of planned tasks done, last 30 days', avg_done_per_day: 'done a day',
  spent_this_week: 'spent this week', spent_last_week: 'spent last week', spent_month: 'spent this month', milestones_done: 'milestones done', milestones_total: 'milestones',
  thoughts_month: 'thoughts this month', progress: 'of milestones done' };
const periodLabel = r => (!r ? 'All time' : r.from === r.to ? dayLabel(r.from) : `${dayLabel(r.from)} – ${dayLabel(r.to)}`);
const cellFmt = (tool, col, v) => {
  if (v == null || v === '') return '–';
  if (col === 'amount' || (col === 'sum' && tool === 'query_money')) return fmt(+v, 'inr');
  if (col === 'progress') return fmt(+v, 'percent');
  if (Array.isArray(v)) return v.map(x => `#${x}`).join(' ');
  if (isDate(v)) return dayLabel(v);
  return clip(String(v), 80);
};
const COL_LABEL = { label: '', sum: 'Total', count: 'Count', title: 'Task', due: 'Due', time: 'Time', done_on: 'Done', goal: 'Goal', priority: 'Priority', status: 'Status',
  date: 'Date', kind: 'Kind', amount: 'Amount', category: 'Category', payee: 'Payee', note: 'Note', text: 'Thought', tags: 'Tags', mood: 'Mood', target: 'Target', done: 'Done', total: 'Of' };

async function resolveOne(card, run, today) {
  const { component } = card;
  if (component === 'Note' || component === 'Callout') return { ...card, data: { text: card.text, tone: card.tone } };
  const { tool, params } = card.query;
  const res = await run(tool, params);
  if (res?.error) return { ...card, data: { empty: true, message: 'Could not read that data.' } };
  const period = res.range !== undefined ? periodLabel(res.range) : null;
  switch (component) {
    case 'Stat': {
      const type = TOOLS[tool].fields.scalars[card.bind.value];
      const value = res[card.bind.value] ?? null;
      const data = { value, display: fmt(value, type), label: card.bind.label || STAT_LABEL[card.bind.value] || card.bind.value.replace(/_/g, ' '), period };
      if (card.compare) {
        const other = await run(tool, card.compare.params);
        const ov = other?.[card.bind.value];
        if (typeof ov === 'number' && typeof value === 'number') {
          const d = Math.round((value - ov) * 100) / 100;
          data.compare = { value: ov, display: fmt(ov, type), delta: d, deltaDisplay: (d > 0 ? '+' : d < 0 ? '−' : '') + fmt(Math.abs(d), type), label: card.compare.label || periodLabel(other.range) };
        }
      }
      // a small 7-day sparkline of the same figure, ending on the period's last day (or today if that is earlier)
      const y = TREND_Y[tool]?.[card.bind.value];
      if (y && res.range) {
        const end = [res.range.to, today || res.range.to].sort()[0];
        const tr = await run(tool, { ...params, from: addDays(end, -6), to: end, range: undefined, group_by: 'day' });
        if (Array.isArray(tr?.groups) && tr.groups.length) {
          const t = y === 'sum' && tool === 'query_money' ? 'inr' : 'number';
          data.trend = { points: tr.groups.map(g => ({ key: g.key, label: g.label, short: g.short || g.label, value: g[y] || 0, display: fmt(g[y] || 0, t) })), unit: t };
        }
      }
      return { ...card, data };
    }
    case 'Line': case 'Bar': case 'Donut': {
      let points = (res.groups || []).map(g => ({ key: g.key, label: g.label, ...(g.short ? { short: g.short } : {}), value: g[card.bind.y] || 0 }));
      if (component === 'Donut') {
        points = points.filter(p => p.value > 0);
        if (points.length > 6) { const rest = points.slice(5).reduce((s, p) => s + p.value, 0); points = [...points.slice(0, 5), { key: '__other', label: 'Other', value: Math.round(rest * 100) / 100 }]; }
      }
      const type = yType(tool, card.bind.y);
      const total = Math.round(points.reduce((s, p) => s + p.value, 0) * 100) / 100;
      return { ...card, data: { points: points.map(p => ({ ...p, display: fmt(p.value, type) })), total, totalDisplay: fmt(total, type), max: Math.max(0, ...points.map(p => p.value)), unit: type, period, empty: total === 0 } };
    }
    case 'Heatmap': {
      const days = (res.groups || []).map(g => ({ date: g.key, value: g[card.bind.y] || 0 }));
      const max = Math.max(0, ...days.map(d => d.value));
      const type = yType(tool, card.bind.y);
      return { ...card, data: { days: days.map(d => ({ ...d, display: fmt(d.value, type) })), max, from: res.range?.from || days[0]?.date || null, to: res.range?.to || days.at(-1)?.date || null, unit: type, period, empty: max === 0 } };
    }
    case 'ProgressList':
      return { ...card, data: { items: (res.goals || []).map(g => ({ id: g.id, label: g.title, done: g.done, total: g.total, frac: g.total ? g.done / g.total : 0, display: g.total ? `${g.done}/${g.total}` : 'no milestones' })), empty: !(res.goals || []).length } };
    case 'TaskList':
      return { ...card, data: { items: (res.items || []).map(t => ({ id: t.id, title: t.title, status: t.status, due: t.due, time: t.time, goal: t.goal || null, dueDisplay: t.due ? dayLabel(t.due) : null })), count: res.count, period, empty: !res.count } };
    case 'Timeline': {
      const items = (res.items || []).map(x => {
        if (tool === 'query_tasks') return { date: x.done_on || x.due, time: x.time, title: x.title, sub: x.status === 'done' ? 'Done' : x.goal || null };
        if (tool === 'query_money') return { date: x.date, time: null, title: x.note || x.payee || x.category, sub: `${x.kind === 'income' ? '+' : ''}${fmt(x.amount, 'inr')} · ${x.category}` };
        if (tool === 'search') return { date: x.date, time: null, title: x.text, sub: x.coll === 'money' ? `${x.kind === 'income' ? '+' : ''}${fmt(x.amount, 'inr')} · ${x.category}` : x.coll === 'tasks' ? (x.status === 'done' ? 'Task · done' : 'Task') : (x.tags || []).map(t => `#${t}`).join(' ') || 'Thought' };
        return { date: x.date, time: null, title: x.text, sub: (x.tags || []).map(t => `#${t}`).join(' ') || null };
      }).filter(x => x.date).sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
      return { ...card, data: { items: items.map(x => ({ ...x, dateDisplay: dayLabel(x.date) })), period, empty: !items.length } };
    }
    case 'Table': {
      const src = card.bind.rows === 'groups' ? (res.groups || []) : (res.items || []);
      const cols = card.bind.columns;
      return { ...card, data: { columns: cols.map(c => ({ key: c, label: c === 'label' ? labelForGroup(params.group_by) : COL_LABEL[c] || c })),
        rows: src.slice(0, params.limit || 10).map(r => cols.map(c => cellFmt(tool, c, r[c]))), period, empty: !src.length } };
    }
  }
  return { ...card, data: { empty: true } };
}
const TREND_Y = { query_tasks: { count: 'count' }, query_money: { total: 'sum', count: 'count', avg_per_day: 'sum' }, query_thoughts: { count: 'count' } };
const labelForGroup = by => ({ day: 'Day', week: 'Week', month: 'Month', category: 'Category', payee: 'Payee', goal: 'Goal', status: 'Status', weekday: 'Weekday', hour: 'Hour', tag: 'Tag', mood: 'Mood', kind: 'Kind' }[by] || '');

// run(tool, params) → tool result (memoized per request by the caller). Resolution never throws: a card that cannot be
// computed comes back { data: { empty: true } } so one bad card never hides the reply.
export async function resolveCards(cards, run, opts = {}) {
  const memo = new Map();
  const once = (tool, params) => { const k = tool + JSON.stringify(params); if (!memo.has(k)) memo.set(k, run(tool, params).catch(() => ({ error: 'failed' }))); return memo.get(k); };
  const out = [];
  for (const c of cards || []) {
    try { out.push(await resolveOne(c, once, opts.today)); } catch { out.push({ ...c, data: { empty: true, message: 'Could not read that data.' } }); }
  }
  return out;
}

// Short text the model sees for earlier cards in the conversation (never numbers).
export const describeCard = c => `${c.component}${c.title ? ` "${c.title}"` : ''}${c.query ? ` (${c.query.tool} ${JSON.stringify(c.query.params)})` : ''}`;


// ---------------------------------------------------------------- deterministic UI selection (1.6)
// The model is asked to pick cards, but the reply is not left to it: when an answer about the user's data carries no
// data card, the server picks one from the tool calls the model actually made, by fixed rules (query shape → card).
// Same input, same cards; the result still goes through validateCards(), so it is a QUERY spec like any other.
//   calls: [{ name, params (cleaned), out }] in call order. Returns raw specs (0–2).
const DATA_KINDS = COMPONENTS.filter(c => c !== 'Note' && c !== 'Callout');
export const hasDataCard = cards => (cards || []).some(c => DATA_KINDS.includes(c.component));
export function pickCards(calls, { max = 2 } = {}) {
  const out = [], seen = new Set();
  for (const c of [...(calls || [])].reverse()) {          // the last calls are the ones the answer rests on
    if (out.length >= max || !c?.out || c.out.error || seen.has(c.name)) continue;
    const spec = cardFor(c.name, c.params || {}, c.out);
    if (spec) { out.unshift(spec); seen.add(c.name); }
  }
  return out;
}
function cardFor(name, p, out) {
  const q = params => ({ tool: name, params });
  const by = p.group_by && p.group_by !== 'none' ? p.group_by : null;
  switch (name) {
    case 'query_tasks': {
      if (by) return { component: ['goal', 'status'].includes(by) ? 'Donut' : 'Bar', title: titleFor(name, p, by), query: q(p), bind: { y: 'count' } };
      if ((p.status || 'any') === 'done') return { component: 'Stat', title: 'Tasks done', query: q(p), bind: { value: 'count', label: 'tasks done' } };
      return out.count ? { component: 'TaskList', title: p.status === 'open' ? 'Open tasks' : 'Tasks', query: q({ ...p, limit: Math.min(p.limit || 8, 20) }) }
        : { component: 'Stat', title: 'Tasks', query: q(p), bind: { value: 'count', label: p.status === 'open' ? 'open tasks' : 'tasks' } };
    }
    case 'query_money':
      if (by) return { component: ['category', 'payee'].includes(by) ? 'Donut' : 'Bar', title: titleFor(name, p, by), query: q(p), bind: { y: 'sum' } };
      return { component: 'Stat', title: p.kind === 'income' ? 'Income' : 'Spent', query: q(p), bind: { value: 'total', label: p.kind === 'income' ? 'received' : 'spent' } };
    case 'query_goals': return out.count ? { component: 'ProgressList', title: 'Goals', query: q(p) } : null;
    case 'query_thoughts':
      if (by) return { component: by === 'day' ? 'Bar' : 'Donut', title: titleFor(name, p, by), query: q(p), bind: { y: 'count' } };
      return out.count ? { component: 'Timeline', title: 'Your thoughts', query: q({ ...p, limit: Math.min(p.limit || 8, 20) }) } : null;
    case 'search': case 'search_thoughts':
      return out.count ? { component: 'Timeline', title: 'What I found', query: q({ ...p, limit: Math.min(p.limit || 8, 20) }) } : null;
    case 'get_insights_summary':
      return { component: 'Stat', title: 'This week', query: { tool: 'query_tasks', params: { status: 'done', range: 'this_week' } }, bind: { value: 'count', label: 'tasks done this week' } };
  }
  return null;
}
const titleFor = (tool, p, by) => `${tool === 'query_money' ? (p.kind === 'income' ? 'Income' : 'Spending') : tool === 'query_tasks' ? (p.status === 'done' ? 'Done' : 'Tasks') : 'Thoughts'} by ${by}`;

// ---------------------------------------------------------------- follow-up suggestions (1.6)
// 0–3 short prompts the user can tap. Plain text, ≤ 40 chars, no figures (a chip is a question, not a fact), no
// repeats of the user's own question. Model-written ones are cleaned here; when it wrote none, fixed ones are picked
// from the tools it used.
export const MAX_SUGGESTIONS = 3, SUGGESTION_LEN = 40;
const norm = t => String(t).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function cleanSuggestions(raw, { asked = '', max = MAX_SUGGESTIONS } = {}) {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  const out = [], seen = new Set([norm(asked)]);
  for (const x of list.slice(0, 8)) {
    if (typeof x !== 'string') continue;
    let t = plain(x).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').replace(/^["'“‘\-–•\s]+|["'”’\s]+$/g, '').trim();
    if (!t || /https?:|www\.|[<>{}]/i.test(t) || FIGURE.test(t)) continue;
    if (t.length > SUGGESTION_LEN) { const cut = t.slice(0, SUGGESTION_LEN + 1).replace(/\s+\S*$/, '').replace(/[,;:]$/, ''); if (cut.length < 12 || cut.length > SUGGESTION_LEN) continue; t = cut; }
    const key = norm(t);
    if (!key || seen.has(key)) continue;
    seen.add(key); out.push(t);
    if (out.length >= max) break;
  }
  return out;
}
const FALLBACK = {
  query_tasks: ["What's still open today?", 'Compare with last week', 'When do I get most done?'],
  query_money: ['Compare with last month', 'Where does most of it go?', 'Show it day by day'],
  query_goals: ['Which goal is behind?', "This week's tasks for my goals"],
  query_thoughts: ['What did I write this week?', 'My most used tags'],
  search: ['Show more like this', 'What else did I write lately?'],
  search_thoughts: ['Show more like this', 'What else did I write lately?'],
  get_insights_summary: ['How is my streak going?', 'Compare with last week'],
};
export function fallbackSuggestions(tools, asked = '') {
  const pool = [...new Set([...(tools || [])].reverse())].flatMap(n => FALLBACK[n] || []);
  return cleanSuggestions(pool.length ? pool : ['How was my day?', 'Spending this week', 'How are my goals?'], { asked });
}
