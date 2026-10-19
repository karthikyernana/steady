// Demo/test data: 30 days of realistic history with learnable patterns. Not loaded in normal use.
import { putRaw, uid, emitExternal, setMeta, meta, all } from './store.js';
import { todayKey, keyAdd, fromKey } from '../core/util.js';

function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

export async function seed(days = 30, { seed: sd = 7 } = {}) {
  const r = rng(sd);
  const tk = todayKey();
  if (!meta('profile').onboarded) await setMeta('profile', { name: 'Karthik', wake: '08:00', sleep: '01:00', onboarded: true });
  const g1 = { id: 'g-client', title: 'Land my first paying client', why: 'Proof I can sell what I build', target: keyAdd(tk, 60),
    milestones: [
      { id: 'm1', title: 'Portfolio site live', week: keyAdd(tk, -21), done: true },
      { id: 'm2', title: '10 case-study posts on LinkedIn', week: keyAdd(tk, -14), done: true },
      { id: 'm3', title: '30 cold DMs to founders', week: keyAdd(tk, -7), done: false },
      { id: 'm4', title: 'Two discovery calls booked', week: keyAdd(tk, 0), done: false },
      { id: 'm5', title: 'Send first proposal', week: keyAdd(tk, 7), done: false }],
    actions: [{ id: 'a1', title: 'Send 3 cold DMs' }, { id: 'a2', title: 'Post on LinkedIn' }] };
  const g2 = { id: 'g-gym', title: 'Gym 4× a week', why: 'Energy for everything else', target: keyAdd(tk, 90),
    milestones: [{ id: 'm6', title: 'Two weeks without missing', week: keyAdd(tk, -7), done: true }, { id: 'm7', title: 'Bench 60 kg', week: keyAdd(tk, 14), done: false }],
    actions: [{ id: 'a3', title: 'Gym session' }] };
  const now = Date.now();
  const goals = [g1, g2].map((g, i) => ({ ...g, order: i, createdAt: now - days * 864e5, updatedAt: now - days * 864e5 }));
  const titles = [['Post on LinkedIn', 20, 'g-client'], ['Send 3 cold DMs', 15, 'g-client'], ['Gym session', 60, 'g-gym'], ['DSA: 2 problems', 45, null],
    ['Read 10 pages', 15, null], ['Placement prep: aptitude', 30, null], ['Ship landing page section', 90, 'g-client'], ['Reply to emails', 10, null], ['Plan tomorrow', 5, null]];
  const tasks = [], checkins = [], thoughts = [];
  for (let i = days; i >= 1; i--) {
    const k = keyAdd(tk, -i); const d = fromKey(k); const wd = d.getDay();
    const n = 3 + Math.floor(r() * 3);
    const weekendDip = wd === 0 || wd === 6 ? 0.35 : 0;
    const slumpDip = i <= 3 ? 0.6 : 0; // recent slump so MVD shows
    let doneCount = 0;
    for (let j = 0; j < n; j++) {
      const [title, dur, goalId] = titles[Math.floor(r() * titles.length)];
      const pDone = 0.82 - weekendDip - slumpDip - (dur > 45 ? 0.25 : 0);
      const done = r() < pDone;
      const skipped = !done && r() < 0.3;
      const hour = r() < 0.62 ? 21 + Math.floor(r() * 2) : 10 + Math.floor(r() * 9);
      const doneAt = d.getTime() + hour * 3600e3 + Math.floor(r() * 59) * 60e3;
      if (done) doneCount++;
      tasks.push({ id: uid(), title, durationMin: dur, goalId, priority: r() < 0.2 ? 3 : 2, dueDate: k, dueTime: r() < 0.4 ? `${String(hour).padStart(2, '0')}:00` : null,
        reminder: false, status: done ? 'done' : skipped ? 'skipped' : 'open', doneAt: done ? doneAt : null, letGo: !done && !skipped ? true : undefined, createdAt: d.getTime() + 8 * 3600e3, updatedAt: done ? doneAt : d.getTime() + 9 * 3600e3 });
      if (!done && !skipped) tasks[tasks.length - 1].status = 'skipped';
    }
    if (r() < 0.75 && i > 2) {
      const energy = Math.max(1, Math.min(5, Math.round(1 + doneCount * 0.9 + (r() - 0.5) * 1.4)));
      const care = r() < 0.6 ? ['Walk by the lake', 'Gym', 'Called home', 'Early night', 'Played cricket'][Math.floor(r() * 5)] : '';
      checkins.push({ id: `ci-${k}`, date: k, energy, win: ['Shipped the hero section', 'Got a reply from a founder', 'Solved a hard DP problem', 'Posted without overthinking', 'Finished aptitude mock'][Math.floor(r() * 5)], selfCare: care, createdAt: d.getTime() + 23 * 3600e3, updatedAt: d.getTime() + 23 * 3600e3 });
    }
    if (r() < 0.4) thoughts.push({ id: uid(), text: ['Idea: an n8n template store for Indian D2C brands #idea #startup', 'Founders reply more to short DMs with one clear ask. #sales', 'Felt scattered today; too many tabs. #reflection', 'Agent that drafts LinkedIn posts from my GitHub commits #idea #ai', 'Placement season is noisy. Keep the main thing the main thing. #focus'][Math.floor(r() * 5)], tags: [], mood: 1 + Math.floor(r() * 5), kind: r() < 0.5 ? 'idea' : 'note', createdAt: d.getTime() + 15 * 3600e3, updatedAt: d.getTime() + 15 * 3600e3 });
  }
  for (const t of thoughts) t.tags = [...new Set((t.text.match(/#[\w-]+/g) || []).map(x => x.slice(1)))];
  // today
  tasks.push(
    { id: uid(), title: 'Post on LinkedIn', durationMin: 20, goalId: 'g-client', priority: 2, dueDate: tk, dueTime: '18:00', reminder: true, status: 'open', createdAt: now, updatedAt: now },
    { id: uid(), title: 'Send 3 cold DMs', durationMin: 15, goalId: 'g-client', priority: 3, dueDate: tk, dueTime: null, reminder: false, status: 'open', createdAt: now, updatedAt: now },
    { id: uid(), title: 'Gym session', durationMin: 60, goalId: 'g-gym', priority: 2, dueDate: tk, dueTime: '07:30', reminder: false, status: 'done', doneAt: now - 3600e3, createdAt: now, updatedAt: now },
    { id: uid(), title: 'DSA: 2 problems', durationMin: 45, priority: 2, dueDate: tk, dueTime: '22:00', reminder: true, status: 'open', createdAt: now, updatedAt: now },
    { id: uid(), title: 'Placement prep: aptitude', durationMin: 30, priority: 1, dueDate: keyAdd(tk, -1), dueTime: null, reminder: false, status: 'open', createdAt: now - 864e5, updatedAt: now - 864e5 },
  );
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const existing = new Set(all('tasks').filter(t => t.dueDate === tk).map(t => norm(t.title)));
  const seen = new Set();
  const deduped = tasks.filter(t => { if (t.dueDate !== tk) return true; const k = norm(t.title); if (existing.has(k) || seen.has(k)) return false; seen.add(k); return true; });
  tasks.length = 0; tasks.push(...deduped);
  const haveGoals = new Set(all('goals').map(g => norm(g.title)));
  for (let i = goals.length - 1; i >= 0; i--) if (haveGoals.has(norm(goals[i].title))) {
    const mine = all('goals').find(g => norm(g.title) === norm(goals[i].title));
    for (const t of tasks) if (t.goalId === goals[i].id) t.goalId = mine.id; // link history to the goal he already has
    if (!(mine.milestones || []).length) await putRaw('goals', [{ ...mine, why: mine.why || goals[i].why, milestones: goals[i].milestones, actions: (mine.actions || []).length ? mine.actions : goals[i].actions, updatedAt: Date.now() }]);
    goals.splice(i, 1);
  }
  await putRaw('goals', goals); await putRaw('tasks', tasks); await putRaw('checkins', checkins); await putRaw('thoughts', thoughts);
  emitExternal();
  return { tasks: tasks.length, checkins: checkins.length, thoughts: thoughts.length };
}
