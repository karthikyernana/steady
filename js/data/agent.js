// Voice agent, browser side: builds the context, talks to /api/agent/*, applies ACCEPTED drafts to the local store.
// Nothing here writes without an explicit accept from the UI (js/ui/voice.js). Every apply returns an undo.
import { all, get, save, remove, uid, meta } from './store.js';
import { api, cloudReady, ApiError } from './sync.js';
import { buildContext, compactContext, rulesPlan, validatePlan, zonedNow } from '../core/agent.js';
import { todayKey, keyAdd, dateKey, weekStart } from '../core/util.js';
import { tagsIn } from '../core/text.js';

export const TZ = 'Asia/Kolkata';
const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || TZ; } catch { return TZ; } };

export function currentContext() {
  return buildContext({ tasks: all('tasks'), goals: all('goals'), money: all('money'), thoughts: all('thoughts'), profile: meta('profile'), settings: meta('settings') }, { today: todayKey(), tz: tz() });
}

// audio → transcript (server: Sarvam Saaras). Raw bytes, no base64 bloat.
export async function transcribeAudio(blob) {
  let res;
  try {
    res = await fetch('/api/agent/transcribe', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Audio-Type': blob.type || 'audio/webm', 'X-Steady': '1' }, body: blob });
  } catch { throw new ApiError(0, navigator.onLine ? "Couldn't reach Steady's server." : 'You are offline. Type it instead and I will understand it on this device.'); }
  const j = await res.json().catch(() => null);
  if (!res.ok || !j) throw new ApiError(res.status, j?.error || `Server error ${res.status}`);
  return j;
}

// text → drafts. Signed in + online: the server agent (Gemini → Sarvam → rules). Otherwise: the same rules on-device.
export async function planText(text) {
  const context = currentContext();
  if (cloudReady() && navigator.onLine) {
    try { return await api('POST', 'agent/plan', { text, context, tz: tz() }); }
    catch (e) { if (e.status && e.status !== 0 && e.status < 500 && e.status !== 404) throw e; /* unreachable: fall back below */ }
  }
  return planOnDevice(text, context);
}
export function planOnDevice(text, context = currentContext()) {
  const compact = compactContext(context, null, zonedNow(tz()));
  return { ...validatePlan(rulesPlan(text, compact), compact), provider: 'device', today: compact.now.date };
}

export function sendLearning(pairs) {
  if (!cloudReady() || !pairs.length) return Promise.resolve(null);
  return api('POST', 'agent/learn', { pairs }).catch(() => null);
}
export const agentMemory = () => api('GET', 'agent/memory');
export const resetAgentMemory = () => api('POST', 'agent/memory/reset');

// ---------------------------------------------------------------- apply (one accepted draft → store writes)
// Returns { changes: [{coll, id, prev}], label }. Undo restores prev (or deletes what was created).
export async function applyDraft(d) {
  const f = d.f, changes = [];
  const put = async (coll, rec) => { const prev = get(coll, rec.id); changes.push({ coll, id: rec.id, prev: prev ? { ...prev } : null }); return save(coll, rec); };
  const doneTask = (title, goalId) => put('tasks', { id: uid(), title, priority: 2, dueDate: todayKey(), dueTime: null, durationMin: null, reminder: false, status: 'done', doneAt: Date.now(), goalId: goalId || null, via: 'voice' });
  let label = '';
  switch (d.type) {
    case 'task': case 'reminder': {
      await put('tasks', { id: uid(), title: f.title, priority: f.priority || 2, dueDate: f.dueDate || todayKey(), dueTime: f.dueTime || null, durationMin: f.durationMin || null,
        reminder: !!(f.reminder && f.dueTime), status: 'open', doneAt: null, goalId: f.goalId || null, via: 'voice' });
      label = d.type === 'reminder' ? 'Reminder set' : 'Task added'; break;
    }
    case 'complete': {
      const t = f.taskId ? get('tasks', f.taskId) : null;
      if (t) await put('tasks', { ...t, status: 'done', doneAt: Date.now(), dueDate: t.dueDate && t.dueDate > todayKey() ? todayKey() : t.dueDate });
      else await doneTask(f.title, f.goalId);
      label = 'Marked done'; break;
    }
    case 'progress': {
      const g = get('goals', f.goalId);
      if (!g) throw new Error('That goal is gone.');
      if (f.markMilestone && f.milestoneId) await put('goals', { ...g, milestones: (g.milestones || []).map(m => (m.id === f.milestoneId ? { ...m, done: true, doneAt: Date.now() } : m)) });
      if (f.logTask !== false) await doneTask(f.title || `Worked on ${g.title}`, g.id);
      label = 'Progress logged'; break;
    }
    case 'goal': {
      const ws = dateKey(weekStart());
      await put('goals', { id: uid(), title: f.title, why: f.why || '', target: f.target || dateKey(new Date(Date.now() + 84 * 864e5)),
        milestones: (f.milestones || []).map((t, i) => ({ id: uid(), title: t, week: keyAdd(ws, i * 7), done: false })), actions: (f.actions || []).map(t => ({ id: uid(), title: t })), order: all('goals').length });
      label = 'Goal added'; break;
    }
    case 'money': {
      await put('money', { id: uid(), kind: f.kind === 'income' ? 'income' : 'expense', amount: Math.round(+f.amount * 100) / 100, category: f.category || 'Other',
        payee: f.payee || null, note: f.note || '', date: f.date || todayKey(), source: 'voice' });
      label = f.kind === 'income' ? 'Income logged' : 'Expense logged'; break;
    }
    case 'thought': {
      const tags = tagsIn(f.text);
      await put('thoughts', { id: uid(), text: f.text, tags, mood: f.mood || 3, kind: f.kind || 'note', via: 'voice' });
      label = 'Thought saved'; break;
    }
    default: throw new Error(`Unknown action ${d.type}`);
  }
  return { changes, label };
}

export async function undoChanges(changes) {
  for (const c of [...changes].reverse()) {
    if (c.prev) await save(c.coll, c.prev); else await remove(c.coll, c.id);
  }
}
