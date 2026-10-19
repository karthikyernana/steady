import { meta, setMeta, save, uid } from '../../data/store.js';
import { esc, todayKey, dateKey, addDays } from '../../core/util.js';
import { I } from '../icons.js';
import { requestPermission, permission } from '../../platform/notify.js';
import { openSignIn } from './settings.js';
import * as motion from '../motion.js';

const st = { step: 0, name: '', goals: ['', '', ''], wake: '07:00', sleep: '23:30' };
const STEPS = 5;

export function renderOnboarding() {
  const dots = `<div class="ob-dots" aria-hidden="true">${[...Array(STEPS)].map((_, i) => `<i class="${i === st.step ? 'on' : i < st.step ? 'past' : ''}"></i>`).join('')}</div>`;
  let body = '';
  if (st.step === 0) body = `
    <div class="ob-mark">${mark()}</div>
    <h1 class="display xl">Steady.</h1>
    <p class="lede">A tracker that learns how you work. Even on the off days.</p>
    <form class="form ob-form" data-ob="name"><label class="field"><span>What should I call you?</span><input name="name" value="${esc(st.name)}" placeholder="Your first name" autocomplete="given-name" required autofocus data-testid="ob-name"></label>
    <button class="btn primary lg" type="submit">Continue ${I.arrow}</button></form>
    <button class="link center-link" data-ob-pair>I already use Steady on another device</button>`;
  else if (st.step === 1) body = `
    <div class="eyebrow">Step 2 of 5</div>
    <h1 class="display">What are you working toward, <em>${esc(st.name)}</em>?</h1>
    <p class="lede">Up to three. I'll break them into weeks.</p>
    <form class="form ob-form" data-ob="goals">${st.goals.map((g, i) => `<label class="field"><span>Goal ${i + 1}${i ? ' (optional)' : ''}</span><input name="g${i}" value="${esc(g)}" placeholder="${['Land my first paying client', 'Ship a product people actually use', 'Read 12 books this year'][i]}" ${i === 0 ? 'autofocus' : ''} data-testid="ob-goal-${i}"></label>`).join('')}
    <div class="row between"><button type="button" class="btn ghost" data-ob-back>Back</button><button class="btn primary lg" type="submit">Continue ${I.arrow}</button></div></form>`;
  else if (st.step === 2) body = `
    <div class="eyebrow">Step 3 of 5</div>
    <h1 class="display">Your <em>rhythm</em>.</h1>
    <p class="lede">Reminders stay inside your waking hours.</p>
    <form class="form ob-form" data-ob="rhythm"><div class="grid2">
      <label class="field"><span>Usually up by</span><input type="time" name="wake" value="${st.wake}" data-testid="ob-wake" autofocus></label>
      <label class="field"><span>Usually asleep by</span><input type="time" name="sleep" value="${st.sleep}" data-testid="ob-sleep"></label></div>
    <div class="row between"><button type="button" class="btn ghost" data-ob-back>Back</button><button class="btn primary lg" type="submit">Continue ${I.arrow}</button></div></form>`;
  else if (st.step === 3) body = `
    <div class="eyebrow">Step 4 of 5</div>
    <div class="ob-bell">${I.bell}</div>
    <h1 class="display">A nudge at <em>the right moment</em>.</h1>
    <p class="lede">Timed tasks can nudge you. Never while you sleep.</p>
    <div class="ob-preview card"><div class="np-app">${mark(18)} Steady · now</div><strong>LinkedIn post</strong><span class="muted">20 min · due 6 PM</span></div>
    <div class="ob-form"><button class="btn primary lg" data-ob-notif data-testid="ob-notif">${permission() === 'granted' ? 'Reminders are on' : 'Turn on reminders'}</button>
    <button class="btn ghost" data-ob-skip>Not now</button></div>`;
  else body = `
    <div class="ob-mark">${mark()}</div>
    <h1 class="display">You're set, <em>${esc(st.name)}</em>.</h1>
    <p class="lede">Small days count. I'll learn when you work best and shrink the list when life gets loud. Start with one thing.</p>
    <div class="ob-form"><button class="btn primary lg" data-ob-finish data-testid="ob-finish">Open today ${I.arrow}</button></div>`;
  return `<main class="onboarding" data-step="${st.step}"><div class="ob-inner">${dots}${body}</div></main>`;
}

export function mountOnboarding(root, finish) {
  const from = st.step;
  const rerender = () => {
    const dir = Math.sign(st.step - from);
    root.innerHTML = renderOnboarding(); mountOnboarding(root, finish); root.querySelector('[autofocus]')?.focus({ preventScroll: true });
    const inner = root.querySelector('.ob-inner');
    motion.stagger([...inner.children].slice(1), dir, { step: 48 });
    motion.anim(inner.querySelector('.ob-dots i.on'), [{ width: '22px' }, { width: '36px' }], 'bouncy');
  };
  const f = root.querySelector('form[data-ob]');
  f?.addEventListener('submit', e => {
    e.preventDefault();
    const kind = f.dataset.ob;
    if (kind === 'name') st.name = f.name.value.trim();
    if (kind === 'goals') st.goals = [0, 1, 2].map(i => f[`g${i}`].value.trim());
    if (kind === 'rhythm') { st.wake = f.wake.value || '07:00'; st.sleep = f.sleep.value || '23:30'; }
    st.step++; rerender();
  });
  root.querySelector('[data-ob-back]')?.addEventListener('click', () => { st.step--; rerender(); });
  root.querySelector('[data-ob-skip]')?.addEventListener('click', () => { st.step++; rerender(); });
  root.querySelector('[data-ob-notif]')?.addEventListener('click', async () => { await requestPermission(); st.step++; rerender(); });
  root.querySelector('[data-ob-pair]')?.addEventListener('click', () => openSignIn(async () => {
    if (!meta('profile').onboarded) await setMeta('profile', { onboarded: true, name: meta('profile').name || 'there' });
    finish();
  }));
  root.querySelector('[data-ob-finish]')?.addEventListener('click', async () => {
    await setMeta('profile', { name: st.name, wake: st.wake, sleep: st.sleep, onboarded: true, onboardedAt: Date.now() });
    let i = 0;
    for (const g of st.goals.filter(Boolean)) {
      await save('goals', { id: uid(), title: g, why: '', target: dateKey(addDays(new Date(), 84)), milestones: [], actions: [], order: i++ });
    }
    finish();
  });
}

export function mark(size = 56) {
  return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true" class="mark"><rect width="64" height="64" rx="18" class="mark-bg"/><path d="M16 40c6-9 11-9 16 0s10 9 16 0" class="mark-wave"/><circle cx="32" cy="22" r="4.5" class="mark-dot"/></svg>`;
}
