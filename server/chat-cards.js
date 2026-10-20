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
import { TOOLS, resolveRange, isDate, dayLabel } from './chat-tools.js';
import { fmtINR } from '../js/core/money.js';

export const COMPONENTS = ['Stat', 'Line', 'Bar', 'Donut', 'Heatmap', 'ProgressList', 'TaskList', 'Timeline', 'Table', 'Note', 'Callout'];
export const MAX_CARDS = 4;
export const TONES = ['info', 'good', 'warn'];
const CANON = Object.fromEntries(COMPONENTS.map(c => [c.toLowerCase(), c]));
const CHART_TOOLS = { Line: ['query_money', 'query_tasks', 'query_thoughts'], Bar: ['query_money', 'query_tasks', 'query_thoughts'], Donut: ['query_money', 'query_tasks', 'query_thoughts'],
  Heatmap: ['query_tasks', 'query_money', 'query_thoughts'] };
const LINE_BY = ['day', 'week', 'month'];
const DONUT_BY = ['category', 'payee', 'status', 'goal', 'tag', 'mood', 'kind'];
const TIMELINE_TOOLS = ['query_tasks', 'query_money', 'query_thoughts', 'search_thoughts'];
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

// One card: returns { card } (repaired) or { error } (dropped). `today` = YYYY-MM-DD in the user's zone.
export function validateCard(raw, { today, index = 0 } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'not an object' };
  const component = CANON[String(raw.component ?? raw.type ?? '').toLowerCase()];
  if (!component) return { error: `unknown component ${clip(raw.component ?? raw.type, 30)}` };
  const card = { id: `c${index + 1}`, component };
  const title = clip(plain(raw.title), 60); if (title) card.title = title;

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
      const label = clip(plain(bind.label ?? raw.label), 40); if (label) card.bind.label = label;
      if (raw.compare && typeof raw.compare === 'object' && toolName !== 'get_insights_summary') {
        const cp = tool.clean({ ...params, ...(raw.compare.params && typeof raw.compare.params === 'object' ? raw.compare.params : {}) });
        card.compare = { params: freeze(cp, today, toolName) };
        const cl = clip(plain(raw.compare.label), 30); if (cl) card.compare.label = cl;
      }
      delete params.group_by; delete params.limit;
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

async function resolveOne(card, run) {
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
      return { ...card, data };
    }
    case 'Line': case 'Bar': case 'Donut': {
      let points = (res.groups || []).map(g => ({ key: g.key, label: g.label, value: g[card.bind.y] || 0 }));
      if (component === 'Donut') {
        points = points.filter(p => p.value > 0);
        if (points.length > 6) { const rest = points.slice(5).reduce((s, p) => s + p.value, 0); points = [...points.slice(0, 5), { key: '__other', label: 'Other', value: Math.round(rest * 100) / 100 }]; }
      }
      const type = yType(tool, card.bind.y);
      const total = Math.round(points.reduce((s, p) => s + p.value, 0) * 100) / 100;
      return { ...card, data: { points: points.map(p => ({ ...p, display: fmt(p.value, type) })), total, totalDisplay: fmt(total, type), unit: type, period, empty: total === 0 } };
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
const labelForGroup = by => ({ day: 'Day', week: 'Week', month: 'Month', category: 'Category', payee: 'Payee', goal: 'Goal', status: 'Status', weekday: 'Weekday', hour: 'Hour', tag: 'Tag', mood: 'Mood', kind: 'Kind' }[by] || '');

// run(tool, params) → tool result (memoized per request by the caller). Resolution never throws: a card that cannot be
// computed comes back { data: { empty: true } } so one bad card never hides the reply.
export async function resolveCards(cards, run) {
  const memo = new Map();
  const once = (tool, params) => { const k = tool + JSON.stringify(params); if (!memo.has(k)) memo.set(k, run(tool, params).catch(() => ({ error: 'failed' }))); return memo.get(k); };
  const out = [];
  for (const c of cards || []) {
    try { out.push(await resolveOne(c, once)); } catch { out.push({ ...c, data: { empty: true, message: 'Could not read that data.' } }); }
  }
  return out;
}

// Short text the model sees for earlier cards in the conversation (never numbers).
export const describeCard = c => `${c.component}${c.title ? ` "${c.title}"` : ''}${c.query ? ` (${c.query.tool} ${JSON.stringify(c.query.params)})` : ''}`;

// The catalogue the model is taught (kept next to the validator so they cannot drift apart).
export const CARD_GUIDE = `CARDS (optional, at most ${MAX_CARDS}; only when a picture beats a sentence). Each card is JSON:
{"component": one of ${COMPONENTS.join(', ')}, "title": "short title", "query": {"tool": "<a read tool>", "params": {...same params as the tool...}}, "bind": {...}}
Cards never contain numbers: you give the QUERY and the app computes the figures from the user's real data.
- Stat: one figure. bind.value = a numeric field of the tool result (query_money: total|count|avg_per_day; query_tasks: count; query_goals: milestones_done|milestones_total|progress; get_insights_summary: streak_current|streak_longest|done_this_week|rate_last_7|rate_last_30|spent_this_week|spent_month|...). Optional bind.label. Optional "compare": {"params": {...period to compare with...}, "label": "last week"}.
- Line: a trend. query_money/query_tasks/query_thoughts with group_by day|week|month; bind.y = sum|count.
- Bar: compare groups. group_by any (money: category|payee|day|week|month; tasks: weekday|hour|goal|status|day). bind.y = sum|count.
- Donut: shares. money group_by category|payee, tasks status|goal, thoughts tag|mood|kind. bind.y = sum|count.
- Heatmap: activity per day. query_tasks {"status":"done"} or query_money or query_thoughts, with a range (default last 90 days).
- ProgressList: goals and milestone progress. query_goals.
- TaskList: a list of tasks. query_tasks with status/range.
- Timeline: things in time order. query_tasks, query_money, query_thoughts or search_thoughts.
- Table: rows. bind.rows = items|groups, bind.columns = up to 4 field names (money items: date, amount, category, payee, note; tasks: title, status, due, time, goal; thoughts: date, text, tags; groups: label, sum, count).
- Note: {"component":"Note","title":"...","text":"..."} plain words, no figures.
- Callout: {"component":"Callout","tone":"info|good|warn","text":"..."} one gentle line, no figures.`;
