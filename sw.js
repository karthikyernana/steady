// Steady service worker: offline app shell (network-first, cache fallback) + Web Push + notification clicks.
const VERSION = 'steady-v1.4.2-r1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './css/styles.css',
  './js/app.js',
  './js/core/agent.js',
  './js/core/engine.js',
  './js/core/merge.js',
  './js/core/money.js',
  './js/core/overview.js',
  './js/core/parse.js',
  './js/core/readable.js',
  './js/core/schema.js',
  './js/core/text.js',
  './js/core/util.js',
  './js/core/voice.js',
  './js/data/agent.js',
  './js/data/backup.js',
  './js/data/insights.js',
  './js/data/store.js',
  './js/data/sync.js',
  './js/platform/notify.js',
  './js/ui/charts.js',
  './js/ui/daystrip.js',
  './js/ui/guide.js',
  './js/ui/icons.js',
  './js/ui/motion.js',
  './js/ui/ui.js',
  './js/ui/voice.js',
  './js/ui/views/goals.js',
  './js/ui/views/insights.js',
  './js/ui/views/money.js',
  './js/ui/views/onboarding.js',
  './js/ui/views/settings.js',
  './js/ui/views/thoughts.js',
  './js/ui/views/today.js',
  './fonts/host-grotesk-latin-wght-normal.woff2',
  './fonts/host-grotesk-latin-ext-wght-normal.woff2',
  './fonts/inter-latin-wght-normal.woff2',
  './fonts/instrument-serif-latin-400-normal.woff2',
  './fonts/instrument-serif-latin-400-italic.woff2',
  './fonts/schibsted-grotesk-latin-wght-normal.woff2',
  './fonts/ibm-plex-mono-latin-500-normal.woff2',
  './fonts/young-serif-latin-400-normal.woff2',
  './fonts/figtree-latin-wght-normal.woff2',
  './fonts/newsreader-latin-400-normal.woff2',
  './fonts/newsreader-latin-400-italic.woff2',
  './fonts/hanken-grotesk-latin-wght-normal.woff2',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/badge-96.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Network-first with a short timeout, cache as the offline fallback. Every deploy is picked up on the next open
// (no "old app on new data" window), and the app still opens instantly offline.
const fromNet = (req, key) => fetch(req).then(r => { if (r.ok && r.type === 'basic') { const c = r.clone(); caches.open(VERSION).then(x => x.put(key || req, c)); } return r; });
const timeout = (ms, p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/source/')) return; // API and third parties: always network
  if (url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/icons/')) {
    e.respondWith(caches.match(req).then(c => c || fromNet(req)));   // immutable assets: cache-first
    return;
  }
  const key = req.mode === 'navigate' ? './index.html' : req;
  const net = fromNet(req, key);
  e.respondWith(timeout(2500, net).catch(() => caches.match(key, { ignoreSearch: true }).then(c => c || net)));
});

// Web Push from Steady's server (see server/push.js). Task reminders get Done / Snooze actions.
const isTaskTag = t => /^task-/.test(t || '');
const taskOpts = (d) => isTaskTag(d.tag) ? { actions: [{ action: 'done', title: 'Done' }, { action: 'snooze', title: 'Snooze 10 min' }] } : {};
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Steady', body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Steady', {
    body: d.body || '', tag: d.tag || 'steady', renotify: true, icon: './icons/icon-192.png', badge: './icons/badge-96.png',
    data: { url: d.url || './#/today', key: d.key || null, taskId: isTaskTag(d.tag) ? d.tag.slice(5) : null }, timestamp: d.at || Date.now(),
    vibrate: [180, 80, 180], ...taskOpts(d),
  }));
});

const openApp = (url, msg) => self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
  for (const c of list) if (c.url.startsWith(self.registration.scope)) { c.focus(); if (msg) c.postMessage(msg); return; }
  return self.clients.openWindow(url);
});

self.addEventListener('notificationclick', e => {
  const n = e.notification, data = n.data || {};
  n.close();
  if (e.action === 'snooze') {
    const key = data.key || (data.taskId ? `st-${data.taskId}` : null);
    e.waitUntil(fetch('/api/reminders/snooze', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-Steady': '1' }, body: JSON.stringify({ key, minutes: 10 }) })
      .then(r => { if (!r.ok) throw new Error(r.status); })
      .catch(() => openApp(`./?snooze=${encodeURIComponent(data.taskId || '')}#/today`, { type: 'task-snooze', id: data.taskId })));
    return;
  }
  if (e.action === 'done' && data.taskId) {
    e.waitUntil(openApp(`./?done=${encodeURIComponent(data.taskId)}#/today`, { type: 'task-done', id: data.taskId }));
    return;
  }
  const target = new URL(data.url || './', self.registration.scope).href;
  e.waitUntil(openApp(target, null));
});
