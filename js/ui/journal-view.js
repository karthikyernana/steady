// Today as a journal: a composer, today's page (entries + what happened), and views of himself that the AI chooses.
// Every number drawn here comes from js/core/journal.js stats; the model only chooses views and writes the words.
import { all, get } from '../data/store.js';
import { cachedReflection, refreshReflection, tagPending, saveEntry, needsTag } from '../data/journal.js';
import { AREAS, areaLabel, fmtNum } from '../core/journal.js';
import { todayKey, dateKey, fmtTime, fmtDateKey, pad, esc, DAYS_SHORT, fromKey } from '../core/util.js';
import { linkTags } from '../core/text.js';
import { guessTaskArea } from '../core/journal.js';
import { I } from './icons.js';
import { on, toast, requestRender } from './ui.js';

const hm = ts => { const d = new Date(ts); return fmtTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`); };
const chip = a => `<span class="ar-chip ar-${a}">${esc(areaLabel(a))}</span>`;
const unitFor = (u, v) => (!u || /^(times?)$/.test(u) ? '' : v === 1 && /[^s]s$/.test(u) ? u.slice(0, -1) : u);
const factChip = f => `<span class="fact-chip ar-${f.area}">${esc(f.label)}${f.value != null ? ` <b>${esc(fmtNum(f.value))}${unitFor(f.unit, f.value) ? ` ${esc(unitFor(f.unit, f.value))}` : ''}</b>` : ''}</span>`;

export function journalHead() {
  const r = cachedReflection();
  return { headline: r.headline, prompt: r.prompt, r };
}

export function renderJournal(r) {
  const tk = todayKey();
  const entries = all('thoughts').filter(t => t.createdAt && dateKey(new Date(t.createdAt)) === tk);
  const done = all('tasks').filter(t => t.status === 'done' && t.doneAt && dateKey(new Date(t.doneAt)) === tk);
  const spent = all('money').filter(m => m.date === tk);
  const items = [
    ...entries.map(e => ({ at: e.createdAt, html: entryRow(e) })),
    ...done.map(t => ({ at: t.doneAt, html: `<li class="jl-row jl-auto" data-k="jt-${t.id}"><span class="jl-time">${hm(t.doneAt)}</span><div class="jl-body"><p>${I.check}<span>Finished <strong>${esc(t.title)}</strong></span></p><div class="jl-chips">${chip(guessTaskArea(t.title))}</div></div></li>` })),
    ...spent.map(m => ({ at: m.createdAt || 0, html: `<li class="jl-row jl-auto" data-k="jm-${m.id}"><span class="jl-time">${m.createdAt ? hm(m.createdAt) : ''}</span><div class="jl-body"><p><span class="jl-rupee">₹</span><span>${m.kind === 'income' ? 'Got' : 'Spent'} <strong>₹${esc(fmtNum(m.amount))}</strong> on ${esc(m.note || m.category)}${m.payee ? ` · ${esc(m.payee)}` : ''}</span></p><div class="jl-chips">${chip('money')}</div></div></li>` })),
  ].sort((a, b) => a.at - b.at);

  let html = `<form class="card jcomposer" id="jcomp" autocomplete="off" data-testid="journal-composer">
    <textarea id="j-text" data-keep rows="3" maxlength="1500" placeholder="${esc(r.prompt || 'What happened today? What did you learn, build, watch, feel?')}" aria-label="Write in your journal"></textarea>
    <div class="jcomposer-bar"><span class="muted small">${r.prompt ? `${I.spark}<span>A question from your journal</span>` : 'Or hold the mic and just talk.'}</span><button class="btn primary sm" type="submit" data-testid="journal-save">Save</button></div>
  </form>`;

  html += `<section class="list-sec jpage" data-testid="journal-page"><div class="sec-head" data-k="sh-page"><h2>Today’s page</h2><span class="count">${entries.length ? `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}` : ''}</span></div>
    ${items.length ? `<ul class="jl">${items.map(x => x.html).join('')}</ul>` : `<p class="empty-inline">A blank page. Write one line about your day, or talk to the mic.</p>`}</section>`;

  // wide views first-come; half views kept side by side; an unpaired half view spans the row
  const built = r.cards.map(c => ({ c, html: card(c, r) })).filter(x => x.html);
  const halves = built.filter(x => !WIDE.has(x.c.kind));
  if (halves.length % 2) halves[halves.length - 1].html = halves[halves.length - 1].html.replace('class="card jv ', 'class="card jv wide ');
  const cards = [...built.filter(x => WIDE.has(x.c.kind)).slice(0, 1), ...halves, ...built.filter(x => WIDE.has(x.c.kind)).slice(1)].map(x => x.html);
  if (cards.length) {
    html += `<section class="list-sec" data-testid="journal-views"><div class="sec-head" data-k="sh-you"><h2>You, lately</h2><span class="count">${r.by === 'device' ? 'from this device' : 'last 14 days'}</span></div>
      <div class="jviews">${cards.join('')}</div></section>`;
  }
  return html;
}

function entryRow(e) {
  const jx = e.jx; const pending = needsTag(e);
  return `<li class="jl-row" data-k="je-${e.id}" data-id="${e.id}">
    <span class="jl-time">${hm(e.createdAt)}</span>
    <button class="jl-body jl-entry" data-act="th-edit" data-id="${e.id}" title="Edit">
      <p class="jl-text">${linkTags(e.text)}</p>
      <div class="jl-chips">${pending ? '<span class="ar-chip pending" aria-label="Understanding this entry">reading…</span>' : ''}${jx && !pending ? jx.areas.map(chip).join('') + (jx.facts || []).map(factChip).join('') : ''}</div>
    </button></li>`;
}

// ---------------------------------------------------------------- views
const WIDE = new Set(['balance', 'mood']);
const wideW = () => (typeof window !== 'undefined' && window.innerWidth >= 760 ? 640 : 320);
function card(c, r) {
  const s = r.stats;
  const head = `<h3 class="jv-title">${esc(c.title)}</h3><p class="jv-text">${esc(c.text)}</p>`;
  const wrap = (body, cls = '') => `<article class="card jv jv-${c.kind} ${cls}" data-k="jv-${c.kind}-${c.metric || c.area || ''}" data-testid="jv-${c.kind}">${head}${body}</article>`;
  switch (c.kind) {
    case 'balance': {
      const used = AREAS.filter(a => s.areaTotals[a.id]).sort((a, b) => s.areaTotals[b.id] - s.areaTotals[a.id]).slice(0, 5);
      return wrap(`<div class="chart-wrap">${stackBars(s, used.map(a => a.id), wideW())}</div><div class="jv-legend">${used.slice(0, 6).map(a => `<span class="ar-${a.id}"><i></i>${esc(a.label)} <b>${s.areaTotals[a.id]}</b></span>`).join('')}</div>`, 'wide');
    }
    case 'metric': {
      const m = s.metrics.find(x => x.id === c.metric); if (!m) return '';
      const vals = s.keys.map(k => m.perDay[k]);
      return wrap(`<div class="jv-big ar-${m.area}"><span>${esc(fmtNum(m.total))}</span><small>${esc(m.unit || 'times')} · 14 days</small></div><div class="chart-wrap">${miniBars(vals, s.keys, m.area)}</div>`);
    }
    case 'streak': {
      const n = s.streaks[c.area] || 0;
      const on_ = s.keys.map(k => s.byDayArea[k][c.area] > 0);
      return wrap(`<div class="jv-big ar-${c.area}"><span>${n}</span><small>${n === 1 ? 'day' : 'days'} in a row</small></div><div class="jv-dots ar-${c.area}">${on_.map((x, i) => `<i class="${x ? 'on' : ''}" title="${esc(s.keys[i])}"></i>`).join('')}</div>`);
    }
    case 'mood': return wrap(`<div class="chart-wrap">${moodLine(s, wideW())}</div><div class="jv-legend"><span class="ln-mood"><i></i>Mood from entries</span>${s.energy.some(v => v != null) ? '<span class="ln-energy"><i></i>Check-in energy</span>' : ''}</div>`, 'wide');
    case 'theme': return wrap(s.people.length ? `<div class="jl-chips">${s.people.slice(0, 6).map(p => `<span class="ar-chip ar-people">${esc(p.name)} <b>${p.n}</b></span>`).join('')}</div>` : '');
    case 'echo': return r.echo ? wrap(`<blockquote class="jv-quote"><p>${linkTags(r.echo.entry.text)}</p><cite>${esc(fmtDateKey(r.echo.day))}</cite></blockquote>`) : '';
    case 'money': {
      const xs = Object.entries(s.spend).sort((a, b) => b[1] - a[1]).slice(0, 5); const max = Math.max(1, ...xs.map(x => x[1]));
      return wrap(`<ul class="jv-hbars">${xs.map(([k, v]) => `<li><span>${esc(k)}</span><i style="--w:${(v / max * 100).toFixed(1)}%"></i><b>₹${esc(fmtNum(Math.round(v)))}</b></li>`).join('')}</ul>`);
    }
    default: return '';
  }
}

const dayLbl = k => DAYS_SHORT[fromKey(k).getDay()].slice(0, 1);
function stackBars(s, areas, W = 320) {
  const H = 150, padB = 18, padT = 6, n = s.keys.length, gap = 5, bw = (W - gap * (n - 1)) / n;
  const tot = s.keys.map(k => areas.reduce((x, a) => x + s.byDayArea[k][a], 0));
  const max = Math.max(1, ...tot);
  let out = '';
  s.keys.forEach((k, i) => {
    let y = H - padB; const x = i * (bw + gap);
    if (!tot[i]) out += `<rect x="${x.toFixed(1)}" y="${H - padB - 2}" width="${bw.toFixed(1)}" height="2" rx="1" class="sb-empty"/>`;
    for (const a of areas) {
      const v = s.byDayArea[k][a]; if (!v) continue;
      const h = (v / max) * (H - padB - padT);
      y -= h;
      out += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1.5, h - 1.5).toFixed(1)}" rx="2.5" class="sb ar-${a}"><title>${esc(k)} · ${esc(areaLabel(a))}: ${v}</title></rect>`;
    }
    out += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle" class="ax${k === s.today ? ' now' : ''}">${dayLbl(k)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="chart jstack" role="img" aria-label="Areas of life per day, last 14 days">${out}</svg>`;
}
function miniBars(vals, keys, area) {
  const W = 320, H = 70, padB = 14, n = vals.length, gap = 4, bw = (W - gap * (n - 1)) / n, max = Math.max(1, ...vals);
  return `<svg viewBox="0 0 ${W} ${H}" class="chart jmini" role="img" aria-label="Per day, last 14 days">${vals.map((v, i) => {
    const h = v ? Math.max(3, (v / max) * (H - padB - 4)) : 2, x = i * (bw + gap);
    return `<rect x="${x.toFixed(1)}" y="${(H - padB - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2.5" class="sb ar-${area}${v ? '' : ' zero'}"><title>${esc(keys[i])}: ${fmtNum(v)}</title></rect><text x="${(x + bw / 2).toFixed(1)}" y="${H - 2}" text-anchor="middle" class="ax">${dayLbl(keys[i])}</text>`;
  }).join('')}</svg>`;
}
function moodLine(s, W = 320) {
  const H = 140, l = 18, r = 6, t = 8, b = 18, n = s.keys.length;
  const X = i => l + (i / (n - 1)) * (W - l - r), Y = v => H - b - ((v - 1) / 4) * (H - b - t);
  const path = vals => { let d = '', pen = false; vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)} `; pen = true; }); return d; };
  let out = [1, 3, 5].map(v => `<line x1="${l}" x2="${W - r}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${l - 6}" y="${Y(v) + 3}" text-anchor="end" class="ax">${v}</text>`).join('');
  out += `<path d="${path(s.energy)}" class="ln energy"/><path d="${path(s.mood)}" class="ln mood"/>`;
  s.mood.forEach((v, i) => { if (v != null) out += `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="3" class="ln-dot"><title>${esc(s.keys[i])}: mood ${v.toFixed(1)}</title></circle>`; });
  s.keys.forEach((k, i) => { if (i % 2 === (n - 1) % 2) out += `<text x="${X(i).toFixed(1)}" y="${H - 4}" text-anchor="middle" class="ax">${dayLbl(k)}</text>`; });
  return `<svg viewBox="0 0 ${W} ${H}" class="chart jmood" role="img" aria-label="Mood over the last 14 days">${out}</svg>`;
}

// ---------------------------------------------------------------- mount: composer + background understanding
let kicked = 0;
export function mountJournal(root) {
  const f = root.querySelector('#jcomp'); if (!f) return;
  const ta = f.querySelector('#j-text');
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) f.requestSubmit(); });
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const v = ta.value.trim(); if (!v) { ta.focus(); return; }
    ta.value = '';
    await saveEntry(v);
    toast('Saved to today’s page.');
    tagPending({ force: true }).then(n => { if (n) { requestRender(); refreshReflection({ force: true }).then(ok => ok && requestRender()); } });
  });
  // once in a while: understand untagged entries, then refresh the reflection (both async; the page re-renders when they land)
  if (Date.now() - kicked > 30_000) {
    kicked = Date.now();
    tagPending().then(n => { if (n) requestRender(); return refreshReflection(); }).then(ok => { if (ok) requestRender(); }).catch(() => {});
  }
}
on('j-refresh', () => refreshReflection({ force: true }).then(ok => { requestRender(); if (!ok) toast('Showing what this device can see.'); }));
