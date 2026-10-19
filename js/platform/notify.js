// Reminders, two ways:
//  1. Local notifications through the service worker while the app is open/installed.
//  2. Web Push from Steady's server (cron drains a reminder queue) when signed in; works with the app closed.
//  3. Optional fallback: ntfy.sh scheduled delivery ("At: <unix ts>") so the phone buzzes even when the app is closed. No server of ours.
//     Each reminder uses a stable sequence id (st-<taskId>) so rescheduling replaces it and finishing a task cancels it.
import { all, local, setLocal, meta } from '../data/store.js';
import { todayKey, keyAdd, fromKey, toMin, fmtTime } from '../core/util.js';
import { api, cloudReady, serverConfig, deviceName } from '../data/sync.js';

export const NTFY_DEFAULT = 'https://ntfy.sh';
export const ntfyServer = () => (meta('settings').ntfyServer || NTFY_DEFAULT).replace(/\/+$/, '');
const MAX_AHEAD = 3 * 864e5 - 5 * 60e3; // ntfy.sh limit: 3 days
const MIN_AHEAD = 15e3;                  // ntfy.sh minimum: 10 s

export const permission = () => ('Notification' in window ? Notification.permission : 'unsupported');

export async function requestPermission() {
  if (!('Notification' in window)) return 'unsupported';
  const p = await Notification.requestPermission();
  await setLocal('notifAsked', true);
  return p;
}

export async function showLocal(title, body, tag = 'steady') {
  if (permission() !== 'granted') return false;
  const reg = await navigator.serviceWorker?.getRegistration();
  const opts = { body, tag, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', data: { url: './#/today' } };
  if (reg) { await reg.showNotification(title, opts); return true; }
  new Notification(title, opts); return true;
}

// Reminder fire time for a task (ms) or null.
export function fireAt(t) {
  if (!t.reminder || !t.dueTime || !t.dueDate || t.status !== 'open' || t.deleted) return null;
  const lead = +(meta('settings').reminderLead ?? 0);
  const d = fromKey(t.dueDate);
  return d.getTime() + (toMin(t.dueTime) - lead) * 60e3;
}

// ---------- local scheduler (runs while a page is alive) ----------
let timer = null;
export function startLocalScheduler(onInApp) {
  clearInterval(timer);
  const tick = async () => {
    const now = Date.now();
    const fired = local('firedLocal', {});
    let changed = false;
    for (const t of all('tasks')) {
      const at = fireAt(t);
      if (!at || at > now || at < now - 10 * 60e3) continue;
      const key = `${t.id}@${at}`;
      if (fired[key]) continue;
      fired[key] = now; changed = true;
      const body = t.durationMin ? `${t.durationMin} min · ${fmtTime(t.dueTime)}` : fmtTime(t.dueTime);
      if (document.visibilityState === 'visible') onInApp?.(t);
      else await showLocal(t.title, body, `task-${t.id}`);
    }
    const ci = checkinFireAt(todayKey());
    if (ci && ci <= now && ci > now - 10 * 60e3 && !fired[`checkin@${ci}`] && !all('checkins').some(c => c.date === todayKey())) {
      fired[`checkin@${ci}`] = now; changed = true;
      if (document.visibilityState !== 'visible') await showLocal('Evening check-in', 'Two minutes: energy, one win, and something you did for yourself.', 'checkin');
    }
    if (changed) {
      for (const k of Object.keys(fired)) if (fired[k] < now - 2 * 864e5) delete fired[k];
      await setLocal('firedLocal', fired);
    }
  };
  // Precise while Steady is alive: besides the 20 s sweep, arm a one-shot timer for the very next reminder so it fires
  // on the minute instead of up to 20 s late. Re-armed after every sweep and whenever data changes.
  let next = null;
  const arm = () => {
    clearTimeout(next);
    const now = Date.now();
    const ats = all('tasks').map(fireAt).filter(at => at && at > now);
    const ci = checkinFireAt(todayKey()); if (ci && ci > now) ats.push(ci);
    const at = Math.min(...ats);
    if (Number.isFinite(at) && at - now < 6 * 3600e3) next = setTimeout(() => { tick().then(arm); }, at - now + 50);
  };
  const run = () => tick().then(arm);
  run();
  timer = setInterval(run, 20e3);
  armLocal = arm;
}
let armLocal = () => {};
export const rearmLocal = () => armLocal();

export function checkinFireAt(dayKey) {
  const s = meta('settings');
  if (s.checkinNudge === false) return null;
  const p = meta('profile');
  let sleep = toMin(p.sleep || '23:30');
  if (sleep < 6 * 60) sleep += 1440; // sleeping after midnight
  const m = Math.max(sleep - 90, 19 * 60);
  return fromKey(dayKey).getTime() + m * 60e3;
}

// ---------- ntfy ----------
const asciiSafe = s => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(s)))}?=`);

export function appUrl() { return location.origin + location.pathname.replace(/index\.html$/, ''); }

export async function ntfyPublish(topic, { seq, title, body, at, tags = 'alarm_clock', priority = 4 }) {
  const headers = { Title: asciiSafe(title), Tags: tags, Priority: String(priority), Click: appUrl() + '#/today' };
  if (at) headers.At = String(Math.floor(at / 1000));
  const res = await fetch(`${ntfyServer()}/${encodeURIComponent(topic)}${seq ? '/' + encodeURIComponent(seq) : ''}`, { method: 'POST', headers, body });
  if (res.status === 429) throw new Error('the ntfy server says this network hit its daily message limit; it resets tomorrow, or use another server');
  if (!res.ok) throw new Error(`ntfy replied ${res.status}`);
  return res.json();
}
export async function ntfyCancel(topic, seq) {
  const res = await fetch(`${ntfyServer()}/${encodeURIComponent(topic)}/${encodeURIComponent(seq)}`, { method: 'DELETE' });
  return res.ok || res.status === 404;
}

export function ntfyTopic() { const s = meta('settings'); return s.ntfyEnabled && s.ntfyTopic ? s.ntfyTopic : null; }

// Every reminder Steady wants delivered between now and `horizon` ms ahead, keyed by a stable id.
export function wantedReminders(horizon) {
  const want = {}, now = Date.now();
  for (const t of all('tasks')) {
    const at = fireAt(t);
    if (!at || at < now + MIN_AHEAD || at > now + horizon) continue;
    const body = [t.durationMin ? `${t.durationMin} min` : null, `due ${fmtTime(t.dueTime)}`].filter(Boolean).join(' · ');
    want[`st-${t.id}`] = { at, title: t.title, body, tags: t.priority === 3 ? 'alarm_clock,warning' : 'alarm_clock', tag: `task-${t.id}`, url: '/#/today' };
  }
  for (let i = 0; i <= Math.ceil(horizon / 864e5); i++) {
    const k = keyAdd(todayKey(), i);
    const at = checkinFireAt(k);
    if (at && at > now + MIN_AHEAD && at < now + horizon && !all('checkins').some(c => c.date === k))
      want[`st-checkin-${k.replace(/-/g, '')}`] = { at, title: 'Evening check-in', body: 'Energy, one win, and one thing you did for yourself. Two minutes.', tags: 'crescent_moon', tag: 'checkin', url: '/?checkin=1#/today' };
  }
  return want;
}

// ---------- Web Push (server-sent) ----------
const b64ToBytes = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); const b = atob(s + '='.repeat((4 - s.length % 4) % 4)); return Uint8Array.from(b, c => c.charCodeAt(0)); };
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export async function enablePush() {
  if (!pushSupported() || permission() !== 'granted' || !cloudReady()) return false;
  const cfg = await serverConfig();
  if (!cfg.vapidPublicKey) return false;
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  const key = cfg.vapidPublicKey;
  if (sub && local('pushKey') !== key) { await sub.unsubscribe().catch(() => {}); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
  await api('POST', 'push/subscribe', { subscription: sub.toJSON(), device: deviceName() });
  await setLocal('pushKey', key); await setLocal('pushOn', true);
  return true;
}
export async function disablePush() {
  const reg = await navigator.serviceWorker?.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) { await api('POST', 'push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe().catch(() => {}); }
  await setLocal('pushOn', false);
}

// Mirror wanted reminders into the server queue (only after a successful sync, so this device's view is current).
let remoteBusy = null;
export function reconcileRemote() {
  if (!cloudReady() || !navigator.onLine) return Promise.resolve(-1);
  if (remoteBusy) return remoteBusy;
  remoteBusy = (async () => {
    const want = wantedReminders(14 * 864e5);
    const cache = { ...local('remoteSched', {}) };
    const upsert = [], del = [];
    for (const [k, w] of Object.entries(want)) {
      const sig = `${w.at}|${w.title}|${w.body}`;
      if (cache[k] !== sig) upsert.push({ key: k, fireAt: w.at, title: w.title, body: w.body, url: w.url, tag: w.tag });
    }
    for (const k of Object.keys(cache)) if (!want[k]) del.push(k);
    if (upsert.length || del.length) {
      await api('POST', 'reminders', { upsert, delete: del });
      for (const u of upsert) cache[u.key] = `${u.fireAt}|${u.title}|${u.body}`;
      for (const k of del) delete cache[k];
      await setLocal('remoteSched', cache);
    }
    return upsert.length + del.length;
  })().catch(e => { console.warn('reminders', e.message); return -1; }).finally(() => { remoteBusy = null; });
  return remoteBusy;
}

let reconciling = null;
// Make ntfy's scheduled queue match the current tasks. Safe to call often.
export function reconcileNtfy() {
  if (reconciling) return reconciling;
  reconciling = (async () => {
    const topic = ntfyTopic();
    const sched = { ...local('ntfySched', {}) }; // seq -> {at, topic, sig}
    const want = topic && navigator.onLine ? wantedReminders(MAX_AHEAD) : {};
    try {
      for (const [seq, s] of Object.entries(sched)) {
        if (!want[seq] || s.topic !== topic) {
          if (s.at > Date.now()) await ntfyCancel(s.topic, seq).catch(() => {});
          delete sched[seq];
        }
      }
      for (const [seq, w] of Object.entries(want)) {
        const sig = `${w.at}|${w.title}|${w.body}`;
        if (sched[seq]?.sig === sig && sched[seq]?.topic === topic) continue;
        await ntfyPublish(topic, { seq, title: w.title, body: w.body, at: w.at, tags: w.tags });
        sched[seq] = { at: w.at, topic, sig };
      }
    } finally {
      await setLocal('ntfySched', sched);
      reconciling = null;
    }
    return Object.keys(sched).length;
  })().catch(e => { reconciling = null; console.warn('ntfy', e); return -1; });
  return reconciling;
}
