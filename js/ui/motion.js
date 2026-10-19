// Steady motion: real spring physics, FLIP list choreography, liquid-glass indicators and micro-interactions.
// Everything animates transform / opacity on the compositor; nothing here runs when the user prefers reduced motion.

const reduceMq = matchMedia('(prefers-reduced-motion: reduce)');
export const calm = () => reduceMq.matches || !Element.prototype.animate;
const LINEAR_OK = typeof CSS !== 'undefined' && CSS.supports?.('animation-timing-function', 'linear(0, 1)');

// ---------- springs ----------
// Integrate a damped spring (mass 1) from 0 to 1 and express it as a CSS linear() easing, so the browser
// plays real physics on the compositor with no per-frame JS.
const cache = new Map();
export function spring({ stiffness = 210, damping = 24, velocity = 0 } = {}) {
  const key = `${stiffness}|${damping}|${velocity.toFixed(2)}`;
  if (cache.has(key)) return cache.get(key);
  const dt = 1 / 600; let x = 0, v = velocity, t = 0; const xs = [0];
  const step = 1 / 60; let next = step;
  while (t < 2.4) {
    const a = -stiffness * (x - 1) - damping * v;
    v += a * dt; x += v * dt; t += dt;
    if (t >= next) { xs.push(x); next += step; }
    if (t > 0.08 && Math.abs(1 - x) < 0.0015 && Math.abs(v) < 0.02) break;
  }
  xs.push(1);
  const res = {
    duration: Math.round(t * 1000),
    easing: LINEAR_OK ? `linear(${xs.map(n => +n.toFixed(4)).join(', ')})` : 'cubic-bezier(.2,.85,.25,1.08)',
  };
  cache.set(key, res);
  return res;
}
export const SPRINGS = {
  snappy: { stiffness: 420, damping: 34 },   // FLIP moves, indicators
  bouncy: { stiffness: 340, damping: 19 },   // pops, check, chips
  gentle: { stiffness: 190, damping: 24 },   // route + list entrances
  soft: { stiffness: 120, damping: 20 },     // big, slow surfaces
  sheet: { stiffness: 300, damping: 30 },    // bottom sheets
};
const sp = p => (typeof p === 'string' ? spring(SPRINGS[p]) : spring(p));

export function anim(el, frames, preset = 'gentle', opts = {}) {
  if (!el || calm()) return null;
  const s = sp(preset);
  return el.animate(frames, { duration: s.duration, easing: s.easing, fill: 'backwards', ...opts });
}

// expose the springs to CSS transitions (press states, toast, switches)
export function installCssSprings() {
  const root = document.documentElement.style;
  for (const [k, cfg] of Object.entries(SPRINGS)) {
    const s = spring(cfg);
    root.setProperty(`--ease-${k}`, s.easing);
    root.setProperty(`--dur-${k}`, `${s.duration}ms`);
  }
}

// ---------- fx layer (ghosts, particles) ----------
let layer;
function fx() {
  if (layer?.isConnected) return layer;
  layer = document.createElement('div');
  layer.className = 'fx-layer'; layer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layer);
  return layer;
}
const onScreen = r => r.bottom > -40 && r.top < innerHeight + 40 && r.width > 0;

// ---------- FLIP across full re-renders ----------
const TRACK = '[data-id], [data-k], .view-inner > *';
function keyOf(el, seen) {
  if (el.dataset.id) return `id:${el.dataset.id}`;
  if (el.dataset.k) return `k:${el.dataset.k}`;
  const sig = `${el.tagName}.${el.classList[0] || ''}.${el.dataset.testid || ''}`;
  const n = (seen.get(sig) || 0) + 1; seen.set(sig, n);
  return `${sig}#${n}`;
}
function collect(root) {
  const m = new Map(); if (!root) return m;
  const seen = new Map();
  for (const el of root.querySelectorAll(TRACK)) {
    if (el.closest('.fx-layer')) continue;
    const k = keyOf(el, seen);
    if (!m.has(k)) m.set(k, { el, r: el.getBoundingClientRect(), k });
  }
  const byEl = new Map([...m.values()].map(o => [o.el, o.k]));
  for (const o of m.values()) {
    let p = o.el.parentElement; o.parent = null;
    while (p && p !== root) { if (byEl.has(p)) { o.parent = byEl.get(p); break; } p = p.parentElement; }
  }
  return m;
}
export const snapshot = root => (calm() ? new Map() : collect(root));

export function flip(prev, root) {
  if (calm() || !prev.size) return;
  const now = collect(root);
  // exits: ghost the outermost removed element at its old spot
  for (const [k, o] of prev) {
    if (now.has(k)) continue;
    if (o.parent && !now.has(o.parent)) continue;
    if (onScreen(o.r)) ghost(o);
  }
  // moves (relative to the nearest tracked ancestor, so nested lists don't double-move)
  const delta = new Map();
  for (const [k, n] of now) {
    const o = prev.get(k); if (!o) continue;
    delta.set(k, [o.r.left - n.r.left, o.r.top - n.r.top]);
  }
  let entered = 0;
  for (const [k, n] of now) {
    const d = delta.get(k);
    if (!d) {
      if (n.parent && !prev.has(n.parent)) continue; // parent's entrance covers it
      if (!onScreen(n.r)) continue;
      anim(n.el, [{ opacity: 0, transform: 'translateY(12px) scale(.965)' }, { opacity: 1, transform: 'none' }], 'gentle', { delay: Math.min(entered++, 6) * 34 });
      continue;
    }
    let [dx, dy] = d;
    const pd = n.parent && delta.get(n.parent);
    if (pd) { dx -= pd[0]; dy -= pd[1]; }
    if (Math.abs(dx) + Math.abs(dy) < 0.75 || (!onScreen(n.r) && !onScreen(prev.get(k).r))) continue;
    anim(n.el, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], 'snappy');
  }
}

function ghost(o) {
  const g = o.el;
  g.querySelectorAll('[id],[data-testid],[data-act],[data-id]').forEach(x => { x.removeAttribute('id'); x.removeAttribute('data-testid'); x.removeAttribute('data-act'); x.removeAttribute('data-id'); });
  ['id', 'data-testid', 'data-act', 'data-id'].forEach(a => g.removeAttribute(a));
  g.setAttribute('inert', '');
  Object.assign(g.style, { position: 'fixed', left: `${o.r.left}px`, top: `${o.r.top}px`, width: `${o.r.width}px`, height: `${o.r.height}px`, margin: '0', pointerEvents: 'none', listStyle: 'none' });
  fx().appendChild(g);
  const right = g.dataset.exit === 'right';
  const done = g.classList.contains('completing');
  const to = right ? 'translateX(46%) scale(.98)' : done ? 'translateY(-10px) scale(.94)' : 'scale(.95)';
  const a = g.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: to }],
    { duration: right ? 340 : 300, easing: 'cubic-bezier(.32,0,.18,1)', fill: 'forwards' });
  a.onfinish = () => g.remove();
  setTimeout(() => g.remove(), 800);
}

// ---------- route & step entrances ----------
export function stagger(els, dir = 0, { base = 0, step = 42, max = 9 } = {}) {
  if (calm()) return;
  [...els].slice(0, max).forEach((el, i) => {
    const r = el.getBoundingClientRect();
    if (r.top > innerHeight + 40) return;
    anim(el, [{ opacity: 0, transform: `translate(${dir * 30}px, ${dir ? 6 : 18}px) scale(.985)` }, { opacity: 1, transform: 'none' }], 'gentle', { delay: base + i * step });
  });
}
// Route change: a single composited cross-slide of the page via the View Transitions API (snapshots, GPU only).
// Top bar, tab bar and sidebar are captured separately so they stay perfectly still.
export function routeSwap(swap, dir, after) {
  // Route change: swap instantly, then one composited slide of the page content (transform + opacity, never from 0).
  // Fixed bars (top bar, tab bar) are never snapshotted or moved, so they stay rock-still on every device.
  swap(); after?.();
  const inner = document.querySelector('.view-inner');
  if (calm() || !inner) return;
  inner.animate([{ transform: `translate3d(${dir * 18}px, 0, 0)`, opacity: 0.5 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
}
// ---------- shell intro ----------
export function shellIn(bootEl, r) {
  if (calm()) return;
  if (bootEl && r) {
    ghostSimple(bootEl, r, [{ opacity: 1, transform: 'none', filter: 'blur(0)' }, { opacity: 0, transform: 'scale(1.08)', filter: 'blur(12px)' }], 420);
  }
  anim(document.querySelector('.tabbar'), [{ transform: 'translateY(140%)', opacity: 0 }, { transform: 'none', opacity: 1 }], 'gentle', { delay: 120 });
  anim(document.querySelector('.topbar'), [{ opacity: 0 }, { opacity: 1 }], 'soft');
  anim(document.querySelector('.side'), [{ opacity: 0, transform: 'translateX(-24px)' }, { opacity: 1, transform: 'none' }], 'gentle');
}
function ghostSimple(el, r, frames, ms) {
  Object.assign(el.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, margin: '0' });
  fx().appendChild(el);
  const a = el.animate(frames, { duration: ms, easing: 'cubic-bezier(.32,0,.18,1)', fill: 'forwards' });
  a.onfinish = () => el.remove();
}

// ---------- rings, bars, charts ----------
const mem = new Map();
export function rings(root, fresh) {
  root.querySelectorAll('.ring-fg[data-frac]').forEach((c, i) => {
    const key = c.closest('[data-ring]')?.dataset.ring || `ring${i}`;
    const f = +c.dataset.frac, C = +c.dataset.c;
    const from = fresh ? 0 : (mem.has(key) ? mem.get(key) : f);
    mem.set(key, f);
    if (Math.abs(from - f) < 0.001) return;
    anim(c, [{ strokeDasharray: `${(C * from).toFixed(2)} ${C}` }, { strokeDasharray: `${(C * f).toFixed(2)} ${C}` }], 'soft', { delay: fresh ? 180 : 0 });
    const wrap = c.closest('.head-ring');
    if (!fresh && f > from) anim(wrap?.querySelector('span'), [{ transform: 'scale(1.35)' }, { transform: 'none' }], 'bouncy');
    if (f >= 0.999 && from < 0.999) anim(wrap, [{ transform: 'scale(1)', filter: 'drop-shadow(0 0 0 transparent)' }, { transform: 'scale(1.12)', filter: 'drop-shadow(0 0 14px var(--accent))', offset: 0.35 }, { transform: 'none', filter: 'drop-shadow(0 0 0 transparent)' }], 'soft', { duration: 900, easing: 'ease-out' });
  });
}
export function bars(root, fresh) {
  root.querySelectorAll('.progress span[data-p]').forEach((s, i) => {
    const key = s.closest('[data-id]')?.dataset.id || s.closest('[data-k]')?.dataset.k || `p${i}`;
    const p = +s.dataset.p;
    const from = fresh ? 0 : (mem.has('bar' + key) ? mem.get('bar' + key) : p);
    mem.set('bar' + key, p);
    if (Math.abs(from - p) < 0.05) return;
    const run = () => anim(s, [{ width: `${from}%` }, { width: `${p}%` }], 'soft', { delay: fresh ? 160 + i * 70 : 0 });
    fresh ? whenVisible(s, run) : run();
  });
}
export function charts(root) {
  root.querySelectorAll('svg.bars').forEach(svg => whenVisible(svg, () =>
    svg.querySelectorAll('rect.bar').forEach((r, i) => anim(r, [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], 'bouncy', { delay: 60 + i * 26 }))));
  root.querySelectorAll('svg.heatmap').forEach(svg => whenVisible(svg, () =>
    svg.querySelectorAll('rect.hm').forEach(r => { const col = Math.round(+r.getAttribute('x') / 14), row = Math.round(+r.getAttribute('y') / 14);
      anim(r, [{ opacity: 0, transform: 'scale(.2)' }, { opacity: 1, transform: 'none' }], 'bouncy', { delay: (col + row) * 18 }); })));
  root.querySelectorAll('svg.scatter').forEach(svg => whenVisible(svg, () => {
    svg.querySelectorAll('circle.dot').forEach((c, i) => anim(c, [{ transform: 'scale(0)' }, { transform: 'none' }], 'bouncy', { delay: 80 + i * 16 }));
    const t = svg.querySelector('.trend');
    if (t?.getTotalLength) { const L = t.getTotalLength(); anim(t, [{ strokeDasharray: `${L}`, strokeDashoffset: L }, { strokeDasharray: `${L}`, strokeDashoffset: 0 }], 'soft', { delay: 300, duration: 900, easing: 'cubic-bezier(.3,.7,.2,1)' }); }
  }));
}
function whenVisible(el, fn) {
  if (calm()) return;
  if (!('IntersectionObserver' in window)) return fn();
  const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); fn(); } }, { threshold: 0.25 });
  io.observe(el);
}

// ---------- liquid indicators (tab bar, sidebar, segmented controls) ----------
const lastPos = new WeakMap();
function slide(ind, x, y, w, h, animate) {
  const prev = lastPos.get(ind);
  ind.style.width = `${w}px`; ind.style.height = `${h}px`;
  ind.style.transform = `translate(${x}px, ${y}px)`;
  ind.style.opacity = '1';
  lastPos.set(ind, { x, y });
  if (!animate || !prev || calm() || (prev.x === x && prev.y === y)) return;
  anim(ind, [{ transform: `translate(${prev.x}px, ${prev.y}px)` }, { transform: `translate(${x}px, ${y}px)` }], 'snappy');
  const goo = ind.firstElementChild;
  const horiz = Math.abs(prev.x - x) > Math.abs(prev.y - y);
  if (goo) goo.animate(horiz
    ? [{ transform: 'scale(1)' }, { transform: 'scaleX(1.12)', offset: 0.35 }, { transform: 'scale(1)' }]
    : [{ transform: 'scale(1)' }, { transform: 'scale(.94, 1.18)', offset: 0.3 }, { transform: 'scale(1)' }], { duration: 460, easing: 'cubic-bezier(.3,.6,.3,1)' });
}
export function indicators(animate) {
  for (const bar of document.querySelectorAll('.tabbar, .nav-items')) {
    const ind = bar.querySelector('.liquid-ind'); const on = bar.querySelector('.on');
    if (!ind) continue;
    if (!on || !on.offsetWidth) { ind.style.opacity = '0'; lastPos.delete(ind); continue; } // e.g. You, opened from the header
    slide(ind, on.offsetLeft, on.offsetTop, on.offsetWidth, on.offsetHeight, animate);
  }
}
export function seg(g, animate = true) {
  if (!g) return;
  let ind = g.querySelector('.seg-ind');
  if (!ind) { ind = document.createElement('i'); ind.className = 'seg-ind'; ind.setAttribute('aria-hidden', 'true'); g.appendChild(ind); }
  const on = g.querySelector('button.on');
  if (!on || !on.offsetWidth) { ind.style.opacity = '0'; return; }
  slide(ind, on.offsetLeft, on.offsetTop, on.offsetWidth, on.offsetHeight, animate);
}
export const segs = root => root?.querySelectorAll('.seg').forEach(g => seg(g, false));
addEventListener('resize', () => { indicators(false); document.querySelectorAll('.seg').forEach(g => seg(g, false)); });

// ---------- task completion ----------
export function complete(li) {
  if (!li) return;
  navigator.vibrate?.(8);
  li.classList.add('done', 'completing');
  if (calm()) return;
  const btn = li.querySelector('.check');
  anim(li, [{ transform: 'scale(1)' }, { transform: 'scale(.985)', offset: 0.25 }, { transform: 'scale(1)' }], 'bouncy', { duration: 420, easing: 'ease-out' });
  anim(btn.querySelector('svg'), [{ transform: 'scale(.2) rotate(-25deg)' }, { transform: 'scale(1)' }], 'bouncy');
  burst(btn);
}
export function burst(el) {
  if (calm() || !el) return;
  const r = el.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const L = fx();
  const ring = document.createElement('i'); ring.className = 'fx-ring';
  Object.assign(ring.style, { left: `${cx}px`, top: `${cy}px` }); L.appendChild(ring);
  ring.animate([{ transform: 'translate(-50%,-50%) scale(.5)', opacity: 0.85 }, { transform: 'translate(-50%,-50%) scale(2.1)', opacity: 0 }], { duration: 620, easing: 'cubic-bezier(.2,.7,.2,1)' }).onfinish = () => ring.remove();
  for (let i = 0; i < 9; i++) {
    const p = document.createElement('i'); p.className = `fx-dot ${i % 3 === 0 ? 'warm' : ''}`;
    Object.assign(p.style, { left: `${cx}px`, top: `${cy}px` }); L.appendChild(p);
    const a = (i / 9) * Math.PI * 2 + Math.random() * 0.5, d = 20 + Math.random() * 14;
    p.animate([{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px)) scale(0)`, opacity: 0.2 }],
      { duration: 520 + Math.random() * 180, easing: 'cubic-bezier(.15,.8,.3,1)' }).onfinish = () => p.remove();
  }
}

// keyed pop for chips that just appeared
export function popNew(container, prevTexts) {
  if (calm()) return;
  let i = 0;
  container.querySelectorAll('.chip').forEach(c => { if (!prevTexts.has(c.textContent)) anim(c, [{ opacity: 0, transform: 'scale(.6) translateY(4px)' }, { opacity: 1, transform: 'none' }], 'bouncy', { delay: i++ * 30 }); });
}

// ---------- sheets ----------
const mobile = () => matchMedia('(max-width: 719px)').matches;
export function sheetIn(wrap) {
  const sheet = wrap.querySelector('.sheet'), bd = wrap.querySelector('.backdrop');
  if (calm()) return;
  bd.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 280, easing: 'ease-out', fill: 'backwards' });
  if (mobile()) anim(sheet, [{ transform: 'translateY(100%)' }, { transform: 'none' }], 'sheet');
  else anim(sheet, [{ opacity: 0, transform: 'translateY(22px) scale(.94)' }, { opacity: 1, transform: 'none' }], { stiffness: 320, damping: 24 });
  if (mobile()) dragToDismiss(wrap);
}
export function sheetOut(wrap, done, { velocity = 0 } = {}) {
  const sheet = wrap.querySelector('.sheet'), bd = wrap.querySelector('.backdrop');
  if (calm()) return done();
  wrap.style.pointerEvents = 'none';
  const cur = getComputedStyle(sheet).transform; const from = cur === 'none' ? 'none' : cur;
  sheet.getAnimations().forEach(a => a.cancel());
  const ms = velocity > 0.5 ? 200 : 240;
  const a = mobile()
    ? sheet.animate([{ transform: from }, { transform: 'translateY(105%)' }], { duration: ms, easing: 'cubic-bezier(.4,0,.9,.6)', fill: 'forwards' })
    : sheet.animate([{ opacity: 1, transform: from }, { opacity: 0, transform: 'translateY(12px) scale(.96)' }], { duration: 200, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
  bd.animate([{ opacity: getComputedStyle(bd).opacity }, { opacity: 0 }], { duration: ms, easing: 'ease-in', fill: 'forwards' });
  a.onfinish = done; setTimeout(done, 450);
}
function dragToDismiss(wrap) {
  const sheet = wrap.querySelector('.sheet'), head = wrap.querySelector('.sheet-head'), bd = wrap.querySelector('.backdrop');
  let y0 = null, dy = 0, last = [], id = null;
  head.style.touchAction = 'none';
  head.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    y0 = e.clientY; dy = 0; last = [[e.timeStamp, 0]]; id = e.pointerId; head.setPointerCapture(id);
    sheet.getAnimations().forEach(a => a.finish());
    sheet.style.transition = 'none';
  });
  head.addEventListener('pointermove', e => {
    if (y0 === null || e.pointerId !== id) return;
    const raw = e.clientY - y0; dy = raw > 0 ? raw : raw * 0.18;
    sheet.style.transform = `translateY(${dy}px)`;
    bd.style.opacity = String(Math.max(0.15, 1 - Math.max(0, dy) / sheet.offsetHeight));
    last.push([e.timeStamp, dy]); if (last.length > 5) last.shift();
  });
  const end = e => {
    if (y0 === null || e.pointerId !== id) return;
    y0 = null;
    const [t0, d0] = last[0], [t1, d1] = last[last.length - 1];
    const v = (d1 - d0) / Math.max(1, t1 - t0); // px per ms
    if (dy > sheet.offsetHeight * 0.28 || v > 0.55) { wrap.querySelector('[data-close]').click(); return; }
    const from = dy; sheet.style.transform = ''; bd.style.opacity = '';
    anim(sheet, [{ transform: `translateY(${from}px)` }, { transform: 'none' }], { ...SPRINGS.sheet, velocity: from ? Math.min(6, (-v * 1000) / Math.abs(from)) : 0 });
  };
  head.addEventListener('pointerup', end); head.addEventListener('pointercancel', end);
}

// ---------- pointer light on glass (desktop only) ----------
if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
  let raf = 0, ev = null;
  addEventListener('pointermove', e => {
    ev = e; if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const c = ev.target.closest?.('.card, .task');
      if (c) { const r = c.getBoundingClientRect(); c.style.setProperty('--mx', `${ev.clientX - r.left}px`); c.style.setProperty('--my', `${ev.clientY - r.top}px`); }
    });
  }, { passive: true });
}

// ---------- theme: circular reveal ----------
export function themeSwap(apply, x = innerWidth / 2, y = 80) {
  if (calm() || !document.startViewTransition) return apply();
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const html = document.documentElement; html.dataset.vt = 'theme';
  const t = document.startViewTransition(apply);
  t.finished.finally(() => { if (html.dataset.vt === 'theme') delete html.dataset.vt; });
  t.ready.then(() => document.documentElement.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
    { duration: 640, easing: 'cubic-bezier(.3,.7,.2,1)', pseudoElement: '::view-transition-new(root)' })).catch(() => {});
}

// let a micro-interaction finish before the list re-renders around it
let holdUntil = 0;
export const hold = ms => { if (!calm()) holdUntil = Math.max(holdUntil, performance.now() + ms); };
export const heldFor = () => Math.max(0, holdUntil - performance.now());
