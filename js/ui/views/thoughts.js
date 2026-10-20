import { all, get, save, remove, uid } from '../../data/store.js';
import { dateKey, fmtDateKey, fmtTime, pad, esc } from '../../core/util.js';
import { tagsIn, linkTags } from '../../core/text.js';
import { fancy, lines, plainBody, KIND } from '../../core/readable.js';
import { I } from '../icons.js';
import { on, openSheet, toast, segmented, bindSeg, segValue, requestRender } from '../ui.js';

const ui = { q: '', tag: null, mood: 3, kind: 'note', open: new Set() };
export const MOODS = ['', 'Low', 'Meh', 'Okay', 'Good', 'Great'];
const KINDS = [['note', 'Note'], ['idea', 'Idea'], ['journal', 'Journal']];
const kindLabel = k => KINDS.find(x => x[0] === k)?.[1] || 'Note';

// ---- readable body: short notes exactly as typed; pasted AI text gets plain math, headings, bullets and table rows.
// Only the rendering changes; the stored text never does. Every piece is escaped once (linkTags) and tags stay highlighted.
function boldHTML(text, spans) {
  let out = '', i = 0;
  for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0])) {
    if (a < i || b > text.length) continue;
    out += linkTags(text.slice(i, a)) + `<strong>${linkTags(text.slice(a, b))}</strong>`; i = b;
  }
  return out + linkTags(text.slice(i));
}
export function readableHTML(text) {
  if (!fancy(text)) return linkTags(text);
  return lines(text).map(l => {
    const inner = boldHTML(l.text, l.bold);
    if (l.kind === KIND.HEADING) return `<span class="rd-h">${inner}</span>`;
    if (l.kind === KIND.BULLET) return `<span class="rd-b">•\u00a0 ${inner}</span>`;
    if (l.kind === KIND.ROW) return `<span class="rd-row">${inner}</span>`;
    return inner;
  }).join('\n');
}
// long = more than ~7 lines on a phone: clamp to 7 with Show more (same rule as Android's ThoughtBody)
const isLong = text => { const b = plainBody(text); return b.length > 380 || (b.match(/\n/g) || []).length > 7; };
const timeOf = t => { const d = new Date(t.createdAt); return fmtTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`); };


export function renderThoughts() {
  const all_ = all('thoughts').sort((a, b) => b.createdAt - a.createdAt);
  const tagCounts = new Map();
  for (const t of all_) for (const g of t.tags || []) tagCounts.set(g, (tagCounts.get(g) || 0) + 1);
  const q = ui.q.trim().toLowerCase();
  const list = all_.filter(t => (!ui.tag || (t.tags || []).includes(ui.tag)) && (!q || t.text.toLowerCase().includes(q) || (t.tags || []).some(g => g.includes(q.replace('#', '')))));

  let html = `<div class="page-head"><div><div class="eyebrow">Thoughts</div><h1 class="display">Catch it <em>before it's gone</em>.</h1></div></div>
  <form class="card capture" id="tf-cap">
    <textarea id="th-text" data-keep rows="3" placeholder="What's on your mind? #idea #startup" aria-label="New thought"></textarea>
    <div class="capture-bar">
      ${segmented('kind', KINDS, ui.kind)}
      <div class="mood-pick" role="radiogroup" aria-label="Mood">${[1, 2, 3, 4, 5].map(m => `<button type="button" class="mood m${m} ${ui.mood === m ? 'on' : ''}" data-mood="${m}" aria-label="Mood ${MOODS[m]}" aria-checked="${ui.mood === m}" role="radio" title="${MOODS[m]}"></button>`).join('')}<span class="mood-label">${MOODS[ui.mood]}</span></div>
      <button class="btn primary sm" type="submit">Save</button>
    </div>
  </form>
  <div class="search-row">
    <label class="search">${I.search}<input id="th-q" data-keep type="search" placeholder="Search thoughts" value="${esc(ui.q)}" aria-label="Search thoughts"></label>
  </div>
  ${tagCounts.size ? `<div class="tag-row">${[...tagCounts].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([t, n]) => `<button class="chip-btn sm ${ui.tag === t ? 'on' : ''}" data-act="th-tag" data-tag="${esc(t)}">#${esc(t)} <small>${n}</small></button>`).join('')}</div>` : ''}`;

  if (!all_.length) {
    html += `<section class="empty"><p class="serif big">Nothing here yet.</p><p class="muted">Drop ideas here. Add #tags to find them later.</p></section>`;
    return html;
  }
  if (!list.length) return html + `<section class="empty small"><p class="muted">No thoughts match${q ? ` “${esc(ui.q)}”` : ''}${ui.tag ? ` in #${esc(ui.tag)}` : ''}.</p></section>`;

  let lastDay = '';
  html += '<div class="thought-list" data-testid="thought-list">';
  for (const t of list) {
    const d = new Date(t.createdAt), k = dateKey(d);
    if (k !== lastDay) { html += `<div class="day-label" data-k="day-${k}">${fmtDateKey(k)}</div>`; lastDay = k; }
    const long = isLong(t.text), open = ui.open.has(t.id);
    html += `<article class="card thought" data-id="${t.id}" data-act="th-open" tabindex="0" aria-label="${esc(kindLabel(t.kind))} from ${timeOf(t)}. Open to read">
      <div class="thought-meta"><span class="mood-dot m${t.mood || 3}" title="${MOODS[t.mood || 3]}"></span><span>${kindLabel(t.kind)}</span><span>${timeOf(t)}</span></div>
      <div class="thought-text${long && !open ? ' clamped' : ''}" id="tt-${t.id}">${readableHTML(t.text)}</div>
      ${long ? `<button class="link th-more" data-act="th-more" aria-expanded="${open}" aria-controls="tt-${t.id}" data-testid="th-more">${open ? 'Show less' : 'Show more'}</button>` : ''}</article>`;
  }
  return html + '</div>';
}

export function mountThoughts(root) {
  const form = root.querySelector('#tf-cap'); if (!form) return;
  bindSeg(root, 'kind', v => { ui.kind = v; });
  root.querySelectorAll('[data-mood]').forEach(b => b.addEventListener('click', () => {
    ui.mood = +b.dataset.mood;
    root.querySelectorAll('[data-mood]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); });
    root.querySelector('.mood-label').textContent = MOODS[ui.mood];
  }));
  const ta = root.querySelector('#th-text');
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) form.requestSubmit(); });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const text = ta.value.trim(); if (!text) { ta.focus(); return; }
    ta.value = '';
    await save('thoughts', { id: uid(), text, tags: tagsIn(text), mood: ui.mood, kind: ui.kind });
    toast('Saved.');
  });
  const q = root.querySelector('#th-q');
  q.addEventListener('input', () => { ui.q = q.value; requestRender(); });
}

on('th-tag', el => { ui.tag = ui.tag === el.dataset.tag ? null : el.dataset.tag; requestRender(); });
on('th-more', el => {
  const card = el.closest('[data-id]'), id = card.dataset.id, body = card.querySelector('.thought-text');
  const open = !ui.open.has(id);
  open ? ui.open.add(id) : ui.open.delete(id);
  body.classList.toggle('clamped', !open);
  el.textContent = open ? 'Show less' : 'Show more'; el.setAttribute('aria-expanded', String(open));
  if (!open && card.getBoundingClientRect().top < 0) card.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
});

// Tap a thought: read it laid out in full (math, headings, rows); Edit switches to the plain-text form.
on('th-open', el => {
  const t = get('thoughts', el.closest('[data-id]').dataset.id); if (!t) return;
  openSheet({
    title: kindLabel(t.kind), cls: 'thought-sheet',
    body: `<div class="th-read" data-testid="th-read">
        <div class="thought-meta"><span class="mood-dot m${t.mood || 3}"></span><span>${MOODS[t.mood || 3]}</span><span>${fmtDateKey(dateKey(new Date(t.createdAt)))} · ${timeOf(t)}</span></div>
        <div class="thought-text reader">${readableHTML(t.text)}</div>
        <div class="th-read-actions"><button type="button" class="btn ghost danger-text" data-del>${I.trash}<span>Delete</span></button><button type="button" class="btn primary" data-edit data-testid="th-edit">Edit</button></div>
      </div>
      <form class="form hidden" id="te"><label class="field"><span>Thought</span><textarea name="text" rows="8">${esc(t.text)}</textarea></label>
      <div class="field"><span>Kind</span>${segmented('kind', KINDS, t.kind || 'note')}</div>
      <div class="field"><span>Mood</span>${segmented('mood', [1, 2, 3, 4, 5].map(m => [m, MOODS[m]]), t.mood || 3)}</div>
      <div class="row between form-actions"><button type="button" class="btn ghost" data-cancel>Cancel</button><button class="btn primary">Save</button></div></form>`,
    onMount: (b, api) => {
      const read = b.querySelector('.th-read'), form = b.querySelector('#te'), title = api.el.querySelector('.sheet-title');
      bindSeg(b, 'kind', () => {}); bindSeg(b, 'mood', () => {});
      b.querySelector('[data-edit]').onclick = () => {
        read.classList.add('hidden'); form.classList.remove('hidden'); title.textContent = 'Edit thought';
        const ta = form.text; ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
      };
      b.querySelector('[data-cancel]').onclick = () => {
        form.text.value = t.text; form.classList.add('hidden'); read.classList.remove('hidden'); title.textContent = kindLabel(t.kind);
        b.querySelector('[data-edit]').focus();
      };
      form.addEventListener('submit', async e => {
        e.preventDefault(); const text = form.text.value.trim(); if (!text) return;
        await save('thoughts', { ...t, text, tags: tagsIn(text), kind: segValue(b, 'kind'), mood: +segValue(b, 'mood') }); api.close();
      });
      b.querySelector('[data-del]').onclick = async () => { const prev = await remove('thoughts', t.id); api.close(); toast('Deleted.', { undo: () => save('thoughts', prev) }); };
      form.text.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) form.requestSubmit(); });
    },
  });
});
