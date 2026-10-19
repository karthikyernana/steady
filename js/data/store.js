// Steady — local-first store. IndexedDB is the source of truth on each device.
// Synced collections hold records shaped {id, updatedAt, deleted?, ...}.
// Deletes become tombstones {id, deleted:true, updatedAt} so they merge across devices.

const DB_NAME = 'steady';
const DB_VERSION = 2; // v2 (Steady 1.3): adds the `money` store
import { COLLECTIONS, SCHEMA_VERSION, migrateCollections, normalize } from '../core/schema.js';
export const SYNCED = COLLECTIONS;
const STORES = [...SYNCED, 'local'];

let dbp = null;
function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function run(store, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    const r = fn(s);
    if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const idbAll = store => run(store, 'readonly', s => s.getAll());
const idbPutMany = (store, recs) => run(store, 'readwrite', s => { for (const r of recs) s.put(r); });
const idbClear = store => run(store, 'readwrite', s => s.clear());

// ---------- in-memory state ----------
export const S = { tasks: new Map(), goals: new Map(), thoughts: new Map(), checkins: new Map(), meta: new Map(), money: new Map(), local: {} };

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(detail) { for (const fn of listeners) { try { fn(detail); } catch (e) { console.error(e); } } }

export async function load() {
  for (const c of SYNCED) {
    S[c].clear();
    for (const r of await idbAll(c)) S[c].set(r.id, r);
  }
  S.local = {};
  for (const r of await idbAll('local')) S.local[r.id] = r.v;
  await migrateLocal();
}

// Upgrade on-device data in place when the app ships a newer schema. Never deletes user data.
async function migrateLocal() {
  const has = SYNCED.some(c => S[c].size);
  const from = S.local.schemaVersion ?? (has ? 0 : SCHEMA_VERSION);
  if (from === SCHEMA_VERSION) { if (S.local.schemaVersion === undefined) await setLocal('schemaVersion', SCHEMA_VERSION); return; }
  if (from > SCHEMA_VERSION) return; // opened by an older build: leave data untouched
  const colls = migrateCollections(snapshotCollections(), from);
  for (const c of SYNCED) {
    const changed = Object.values(colls[c]).filter(r => JSON.stringify(r) !== JSON.stringify(S[c].get(r.id)));
    await putRaw(c, changed);
  }
  await setLocal('schemaVersion', SCHEMA_VERSION);
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

// Monotonic per-record clock so an edit always beats the version it replaced.
function stamp(prev) {
  const now = Date.now();
  return prev && prev.updatedAt >= now ? prev.updatedAt + 1 : now;
}

export function all(coll) { return [...S[coll].values()].filter(r => !r.deleted); }
export function get(coll, id) { const r = S[coll].get(id); return r && !r.deleted ? r : null; }

export async function save(coll, rec, { silent = false } = {}) {
  const prev = S[coll].get(rec.id);
  const next = { ...rec, updatedAt: stamp(prev) };
  if (!next.createdAt) next.createdAt = prev?.createdAt || Date.now();
  delete next.deleted;
  Object.assign(next, normalize(coll, next));
  S[coll].set(next.id, next);
  await idbPutMany(coll, [next]);
  emit({ coll, rec: next, silent });
  return next;
}

export async function remove(coll, id) {
  const prev = S[coll].get(id);
  const tomb = { id, deleted: true, updatedAt: stamp(prev) };
  S[coll].set(id, tomb);
  await idbPutMany(coll, [tomb]);
  emit({ coll, rec: tomb, removed: prev });
  return prev;
}

// Used by sync + import: write already-stamped records verbatim.
export async function putRaw(coll, recs) {
  if (!recs.length) return;
  for (const r of recs) S[coll].set(r.id, r);
  await idbPutMany(coll, recs);
}
export function emitExternal() { emit({ external: true, silent: true }); }

// Synced key/value records live in "meta" (profile, settings).
export function meta(key, fallback = {}) { return get('meta', key) || { id: key, ...fallback }; }
export async function setMeta(key, patch) { return save('meta', { ...meta(key), ...patch, id: key }); }

// Device-only values (token, theme, last sync...). Never synced.
export function local(key, fallback = null) { return key in S.local ? S.local[key] : fallback; }
export async function setLocal(key, v) { S.local[key] = v; await idbPutMany('local', [{ id: key, v }]); }

export function snapshotCollections() {
  const out = {};
  for (const c of SYNCED) { out[c] = {}; for (const [id, r] of S[c]) out[c][id] = r; }
  return out;
}

export async function wipeAll() {
  for (const c of STORES) await idbClear(c);
  await load();
  emit({ external: true });
}
