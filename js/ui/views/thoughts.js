import { all, get, save, remove, uid } from '../../data/store.js';
import { dateKey, fmtDateKey, fmtTime, pad, esc } from '../../core/util.js';
import { tagsIn, linkTags } from '../../core/text.js';
import { I } from '../icons.js';
import { on, openSheet, toast, segmented, bindSeg, segValue, requestRender } from '../ui.js';

const ui = { q: '', tag: null, mood: 3, kind: 'note' };
export const MOODS = ['', 'Low', 'Meh', 'Okay', 'Good', 'Great'];
const KINDS = [['note', 'Note'], ['idea', 'Idea'], ['journal', 'Journal']];


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
    html += `<article class="card thought" data-id="${t.id}" data-act="th-edit" tabindex="0">
      <div class="thought-meta"><span class="mood-dot m${t.mood || 3}" title="${MOODS[t.mood || 3]}"></span><span>${KINDS.find(x => x[0] === t.kind)?.[1] || 'Note'}</span><span>${fmtTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`)}</span></div>
      <p class="thought-text">${linkTags(t.text)}</p></article>`;
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
on('th-edit', el => {
  const t = get('thoughts', el.closest('[data-id]').dataset.id); if (!t) return;
  openSheet({
    title: 'Thought',
    body: `<form class="form" id="te"><textarea name="text" rows="6" autofocus>${esc(t.text)}</textarea>
      <div class="field"><span>Kind</span>${segmented('kind', KINDS, t.kind || 'note')}</div>
      <div class="field"><span>Mood</span>${segmented('mood', [1, 2, 3, 4, 5].map(m => [m, MOODS[m]]), t.mood || 3)}</div>
      <div class="row between form-actions"><button type="button" class="btn ghost sm danger-text" data-del>${I.trash}<span>Delete</span></button><button class="btn primary">Save</button></div></form>`,
    onMount: (b, api) => {
      bindSeg(b, 'kind', () => {}); bindSeg(b, 'mood', () => {});
      b.querySelector('#te').addEventListener('submit', async e => {
        e.preventDefault(); const text = e.target.text.value.trim(); if (!text) return;
        await save('thoughts', { ...t, text, tags: tagsIn(text), kind: segValue(b, 'kind'), mood: +segValue(b, 'mood') }); api.close();
      });
      b.querySelector('[data-del]').onclick = async () => { const prev = await remove('thoughts', t.id); api.close(); toast('Deleted.', { undo: () => save('thoughts', prev) }); };
    },
  });
});
