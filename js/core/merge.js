// Conflict-free-enough merge: per record, last write wins by updatedAt; deletes are tombstones.
// Deterministic on every device: ties break on tombstone first, then on JSON order.
export const TOMBSTONE_TTL_MS = 90 * 864e5;

export function pick(l, r) {
  if (!l) return r;
  if (!r) return l;
  if (l.updatedAt !== r.updatedAt) return l.updatedAt > r.updatedAt ? l : r;
  if (!!l.deleted !== !!r.deleted) return l.deleted ? l : r;
  return JSON.stringify(l) >= JSON.stringify(r) ? l : r;
}

const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);

// Returns merged collections, the records the local side must adopt, and whether the remote is behind.
export function merge(localC, remoteC, collections) {
  const merged = {}, toLocal = {};
  let remoteDirty = false;
  for (const c of collections) {
    const L = localC[c] || {}, R = remoteC[c] || {};
    merged[c] = {}; toLocal[c] = [];
    for (const id of new Set([...Object.keys(L), ...Object.keys(R)])) {
      const w = pick(L[id], R[id]);
      merged[c][id] = w;
      if (!same(w, L[id])) toLocal[c].push(w);
      if (!same(w, R[id])) remoteDirty = true;
    }
  }
  return { merged, toLocal, remoteDirty };
}

export function prune(colls, now = Date.now(), ttl = TOMBSTONE_TTL_MS) {
  for (const c of Object.keys(colls)) for (const [id, r] of Object.entries(colls[c])) if (r.deleted && r.updatedAt < now - ttl) delete colls[c][id];
  return colls;
}
