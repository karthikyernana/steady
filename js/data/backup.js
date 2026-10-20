import { SYNCED, snapshotCollections, putRaw, emitExternal } from './store.js';
import { merge as mergeColls } from '../core/merge.js';
import { markDirty } from './sync.js';
const merge = (l, r) => mergeColls(l, r, SYNCED);
import { readDoc, makeDoc, migrateCollections, SCHEMA_VERSION } from '../core/schema.js';
import { todayKey } from '../core/util.js';
import { isNative, shareFile } from '../platform/native.js';

export function exportJSON() {
  const doc = makeDoc(snapshotCollections(), { exportedAt: new Date().toISOString() });
  return JSON.stringify(doc, null, 1);
}

export function downloadExport() {
  if (isNative()) return shareFile(`steady-${todayKey()}.json`, exportJSON());
  const blob = new Blob([exportJSON()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `steady-${todayKey()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// Import merges (same rules as sync), so importing an old backup never clobbers newer edits.
export async function importJSON(text) {
  let doc;
  try { doc = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
  const data = doc?.data ?? doc;
  if (!data || typeof data !== 'object' || !SYNCED.some(c => data[c])) throw new Error('This file is not a Steady export.');
  const remote = readDoc(doc);
  const { toLocal } = merge(migrateCollections(snapshotCollections(), SCHEMA_VERSION), remote);
  let n = 0;
  for (const c of SYNCED) { n += toLocal[c].length; await putRaw(c, toLocal[c]); for (const r of toLocal[c]) markDirty(c, r); }
  emitExternal();
  return n;
}
