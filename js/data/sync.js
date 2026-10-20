// Cross-device sync through Steady's own API (Vercel functions + Neon Postgres).
// Local-first: IndexedDB is always the source of truth on the device. Changes are queued ("dirty"), pushed with
// last-write-wins per record, and remote changes are pulled incrementally by a server cursor.
// The browser never sees database credentials; it holds only an httpOnly session cookie.
import { S, SYNCED, local, setLocal, putRaw, emitExternal, wipeAll } from './store.js';
import { pick } from '../core/merge.js';
import { migrateCollections, SCHEMA_VERSION } from '../core/schema.js';

const API = '/api/';
const status = { state: 'off', error: null, lastSyncedAt: null };
const subs = new Set();
export function onStatus(fn) { subs.add(fn); fn(status); return () => subs.delete(fn); }
function setStatus(p) { Object.assign(status, p); for (const fn of subs) fn(status); }
export const getStatus = () => status;

export class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

export async function api(method, path, body) {
  let res;
  try {
    res = await fetch(API + path, {
      method, credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Steady': '1' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch { throw new ApiError(0, navigator.onLine ? "Couldn't reach Steady's server." : 'Offline.'); }
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON (e.g. static host without API) */ }
  if (!res.ok || !data) { const e = new ApiError(res.status, data?.error || (res.status === 404 ? 'Cloud sync is not available on this host.' : `Server error ${res.status}`)); e.revoked = !!data?.revoked; throw e; }
  return data;
}

// ---- server capabilities (cached for offline starts) ----
export async function serverConfig(refresh = false) {
  const cached = local('serverConfig');
  if (cached && !refresh) { if (navigator.onLine) serverConfig(true).catch(() => {}); return cached; }
  try { const c = await api('GET', 'config'); await setLocal('serverConfig', c); return c; }
  catch (e) { if (e.status === 404) await setLocal('serverConfig', { db: false }); return cached || { db: false }; }
}

export const account = () => local('account');           // { email } when signed in on this device
export const cloudReady = () => !!account();

// ---- dirty queue ----
const key = (c, id) => `${c}\u0001${id}`;
let dirty = null;
const loadDirty = () => (dirty ??= { ...local('dirty', {}) });
const saveDirty = () => setLocal('dirty', dirty);
export function markDirty(coll, rec) {
  if (!rec || !SYNCED.includes(coll)) return;
  loadDirty()[key(coll, rec.id)] = rec.updatedAt;
  saveDirty();
}
export function markAllDirty() {
  loadDirty();
  for (const c of SYNCED) for (const r of S[c].values()) dirty[key(c, r.id)] = r.updatedAt;
  return saveDirty();
}
export const pendingCount = () => Object.keys(loadDirty()).length;

// ---- auth ----
export async function signInWithGoogle(credential) {
  const r = await api('POST', 'auth/google', { credential, device: deviceName() });
  await afterSignIn(r.email); return r;
}
export const checkEmail = email => api('POST', 'auth/check', { email });
export async function signUp(email, password, name) {
  const r = await api('POST', 'auth/signup', { email, password, name, device: deviceName() });
  await afterSignIn(r.email); return r;
}
export async function logIn(email, password) {
  const r = await api('POST', 'auth/login', { email, password, device: deviceName() });
  await afterSignIn(r.email); return r;
}
export const changePassword = (current, password) => api('POST', 'auth/password', { current, password });
export async function deleteAccount(password) {
  await api('POST', 'auth/delete', { password });
  stopLive(); await setLocal('account', null); await setLocal('syncCursor', 0);
  setStatus({ state: 'off', error: null });
}
async function afterSignIn(email) {
  await setLocal('account', { email });
  await markAllDirty();           // anything created before signing in joins the account
  await setLocal('syncCursor', 0);
  await syncNow('sign-in');
  startLive();
}
export async function signOut() {
  stopLive();
  try { await api('POST', 'auth/logout'); } catch { /* offline: still forget locally */ }
  await setLocal('account', null);
  setStatus({ state: 'off', error: null });
}
export async function checkSession() {
  if (!account() || !navigator.onLine) return;
  try { const r = await api('GET', 'auth/me'); if (!r.signedIn) await expired(!!r.revoked); } catch { /* keep state; retry later */ }
}
// revoked = this device was removed from another device (You > Devices, or a password change): its local copy goes too,
// so a removed phone or a shared computer stops showing the account. A plain expiry keeps local data (it may hold unsynced work).
async function expired(revoked = false) {
  stopLive();
  if (revoked) {
    await wipeAll(); try { localStorage.clear(); sessionStorage.setItem('steady.revoked', '1'); } catch { /* ignore */ }
    location.hash = '#/'; location.reload(); return;
  }
  await setLocal('account', null);
  setStatus({ state: 'signedout', error: 'Your session ended. Sign in again to keep syncing.' });
}

// ---- sync ----
let running = null, again = false;
export function syncNow(reason = 'manual') {
  if (!cloudReady()) { setStatus({ state: 'off' }); return Promise.resolve(false); }
  if (running) { again = true; return running; }
  running = doSync(reason).finally(() => { running = null; if (again) { again = false; setTimeout(() => syncNow('queued'), 150); } });
  return running;
}

async function doSync() {
  if (!navigator.onLine) { setStatus({ state: 'offline', error: null }); return false; }
  setStatus({ state: 'syncing', error: null });
  try {
    // 1. push local changes
    loadDirty();
    const entries = Object.entries(dirty);
    for (let i = 0; i < entries.length; i += 500) {
      const batch = entries.slice(i, i + 500).map(([k]) => {
        const [coll, id] = k.split('\u0001'); const r = S[coll]?.get(id);
        return r ? { coll, id, updatedAt: r.updatedAt, deleted: !!r.deleted, data: r, schemaVersion: SCHEMA_VERSION } : null;
      }).filter(Boolean);
      if (batch.length) await api('POST', 'sync/push', { records: batch });
      for (const [k, at] of entries.slice(i, i + 500)) if (dirty[k] === at) delete dirty[k];
      await saveDirty();
    }
    // 2. pull remote changes
    let cursor = local('syncCursor', 0), pulled = 0, more = true;
    while (more) {
      const r = await api('GET', `sync/pull?since=${cursor}&limit=1000`);
      pulled += await applyRemote(r.records);
      cursor = r.cursor; more = r.more;
      await setLocal('syncCursor', cursor);
    }
    if (pulled) emitExternal();
    const t = Date.now();
    await setLocal('lastSyncedAt', t);
    setStatus({ state: live.on ? 'live' : 'ok', lastSyncedAt: t, error: null, pulled });
    return true;
  } catch (e) {
    if (e.status === 401) { await expired(!!e.revoked); return false; }
    setStatus({ state: navigator.onLine ? 'error' : 'offline', error: e.message });
    return false;
  }
}

async function applyRemote(rows) {
  const byColl = {};
  for (const row of rows) {
    if (row.schemaVersion > SCHEMA_VERSION) throw new ApiError(409, 'Your data was saved by a newer Steady. Reload to update this device.');
    const rec = row.deleted ? { id: row.id, deleted: true, updatedAt: row.updatedAt } : row.data;
    const migrated = migrateCollections({ [row.coll]: { [row.id]: rec } }, row.schemaVersion || 1)[row.coll][row.id];
    if (!migrated) continue;
    const mine = S[row.coll]?.get(row.id);
    if (mine && mine.updatedAt > migrated.updatedAt) { markDirty(row.coll, mine); continue; }      // ours is newer: keep and re-push
    if (mine && mine.updatedAt === migrated.updatedAt && pick(mine, migrated) === mine && JSON.stringify(mine) === JSON.stringify(migrated)) continue;
    (byColl[row.coll] ||= []).push(migrated);                                                    // server copy wins (newer or tie)
  }
  let n = 0;
  for (const [c, recs] of Object.entries(byColl)) { n += recs.length; await putRaw(c, recs); }
  return n;
}

export function deviceName() {
  return /Android/i.test(navigator.userAgent) ? 'Android' : /iPhone|iPad/i.test(navigator.userAgent) ? 'iPhone' : 'Desktop';
}

export function initStatus() {
  setStatus({ state: cloudReady() ? 'idle' : 'off', lastSyncedAt: local('lastSyncedAt') });
}

// ---- devices: every signed-in session (name, app, place) and remote sign-out ----
export const listSessions = () => api('GET', 'auth/sessions');
export const revokeSession = id => api('POST', 'auth/sessions/revoke', { id });
export const revokeOtherSessions = () => api('POST', 'auth/sessions/revoke-others');

// ---- Hark plugin: read-only tokens ----
export const createReadToken = label => api('POST', 'tokens', { label });
export const listReadTokens = () => api('GET', 'tokens');
export const revokeReadToken = id => api('POST', 'tokens/revoke', { id });

// ---- live sync ----
// A long-poll loop: the server answers as soon as another device writes (or after ~20 s), then we pull.
// Runs only while the app is visible and online, so a closed app costs nothing.
const live = { on: false, ctl: null, backoff: 0, gen: 0 };
export function startLive() {
  if (live.on || !cloudReady() || document.hidden || !navigator.onLine) return;
  live.on = true; live.backoff = 0;
  loop(++live.gen);
}
export function stopLive() { live.on = false; live.ctl?.abort(); live.ctl = null; }
// One loop at a time: a quick hide/show (stopLive then startLive while the old loop is still awaiting a sync) starts a
// new generation and the old loop exits instead of running a second long-poll next to it.
const current = gen => live.on && live.gen === gen && cloudReady();
async function backoff(gen) {
  live.backoff = Math.min(30_000, (live.backoff || 2000) * 2);
  await new Promise(r => setTimeout(r, live.backoff));
  return current(gen);
}
async function loop(gen) {
  while (current(gen)) {
    const ctl = live.ctl = new AbortController();
    try {
      const res = await fetch(`${API}sync/wait?since=${local('syncCursor', 0)}`, { credentials: 'same-origin', cache: 'no-store', headers: { 'X-Steady': '1' }, signal: ctl.signal });
      if (res.status === 401) { const j = await res.json().catch(() => null); if (current(gen)) await expired(!!j?.revoked); return; }
      if (!res.ok) throw new Error(res.status);
      const r = await res.json();
      if (!current(gen)) return;
      if (status.state !== 'syncing' && status.state !== 'live') setStatus({ state: 'live', error: null });
      // a pull that fails leaves the cursor behind, so the next wait answers "changed" at once: back off instead of
      // hammering the server (e.g. data from a newer schema, or the database down)
      if (r.changed && !(await syncNow('live'))) { if (!(await backoff(gen))) return; continue; }
      live.backoff = 0;
    } catch (e) {
      if (!current(gen)) return;
      if (!(await backoff(gen))) return;
    }
  }
}
document.addEventListener('visibilitychange', () => { if (document.hidden) stopLive(); else if (cloudReady()) { syncNow('focus'); startLive(); } });
addEventListener('online', () => { if (cloudReady()) { syncNow('online'); startLive(); } });
addEventListener('offline', () => { stopLive(); setStatus({ state: 'offline' }); });
