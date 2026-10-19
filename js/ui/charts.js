// Inline SVG charts. No libraries, works offline, follows the theme through CSS variables.
import { todayKey, keyAdd, fromKey, MONTHS, DAYS_SHORT, esc } from '../core/util.js';

export function heatmap(counts, { weeks = 22 } = {}) {
  const today = todayKey();
  const todayWd = (fromKey(today).getDay() + 6) % 7; // Mon=0
  const start = keyAdd(today, -(weeks - 1) * 7 - todayWd);
  const max = Math.max(1, ...[...counts.values()]);
  const cell = 11, gap = 3, left = 22, top = 16;
  let rects = '', months = '', lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const k = keyAdd(start, w * 7 + d);
      if (k > today) continue;
      const c = counts.get(k) || 0;
      const lvl = c === 0 ? 0 : Math.min(4, Math.ceil((c / max) * 4));
      rects += `<rect x="${left + w * (cell + gap)}" y="${top + d * (cell + gap)}" width="${cell}" height="${cell}" rx="3" class="hm l${lvl}"><title>${esc(k)}: ${c} done</title></rect>`;
    }
    const m = fromKey(keyAdd(start, w * 7)).getMonth();
    if (m !== lastMonth) { if (w < weeks - 2 && (w === 0 ? fromKey(keyAdd(start, 0)).getDate() < 20 : true)) months += `<text x="${left + w * (cell + gap)}" y="10" class="ax">${MONTHS[m].slice(0, 3)}</text>`; lastMonth = m; }
  }
  const labels = ['Mon', '', 'Wed', '', 'Fri', '', ''].map((l, i) => (l ? `<text x="0" y="${top + i * (cell + gap) + 9}" class="ax">${l}</text>` : '')).join('');
  const W = left + weeks * (cell + gap), H = top + 7 * (cell + gap);
  return `<svg viewBox="0 0 ${W} ${H}" class="chart heatmap" role="img" aria-label="Completion heatmap, last ${weeks} weeks">${months}${labels}${rects}</svg>`;
}

export function bars(values, labels, { highlight = -1, fmt = v => v, height = 120, emptyLabel = '', label = 'Bar chart' } = {}) {
  const n = values.length, W = 320, padB = 20, padT = 16, gap = n > 12 ? 2 : 8;
  const bw = (W - gap * (n - 1)) / n;
  const max = Math.max(1e-9, ...values.map(v => v || 0));
  let out = '';
  values.forEach((v, i) => {
    const h = v ? Math.max(3, (v / max) * (height - padB - padT)) : 2;
    const x = i * (bw + gap), y = height - padB - h;
    out += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(4, bw / 3).toFixed(1)}" class="bar${i === highlight ? ' hi' : ''}${v == null ? ' na' : ''}"><title>${esc(labels[i])}: ${v == null ? emptyLabel || 'no data' : fmt(v)}</title></rect>`;
    if (labels[i] && (n <= 12 || i % 3 === 0)) out += `<text x="${(i === 0 && n > 12 ? x : x + bw / 2).toFixed(1)}" y="${height - 5}" text-anchor="${i === 0 && n > 12 ? 'start' : 'middle'}" class="ax">${esc(labels[i])}</text>`;
    if (v != null && n <= 8) out += `<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" class="val">${esc(fmt(v))}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${height}" class="chart bars" role="img" aria-label="${esc(label)}">${out}</svg>`;
}

export function scatter(points, byEnergy) {
  const W = 320, H = 150, l = 26, b = 22, t = 12, r = 16;
  const maxY = Math.max(4, ...points.map(p => p.done));
  const X = e => l + ((e - 1) / 4) * (W - l - r);
  const Y = v => H - b - (v / maxY) * (H - b - t);
  let out = '';
  for (let i = 0; i <= maxY; i += Math.ceil(maxY / 4)) out += `<line x1="${l}" x2="${W - r}" y1="${Y(i)}" y2="${Y(i)}" class="grid"/><text x="${l - 6}" y="${Y(i) + 3}" text-anchor="end" class="ax">${i}</text>`;
  for (let e = 1; e <= 5; e++) out += `<text x="${X(e)}" y="${H - 6}" text-anchor="middle" class="ax">${e}</text>`;
  points.forEach((p, i) => {
    const jx = ((i * 37) % 11 - 5) * 1.6, jy = ((i * 53) % 7 - 3) * 0.8;
    out += `<circle cx="${(X(p.energy) + jx).toFixed(1)}" cy="${(Y(p.done) + jy).toFixed(1)}" r="3.4" class="dot"><title>${esc(p.date)}: energy ${p.energy}, ${p.done} done</title></circle>`;
  });
  const line = byEnergy.map((v, i) => (v == null ? null : `${X(i + 1).toFixed(1)},${Y(v).toFixed(1)}`)).filter(Boolean);
  if (line.length >= 2) out += `<polyline points="${line.join(' ')}" class="trend"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="chart scatter" role="img" aria-label="Energy versus tasks done">${out}</svg>`;
}

export function ring(frac, size = 44) {
  const r = size / 2 - 4, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, frac || 0));
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" class="ring" aria-hidden="true"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-bg"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-fg" data-frac="${f.toFixed(4)}" data-c="${c.toFixed(2)}" stroke-dasharray="${(c * f).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>`;
}

export const WEEK_LABELS = [1, 2, 3, 4, 5, 6, 0].map(i => DAYS_SHORT[i].slice(0, 2));
