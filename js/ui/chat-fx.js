// Chat motion: how a fresh answer arrives. Words fade in quickly (CSS, one opacity animation per word, delays set in the
// markup), then the cards rise in one after another on a spring, and each chart draws itself: bars grow from the
// baseline, a line draws, a donut sweeps, a figure counts up, progress fills. Transform / opacity only (the donut's dash
// and the count-up are tiny), nothing runs when the user prefers reduced motion, and everything is fire-and-forget.
import * as motion from './motion.js';
import { esc } from '../core/util.js';
import { countParts } from './cards.js';

// ---------------------------------------------------------------- words
// Text → paragraphs; with `reveal`, every word is its own span with a delay (fast: the whole reply is in within ~0.7 s).
export function revealHtml(text, reveal) {
  const t = String(text || '');
  if (!reveal || motion.calm()) return { html: plain(t), ms: 0 };
  const words = t.split(/\s+/).filter(Boolean).length || 1;
  const step = Math.max(8, Math.min(28, 700 / words));
  let i = 0;
  const html = t.split(/\n{2,}/).map(p => `<p>${p.split(/(\n)/).map(seg => (seg === '\n' ? '<br>' : seg.split(/(\s+)/).map(w => (!w || /^\s+$/.test(w) ? esc(w) : `<span class="w" style="--d:${Math.round(i++ * step)}ms">${esc(w)}</span>`)).join(''))).join('')}</p>`).join('');
  return { html, ms: Math.round(Math.min(i, words) * step) + 120 };
}
export const plain = t => esc(t).split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');

// ---------------------------------------------------------------- cards
const up = [{ opacity: 0, transform: 'translate3d(0, 14px, 0) scale(.985)' }, { opacity: 1, transform: 'none' }];
/** Animate a freshly arrived answer: cards (and chips) after the words. `after` = ms the words take. */
export function arrive(msgEl, after = 0) {
  if (!msgEl || motion.calm()) return;
  const cards = [...msgEl.querySelectorAll('.cm-cards > .cc')];
  cards.forEach((card, i) => {
    const delay = after + i * 110;
    motion.anim(card, up, 'gentle', { delay });
    drawCard(card, delay + 140);
  });
  msgEl.querySelectorAll('.chat-chips .chip-btn').forEach((b, i) =>
    motion.anim(b, [{ opacity: 0, transform: 'translate3d(0, 6px, 0) scale(.94)' }, { opacity: 1, transform: 'none' }], 'bouncy', { delay: after + cards.length * 110 + 120 + i * 60 }));
}
/** Cards that appear on their own (the empty-state headline). */
export function arriveCards(root) {
  if (!root || motion.calm()) return;
  root.querySelectorAll('.cc').forEach((card, i) => { motion.anim(card, up, 'gentle', { delay: i * 110 }); drawCard(card, i * 110 + 140); });
  root.querySelectorAll('.chip-btn').forEach((b, i) => motion.anim(b, [{ opacity: 0, transform: 'translate3d(0, 6px, 0) scale(.94)' }, { opacity: 1, transform: 'none' }], 'bouncy', { delay: 160 + i * 60 }));
}

function drawCard(card, delay) {
  // bars (Bar card, Stat sparkline): grow from the baseline, left to right
  card.querySelectorAll('svg.bars').forEach(svg => {
    const rs = [...svg.querySelectorAll('rect.bar')], step = Math.min(40, 360 / Math.max(1, rs.length));
    rs.forEach((r, i) => motion.anim(r, [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], 'bouncy', { delay: delay + i * step }));
    svg.querySelectorAll('text.val').forEach((t, i) => motion.anim(t, [{ opacity: 0 }, { opacity: 1 }], 'gentle', { delay: delay + 200 + i * step }));
  });
  // line: the stroke draws, the area and dots follow
  card.querySelectorAll('.cc-stroke').forEach(p => motion.anim(p, [{ strokeDasharray: '1 1', strokeDashoffset: 1 }, { strokeDasharray: '1 1', strokeDashoffset: 0 }], 'soft', { delay, duration: 760, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'backwards' }));
  card.querySelectorAll('.cc-area, .cc-line-svg .val').forEach(a => motion.anim(a, [{ opacity: 0 }, { opacity: 1 }], 'soft', { delay: delay + 420 }));
  card.querySelectorAll('.cc-dot.hi').forEach(d => motion.anim(d, [{ transform: 'scale(0)' }, { transform: 'none' }], 'bouncy', { delay: delay + 640 }));
  // donut: each slice sweeps in after the one before it
  const segs = [...card.querySelectorAll('.cc-seg[data-len]')];
  const C = +(segs[0]?.dataset.c || 0), total = 620;
  segs.forEach(s => {
    const len = +s.dataset.len, at = (+s.dataset.off / C) * total, dur = Math.max(120, (len / C) * total);
    motion.anim(s, [{ strokeDasharray: `0 ${C}` }, { strokeDasharray: `${len} ${C - len}` }], 'soft', { delay: delay + at, duration: dur, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'backwards' });
  });
  card.querySelectorAll('.cc-legend li').forEach((li, i) => motion.anim(li, [{ opacity: 0, transform: 'translate3d(6px, 0, 0)' }, { opacity: 1, transform: 'none' }], 'gentle', { delay: delay + 120 + i * 60 }));
  // horizontal bars and progress meters fill from the left (scaleX, never width)
  card.querySelectorAll('.cc-ht i').forEach((b, i) => motion.anim(b, [{ transform: 'scaleX(0)' }, { transform: `scaleX(${b.style.getPropertyValue('--w') || 1})` }], 'soft', { delay: delay + i * 60 }));
  card.querySelectorAll('.progress span').forEach((b, i) => motion.anim(b, [{ transform: 'scaleX(0)' }, { transform: 'none' }], 'soft', { delay: delay + i * 70 }));
  // heatmap: one composited wipe of the whole grid (dozens of per-cell animations would be a long task on a phone)
  card.querySelectorAll('svg.heatmap').forEach(svg => motion.anim(svg, [{ opacity: 0, clipPath: 'inset(0 100% 0 0)' }, { opacity: 1, clipPath: 'inset(0 0 0 0)' }], 'soft', { delay, duration: 700, easing: 'cubic-bezier(.3,.7,.2,1)' }));
  // lists: rows settle in
  card.querySelectorAll('.cc-tasks li, .cc-tl li, .cc-table tbody tr').forEach((li, i) => i < 10 && motion.anim(li, [{ opacity: 0, transform: 'translate3d(0, 6px, 0)' }, { opacity: 1, transform: 'none' }], 'gentle', { delay: delay + i * 45 }));
  // a figure counts up to its value
  card.querySelectorAll('.cc-num').forEach(n => countUp(n, delay));
}

function countUp(el, delay) {
  const final = el.textContent, p = countParts(final);
  if (!p) return;
  const dur = 650;
  el.textContent = p.fmt(0); el.dataset.counting = '1';
  let t0 = 0;
  const tick = now => {
    if (!el.isConnected || !el.dataset.counting) return;
    if (motion.calm()) { el.textContent = final; delete el.dataset.counting; return; }
    if (!t0) t0 = now;
    const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    el.textContent = k >= 1 ? final : p.fmt(p.target * e);
    if (k < 1) requestAnimationFrame(tick); else delete el.dataset.counting;
  };
  setTimeout(() => requestAnimationFrame(tick), delay);
  setTimeout(() => { if (el.dataset.counting) { el.textContent = final; delete el.dataset.counting; } }, delay + dur + 400);   // a hidden tab gets no frames
}
