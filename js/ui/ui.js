import { I } from './icons.js';
import { esc } from '../core/util.js';
import * as motion from './motion.js';

let rerender = () => {};
export const setRerender = fn => { rerender = fn; };
export const requestRender = () => rerender();

export const actions = {};
export const on = (name, fn) => { actions[name] = fn; };

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- toast ----------
let toastTimer;
export function toast(msg, { undo, ms } = {}) {
  ms = ms ?? (undo ? 5000 : 2400);
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); document.body.appendChild(el); }
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button class="toast-undo">Undo</button>' : ''}`;
  el.classList.add('show');
  el.onclick = e => { if (!e.target.closest('.toast-undo')) el.classList.remove('show'); };
  clearTimeout(toastTimer);
  if (undo) $('.toast-undo', el).onclick = () => { el.classList.remove('show'); undo(); };
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ---------- sheet (bottom sheet on mobile, dialog on desktop) ----------
const stack = [];
export function openSheet({ title = '', body = '', onMount, cls = '' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = `sheet-wrap ${cls}`;
  wrap.innerHTML = `<div class="backdrop"></div>
    <section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-head"><h2 class="sheet-title">${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">${I.close}</button></div>
      <div class="sheet-body">${body}</div>
    </section>`;
  document.body.appendChild(wrap);
  const prevFocus = document.activeElement;
  const close = () => {
    if (!wrap.isConnected) return;
    wrap.classList.remove('open');
    stack.splice(stack.indexOf(api), 1);
    let gone = false; motion.sheetOut(wrap, () => { if (!gone) { gone = true; wrap.remove(); } });
    prevFocus?.focus?.({ preventScroll: true });
    api.onClose?.();
  };
  const api = { el: wrap, close, onClose: null };
  stack.push(api);
  wrap.querySelector('.backdrop').onclick = close;
  wrap.querySelector('[data-close]').onclick = close;
  wrap.classList.add('open');
  onMount?.(wrap.querySelector('.sheet-body'), api);
  motion.segs(wrap);
  motion.sheetIn(wrap);
  const first = wrap.querySelector('[autofocus]');
  if (first && matchMedia('(pointer:fine)').matches) setTimeout(() => first.focus(), 60);
  return api;
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && stack.length) stack[stack.length - 1].close(); });
export const sheetOpen = () => stack.length > 0;

export function confirmSheet(text, ok = 'Confirm', danger = false) {
  return new Promise(resolve => {
    let done = false;
    const s = openSheet({
      title: 'Are you sure?',
      body: `<p class="muted">${esc(text)}</p><div class="row end gap"><button class="btn ghost" data-no>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(ok)}</button></div>`,
      onMount: (b, api) => {
        b.querySelector('[data-no]').onclick = () => api.close();
        b.querySelector('[data-yes]').onclick = () => { done = true; resolve(true); api.close(); };
      },
    });
    s.onClose = () => { if (!done) resolve(false); };
  });
}

export function segmented(name, options, value) {
  return `<div class="seg" role="radiogroup" data-seg="${name}">${options.map(([v, l]) => `<button type="button" role="radio" aria-checked="${String(v) === String(value)}" data-v="${esc(v)}" class="${String(v) === String(value) ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
}
export function bindSeg(root, name, cb) {
  const g = root.querySelector(`[data-seg="${name}"]`); if (!g) return;
  g.addEventListener('click', e => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    g.querySelectorAll('button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); });
    motion.seg(g, true);
    cb(b.dataset.v);
  });
}
export const segValue = (root, name) => root.querySelector(`[data-seg="${name}"] button.on`)?.dataset.v;

export function toggle(id, checked, label) {
  return `<label class="switch"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}><span class="track"><span class="thumb"></span></span><span class="switch-label">${label}</span></label>`;
}
