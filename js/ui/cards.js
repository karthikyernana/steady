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

// "₹200 less than last week" for money (as Insights says it), "+3 vs last week" for counts.
function compareLine(d) {
  const x = d.compare; if (!x) return '';
  const inr = String(d.display || '').startsWith('₹');
  const txt = x.delta === 0 ? `same as ${x.label}` : inr ? `${x.deltaDisplay.replace(/^[+−]/, '')} ${x.delta > 0 ? 'more' : 'less'} than ${x.label}` : `${x.deltaDisplay} vs ${x.label}`;
  return `<p class="cc-cmp">${esc(txt)}</p>`;
}
function stat(c) {
  const d = c.data || {};
  const label = d.label && d.label.toLowerCase() !== String(c.title || '').toLowerCase() ? `<p class="cc-label">${esc(d.label)}</p>` : '';
  return wrap(c, `<p class="cc-big" data-testid="cc-value">${esc(d.display ?? '–')}</p>${label}${compareLine(d)}`);
}

function line(c) {
  const d = c.data || {}, pts = d.points || [];
  if (d.empty || pts.length < 2) return wrap(c, empty(d.message || 'Not enough data to draw a trend yet.'));
  const W = 320, H = 130, l = 4, r = 4, t = 14, b = 20;
  const max = Math.max(1e-9, ...pts.map(p => p.value));
  const X = i => l + (i / (pts.length - 1)) * (W - l - r), Y = v => H - b - (v / max) * (H - b - t);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.value).toFixed(1)}`).join('');
  const area = `${path}L${X(pts.length - 1).toFixed(1)},${H - b}L${X(0).toFixed(1)},${H - b}Z`;
  // about five evenly spaced labels, always the first and last, never crowding the last one
  const n = pts.length - 1, want = Math.min(n, 4), tickIdx = new Set([0, n]);
  for (let k = 1; k < want; k++) tickIdx.add(Math.round((k * n) / want));
  const ticks = [...tickIdx].sort((x, y) => x - y).map(i => `<text x="${X(i).toFixed(1)}" y="${H - 5}" text-anchor="${i === 0 ? 'start' : i === n ? 'end' : 'middle'}" class="ax">${esc(short(pts[i].label))}</text>`).join('');
  const hi = pts.reduce((a, p, i) => (p.value > pts[a].value ? i : a), 0);
  const dots = pts.map((p, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.value).toFixed(1)}" r="${i === hi ? 3.2 : 1.8}" class="cc-dot${i === hi ? ' hi' : ''}"><title>${esc(p.label)}: ${esc(p.display)}</title></circle>`).join('');
  const svg = `<svg viewBox="0 0 ${W} ${H}" class="chart cc-line-svg" role="img" aria-label="${esc(c.title || 'Trend')}"><line x1="${l}" x2="${W - r}" y1="${H - b}" y2="${H - b}" class="grid"/>
    <path d="${area}" class="cc-area"/><path d="${path}" class="cc-stroke"/>${dots}${ticks}
    <text x="${X(hi).toFixed(1)}" y="${(Y(pts[hi].value) - 6).toFixed(1)}" text-anchor="${hi > pts.length * 0.8 ? 'end' : hi < pts.length * 0.2 ? 'start' : 'middle'}" class="val">${esc(pts[hi].display)}</text></svg>`;
  return wrap(c, `<div class="chart-wrap">${svg}</div><p class="cc-foot muted small">Total ${esc(d.totalDisplay || '')}</p>`);
}
const short = label => String(label).replace(/^Week of /, '');

function bar(c) {
  const d = c.data || {}, pts = d.points || [];
  if (d.empty || !pts.length) return wrap(c, empty(d.message));
  const hi = pts.reduce((a, p, i) => (p.value > pts[a].value ? i : a), 0);
  if (pts.length > 8 || pts.some(p => p.label.length > 6)) {   // long labels read better as rows
    const max = Math.max(1e-9, ...pts.map(p => p.value));
    return wrap(c, `<div class="cc-hbars">${pts.slice(0, 12).map((p, i) => `<div class="cc-hbar${i === hi ? ' hi' : ''}"><span class="cc-hl">${esc(p.label)}</span>
      <span class="cc-ht"><i style="width:${((p.value / max) * 100).toFixed(1)}%"></i></span><span class="cc-hv">${esc(p.display)}</span></div>`).join('')}</div>`);
  }
  return wrap(c, `<div class="chart-wrap">${bars(pts.map(p => p.value), pts.map(p => p.label), { highlight: hi, fmt: v => num(v, d.unit), label: c.title || 'Bar chart' })}</div>`);
}

const SEG = ['var(--accent)', 'var(--hi)', 'var(--hm2)', 'var(--warn)', 'var(--hm3)', 'var(--line-2)'];
function donut(c) {
  const d = c.data || {}, pts = (d.points || []).filter(p => p.value > 0);
  if (d.empty || !pts.length) return wrap(c, empty(d.message));
  const R = 42, C = 2 * Math.PI * R, total = pts.reduce((s, p) => s + p.value, 0);
  let off = 0;
  const arcs = pts.map((p, i) => { const len = (p.value / total) * C; const a = `<circle cx="60" cy="60" r="${R}" class="cc-seg" stroke="${SEG[i % SEG.length]}" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 60 60)"><title>${esc(p.label)}: ${esc(p.display)}</title></circle>`; off += len; return a; }).join('');
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

// Unknown components render nothing (the server never sends one; an old client simply skips a new kind).
export function renderCard(c) {
  if (!c || !R[c.component]) return '';
  try { return R[c.component](c); } catch { return ''; }
}
export const renderCards = cards => (cards || []).map(renderCard).join('');
