// Chat cards, rendered natively. Input is a RESOLVED card from /api/agent/chat (server/chat-cards.js): the server has
// already run the card's query against the user's own rows, so every figure here came from real data. This module only
// draws: plain HTML/SVG strings, every string escaped, no model-provided markup, code or URLs. Pure (no DOM), unit-tested.
import { esc } from '../core/util.js';
import { fmtINR } from '../core/money.js';
import { bars } from './charts.js';

export const KINDS = ['Stat', 'Line', 'Bar', 'Donut', 'Heatmap', 'ProgressList', 'TaskList', 'Timeline', 'Table', 'Note', 'Callout'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const num = (v, unit) => (unit === 'inr' ? fmtINR(Math.round(v)) : String(Math.round(v * 10) / 10));
const clampFrac = f => Math.max(0, Math.min(1, +f || 0));
const head = c => (c.title || c.data?.period ? `<div class="cc-head">${c.title ? `<h3 class="cc-title">${esc(c.title)}</h3>` : ''}${c.data?.period ? `<span class="cc-period">${esc(c.data.period)}</span>` : ''}</div>` : '');
const empty = (msg = 'Nothing here yet.') => `<p class="cc-empty muted small">${esc(msg)}</p>`;
const wrap = (c, inner, cls = '') => `<section class="card cc cck-${esc(c.component.toLowerCase())} ${cls}" data-testid="card-${esc(c.component.toLowerCase())}" data-k="cc-${esc(c.id || '')}">${head(c)}${inner}</section>`;

// ---------------------------------------------------------------- Stat: a figure with its unit, a delta and a tiny trend
// A count reads as "1 task" / "2 tasks" (never "1 items"): the noun comes from the card's tool, and a label the model or
// server wrote is made to agree with the figure.
const NOUN = { query_tasks: ['task', 'tasks'], query_money: ['entry', 'entries'], query_thoughts: ['thought', 'thoughts'], search_thoughts: ['thought', 'thoughts'], query_goals: ['goal', 'goals'] };
const SING = { tasks: 'task', items: 'item', thoughts: 'thought', goals: 'goal', entries: 'entry', days: 'day', milestones: 'milestone', spends: 'spend', notes: 'note', ideas: 'idea', payments: 'payment', times: 'time' };
const PLUR = Object.fromEntries(Object.entries(SING).map(([p, s]) => [s, p]));
const agree = (text, n) => String(text || '').replace(/^(\S+)/, w => { const lw = w.toLowerCase(); return n === 1 ? (SING[lw] || w) : (n !== 1 && PLUR[lw] ? PLUR[lw] : w); });
export function statParts(c) {
  const d = c.data || {}, v = typeof d.value === 'number' ? d.value : null, bindV = c.bind?.value || '';
  let unit = '', label = d.label || '';
  const noun = bindV === 'count' || (!bindV && /^\d+$/.test(String(d.display || ''))) ? NOUN[c.query?.tool] : null;
  if (noun && v != null && /^[\d,.]+$/.test(String(d.display))) {
    unit = v === 1 ? noun[0] : noun[1];
    if (!label || /^(items?|count|entries|tasks?|thoughts?|goals?)$/i.test(label.trim())) label = '';
  }
  if (v != null) label = agree(label, v);
  if (/\bdays?$/.test(String(d.display || '')) && /^days? /i.test(label)) label = label.replace(/^days? /i, '');   // "5 days" + "day streak" → "streak"
  if (label && label.toLowerCase() === String(c.title || '').toLowerCase()) label = '';
  return { display: d.display ?? '–', unit, label };
}
// "₹200 less than last week" for money (as Insights says it), "+3 vs last week" for counts; an arrow and a calm tone.
function compareLine(d) {
  const x = d.compare; if (!x) return '';
  const inr = String(d.display || '').startsWith('₹');
  const txt = x.delta === 0 ? `same as ${x.label}` : inr ? `${x.deltaDisplay.replace(/^[+−]/, '')} ${x.delta > 0 ? 'more' : 'less'} than ${x.label}` : `${x.deltaDisplay} vs ${x.label}`;
  const dir = x.delta > 0 ? 'up' : x.delta < 0 ? 'down' : 'same';
  const tone = dir === 'same' ? 'same' : (inr ? dir === 'down' : dir === 'up') ? 'good' : 'warn';      // spending less / doing more = good
  const arrow = dir === 'up' ? '↑' : dir === 'down' ? '↓' : '→';
  return `<p class="cc-cmp t-${tone}" data-dir="${dir}"><span class="cc-arrow" aria-hidden="true">${arrow}</span><span>${esc(txt)}</span></p>`;
}
function spark(t) {
  const pts = t?.points || []; if (pts.length < 2) return '';
  const W = 84, H = 34, n = pts.length, gap = 3, bw = (W - gap * (n - 1)) / n, max = Math.max(1e-9, ...pts.map(p => +p.value || 0));
  const rects = pts.map((p, i) => { const v = +p.value || 0, h = v ? Math.max(3, (v / max) * (H - 4)) : 2;
    return `<rect x="${(i * (bw + gap)).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" class="bar${v ? '' : ' zero'}${i === n - 1 ? ' hi' : ''}"><title>${esc(p.label)}: ${esc(p.display)}</title></rect>`; }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart bars cc-spark" role="img" aria-label="Last ${n} days">${rects}</svg>`;
}
function stat(c) {
  const d = c.data || {}, { display, unit, label } = statParts(c);
  const fig = `<p class="cc-big"><span class="cc-num" data-testid="cc-value">${esc(display)}</span>${unit ? `<span class="cc-unit">${esc(unit)}</span>` : ''}</p>`;
  return wrap(c, `<div class="cc-stat-row"><div class="cc-stat-main">${fig}${label ? `<p class="cc-label">${esc(label)}</p>` : ''}${compareLine(d)}</div>${spark(d.trend)}</div>`);
}

// ---------------------------------------------------------------- day series: every day present, short weekday labels
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dkey = ms => new Date(ms).toISOString().slice(0, 10);
const dms = k => Date.parse(`${k}T00:00:00Z`);
const shortOf = k => WD[new Date(dms(k)).getUTCDay()];
const dayLbl = k => `${+k.slice(8)} ${MON[+k.slice(5, 7) - 1]}`;
// "15 Oct – 21 Oct" (the query's own period) → its day keys, the year taken from the data; null when it can't be read
function periodKeys(period, near) {
  const m = String(period || '').match(/^(\d{1,2}) (\w{3})(?: (\d{4}))? – (\d{1,2}) (\w{3})(?: (\d{4}))?$/); if (!m || !near) return null;
  const y = +near.slice(0, 4), mi = x => MON.indexOf(x);
  if (mi(m[2]) < 0 || mi(m[5]) < 0) return null;
  const y2 = +(m[6] || y), y1 = +(m[3] || (mi(m[2]) > mi(m[5]) ? y2 - 1 : y2));
  const k = (yy, mm, dd) => `${yy}-${String(mm + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  return [k(y1, mi(m[2]), +m[1]), k(y2, mi(m[5]), +m[4])];
}
// Older servers sent only the days that had data; zero days in the period are real zeros, so they are filled here.
export function daySeries(d) {
  const pts = (d.points || []).filter(Boolean);
  if (!pts.length || !pts.every(p => ISO.test(p.key || ''))) return null;
  const by = new Map(pts.map(p => [p.key, p]));
  let from = pts[0].key, to = pts.at(-1).key;
  const pk = periodKeys(d.period, to);
  if (pk && pk[0] <= from && pk[1] >= to && (dms(pk[1]) - dms(pk[0])) / 864e5 <= 92) [from, to] = pk;
  if ((dms(to) - dms(from)) / 864e5 > 400) return pts.map(p => ({ ...p, short: p.short || shortOf(p.key) }));
  const zero = d.unit === 'inr' ? fmtINR(0) : '0', out = [];
  for (let t = dms(from); t <= dms(to); t += 864e5) { const k = dkey(t), p = by.get(k); out.push(p ? { ...p, short: p.short || shortOf(k) } : { key: k, label: dayLbl(k), short: shortOf(k), value: 0, display: zero }); }
  return out;
}

function line(c) {
  const d = c.data || {}, pts = daySeries(d) || d.points || [];
  if (d.empty || pts.length < 2) return wrap(c, empty(d.message || 'Not enough data to draw a trend yet.'));
  const W = 320, H = 130, l = 4, r = 4, t = 16, b = 20;
  const max = Math.max(1e-9, ...pts.map(p => p.value));
  const X = i => l + (i / (pts.length - 1)) * (W - l - r), Y = v => H - b - (v / max) * (H - b - t);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.value).toFixed(1)}`).join('');
  const area = `${path}L${X(pts.length - 1).toFixed(1)},${H - b}L${X(0).toFixed(1)},${H - b}Z`;
  const week = pts.length <= 8 && pts.every(p => p.short);
  // a week reads by weekday (every point); longer spans get about five evenly spaced dates, always the first and last
  const n = pts.length - 1, want = week ? n : Math.min(n, 4), tickIdx = new Set([0, n]);
  for (let k = 1; k < want; k++) tickIdx.add(Math.round((k * n) / want));
  const ticks = [...tickIdx].sort((x, y) => x - y).map(i => `<text x="${X(i).toFixed(1)}" y="${H - 5}" text-anchor="${i === 0 ? 'start' : i === n ? 'end' : 'middle'}" class="ax">${esc(week ? pts[i].short : short(pts[i].label))}</text>`).join('');
  const hi = pts.reduce((a, p, i) => (p.value > pts[a].value ? i : a), 0);
  const dots = pts.map((p, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.value).toFixed(1)}" r="${i === hi ? 3.2 : pts.length > 40 ? 0 : 1.8}" class="cc-dot${i === hi ? ' hi' : ''}"><title>${esc(p.label)}: ${esc(p.display)}</title></circle>`).join('');
  const svg = `<svg viewBox="0 0 ${W} ${H}" class="chart cc-line-svg" role="img" aria-label="${esc(c.title || 'Trend')}"><line x1="${l}" x2="${W - r}" y1="${H - b}" y2="${H - b}" class="grid"/>
    <path d="${area}" class="cc-area"/><path d="${path}" class="cc-stroke" pathLength="1"/>${dots}${ticks}
    <text x="${X(hi).toFixed(1)}" y="${(Y(pts[hi].value) - 7).toFixed(1)}" text-anchor="${hi > pts.length * 0.8 ? 'end' : hi < pts.length * 0.2 ? 'start' : 'middle'}" class="val">${esc(pts[hi].display)}</text></svg>`;
  return wrap(c, `<div class="chart-wrap">${svg}</div><p class="cc-foot muted small">Total ${esc(d.totalDisplay || '')}</p>`);
}
const short = label => String(label).replace(/^Week of /, '');

function bar(c) {
  const d = c.data || {}, days = daySeries(d), pts = days || d.points || [];
  if (d.empty || !pts.length) return wrap(c, empty(d.message));
  const hi = pts.reduce((a, p, i) => (p.value > pts[a].value ? i : a), 0);
  if (!days && (pts.length > 8 || pts.some(p => String(p.label).length > 6))) {   // long category labels read better as rows
    const max = Math.max(1e-9, ...pts.map(p => p.value));
    return wrap(c, `<div class="cc-hbars">${pts.slice(0, 12).map((p, i) => `<div class="cc-hbar${i === hi ? ' hi' : ''}"><span class="cc-hl">${esc(p.label)}</span>
      <span class="cc-ht"><i style="--w:${(p.value / max).toFixed(4)}"></i></span><span class="cc-hv">${esc(p.display)}</span></div>`).join('')}</div>`);
  }
  const week = days && pts.length <= 8;
  const labels = pts.map(p => (week ? p.short : days ? String(+p.key.slice(8)) : p.label));
  const svg = bars(pts.map(p => p.value), labels, { highlight: hi, fmt: v => num(v, d.unit), label: c.title || 'Bar chart', maxBar: 34, values: pts.length <= 10, titles: pts.map(p => `${p.label}: ${p.display}`) });
  const foot = days && d.totalDisplay ? `<p class="cc-foot muted small">Total ${esc(d.totalDisplay)}</p>` : '';
  return wrap(c, `<div class="chart-wrap">${svg}</div>${foot}`);
}

const SEG = ['var(--accent)', 'var(--hi)', 'var(--hm2)', 'var(--warn)', 'var(--hm3)', 'var(--line-2)'];
function donut(c) {
  const d = c.data || {}, pts = (d.points || []).filter(p => p.value > 0);
  if (d.empty || !pts.length) return wrap(c, empty(d.message));
  const R = 42, C = 2 * Math.PI * R, total = pts.reduce((s, p) => s + p.value, 0);
  let off = 0;
  const arcs = pts.map((p, i) => { const len = (p.value / total) * C; const a = `<circle cx="60" cy="60" r="${R}" class="cc-seg" stroke="${SEG[i % SEG.length]}" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" data-len="${len.toFixed(2)}" data-off="${off.toFixed(2)}" data-c="${C.toFixed(2)}" transform="rotate(-90 60 60)"><title>${esc(p.label)}: ${esc(p.display)}</title></circle>`; off += len; return a; }).join('');
  const svg = `<svg viewBox="0 0 120 120" class="cc-donut-svg" role="img" aria-label="${esc(c.title || 'Shares')}"><circle cx="60" cy="60" r="${R}" class="cc-ring"/>${arcs}
    <text x="60" y="58" text-anchor="middle" class="cc-dtotal">${esc(d.totalDisplay || '')}</text><text x="60" y="73" text-anchor="middle" class="ax">total</text></svg>`;
  const legend = pts.map((p, i) => `<li><i style="background:${SEG[i % SEG.length]}"></i><span class="cc-ll">${esc(p.label)}</span><span class="cc-lv">${esc(p.display)}</span><span class="cc-lp">${Math.round((p.value / total) * 100)}%</span></li>`).join('');
  return wrap(c, `<div class="cc-donut-body">${svg}<ul class="cc-legend">${legend}</ul></div>`);
}

function heatmap(c) {
  const d = c.data || {}, days = d.days || [];
  if (!days.length) return wrap(c, empty(d.message));
  const wd = k => (new Date(`${k}T12:00:00Z`).getUTCDay() + 6) % 7;
  const lead = wd(days[0].date), cell = 12, gap = 3, top = 14, left = 0;
  const weeks = Math.ceil((lead + days.length) / 7);
  const max = Math.max(1, d.max || 0);
  let rects = '', months = '', lastM = -1;
  days.forEach((x, i) => {
    const p = lead + i, w = Math.floor(p / 7), r = p % 7;
    const lvl = x.value <= 0 ? 0 : Math.min(4, Math.ceil((x.value / max) * 4));
    rects += `<rect x="${left + w * (cell + gap)}" y="${top + r * (cell + gap)}" width="${cell}" height="${cell}" rx="3" class="hm l${lvl}"><title>${esc(x.date)}: ${esc(x.display)}</title></rect>`;
    const m = +x.date.slice(5, 7) - 1;
    if ((r === 0 || i === 0) && m !== lastM) { if (w < weeks - 1 || weeks === 1) months += `<text x="${left + w * (cell + gap)}" y="9" class="ax">${MON[m]}</text>`; lastM = m; }
  });
  const W = left + weeks * (cell + gap), H = top + 7 * (cell + gap);
  return wrap(c, `<div class="chart-wrap"><svg viewBox="0 0 ${W} ${H}" class="chart heatmap cc-heat-svg" role="img" aria-label="${esc(c.title || 'Activity by day')}">${months}${rects}</svg></div>
    <div class="legend"><span>Less</span>${[0, 1, 2, 3, 4].map(l => `<i class="hm l${l}"></i>`).join('')}<span>More</span></div>`);
}

function progressList(c) {
  const items = c.data?.items || [];
  if (!items.length) return wrap(c, empty('No goals yet.'));
  return wrap(c, items.map(g => `<div class="ins-row"><div class="ins-row-top"><span class="ins-name">${esc(g.label)}</span><span class="ins-val">${esc(g.display)}</span></div>
    <div class="progress meter" role="progressbar" aria-label="${esc(g.label)}" aria-valuenow="${Math.round(clampFrac(g.frac) * 100)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${(clampFrac(g.frac) * 100).toFixed(1)}%"></span></div></div>`).join(''));
}

function taskList(c) {
  const d = c.data || {}, items = d.items || [];
  if (!items.length) return wrap(c, empty('No tasks there.'));
  const more = d.count > items.length ? `<p class="cc-foot muted small">and ${d.count - items.length} more</p>` : '';
  return wrap(c, `<ul class="cc-tasks">${items.map(t => `<li class="${t.status === 'done' ? 'done' : ''}"><span class="cc-tick" aria-hidden="true"></span><span class="cc-tt">${esc(t.title)}</span>
    <span class="cc-td">${esc([t.dueDisplay, t.time ? fmtT(t.time) : ''].filter(Boolean).join(' · '))}</span></li>`).join('')}</ul>${more}`);
}
const fmtT = hhmm => { const [h, m] = hhmm.split(':').map(Number); return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h >= 12 ? 'PM' : 'AM'}`; };

function timeline(c) {
  const items = c.data?.items || [];
  if (!items.length) return wrap(c, empty('Nothing found.'));
  return wrap(c, `<ol class="cc-tl">${items.map(x => `<li><span class="cc-tl-when">${esc(x.dateDisplay)}${x.time ? ` · ${esc(fmtT(x.time))}` : ''}</span>
    <span class="cc-tl-what">${esc(x.title)}</span>${x.sub ? `<span class="cc-tl-sub muted small">${esc(x.sub)}</span>` : ''}</li>`).join('')}</ol>`);
}

function table(c) {
  const d = c.data || {}, cols = d.columns || [], rows = d.rows || [];
  if (!rows.length) return wrap(c, empty(d.message));
  const numeric = cols.map((col, i) => rows.every(r => /^[−+\-₹\d.,\s%]+$|^–$/.test(r[i] || '')));
  return wrap(c, `<div class="cc-table-wrap"><table class="cc-table"><thead><tr>${cols.map((col, i) => `<th${numeric[i] ? ' class="n"' : ''}>${esc(col.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map((v, i) => `<td${numeric[i] ? ' class="n"' : ''}>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
}

const note = c => wrap(c, `<p class="cc-text">${esc(c.data?.text ?? c.text ?? '')}</p>`);
const callout = c => `<aside class="cc cc-callout tone-${esc(['info', 'good', 'warn'].includes(c.data?.tone) ? c.data.tone : 'info')}" data-testid="card-callout" data-k="cc-${esc(c.id || '')}">${c.title ? `<strong>${esc(c.title)}</strong> ` : ''}${esc(c.data?.text ?? c.text ?? '')}</aside>`;

const R = { Stat: stat, Line: line, Bar: bar, Donut: donut, Heatmap: heatmap, ProgressList: progressList, TaskList: taskList, Timeline: timeline, Table: table, Note: note, Callout: callout };

// The figure's count-up (js/ui/chat-fx.js) reads its own text back in the same format:
// "₹1,330" / "12" / "40%" / "5 days" → counts up from zero in its own format (Indian grouping when the figure has commas)
export function countParts(s) {
  const m = String(s).match(/^([^\d]*)(\d[\d,]*)(\.\d+)?(.*)$/);
  if (!m) return null;
  const target = +(m[2].replace(/,/g, '') + (m[3] || ''));
  if (!Number.isFinite(target) || target === 0) return null;
  const dec = m[3] ? m[3].length - 1 : 0, comma = m[2].includes(',') || (m[1].includes('₹') && target >= 1000);
  const fmt = v => {
    const fixed = v.toFixed(dec), [int, frac] = fixed.split('.');
    const g = !comma ? int : int.length > 3 ? `${int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${int.slice(-3)}` : int;
    return `${m[1]}${g}${frac ? `.${frac}` : ''}${m[4]}`;
  };
  return { target, fmt };
}

// Unknown components render nothing (the server never sends one; an old client simply skips a new kind).
export function renderCard(c) {
  if (!c || !R[c.component]) return '';
  try { return R[c.component](c); } catch { return ''; }
}
export const renderCards = cards => (cards || []).map(renderCard).join('');
