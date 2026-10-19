import { load, onChange, meta, local, setLocal, all } from './data/store.js';
import { I } from './ui/icons.js';
import { esc, debounce, ago } from './core/util.js';
import { actions, setRerender, requestRender, toast, sheetOpen } from './ui/ui.js';
import { renderToday, mountToday, openCheckin } from './ui/views/today.js';
import { renderGoals } from './ui/views/goals.js';
import { renderThoughts, mountThoughts } from './ui/views/thoughts.js';
import { renderInsights, insightsForExport } from './ui/views/insights.js';
import { renderSettings, mountSettings, openSignIn } from './ui/views/settings.js';
import { renderOnboarding, mountOnboarding, mark } from './ui/views/onboarding.js';
import { syncNow, onStatus, initStatus, cloudReady, getStatus, markDirty, checkSession, startLive } from './data/sync.js';
import * as motion from './ui/motion.js';
import { startLocalScheduler, reconcileNtfy, reconcileRemote, enablePush, requestPermission, permission } from './platform/notify.js';

const ROUTES = {
  today: { label: 'Today', icon: I.today, render: renderToday, mount: mountToday },
  goals: { label: 'Goals', icon: I.goals, render: renderGoals },
  thoughts: { label: 'Thoughts', icon: I.thoughts, render: renderThoughts, mount: mountThoughts },
  insights: { label: 'Insights', icon: I.insights, render: renderInsights },
  you: { label: 'You', icon: I.you, render: renderSettings, mount: mountSettings },
};
const route = () => { const r = (location.hash.match(/^#\/(\w+)/) || [])[1]; return ROUTES[r] ? r : 'today'; };

const app = document.getElementById('app');
window.__steadyInsights = insightsForExport;

// ---------- theme ----------
const mq = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const t = local('theme', 'system');
  const dark = t === 'dark' || (t === 'system' && mq.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  try { localStorage.setItem('steady-theme', t); } catch { /* private mode */ }
  document.querySelector('meta[name=theme-color]').setAttribute('content', dark ? '#16150f' : '#FBF8F1');
}
let lastPointer = null;
addEventListener('pointerdown', e => { lastPointer = [e.clientX, e.clientY]; }, { capture: true, passive: true });
window.__applyTheme = () => { const p = lastPointer || []; motion.themeSwap(applyTheme, p[0], p[1]); };
motion.installCssSprings();
window.__applyStyle = v => { const p = lastPointer || []; motion.themeSwap(() => { document.documentElement.dataset.style = v; }, p[0], p[1]); };
mq.addEventListener?.('change', applyTheme);

// ---------- shell ----------
function shell() {
  app.innerHTML = `
  <div class="shell">
    <nav class="side" aria-label="Main">
      <a class="brand" href="#/today">${mark(30)}<span>Steady</span></a>
      <div class="nav-items"><span class="liquid-ind" aria-hidden="true"><i></i></span>${Object.entries(ROUTES).map(([k, r]) => `<a href="#/${k}" data-route="${k}" class="nav-item">${r.icon}<span>${r.label}</span></a>`).join('')}</div>
      <div class="side-foot" id="side-sync"></div>
    </nav>
    <header class="topbar"><a class="brand" href="#/today">${mark(26)}<span>Steady</span></a><div id="top-sync"></div></header>
    <main id="view" class="view" tabindex="-1"></main>
    <nav class="tabbar" aria-label="Main"><span class="liquid-ind" aria-hidden="true"><i></i></span>${Object.entries(ROUTES).map(([k, r]) => `<a href="#/${k}" data-route="${k}" class="tab">${r.icon}<span>${r.label}</span></a>`).join('')}</nav>
  </div>`;
}

function syncChip(st, long) {
  if (!cloudReady()) return long ? `<a class="sync-chip off" href="#/you" data-testid="sync-chip">${I.sync}<span>Sync is off</span></a>` : '';
  const label = st.state === 'live' ? 'Live' : st.state === 'syncing' ? 'Syncing…' : st.state === 'error' ? 'Sync issue' : st.state === 'offline' ? 'Offline' : `Synced ${ago(st.lastSyncedAt || local('lastSyncedAt'))}`;
  return `<button class="sync-chip ${st.state}" data-act="sync-chip" data-testid="sync-chip" title="${esc(st.error || 'Sync now')}" aria-label="${esc(label)}. Sync now">${I.sync}<span>${esc(label)}</span></button>`;
}
function paintSync() {
  const st = getStatus();
  const a = document.getElementById('top-sync'), b = document.getElementById('side-sync');
  if (a) a.innerHTML = syncChip(st, false);
  if (b) b.innerHTML = syncChip(st, true);
}
actions['sync-chip'] = async () => {
  const ok = await syncNow('manual');
  if (!ok && getStatus().error) toast(getStatus().error);
};

// ---------- render ----------
let rendering = false;
function render() {
  if (!meta('profile').onboarded) {
    if (!app.querySelector('.onboarding') || rendering === 'force') {
      const boot = app.querySelector('.boot'), br = boot?.getBoundingClientRect();
      app.innerHTML = renderOnboarding();
      if (boot) motion.shellIn(boot, br);
      motion.stagger(app.querySelector('.ob-inner')?.children || [], 0, { base: 120, step: 70 });
      mountOnboarding(app, () => { shell(); render(); motion.shellIn(); toast(`Welcome, ${meta('profile').name || 'friend'}.`); setTimeout(() => document.getElementById('qa')?.focus(), 200); });
    }
    return;
  }
  let fresh = false;
  if (!document.getElementById('view')) { const boot = app.querySelector('.boot'), br = boot?.getBoundingClientRect(); shell(); fresh = true; motion.shellIn(boot, br); }
  const r = route();
  const view = document.getElementById('view');
  const order = Object.keys(ROUTES);
  const dir = view.dataset.route ? Math.sign(order.indexOf(r) - order.indexOf(view.dataset.route)) : 0;
  const changed = view.dataset.route !== r;
  const before = changed ? null : motion.snapshot(view);
  const scroll = window.scrollY;
  const swap = () => {
    // keep in-progress typing and focus across re-renders (read at swap time: a view transition runs this a frame later)
    const kept = {};
    view.querySelectorAll('[data-keep]').forEach(el => { kept[el.id] = { v: el.value, focus: document.activeElement === el, s: el.selectionStart, e: el.selectionEnd }; });
    view.dataset.route = r;
    view.innerHTML = `<div class="view-inner v-${r}">${ROUTES[r].render()}</div>`;
    for (const [id, k] of Object.entries(kept)) {
      const el = document.getElementById(id); if (!el) continue;
      el.value = k.v;
      if (k.focus) { el.focus({ preventScroll: true }); try { el.setSelectionRange(k.s, k.e); } catch { /* type=search */ } }
    }
    ROUTES[r].mount?.(view);
    document.querySelectorAll('[data-route]').forEach(a => { const on = a.dataset.route === r; a.classList.toggle('on', on); on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'); });
    document.title = r === 'today' ? 'Steady' : `${ROUTES[r].label} · Steady`;
    window.scrollTo(0, changed ? 0 : scroll);
    motion.segs(view);
  };
  if (changed && !fresh) {
    // route change: one composited cross-slide of the page (View Transitions) — no per-element work, no flash
    motion.routeSwap(swap, dir, () => { motion.indicators(true); motion.rings(view, true); motion.bars(view, true); motion.charts(view); });
  } else {
    swap();
    if (fresh) { motion.rings(view, true); requestAnimationFrame(() => motion.indicators(false)); }
    else { if (before) motion.flip(before, view); motion.rings(view, false); motion.bars(view, false); motion.indicators(false); }
  }
  paintSync();
}
const scheduleRender = (() => { let q = false; const run = () => {
  const wait = motion.heldFor();
  if (wait > 0) { setTimeout(run, wait); return; }
  q = false; render(); };
  return () => { if (q) return; q = true; requestAnimationFrame(run); }; })();
setRerender(scheduleRender);

// ---------- delegated actions ----------
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || !actions[el.dataset.act]) return;
  if (el.tagName === 'A') e.preventDefault();
  actions[el.dataset.act](el, e);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches?.('article[data-act]')) actions[e.target.dataset.act]?.(e.target, e);
  if (e.key === 'n' && !e.metaKey && !e.ctrlKey && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) && !sheetOpen()) {
    e.preventDefault(); if (route() !== 'today') location.hash = '#/today'; setTimeout(() => document.getElementById('qa')?.focus(), 50);
  }
});
window.addEventListener('hashchange', () => render());

// ---------- install prompt ----------
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); window.__installPrompt = e; scheduleRender(); });
window.addEventListener('appinstalled', () => { window.__installPrompt = null; toast('Installed. Find Steady on your home screen.'); scheduleRender(); });
actions.install = async () => {
  const p = window.__installPrompt; if (!p) return;
  p.prompt(); const { outcome } = await p.userChoice; window.__installPrompt = null;
  if (outcome === 'accepted') await setLocal('installDismissed', true);
  scheduleRender();
};

// ---------- notifications ask (gentle, once) ----------
window.__askNotifications = async () => {
  if (permission() !== 'default') return;
  const { openSheet } = await import('./ui/ui.js');
  openSheet({
    title: 'Want a nudge at that time?',
    body: `<p class="muted">Steady will remind you when a task with a time comes up. You can change this anytime in Settings.</p>
      <div class="row end gap"><button class="btn ghost" data-no>Not now</button><button class="btn primary" data-yes>Turn on reminders</button></div>`,
    onMount: (b, api) => {
      b.querySelector('[data-no]').onclick = async () => { await setLocal('notifAsked', true); api.close(); };
      b.querySelector('[data-yes]').onclick = async () => { await requestPermission(); api.close(); scheduleRender(); };
    },
  });
};

// ---------- sync triggers ----------
const syncSoon = debounce(() => { if (cloudReady()) syncNow('change'); }, 600);
window.__markDirty = syncSoon;
const reconcileSoon = debounce(() => reconcileNtfy(), 1500);
onChange(d => {
  scheduleRender();
  if (d.rec && d.coll && !d.external) markDirty(d.coll, d.rec);
  if (!d.silent) syncSoon();
  if (d.external) reconcileSoon();
});
let lastState = null;
onStatus(st => {
  paintSync();
  if ((st.state === 'ok' || st.state === 'live') && st.lastSyncedAt && lastState !== 'ok-' + st.lastSyncedAt) { lastState = 'ok-' + st.lastSyncedAt; reconcileRemote(); }
  if (st.state === 'signedout') scheduleRender();
});
const syncIfStale = (min = 20e3) => { if (cloudReady() && Date.now() - (local('lastSyncedAt') || 0) > min) syncNow('focus'); };
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { syncIfStale(); reconcileNtfy(); scheduleRender(); } });
window.addEventListener('focus', () => syncIfStale());
window.addEventListener('online', () => { if (cloudReady()) syncNow('online'); reconcileNtfy(); });
window.addEventListener('offline', () => paintSync());
// near-realtime: a cheap incremental pull every 30 s while visible
setInterval(() => { if (document.visibilityState === 'visible') syncIfStale(28e3); paintSync(); }, 30e3);

// Day rollover while open
let lastDay = new Date().toDateString();
setInterval(() => { const d = new Date().toDateString(); if (d !== lastDay) { lastDay = d; scheduleRender(); reconcileNtfy(); } }, 60e3);

// ---------- boot ----------
async function boot() {
  if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('./sw.js').then(reg => {
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
    }).catch(e => console.warn('SW', e));
    // a new version took over: reload once so code and cache always match
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
    navigator.serviceWorker.addEventListener('message', e => { if (e.data?.type === 'open-checkin') openCheckin(); });
  }
  await load();
  applyTheme();
  initStatus();
  render();
  if (cloudReady()) { syncNow('open'); checkSession(); if (permission() === 'granted') enablePush().catch(() => {}); }
  reconcileNtfy();
  startLocalScheduler(t => toast(`Now: ${t.title}`, { ms: 8000 }));
  if (location.search.includes('checkin')) openCheckin();
  document.documentElement.classList.add('ready');
}
boot();

// Test/dev hook (no-op for normal use)
window.__steady = { requestRender, syncNow, all, reconcileNtfy, reconcileRemote };
