// Versioned data contract shared by every Steady client (web today; native later).
// The same shape is used in IndexedDB, in data/state.json in the sync repo, and in JSON exports.
// Full field reference: docs/DATA_MODEL.md. Bump SCHEMA_VERSION only together with a migration.

export const SCHEMA_VERSION = 1;
export const COLLECTIONS = ['tasks', 'goals', 'thoughts', 'checkins', 'meta'];

export class NewerSchemaError extends Error {
  constructor(v) { super(`This data was written by a newer Steady (schema ${v}). Update this device to keep syncing.`); this.version = v; }
}

// ---- entity defaults (normalizers never drop unknown fields: forward compatible) ----
const DEFAULTS = {
  tasks: { title: '', priority: 2, dueDate: null, dueTime: null, durationMin: null, reminder: false, status: 'open', doneAt: null, goalId: null },
  goals: { title: '', why: '', target: null, milestones: [], actions: [] },
  thoughts: { text: '', tags: [], mood: 3, kind: 'note' },
  checkins: { date: null, energy: 3, win: '', selfCare: '' },
  meta: {},
};
export function normalize(coll, rec) {
  if (!rec || typeof rec.id !== 'string' || typeof rec.updatedAt !== 'number') return null;
  if (rec.deleted) return { id: rec.id, deleted: true, updatedAt: rec.updatedAt };
  return { ...DEFAULTS[coll], ...rec };
}

// ---- migrations: MIGRATIONS[n] upgrades collections from version n-1 to n ----
// Each receives and returns { tasks:{id:rec}, goals:{...}, ... }. Must be pure and idempotent.
export const MIGRATIONS = {
  // v0 -> v1: pre-release docs used `schema` instead of `schemaVersion`, and tasks could lack `status`.
  1: colls => {
    for (const t of Object.values(colls.tasks || {})) if (!t.deleted && !t.status) t.status = t.doneAt ? 'done' : 'open';
    return colls;
  },
};

export function docVersion(doc) { return doc ? (doc.schemaVersion ?? doc.schema ?? 0) : SCHEMA_VERSION; }

export function migrateCollections(colls, from) {
  if (from > SCHEMA_VERSION) throw new NewerSchemaError(from);
  let out = structuredClone(colls || {});
  for (const c of COLLECTIONS) out[c] = out[c] || {};
  for (let v = from + 1; v <= SCHEMA_VERSION; v++) if (MIGRATIONS[v]) out = MIGRATIONS[v](out);
  for (const c of COLLECTIONS) for (const [id, r] of Object.entries(out[c])) { const n = normalize(c, r); if (n && n.id === id) out[c][id] = n; else delete out[c][id]; }
  return out;
}

// Parse any Steady document (sync file, export, legacy) into current-version collections.
export function readDoc(doc) {
  const data = doc?.data ?? doc;
  const colls = {};
  for (const c of COLLECTIONS) {
    const v = data?.[c] || {};
    colls[c] = Array.isArray(v) ? Object.fromEntries(v.filter(r => r && r.id).map(r => [r.id, r])) : { ...v };
  }
  return migrateCollections(colls, docVersion(doc));
}

export function makeDoc(colls, extra = {}) {
  return { app: 'steady', schemaVersion: SCHEMA_VERSION, writtenAt: new Date().toISOString(), ...extra, data: colls };
}
