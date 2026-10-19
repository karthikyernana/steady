// Steady service worker: offline app shell (stale-while-revalidate) + notification clicks.
const VERSION = 'steady-v1.0.0';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/core/engine.js',
  './js/core/merge.js',
  './js/core/parse.js',
  './js/core/schema.js',
  './js/core/util.js',
  './js/core/voice.js',
  './js/data/backup.js',
  './js/data/insights.js',
  './js/data/store.js',
  './js/data/sync.js',
  './js/platform/notify.js',
  './js/ui/charts.js',
  './js/ui/icons.js',
  './js/ui/motion.js',
  './js/ui/ui.js',
  './js/ui/views/goals.js',
  './js/ui/views/insights.js',
  './js/ui/views/onboarding.js',
  './js/ui/views/settings.js',
  './js/ui/views/thoughts.js',
  './js/ui/views/today.js',
  './fonts/inter-latin-wght-normal.woff2',
  './fonts/instrument-serif-latin-400-normal.woff2',
  './fonts/instrument-serif-latin-400-italic.woff2',
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

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // GitHub API, ntfy: always network
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('./index.html').then(cached => {
      const net = fetch(req).then(r => { if (r.ok) caches.open(VERSION).then(c => c.put('./index.html', r.clone())); return r; }).catch(() => cached);
      return cached || net;
    }));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(cached => {
    const net = fetch(req).then(r => { if (r.ok && r.type === 'basic') caches.open(VERSION).then(c => c.put(req, r.clone())); return r; }).catch(() => cached);
    return cached || net;
  }));
});

// Web Push from Steady's server (see server/push.js)
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Steady', body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Steady', {
    body: d.body || '', tag: d.tag || 'steady', renotify: true, icon: './icons/icon-192.png', badge: './icons/badge-96.png',
    data: { url: d.url || './#/today' },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.startsWith(self.registration.scope)) { c.focus(); if (e.notification.tag === 'checkin') c.postMessage({ type: 'open-checkin' }); return; }
    return self.clients.openWindow(e.notification.tag === 'checkin' ? './?checkin=1' : target);
  }));
});
