// Steady inside the Android app (Capacitor shell, android-app/). On the web every export here is a no-op.
// The shell loads the live site in a WebView and injects window.Capacitor; plugins are reached through
// window.Capacitor.Plugins so the web build needs no npm imports and no bundler.
//  - Reminders: Android WebView has no Web Push and no Notification API, so every upcoming reminder is scheduled as a
//    native exact alarm (LocalNotifications). They fire with the app closed and are re-armed after a reboot.
//  - Done / Snooze buttons on a reminder, the hardware back button, status-bar colour, and file export (share sheet).
const cap = () => (typeof window !== 'undefined' ? window.Capacitor : null);
export const isNative = () => !!cap()?.isNativePlatform?.() && cap()?.getPlatform?.() === 'android';
const P = name => cap()?.Plugins?.[name];

const HORIZON = 14 * 864e5;   // schedule two weeks ahead
const MAX_SCHEDULED = 64;     // far below Android's 500-alarm cap
let perm = 'default';
export const nativePermission = () => perm;

// Stable 31-bit id per reminder key, so re-scheduling replaces instead of duplicating.
export function idFor(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 1) || 1;
}

async function refreshPermission() {
  const LN = P('LocalNotifications'); if (!LN) return perm;
  try { const r = await LN.checkPermissions(); perm = r.display === 'granted' ? 'granted' : r.display === 'denied' ? 'denied' : 'default'; } catch { /* keep */ }
  return perm;
}

export async function requestNativePermission() {
  const LN = P('LocalNotifications'); if (!LN) return 'unsupported';
  try { const r = await LN.requestPermissions(); perm = r.display === 'granted' ? 'granted' : r.display === 'denied' ? 'denied' : 'default'; } catch { /* keep */ }
  // Android 12: exact alarms need a user toggle (13+ uses USE_EXACT_ALARM, granted at install)
  try { const ex = await LN.checkExactNotificationSetting?.(); if (ex && ex.exact_alarm && ex.exact_alarm !== 'granted') await LN.changeExactNotificationSetting?.(); } catch { /* optional */ }
  if (perm === 'granted') reconcileNative();
  return perm;
}

// Show something right now (a test, a check-in nudge while open).
export async function showNative(title, body, extra = {}) {
  const LN = P('LocalNotifications'); if (!LN || perm !== 'granted') return false;
  await LN.schedule({ notifications: [{ id: idFor(`now-${Date.now()}-${Math.random()}`), title, body, channelId: 'reminders', smallIcon: 'ic_stat_steady', extra: { ...extra, steady: 1 } }] });
  return true;
}

// Make the device's scheduled alarms equal the wanted reminders (same keys as the server queue: st-<taskId>, st-checkin-<day>).
let wantedFn = null, busy = null, again = false;
export function reconcileNative() {
  if (!isNative() || !wantedFn) return Promise.resolve(0);
  if (busy) { again = true; return busy; }
  busy = (async () => {
    const LN = P('LocalNotifications'); if (!LN) return 0;
    await refreshPermission();
    if (perm !== 'granted') return 0;
    const want = wantedFn(HORIZON);
    const entries = Object.entries(want).sort((a, b) => a[1].at - b[1].at).slice(0, MAX_SCHEDULED);
    const wanted = new Map(entries.map(([key, r]) => [idFor(key), { key, ...r }]));
    const { notifications: pending = [] } = await LN.getPending();
    const have = new Map(pending.filter(n => n.extra?.steady).map(n => [n.id, n]));
    const cancel = [...have.values()].filter(n => { const w = wanted.get(n.id); return !w || n.extra?.at !== w.at || n.title !== w.title || n.body !== w.body; });
    if (cancel.length) await LN.cancel({ notifications: cancel.map(n => ({ id: n.id })) });
    const keep = new Set([...have.keys()].filter(id => !cancel.some(c => c.id === id)));
    const add = [...wanted.entries()].filter(([id]) => !keep.has(id)).map(([id, r]) => ({
      id, title: r.title, body: r.body, channelId: 'reminders', smallIcon: 'ic_stat_steady',
      schedule: { at: new Date(r.at), allowWhileIdle: true },
      actionTypeId: r.key.startsWith('st-checkin') ? undefined : 'task',
      extra: { steady: 1, key: r.key, at: r.at, taskId: r.key.startsWith('st-checkin') ? null : r.key.slice(3), url: r.url },
    }));
    if (add.length) await LN.schedule({ notifications: add });
    return add.length;
  })().catch(e => { console.warn('[native reminders]', e?.message || e); return 0; })
    .finally(() => { busy = null; if (again) { again = false; reconcileNative(); } });
  return busy;
}

// Theme → status/navigation bar icons (dark icons on the light ground, light icons in dark mode).
function syncBars() {
  const SB = P('SystemBars'); if (!SB) return;
  const dark = document.documentElement.dataset.theme === 'dark';
  SB.setStyle?.({ style: dark ? 'DARK' : 'LIGHT' }).catch?.(() => {});
}

// Save a file: WebView ignores <a download>, so write it to the cache and open the share sheet (Drive, Files, WhatsApp…).
export async function shareFile(name, text, mime = 'application/json') {
  const FS = P('Filesystem'), SH = P('Share'); if (!FS || !SH) return false;
  const { uri } = await FS.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' });
  await SH.share({ title: name, files: [uri], dialogTitle: 'Save your Steady backup' });
  return true;
}

// One-time setup. opts: { wanted(horizon) → reminders, onAction(type, taskId), onCheckin(), onBack() → handled? }
export async function initNative({ wanted, onAction, onCheckin, onBack } = {}) {
  if (!isNative()) return false;
  document.documentElement.classList.add('native');
  wantedFn = wanted;
  const LN = P('LocalNotifications'), App = P('App');
  try {
    await LN?.createChannel?.({ id: 'reminders', name: 'Reminders', description: 'Task reminders and the evening check-in', importance: 5, visibility: 1, vibration: true, lights: true });
    await LN?.registerActionTypes?.({ types: [{ id: 'task', actions: [{ id: 'done', title: 'Done' }, { id: 'snooze', title: 'Snooze 10 min' }] }] });
    LN?.addListener?.('localNotificationActionPerformed', ({ actionId, notification }) => {
      const x = notification?.extra || {};
      if (actionId === 'done' && x.taskId) onAction?.('task-done', x.taskId);
      else if (actionId === 'snooze' && x.taskId) onAction?.('task-snooze', x.taskId);
      else if (x.key?.startsWith('st-checkin')) onCheckin?.();
      else if (x.taskId) location.hash = '#/today';
    });
  } catch (e) { console.warn('[native init]', e?.message || e); }
  App?.addListener?.('backButton', () => { if (!onBack?.()) App.minimizeApp?.(); });
  App?.addListener?.('resume', () => reconcileNative());
  new MutationObserver(syncBars).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  syncBars();
  await refreshPermission();
  reconcileNative();
  return true;
}
