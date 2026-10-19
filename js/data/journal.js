// Journal, browser side: save entries, get them understood (server model, or rules on-device), and keep a cached
// reflection for Today. Understanding is stored on the entry itself (thoughts.jx), so it syncs to every device once.
import { all, get, save, uid, meta, local, setLocal } from './store.js';
import { api, cloudReady } from './sync.js';
import { todayKey } from '../core/util.js';
import { tagsIn } from '../core/text.js';
import { journalStats, ruleTag, buildReflectDigest, validateReflect, localReflect, echoEntry, MAX_ENTRY } from '../core/journal.js';

const srcSig = text => `${String(text || '').length}:${String(text || '').slice(0, 24)}`;
export const needsTag = t => !t.jx || (t.jx.src && t.jx.src !== srcSig(t.text));
const online = () => cloudReady() && navigator.onLine;
const data = () => ({ thoughts: all('thoughts'), tasks: all('tasks'), money: all('money'), checkins: all('checkins') });
export const stats = (today = todayKey()) => journalStats(data(), today);
export const knownLabels = () => [...new Set(all('thoughts').flatMap(t => (t.jx?.facts || []).map(f => f.label)))];

export async function saveEntry(text) {
  const t = String(text || '').trim().slice(0, MAX_ENTRY);
  if (!t) return null;
  const rec = await save('thoughts', { id: uid(), text: t, tags: tagsIn(t), mood: 3, kind: 'journal', via: 'today' });
  tagPending({ force: true, ids: [rec.id] });
  return rec;
}

// Entries without understanding (new ones, voice thoughts, entries from before this feature): file them in small batches.
let tagging = null, lastTagTry = 0;
export function tagPending({ force = false, ids = null } = {}) {
  if (tagging) return tagging;
  if (!force && Date.now() - lastTagTry < 60_000) return Promise.resolve(0);
  lastTagTry = Date.now();
  const since = Date.now() - 30 * 864e5;
  const todo = (ids ? ids.map(id => get('thoughts', id)).filter(Boolean) : all('thoughts').filter(t => needsTag(t) && t.createdAt > since && String(t.text || '').trim()))
    .sort((a, b) => b.createdAt - a.createdAt).slice(0, 12);
  if (!todo.length) return Promise.resolve(0);
  tagging = (async () => {
    let tags = null;
    if (online()) {
      try { tags = (await api('POST', 'agent/journal/tag', { entries: todo.map(t => ({ id: t.id, text: t.text })), labels: knownLabels() })).tags; }
      catch { tags = null; }
    }
    if (!tags) tags = Object.fromEntries(todo.map(t => [t.id, ruleTag(t.text)]));
    let n = 0;
    for (const t of todo) {
      const jx = tags[t.id]; const cur = get('thoughts', t.id);
      if (!jx || !cur || cur.text !== t.text) continue;
      await save('thoughts', { ...cur, jx: { ...jx, src: srcSig(cur.text), at: Date.now() }, mood: jx.mood || cur.mood || 3 });
      n++;
    }
    return n;
  })().finally(() => { tagging = null; });
  return tagging;
}

// Reflection cache: recomputed when the journal changed (signature) and at most every 10 minutes, or on a new day.
const sigOf = s => `${s.today}|${s.allEntries}|${s.taggedCount}|${Object.values(s.areaTotals).join('.')}`;
export function cachedReflection() {
  const s = stats();
  const c = local('jxReflect');
  const echo = echoEntry(all('thoughts'), s.today);
  if (c && c.today === s.today && c.data) {
    const v = c.by === 'device' ? localReflect(s, { echo }) : validateReflect(c.data, s, { hasEcho: !!echo });
    return { ...v, by: c.by, stale: c.sig !== sigOf(s), stats: s, echo };
  }
  return { ...localReflect(s, { echo }), by: 'device', stale: true, stats: s, echo };
}
let reflecting = null;
export function refreshReflection({ force = false } = {}) {
  if (reflecting) return reflecting;
  const s = stats(); const c = local('jxReflect');
  if (!force && c && c.today === s.today && (c.sig === sigOf(s) || Date.now() - c.at < 10 * 60e3)) return Promise.resolve(false);
  if (!online() || s.allEntries === 0) return Promise.resolve(false);
  const echo = echoEntry(all('thoughts'), s.today);
  reflecting = (async () => {
    try {
      const r = await api('POST', 'agent/journal/reflect', { digest: buildReflectDigest(s, all('thoughts'), { echo, name: meta('profile').name || '' }) });
      await setLocal('jxReflect', { today: s.today, sig: sigOf(s), at: Date.now(), by: r.provider || 'gemini', data: r.raw });
      return true;
    } catch { await setLocal('jxReflect', { today: s.today, sig: sigOf(s), at: Date.now(), by: 'device', data: {} }); return false; }
  })().finally(() => { reflecting = null; });
  return reflecting;
}
