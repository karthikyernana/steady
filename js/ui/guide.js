// First-run tour: six swipeable pages, one idea each, with a tiny "you type → it becomes" demo.
// Mirrors android ui/Guide.kt (same pages and copy). Swipe (scroll-snap), arrow keys, Enter, Escape all work.
import { I } from './icons.js';
import { esc } from '../core/util.js';
import { local, setLocal } from '../data/store.js';

export const PAGES = [
  { icon: I.mic, title: 'Just say it', line: 'Tap the mic and talk, in English or Telugu. Steady turns it into tasks, goals or money entries for you to accept.', type: '"Remind me to call amma in 10 minutes"', becomes: ['Task', 'Today, in 10 min', 'Reminder on'] },
  { icon: I.today, title: 'Today', line: "Type tasks the way you'd text a friend. Time, length and day are picked up for you.", type: 'gym 7pm 45m', becomes: ['Gym', '7:00 PM', '45 min'] },
  { icon: I.goals, title: 'Goals', line: 'A big goal becomes one small milestone a week, so you always know the next step.', type: 'Crack placements by March', becomes: ['Week 1: resume', 'Week 2: mocks', '…'] },
  { icon: I.money, title: 'Money', line: 'Log spending in a few words. Steady sorts the category and shows where it went.', type: '250 lunch swiggy', becomes: ['₹250', 'Food', 'Swiggy'] },
  { icon: I.thoughts, title: 'Thoughts', line: 'Catch ideas and notes. Add #tags to group them; long notes pasted from AI read cleanly.', type: 'pricing idea for Steady #startup', becomes: ['Idea', '#startup'] },
  { icon: I.insights, title: 'Insights', line: "Your week in one look: tasks done, streak, goal progress, spending and what's on your mind.", type: '', becomes: [] },
];

export const guideSeen = () => !!local('guideSeen');
let open = null;

export function openGuide({ onDone } = {}) {
  if (open) return open;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const prevFocus = document.activeElement;
  const el = document.createElement('div');
  el.className = 'guide';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'How Steady works');
  el.dataset.testid = 'guide';
  el.innerHTML = `
    <div class="guide-top"><span class="guide-label">How Steady works</span><button class="btn ghost sm guide-skip" data-testid="guide-skip">Skip</button></div>
    <div class="guide-track" tabindex="-1">${PAGES.map((p, i) => `
      <section class="guide-page" aria-roledescription="slide" aria-label="${i + 1} of ${PAGES.length}: ${esc(p.title)}" ${i ? 'aria-hidden="true"' : ''}>
        <div class="guide-inner">
          <div class="guide-icon">${p.icon}</div>
          <h2 class="guide-title">${esc(p.title)}</h2>
          <p class="guide-line">${esc(p.line)}</p>
          ${p.type ? `<div class="card guide-demo"><div class="eyebrow">You type or say</div><p class="guide-said">${esc(p.type)}</p>
            <div class="eyebrow guide-becomes">It becomes</div><div class="guide-pills">${p.becomes.map(b => `<span class="pill ok">${esc(b)}</span>`).join('')}</div></div>` : ''}
        </div></section>`).join('')}</div>
    <div class="guide-foot">
      <div class="guide-dots" aria-hidden="true">${PAGES.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>
      <button class="btn primary lg guide-next" data-testid="guide-next">Next</button>
    </div>`;
  document.body.appendChild(el);
  document.documentElement.classList.add('guide-on');
  const track = el.querySelector('.guide-track'), next = el.querySelector('.guide-next');
  const dots = [...el.querySelectorAll('.guide-dots i')], pages = [...el.querySelectorAll('.guide-page')];
  let idx = 0;
  const paint = i => {
    if (i === idx && next.dataset.i === String(i)) return;
    idx = i; next.dataset.i = String(i);
    dots.forEach((d, j) => d.classList.toggle('on', j === i));
    pages.forEach((p, j) => (j === i ? p.removeAttribute('aria-hidden') : p.setAttribute('aria-hidden', 'true')));
    next.textContent = i === PAGES.length - 1 ? 'Start using Steady' : 'Next';
  };
  paint(0);
  const go = i => { i = Math.max(0, Math.min(PAGES.length - 1, i)); track.scrollTo({ left: i * track.clientWidth, behavior: reduce ? 'auto' : 'smooth' }); paint(i); };
  let raf = 0;
  track.addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => paint(Math.round(track.scrollLeft / Math.max(1, track.clientWidth)))); }, { passive: true });
  const finish = async () => {
    if (!el.isConnected) return;
    open = null;
    removeEventListener('keydown', onKey, true);
    await setLocal('guideSeen', true);
    document.documentElement.classList.remove('guide-on');
    const done = () => { el.remove(); prevFocus?.focus?.({ preventScroll: true }); onDone?.(); };
    if (reduce) done(); else { el.classList.add('out'); setTimeout(done, 220); }
  };
  next.addEventListener('click', () => (idx === PAGES.length - 1 ? finish() : go(idx + 1)));
  el.querySelector('.guide-skip').addEventListener('click', finish);
  const onKey = e => {
    if (!el.isConnected) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(idx + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(idx - 1); }
    else if (e.key === 'Tab') { // keep focus inside the tour
      const f = [el.querySelector('.guide-skip'), next];
      if (!f.includes(document.activeElement)) { e.preventDefault(); next.focus(); }
      else if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); next.focus(); }
      else if (!e.shiftKey && document.activeElement === next) { e.preventDefault(); f[0].focus(); }
    }
    e.stopImmediatePropagation?.();
  };
  addEventListener('keydown', onKey, true);
  addEventListener('resize', () => { if (el.isConnected) track.scrollLeft = idx * track.clientWidth; });
  requestAnimationFrame(() => next.focus({ preventScroll: true }));
  open = { el, close: finish };
  return open;
}
