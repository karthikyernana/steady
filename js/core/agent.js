// Steady voice agent: the shared, pure core (no DOM, no network). Used by the browser AND the server.
//
//   browser  buildContext(store)           → compact context with real ids (what Steady knows right now)
//   server   compactContext(ctx, memory)   → prompt context with short refs (t1, g1, g1m2…) + an index back to ids
//   server   buildPrompt(text, compact)    → system + user messages for the LLM (or rulesPlan for the offline/rules provider)
//   server   validatePlan(raw, index)      → normalized, safe drafts (unknown refs dropped, fields clamped, gaps flagged)
//   browser  shows drafts as editable cards; nothing is written until the user taps Accept
//   server   learn(memory, pairs)          → per-user profile memory (categories, payees, wording → category fixes)
//
// The LLM never sees or returns real ids: it gets short refs, and validatePlan maps them back. A ref the model
// invents simply fails to resolve, so a hallucinated "complete task X" can never touch the wrong record.
import { parseQuick } from './parse.js';
import { findAmount, parseMoney, canonicalCategory, guessCategory, guessPayee, DEFAULT_CATEGORIES } from './money.js';

export const ACTION_TYPES = ['task', 'reminder', 'complete', 'progress', 'goal', 'money', 'thought'];
export const MAX_ACTIONS = 8;
export const MAX_TEXT = 1200;

// ---------------------------------------------------------------- time (always the user's zone, default Asia/Kolkata)
const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function zonedNow(tz = 'Asia/Kolkata', at = new Date()) {
  let zone = tz;
  try { new Intl.DateTimeFormat('en-CA', { timeZone: zone }); } catch { zone = 'Asia/Kolkata'; }
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'long' })
    .formatToParts(at).map(x => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  return { tz: zone, date, time: `${p.hour}:${p.minute}`, weekday: p.weekday, at: at.getTime() };
}
export const addDaysKey = (k, n) => { const d = new Date(`${k}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekdayOf = k => WD[new Date(`${k}T12:00:00Z`).getUTCDay()];
const mondayOf = k => { const wd = (new Date(`${k}T12:00:00Z`).getUTCDay() + 6) % 7; return addDaysKey(k, -wd); };

// ---------------------------------------------------------------- 1. browser: what Steady knows (real ids)
// data = { tasks, goals, money, thoughts, profile, settings }; returns a small, bounded object (sent to the server)
export function buildContext(data, { today, tz = 'Asia/Kolkata' } = {}) {
  const t = today;
  const tasks = (data.tasks || []).filter(x => !x.deleted);
  const open = tasks.filter(x => x.status === 'open' && (!x.dueDate || x.dueDate <= addDaysKey(t, 14)))
    .sort((a, b) => (a.dueDate || '9').localeCompare(b.dueDate || '9') || (a.dueTime || '99').localeCompare(b.dueTime || '99')).slice(0, 40);
  const done = tasks.filter(x => x.status === 'done' && x.doneAt).sort((a, b) => b.doneAt - a.doneAt).slice(0, 10);
  const goals = (data.goals || []).filter(g => !g.deleted).slice(0, 12);
  const money = (data.money || []).filter(m => !m.deleted).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);
  const cats = new Map();
  for (const m of money.slice(0, 300)) cats.set(m.category, (cats.get(m.category) || 0) + 1);
  return {
    v: 1, tz, today: t,
    profile: { name: data.profile?.name || '', wake: data.profile?.wake || '07:00', sleep: data.profile?.sleep || '23:30' },
    defaultReminder: data.settings?.defaultReminder !== false,
    tasks: open.map(x => ({ id: x.id, title: clip(x.title, 90), due: x.dueDate || null, time: x.dueTime || null, goalId: x.goalId || null })),
    done: done.map(x => ({ id: x.id, title: clip(x.title, 90), doneOn: x.doneAt ? new Date(x.doneAt).toISOString().slice(0, 10) : null })),
    goals: goals.map(g => ({ id: g.id, title: clip(g.title, 90), target: g.target || null,
      milestones: (g.milestones || []).filter(m => !m.done).slice(0, 6).map(m => ({ id: m.id, title: clip(m.title, 80), week: m.week || null })),
      actions: (g.actions || []).slice(0, 6).map(a => ({ id: a.id, title: clip(a.title, 60) })) })),
    money: money.slice(0, 15).map(m => ({ date: m.date, kind: m.kind, amount: m.amount, category: m.category, payee: m.payee || null, note: clip(m.note, 60) })),
    categories: [...cats].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([c]) => c),
    thoughts: (data.thoughts || []).filter(x => !x.deleted).sort((a, b) => b.createdAt - a.createdAt).slice(0, 5).map(x => clip(x.text, 140)),
  };
}
const clip = (s, n) => { const v = String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim(); return v.length > n ? v.slice(0, n - 1) + '…' : v; };
const str = (v, n) => (typeof v === 'string' ? clip(v, n) : '');
const isId = v => typeof v === 'string' && v.length > 0 && v.length <= 128;
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);
const isTime = v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

// ---------------------------------------------------------------- 2. server: refs + bounded prompt context
// Untrusted input (it came from the browser): everything is re-validated and clipped here.
export function compactContext(ctx, memory = null, now = zonedNow(ctx?.tz)) {
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  const index = {};  // ref → { kind, id, title, goalId?, goalRef? }
  const tasks = (Array.isArray(c.tasks) ? c.tasks : []).filter(x => isId(x?.id)).slice(0, 40).map((x, i) => {
    const ref = `t${i + 1}`; index[ref] = { kind: 'task', id: x.id, title: str(x.title, 90), goalId: isId(x.goalId) ? x.goalId : null };
    return { ref, title: str(x.title, 90), due: isDate(x.due) ? x.due : null, time: isTime(x.time) ? x.time : null };
  });
  const done = (Array.isArray(c.done) ? c.done : []).filter(x => isId(x?.id)).slice(0, 10).map((x, i) => ({ title: str(x.title, 90), doneOn: isDate(x.doneOn) ? x.doneOn : null, _i: i }));
  const goals = (Array.isArray(c.goals) ? c.goals : []).filter(g => isId(g?.id)).slice(0, 12).map((g, i) => {
    const ref = `g${i + 1}`; index[ref] = { kind: 'goal', id: g.id, title: str(g.title, 90) };
    const milestones = (Array.isArray(g.milestones) ? g.milestones : []).filter(m => isId(m?.id)).slice(0, 6).map((m, j) => {
      const mref = `${ref}m${j + 1}`; index[mref] = { kind: 'milestone', id: m.id, title: str(m.title, 80), goalRef: ref, goalId: g.id };
      return { ref: mref, title: str(m.title, 80), week: isDate(m.week) ? m.week : null };
    });
    const actions = (Array.isArray(g.actions) ? g.actions : []).slice(0, 6).map((a, j) => {
      const aref = `${ref}a${j + 1}`; index[aref] = { kind: 'action', id: isId(a?.id) ? a.id : null, title: str(a?.title, 60), goalRef: ref, goalId: g.id };
      return { ref: aref, title: str(a?.title, 60) };
    });
    return { ref, title: str(g.title, 90), target: isDate(g.target) ? g.target : null, milestones, actions };
  });
  for (const t of tasks) { const g = Object.entries(index).find(([, v]) => v.kind === 'goal' && v.id === index[t.ref].goalId); if (g) t.goal = g[0]; }
  const money = (Array.isArray(c.money) ? c.money : []).slice(0, 15).filter(m => Number.isFinite(+m?.amount)).map(m => ({
    date: isDate(m.date) ? m.date : null, kind: m.kind === 'income' ? 'income' : 'expense', amount: Math.round(+m.amount * 100) / 100,
    category: str(m.category, 40) || 'Other', payee: str(m.payee, 60) || null, note: str(m.note, 60) }));
  const learnedCats = Object.entries(memory?.categories || {}).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const categories = [...new Set([...(Array.isArray(c.categories) ? c.categories.map(x => str(x, 40)).filter(Boolean) : []), ...learnedCats])].slice(0, 24);
  const week = []; for (let i = -1; i <= 7; i++) { const k = addDaysKey(now.date, i); week.push(`${weekdayOf(k).slice(0, 3)} ${k}${i === 0 ? ' (today)' : i === -1 ? ' (yesterday)' : i === 1 ? ' (tomorrow)' : ''}`); }
  const prompt = {
    now: { date: now.date, time: now.time, weekday: now.weekday, tz: now.tz, thisWeekMonday: mondayOf(now.date), calendar: week },
    profile: { name: str(c.profile?.name, 40), wake: isTime(c.profile?.wake) ? c.profile.wake : '07:00', sleep: isTime(c.profile?.sleep) ? c.profile.sleep : '23:30' },
    openTasks: tasks, recentlyDone: done.map(({ _i, ...r }) => r), goals,
    money: { recent: money, categories: categories.length ? categories : DEFAULT_CATEGORIES },
    recentThoughts: (Array.isArray(c.thoughts) ? c.thoughts : []).slice(0, 5).map(x => str(x, 140)).filter(Boolean),
    learned: memoryForPrompt(memory),
  };
  return { prompt, index, now, defaultReminder: c.defaultReminder !== false };
}

export function memoryForPrompt(m) {
  if (!m) return { payees: [], corrections: [] };
  return {
    payees: Object.values(m.payees || {}).sort((a, b) => (b.n || 0) - (a.n || 0)).slice(0, 15).map(p => `${p.name} → ${p.category}`),
    corrections: (m.corrections || []).slice(0, 20).map(x => `${x.w} → ${x.c}`),
  };
}

// ---------------------------------------------------------------- 3. the prompt + response schema
export const SYSTEM_PROMPT = `You are Steady's capture agent for Karthik, a student-founder in India. He speaks to his tracker in English, Telugu, or Telugu-English code-mix (Telugu script or romanized, e.g. "ivala 500 petrol ki karchu ayyindi", "DSA problems chesanu"). Turn ONE utterance into a list of draft actions he will review and accept. Nothing you output is applied until he taps Accept.

Action types:
- task: a to-do. title, optional date (YYYY-MM-DD), time (HH:MM 24h), duration_min, priority, goal (ref of a goal it serves).
- reminder: a to-do that must notify him at a time ("remind me…", "set a reminder", "set an alarm", "notify/ping/alert me", "గుర్తు చేయి"). Same fields as task; time is required if he said one.
- complete: he says he DID something ("done", "finished", "chesanu", "అయిపోయింది", "today I have done…"). Set target to the ref of the matching item in openTasks. If nothing in openTasks matches, leave target null and put what he did in title.
- progress: he made progress on a GOAL (worked on it, finished a milestone, did one of its daily actions). target = goal ref; milestone = milestone ref if he finished that milestone (then mark_milestone_done=true); title = short description of what he did.
- goal: a new goal ("my goal is…", "I want to … by …"). title, date = target date if given, milestones = short weekly steps if he listed any, note = why.
- money: an expense or income in INR. amount is a number in rupees ("five hundred" / "ఐదు వందలు" / "aidu vandalu" = 500, "2.5k" = 2500, "1.5 lakh" = 150000). money_kind expense|income. category: reuse one of money.categories or the learned list when it fits, else a short English noun (Food, Transport, Groceries, Bills, Shopping, Education, Health, Entertainment, Family, Rent, Salary, Freelance, Stipend). payee if he named a shop/app/person. note = 2-5 words. date = the day it happened.
- thought: an idea, note, feeling or journal line. note = the text in his words (keep Telugu as Telugu). thought_kind note|idea|journal, mood 1-5 if he expressed one.

Rules:
- One utterance can hold several actions (e.g. "spent 200 on lunch and finished the DSA task" = money + complete). Never merge two different things; never split one thing into two.
- Times counted from now ("in 5 minutes", "after 2 hours", "half an hour from now", "5 నిమిషాల్లో", "10 nimishallo") go in in_minutes as a whole number of minutes, with time and date null; the app computes the exact clock time. For a reminder or alarm, "for N minutes" with no clock time also means in N minutes ("set a reminder for 5 minutes" → in_minutes 5, duration_min null). Use time (HH:MM) only for clock times ("at 7", "7:30 pm").
- Resolve relative dates and times against now.calendar (today, tomorrow, yesterday, weekday names, "next week" = next Monday, "evening" = 19:00, "morning" = 09:00, "night" = 21:00). Never output a past date for a new task unless he said so.
- Resolve references: "that goal", "the gym one", "same as yesterday" (copy the amount/category from money.recent of yesterday), "it" → use the context. Prefer matching existing items over creating duplicates.
- Only use refs that appear in the context (t…, g…, g…m…). Never invent refs. If unsure which item he meant, leave target null and lower confidence.
- Titles: short, start with a verb or noun, English unless he used only Telugu for a personal note. Categories always English.
- Respect "learned" mappings ("word → Category", "Payee → Category"): they are his own corrections and override your guess.
- confidence 0..1: how sure you are this action is what he meant. evidence: the exact words of the utterance this action came from.
- If the utterance is empty, noise, or asks a question you cannot act on, return no actions and put a one-line reply in clarification.
Output JSON only, matching the schema.`;

const N = t => ({ type: [t, 'null'] });
export const ACTION_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    type: { type: 'string', enum: ACTION_TYPES },
    title: N('string'), date: N('string'), time: N('string'), in_minutes: N('integer'), duration_min: N('integer'),
    priority: { type: ['string', 'null'], enum: ['low', 'normal', 'high', null] },
    amount: N('number'), money_kind: { type: ['string', 'null'], enum: ['expense', 'income', null] },
    category: N('string'), payee: N('string'), note: N('string'),
    thought_kind: { type: ['string', 'null'], enum: ['note', 'idea', 'journal', null] }, mood: N('integer'),
    target: N('string'), milestone: N('string'), goal: N('string'),
    milestones: { type: 'array', items: { type: 'string' } }, mark_milestone_done: N('boolean'),
    confidence: { type: 'number' }, evidence: { type: 'string' },
  },
  required: ['type', 'title', 'date', 'time', 'in_minutes', 'duration_min', 'priority', 'amount', 'money_kind', 'category', 'payee', 'note', 'thought_kind', 'mood', 'target', 'milestone', 'goal', 'milestones', 'mark_milestone_done', 'confidence', 'evidence'],
};
export const RESPONSE_SCHEMA = {
  type: 'object', additionalProperties: false,
  // actions LAST: some decoders keep emitting whitespace when a field follows a long array, so nothing follows it
  properties: { language: { type: 'string', enum: ['en', 'te', 'mixed', 'other'] }, clarification: N('string'), actions: { type: 'array', items: ACTION_SCHEMA, maxItems: MAX_ACTIONS } },
  required: ['language', 'clarification', 'actions'],
};

// For providers without schema-constrained decoding: spell the exact shape out in the prompt.
export const SHAPE_HINT = `
Return ONE JSON object and nothing else, exactly this shape (every key present, null when unknown):
{"language":"en|te|mixed|other","clarification":null,"actions":[{"type":"task|reminder|complete|progress|goal|money|thought","title":null,"date":"YYYY-MM-DD or null","time":"HH:MM or null","in_minutes":null,"duration_min":null,"priority":"low|normal|high or null","amount":null,"money_kind":"expense|income or null","category":null,"payee":null,"note":null,"thought_kind":"note|idea|journal or null","mood":null,"target":null,"milestone":null,"goal":null,"milestones":[],"mark_milestone_done":null,"confidence":0.9,"evidence":"exact words"}]}
The key is "type" (not "action_type"). Always fill "date" for anything that happens on a specific day (tasks, reminders, money).`;
export function buildPrompt(text, compact, { shapeHint = false } = {}) {
  const user = `CONTEXT_JSON:\n${JSON.stringify(compact.prompt)}\n\nUTTERANCE:\n<<<${clip(text, MAX_TEXT)}>>>`;
  return { system: shapeHint ? SYSTEM_PROMPT + '\n' + SHAPE_HINT : SYSTEM_PROMPT, user };
}

// ---------------------------------------------------------------- 4. validation (the only path from model output to a draft)
const words = s => new Set((String(s || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).map(stem).filter(w => w.length > 1 && !STOP.has(w)));
const STOP = new Set('a an the to for of and or with on in at my me i be do did done get go make take have has had is are was this that it up out some more today todays now just also all finished complete completed chesanu chesa ayipoyindi'.split(' '));
const stem = w => w.replace(/(ing|ed|es|s)$/u, '') || w;
export function similarity(a, b) {
  const A = words(a), B = words(b); if (!A.size || !B.size) return 0;
  let n = 0; for (const w of A) if (B.has(w) || [...B].some(x => x.length > 3 && w.length > 3 && (x.startsWith(w) || w.startsWith(x)))) n++;
  return n / Math.min(A.size, B.size) * (0.75 + 0.25 * n / Math.max(A.size, B.size));
}
function bestMatch(text, items) {
  const scored = items.map(it => ({ it, s: similarity(text, it.title) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
  const top = scored[0];
  if (!top || top.s < 0.5) return { hit: null, candidates: scored.slice(0, 4).map(x => x.it) };
  if (scored[1] && top.s - scored[1].s < 0.12) return { hit: null, candidates: scored.slice(0, 4).map(x => x.it) };
  return { hit: top.it, candidates: scored.slice(0, 4).map(x => x.it) };
}
const PRIO = { low: 1, normal: 2, high: 3 };

export function validatePlan(raw, compact, { known = [] } = {}) {
  const { index, now } = compact;
  const out = { drafts: [], dropped: [], clarification: typeof raw?.clarification === 'string' ? clip(raw.clarification, 200) : null, language: ['en', 'te', 'mixed', 'other'].includes(raw?.language) ? raw.language : 'other' };
  const acts = Array.isArray(raw?.actions) ? raw.actions.slice(0, MAX_ACTIONS * 2) : [];
  const tasks = Object.values(index).filter(v => v.kind === 'task');
  const goals = Object.entries(index).filter(([, v]) => v.kind === 'goal').map(([ref, v]) => ({ ref, ...v }));
  const actionsIdx = Object.values(index).filter(v => v.kind === 'action');
  const cats = [...known, ...(compact.prompt?.money?.categories || [])];
  const seen = new Set();
  const minDate = addDaysKey(now.date, -400), maxDate = addDaysKey(now.date, 730);
  const dateOr = (v, dflt, warn) => { if (v == null || v === '') return dflt; if (isDate(v) && v >= minDate && v <= maxDate) return v; warn.push('date'); return dflt; };
  const ref = (r, kind) => (typeof r === 'string' && Object.hasOwn(index, r) && index[r].kind === kind ? index[r] : null);

  for (const a0 of acts) {
    const a = a0 && typeof a0 === 'object' && !a0.type ? { ...a0, type: a0.action_type ?? a0.intent ?? a0.kind } : a0;   // tolerate common key slips
    if (!a || typeof a !== 'object' || !ACTION_TYPES.includes(a.type)) { out.dropped.push({ reason: 'unknown type' }); continue; }
    const warnings = [], needs = [];
    const conf = Number.isFinite(+a.confidence) ? Math.max(0, Math.min(1, +a.confidence)) : 0.6;
    const evidence = str(a.evidence, 200);
    let d = null;
    switch (a.type) {
      case 'task': case 'reminder': {
        const title = str(a.title, 120); if (!title) { out.dropped.push({ reason: 'task without title' }); continue; }
        let dueTime = a.time == null ? null : isTime(a.time) ? a.time : (warnings.push('time'), null);
        let date0 = a.date, dur = a.duration_min;
        // "in 5 minutes": an offset from now, turned into his clock time here (the model never does clock maths)
        let inMin = Number.isInteger(a.in_minutes) && a.in_minutes > 0 && a.in_minutes <= 10080 ? a.in_minutes : null;
        if (inMin === null && a.type === 'reminder' && !dueTime && Number.isInteger(dur) && dur > 0 && dur <= 720) { inMin = dur; dur = null; }   // "reminder for 5 minutes"
        if (inMin !== null) { const at = zonedNow(now.tz, new Date(Math.round((now.at + inMin * 60e3) / 60e3) * 60e3)); dueTime = at.time; date0 = at.date; }
        const g = ref(a.goal, 'goal');
        const reminder = a.type === 'reminder' ? true : !!dueTime && compact.defaultReminder;
        if (a.type === 'reminder' && !dueTime) needs.push('time');
        d = { type: a.type, f: { title, dueDate: dateOr(date0, now.date, warnings), dueTime, durationMin: Number.isInteger(dur) && dur > 0 && dur <= 600 ? dur : null,
          priority: Object.hasOwn(PRIO, a.priority) ? PRIO[a.priority] : 2, reminder, goalId: g?.id || null }, labels: { goal: g?.title || null } };
        break;
      }
      case 'complete': {
        let t = ref(a.target, 'task');
        const title = str(a.title, 120) || evidence;
        let candidates = [];
        if (!t && title) {
          const m = bestMatch(title, tasks); t = m.hit; candidates = m.candidates;
          if (!t) { // maybe it is a goal's daily action → progress
            const am = bestMatch(title, actionsIdx);
            if (am.hit) { d = { type: 'progress', f: { goalId: am.hit.goalId, milestoneId: null, markMilestone: false, logTask: true, title: am.hit.title }, labels: { goal: index[am.hit.goalRef]?.title } }; break; }
          }
        }
        if (!t && !title) { out.dropped.push({ reason: 'complete without target' }); continue; }
        d = { type: 'complete', f: { taskId: t?.id || null, title: t ? t.title : capFirst(title), goalId: t?.goalId || null },
          labels: { task: t?.title || null }, candidates: candidates.map(c => ({ id: c.id, title: c.title })) };
        break;
      }
      case 'progress': {
        const asTask = ref(a.target, 'task');
        if (asTask && !ref(a.goal, 'goal')) { d = { type: 'complete', f: { taskId: asTask.id, title: asTask.title, goalId: asTask.goalId }, labels: { task: asTask.title }, candidates: [] }; break; }
        let g = ref(a.target, 'goal') || ref(a.goal, 'goal');
        const ms = ref(a.milestone, 'milestone');
        if (ms && (!g || ms.goalId !== g.id)) g = index[ms.goalRef];
        const title = str(a.title, 120) || str(a.note, 120) || evidence;
        if (!g && title) { const m = bestMatch(title, goals); g = m.hit; if (!g) { const am = bestMatch(title, actionsIdx); if (am.hit) g = index[am.hit.goalRef]; } }
        if (!g) { // no goal to attach to: keep it as a logged "done" so the effort still counts
          if (!title) { out.dropped.push({ reason: 'progress without goal' }); continue; }
          d = { type: 'complete', f: { taskId: null, title: capFirst(title), goalId: null }, labels: { task: null }, candidates: [] };
          warnings.push('no-goal'); break;
        }
        const msOk = ms && ms.goalId === g.id ? ms : null;
        d = { type: 'progress', f: { goalId: g.id, milestoneId: msOk?.id || null, markMilestone: !!(msOk && a.mark_milestone_done), logTask: !!title, title: capFirst(title || g.title) },
          labels: { goal: g.title, milestone: msOk?.title || null } };
        break;
      }
      case 'goal': {
        const title = str(a.title, 120); if (!title) { out.dropped.push({ reason: 'goal without title' }); continue; }
        const target = a.date ? dateOr(a.date, null, warnings) : null;
        d = { type: 'goal', f: { title: capFirst(title), why: str(a.note, 160), target: target && target > now.date ? target : null,
          milestones: (Array.isArray(a.milestones) ? a.milestones : []).map(m => str(m, 80)).filter(Boolean).slice(0, 8), actions: [] } };
        break;
      }
      case 'money': {
        let amount = Number(a.amount);
        if (!Number.isFinite(amount) || amount <= 0) { amount = findAmount(`${a.title || ''} ${evidence}`)?.value ?? null; if (amount == null) needs.push('amount'); }
        if (amount != null && amount > 1e8) { amount = null; needs.push('amount'); }
        const kind = a.money_kind === 'income' ? 'income' : 'expense';
        const date = dateOr(a.date, now.date, warnings);
        d = { type: 'money', f: { kind, amount: amount == null ? null : Math.round(amount * 100) / 100,
          category: canonicalCategory(a.category || guessCategory(`${a.note || ''} ${a.payee || ''} ${evidence}`, kind), cats),
          payee: str(a.payee, 60) || null, note: capFirst(str(a.note, 120) || str(a.title, 120)), date: date > addDaysKey(now.date, 1) ? (warnings.push('future'), date) : date } };
        break;
      }
      case 'thought': {
        const text = str(a.note, 1000) || str(a.title, 1000) || evidence; if (!text) { out.dropped.push({ reason: 'empty thought' }); continue; }
        d = { type: 'thought', f: { text, kind: ['note', 'idea', 'journal'].includes(a.thought_kind) ? a.thought_kind : 'note', mood: Number.isInteger(a.mood) && a.mood >= 1 && a.mood <= 5 ? a.mood : 3 } };
        break;
      }
    }
    if (!d) continue;
    const sig = `${d.type}|${JSON.stringify(d.f)}`;
    if (seen.has(sig)) { out.dropped.push({ reason: 'duplicate' }); continue; }
    seen.add(sig);
    if (out.drafts.length >= MAX_ACTIONS) { out.dropped.push({ reason: 'too many' }); continue; }
    out.drafts.push({ key: `a${out.drafts.length + 1}`, type: d.type, confidence: Math.round(conf * 100) / 100, evidence, f: d.f, labels: d.labels || {}, candidates: d.candidates || [], needs, warnings });
  }
  return out;
}
const capFirst = s => (s ? s[0].toUpperCase() + s.slice(1) : s);

// What a draft still needs before it can be accepted (re-checked in the browser after edits).
export function missing(d) {
  const f = d.f || {};
  if (d.type === 'task' || d.type === 'reminder') return [!f.title && 'title', d.type === 'reminder' && !f.dueTime && 'time', f.dueDate && !isDate(f.dueDate) && 'date'].filter(Boolean);
  if (d.type === 'money') return [!(f.amount > 0) && 'amount', !f.category && 'category', !isDate(f.date) && 'date'].filter(Boolean);
  if (d.type === 'complete') return [!f.taskId && !f.title && 'target'].filter(Boolean);
  if (d.type === 'progress') return [!f.goalId && 'goal'].filter(Boolean);
  if (d.type === 'goal') return [!f.title && 'title'].filter(Boolean);
  if (d.type === 'thought') return [!f.text && 'text'].filter(Boolean);
  return [];
}

// ---------------------------------------------------------------- 5. rules provider (no LLM key, offline typing, tests)
// Deterministic and modest: clause splitting + the same quick-add parsers the app already uses. It returns the
// SAME raw shape an LLM returns, so it goes through validatePlan like everything else.
const SPLIT = /\s*(?:[;.!?]+\s+|,\s*(?:and\s+|then\s+)?|\s+(?:and then|and also|and|then|also|plus)\s+|\s+(?:ఇంకా|తర్వాత|మరియు|inka|tarvata)\s+)\s*/iu;
const DONE_RE = /\b(done|did|finished|finish(?:ed)? off|completed|wrapped up|knocked out|sent|posted|went to|called|wrote|studied|practi[cs]ed|solved|submitted|shipped|attended|cleaned|worked on)\b|\bi(?:'ve| have) (?:done|finished|completed)\b|చేశాను|చేసాను|అయిపోయింది|పూర్తి(?: చేశాను)?|\b(chesanu|chesa|chesesa|ayipoyindi|purthi)\b/iu;
const FUTURE_RE = /\b(will|need to|have to|should|tomorrow|later|remind)\b|రేపు/iu;
const REMIND_RE = /^\s*(?:please\s+)?(?:remind(?: me)?|reminder|set (?:a|an) (?:reminder|alarm)|alarm|notify me|ping me|alert me)\b|గుర్తు\s*చేయ|\bgurthu\s*chey/iu;
const GOAL_RE = /\b(?:my (?:new )?goal(?: is)?|new goal|goal:|i want to .+ by)\b|లక్ష్యం/iu;
const THOUGHT_RE = /^\s*(?:idea|note|thought|journal)\s*[:\-]|^\s*(?:i feel|i felt|feeling|i think|i wonder|i realised|i realized)\b|ఆలోచన|అనిపిస్తుంది|\banipistundi\b/iu;
const MONEY_HINT = /\b(spent|spend|paid|pay|bought|cost|rs|inr|rupees?|bucks|got|received|credited|salary|stipend|refund|kharchu|karchu|petta(?:nu)?)\b|₹|ఖర్చు|రూపాయ|కొన్నాను|కట్టాను|వచ్చింది/iu;
const SAME_AS = /\bsame as (yesterday|last time)\b|నిన్నటి లాగే|ninnati lage/iu;
const TIMEISH = /\d\s?(?:am|pm)\b|\b\d+\s?(?:m|min|mins|minutes?|h|hrs?|hours?)\b|\bat \d|\b\d{1,2}:\d{2}\b/i;

export function rulesPlan(text, compact) {
  const p = compact.prompt; const now = new Date(`${p.now.date}T${p.now.time}:00`);
  const goalsForParse = p.goals.map(g => ({ id: g.ref, title: g.title, actions: g.actions, milestones: g.milestones }));
  const memory = { payees: {}, corrections: (p.learned?.corrections || []).map(s => { const m = /^(.+) → (.+)$/.exec(s); return m ? { w: m[1], c: m[2] } : null; }).filter(Boolean) };
  for (const s of p.learned?.payees || []) { const m = /^(.+) → (.+)$/.exec(s); if (m) memory.payees[m[1].toLowerCase()] = { name: m[1], category: m[2] }; }
  const clauses = String(text || '').split(SPLIT).map(s => s && s.trim()).filter(s => s && s.length > 1);
  const actions = [];
  const base = { title: null, date: null, time: null, in_minutes: null, duration_min: null, priority: null, amount: null, money_kind: null, category: null, payee: null, note: null, thought_kind: null, mood: null, target: null, milestone: null, goal: null, milestones: [], mark_milestone_done: null, confidence: 0.6, evidence: '' };
  for (const c of clauses) {
    const A = { ...base, evidence: c };
    const amt = findAmount(c);
    if (REMIND_RE.test(c)) {
      const bare = c.replace(/^\s*(?:please\s+)?(?:set (?:a|an) (?:reminder|alarm)|alarm|notify me|ping me|alert me)\s*(?:to|for|about|that)?\s*/iu, 'remind me to ');
      const q0 = parseQuick(bare, { now, wake: p.profile.wake, sleep: p.profile.sleep, goals: goalsForParse });
      const q = { ...q0, title: /^(?:remind me\b|\d|$)/i.test(q0.title.trim()) ? 'Reminder' : q0.title };
      actions.push({ ...A, type: 'reminder', title: q.title, date: q.dueDate, time: q.dueTime, duration_min: q.durationMin, priority: ['low', 'normal', 'high'][q.priority - 1], goal: q.goalId, confidence: q.dueTime ? 0.8 : 0.55 });
    } else if (GOAL_RE.test(c)) {
      const title = c.replace(/\b(my (?:new )?goal(?: is)?|new goal|goal:)\s*/i, '').replace(/^\s*(to|is)\s+/i, '').trim();
      const by = /\bby (.+)$/i.exec(title);
      let date = null; if (by) { const q = parseQuick(`x ${by[1]}`, { now }); if (q.dueDate !== p.now.date) date = q.dueDate; }
      actions.push({ ...A, type: 'goal', title: (by ? title.slice(0, by.index) : title).replace(/^i want to\s+/i, '').trim() || title, date, confidence: 0.65 });
    } else if (THOUGHT_RE.test(c)) {
      const kind = /^\s*idea/i.test(c) ? 'idea' : /\b(feel|felt|feeling)\b|అనిపిస్తుంది/i.test(c) ? 'journal' : 'note';
      actions.push({ ...A, type: 'thought', note: c.replace(/^\s*(?:idea|note|thought|journal)\s*[:\-]\s*/i, ''), thought_kind: kind, confidence: 0.7 });
    } else if ((amt && (MONEY_HINT.test(c) || (!TIMEISH.test(c) && amt.value >= 10 && (guessCategory(c) !== 'Other' || guessPayee(c))))) || (SAME_AS.test(c) && p.money.recent.length)) {
      const same = SAME_AS.test(c);
      const m = parseMoney(c.replace(SAME_AS, ' '), { now, memory, known: p.money.categories });
      let amount = m.amount;
      if (amount == null && same) {
        const y = addDaysKey(p.now.date, -1);
        const prev = p.money.recent.find(r => r.date === y && (r.category === m.category || similarity(c, `${r.note} ${r.payee || ''}`) > 0)) || p.money.recent.find(r => r.date === y);
        if (prev) { amount = prev.amount; m.category = prev.category; m.payee = m.payee || prev.payee; m.note = m.note || prev.note; }
      }
      actions.push({ ...A, type: 'money', amount, money_kind: m.kind, category: m.category, payee: m.payee, note: m.note || null, date: m.date, confidence: amount ? 0.8 : 0.4 });
    } else if (DONE_RE.test(c) && !FUTURE_RE.test(c)) {
      const what = c.replace(DONE_RE, ' ').replace(/\b(today|i|i've|have|has|the|my|just|already|all|it|ivala|eeroju)\b|ఈరోజు|ఇవాళ/giu, ' ').replace(/\s+/g, ' ').trim();
      const tm = bestMatch(what, p.openTasks.map(t => ({ ...t, id: t.ref })));
      if (tm.hit) { actions.push({ ...A, type: 'complete', target: tm.hit.ref, title: tm.hit.title, confidence: 0.75 }); continue; }
      const said = capFirst(c.replace(/\b(today|just|already|ivala|eeroju)\b|ఈరోజు|ఇవాళ/giu, ' ').replace(/\s+/g, ' ').trim());
      const acts = p.goals.flatMap(g => g.actions.map(a => ({ id: g.ref, title: a.title }))), ms = p.goals.flatMap(g => g.milestones.map(m => ({ id: m.ref, goal: g.ref, title: m.title })));
      const am = bestMatch(what, acts);
      if (am.hit) { actions.push({ ...A, type: 'progress', target: am.hit.id, title: said, confidence: 0.65 }); continue; }
      const mm = bestMatch(what, ms);
      if (mm.hit && similarity(what, mm.hit.title) >= 0.8) { actions.push({ ...A, type: 'progress', target: mm.hit.goal, milestone: mm.hit.id, mark_milestone_done: true, title: said, confidence: 0.6 }); continue; }
      const gm = bestMatch(what, p.goals.map(g => ({ id: g.ref, title: g.title })));
      if (gm.hit) { actions.push({ ...A, type: 'progress', target: gm.hit.id, title: said, confidence: 0.55 }); continue; }
      actions.push({ ...A, type: 'complete', title: capFirst(what || c), confidence: 0.5 });
    } else {
      const q = parseQuick(c, { now, wake: p.profile.wake, sleep: p.profile.sleep, goals: goalsForParse, defaultReminder: false });
      if (!q.title || q.title.length < 2) continue;
      actions.push({ ...A, type: q.reminder ? 'reminder' : 'task', title: q.title, date: q.dueDate, time: q.dueTime, duration_min: q.durationMin, priority: ['low', 'normal', 'high'][q.priority - 1], goal: q.goalId, confidence: 0.6 });
    }
  }
  return { language: /[\u0C00-\u0C7F]/.test(text) ? (/[a-z]/i.test(text) ? 'mixed' : 'te') : 'en', actions: actions.slice(0, MAX_ACTIONS), clarification: actions.length ? null : 'I could not find anything to add. Try “spent 200 on lunch” or “remind me to call home at 7”.' };
}

// ---------------------------------------------------------------- 6. learning (server-side profile memory)
// pairs: [{ before: draft as proposed, after: draft as accepted }]. Small, capped, newest wins.
const UNSAFE_KEY = /^(__proto__|constructor|prototype)$/i;   // client-supplied strings become object keys below
export const emptyMemory = () => ({ v: 1, categories: {}, payees: {}, corrections: [], accepted: 0, edited: 0 });
export function learn(memory, pairs, at = Date.now()) {
  const m = { ...emptyMemory(), ...(memory || {}) };
  m.categories = { ...m.categories }; m.payees = { ...m.payees }; m.corrections = [...m.corrections];
  for (const { before, after } of Array.isArray(pairs) ? pairs.slice(0, MAX_ACTIONS) : []) {
    if (!after || typeof after !== 'object' || !ACTION_TYPES.includes(after.type)) continue;
    m.accepted++;
    if (before && JSON.stringify(before.f) !== JSON.stringify(after.f)) m.edited++;
    if (after.type !== 'money') continue;
    const f = after.f || {}; const cat = canonicalCategory(f.category);
    if (!cat || UNSAFE_KEY.test(cat)) continue;
    m.categories[cat] = (m.categories[cat] || 0) + 1;
    if (f.payee && !UNSAFE_KEY.test(String(f.payee).toLowerCase().slice(0, 60))) { const k = String(f.payee).toLowerCase().slice(0, 60); m.payees[k] = { name: clip(f.payee, 60), category: cat, n: (m.payees[k]?.n || 0) + 1, at }; }
    const was = before?.f?.category;
    if (was && was.toLowerCase() !== cat.toLowerCase()) {
      const w = keyword(f.payee || f.note || before.evidence || '');
      if (w && !UNSAFE_KEY.test(w)) { m.corrections = m.corrections.filter(x => x.w !== w); m.corrections.unshift({ w, c: cat, at }); }
    }
  }
  m.corrections = m.corrections.slice(0, 60);
  m.payees = Object.fromEntries(Object.entries(m.payees).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, 60));
  m.categories = Object.fromEntries(Object.entries(m.categories).sort((a, b) => b[1] - a[1]).slice(0, 40));
  return m;
}
function keyword(s) {
  const ws = (String(s).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(w => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w) && !MONEY_WORDS.has(w));
  return ws.sort((a, b) => b.length - a.length)[0]?.slice(0, 40) || null;
}
const MONEY_WORDS = new Set('spent spend paid pay bought rupees rupee bucks yesterday kharchu karchu for from got received'.split(' '));

// ---------------------------------------------------------------- 7. human copy for a draft
export const TYPE_LABEL = { task: 'New task', reminder: 'Reminder', complete: 'Mark done', progress: 'Goal progress', goal: 'New goal', money: 'Money', thought: 'Thought' };
