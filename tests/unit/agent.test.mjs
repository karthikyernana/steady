import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, compactContext, buildPrompt, validatePlan, rulesPlan, learn, missing, zonedNow, RESPONSE_SCHEMA, ACTION_SCHEMA, ACTION_TYPES, MAX_ACTIONS } from '../../js/core/agent.js';

const data = {
  tasks: [{ id: 'task-dsa', title: 'DSA: 2 problems', status: 'open', dueDate: '2026-10-19', createdAt: 1 },
    { id: 'task-li', title: 'Post on LinkedIn', status: 'open', dueDate: '2026-10-19', createdAt: 2, goalId: 'g-client' },
    { id: 'old', title: 'Old done', status: 'done', doneAt: Date.parse('2026-10-18T10:00:00Z'), createdAt: 0 }],
  goals: [{ id: 'g-client', title: 'Land my first paying client', milestones: [{ id: 'm3', title: '30 cold DMs to founders', week: '2026-10-12', done: false }, { id: 'm1', title: 'Portfolio live', done: true }], actions: [{ id: 'a1', title: 'Send 3 cold DMs' }] },
    { id: 'g-gym', title: 'Gym 4x a week', milestones: [], actions: [{ id: 'a3', title: 'Gym session' }] }],
  money: [{ id: 'x1', date: '2026-10-18', kind: 'expense', amount: 120, category: 'Food', note: 'Lunch', createdAt: 1 }],
  thoughts: [{ id: 'th', text: 'ship the money tab', createdAt: 1 }], profile: { name: 'Karthik', wake: '08:00', sleep: '01:00' }, settings: {},
};
const NOW = zonedNow('Asia/Kolkata', new Date('2026-10-19T09:30:00Z'));   // 15:00 IST, Monday
const ctx = buildContext(data, { today: '2026-10-19' });
const C = compactContext(ctx, { categories: { Snacks: 3 }, payees: { swiggy: { name: 'Swiggy', category: 'Food', n: 4 } }, corrections: [{ w: 'chai', c: 'Snacks' }] }, NOW);
const blank = { title: null, date: null, time: null, duration_min: null, priority: null, amount: null, money_kind: null, category: null, payee: null, note: null, thought_kind: null, mood: null, target: null, milestone: null, goal: null, milestones: [], mark_milestone_done: null, confidence: 0.9, evidence: '' };
const plan = (...actions) => validatePlan({ language: 'en', clarification: null, actions: actions.map(a => ({ ...blank, ...a })) }, C);

test('time is resolved in Asia/Kolkata, not the server zone', () => {
  assert.deepEqual([NOW.date, NOW.time, NOW.weekday], ['2026-10-19', '15:00', 'Monday']);
  assert.equal(zonedNow('Asia/Kolkata', new Date('2026-10-19T19:00:00Z')).date, '2026-10-20');   // 00:30 IST next day
});
test('context: open tasks + undone milestones only, bounded, real ids stay out of the prompt', () => {
  assert.equal(ctx.tasks.length, 2); assert.equal(ctx.goals[0].milestones.length, 1); assert.equal(ctx.done.length, 1);
  const { user, system } = buildPrompt('hi', C);
  assert.ok(!user.includes('task-dsa') && !user.includes('g-client') && !user.includes('m3'), 'ids must not reach the model');
  assert.match(user, /"ref":"t1"/); assert.match(user, /"ref":"g1m1"/); assert.match(user, /Mon 2026-10-19 \(today\)/);
  assert.match(user, /chai → Snacks/); assert.match(user, /Swiggy → Food/); assert.ok(system.length < 6000);
});
test('context from the browser is untrusted: junk is dropped and clipped', () => {
  const c = compactContext({ tasks: [{ id: 5, title: 'x' }, { id: 'ok', title: 'y'.repeat(500), due: 'not a date' }], goals: 'nope', money: [{ amount: 'abc' }] }, null, NOW);
  assert.equal(c.prompt.openTasks.length, 1); assert.ok(c.prompt.openTasks[0].title.length <= 90); assert.equal(c.prompt.openTasks[0].due, null);
  assert.deepEqual(c.prompt.goals, []); assert.deepEqual(c.prompt.money.recent, []);
});
test('schema: every action field is required (strict mode) and types are the shared list', () => {
  assert.deepEqual(Object.keys(ACTION_SCHEMA.properties).sort(), [...ACTION_SCHEMA.required].sort());
  assert.deepEqual(ACTION_SCHEMA.properties.type.enum, ACTION_TYPES);
  assert.equal(RESPONSE_SCHEMA.properties.actions.maxItems, MAX_ACTIONS);
  assert.deepEqual(Object.keys(RESPONSE_SCHEMA.properties).at(-1), 'actions');
});
test('validate: refs map back to real ids; invented refs never touch data', () => {
  const v = plan({ type: 'complete', target: 't1' }, { type: 'complete', target: 't99', title: 'post on linkedin' }, { type: 'complete', target: 'g1' });
  assert.equal(v.drafts[0].f.taskId, 'task-dsa');
  assert.equal(v.drafts[1].f.taskId, 'task-li', 'bad ref falls back to a confident title match');
  assert.equal(v.drafts.length, 2, 'a goal ref is not a task, and with no words to match it is dropped');
  assert.deepEqual(v.dropped, [{ reason: 'complete without target' }]);
});
test('validate: progress on a goal, milestone only if it belongs to that goal', () => {
  const v = plan({ type: 'progress', target: 'g1', milestone: 'g1m1', mark_milestone_done: true, title: 'sent 30 DMs' }, { type: 'progress', target: 'g2', milestone: 'g1m1', mark_milestone_done: true, title: 'x' });
  assert.deepEqual([v.drafts[0].f.goalId, v.drafts[0].f.milestoneId, v.drafts[0].f.markMilestone], ['g-client', 'm3', true]);
  assert.equal(v.drafts[1].f.goalId, 'g-client', 'a milestone pulls the action onto its own goal');
});
test('validate: progress pointed at a task is a completion', () => {
  const v = plan({ type: 'progress', target: 't1', title: 'Completed DSA problems' });
  assert.equal(v.drafts[0].type, 'complete'); assert.equal(v.drafts[0].f.taskId, 'task-dsa');
});
test('validate: money is clamped and categorized; missing amount is flagged, not invented', () => {
  const v = plan({ type: 'money', amount: 250.456, category: 'food', note: 'lunch', evidence: 'lunch 250' }, { type: 'money', amount: -5, note: 'chai', evidence: 'chai' }, { type: 'money', amount: 1e12, evidence: 'x' });
  assert.deepEqual([v.drafts[0].f.amount, v.drafts[0].f.category, v.drafts[0].f.kind, v.drafts[0].f.date], [250.46, 'Food', 'expense', '2026-10-19']);
  assert.deepEqual(v.drafts[1].needs, ['amount']); assert.equal(v.drafts[1].f.amount, null);
  assert.deepEqual(v.drafts[2].needs, ['amount']);
});
test('validate: bad dates/times, reminder without a time, unknown types, duplicates, cap', () => {
  const v = plan({ type: 'reminder', title: 'call amma', time: '25:99', date: '2026-02-31' }, { type: 'hack', title: 'x' }, { type: 'task', title: 'a' }, { type: 'task', title: 'a' }, { type: 'task', title: '' });
  assert.equal(v.drafts.length, 2);
  assert.deepEqual(v.drafts[0].needs, ['time']); assert.equal(v.drafts[0].f.dueDate, '2026-10-19'); assert.ok(v.drafts[0].warnings.includes('date'));
  assert.deepEqual(v.dropped.map(d => d.reason).sort(), ['duplicate', 'task without title', 'unknown type']);
  const many = plan(...Array.from({ length: 12 }, (_, i) => ({ type: 'thought', note: `t${i}` })));
  assert.equal(many.drafts.length, MAX_ACTIONS);
});
test('validate: tolerates "action_type" instead of "type" (seen from sarvam-105b JSON mode)', () => {
  const v = validatePlan({ actions: [{ action_type: 'money', amount: 250, category: 'Food', evidence: 'lunch 250' }] }, C);
  assert.equal(v.drafts[0].type, 'money'); assert.equal(v.drafts[0].f.amount, 250);
});
test('validate: garbage model output yields nothing, never throws', () => {
  for (const raw of [null, 'x', { actions: 'no' }, { actions: [null, 1, 'a', { type: 'money' }] }]) assert.doesNotThrow(() => validatePlan(raw, C));
  assert.equal(validatePlan({ actions: [{ type: 'money' }] }, C).drafts[0].needs[0], 'amount');
});
test('missing() re-checks edited drafts before Accept', () => {
  assert.deepEqual(missing({ type: 'money', f: { amount: 0, category: 'Food', date: '2026-10-19' } }), ['amount']);
  assert.deepEqual(missing({ type: 'reminder', f: { title: 'x', dueTime: null, dueDate: '2026-10-19' } }), ['time']);
  assert.deepEqual(missing({ type: 'task', f: { title: 'x', dueDate: '2026-10-19' } }), []);
});

const R = text => validatePlan(rulesPlan(text, C), C).drafts;
test('rules planner: multiple intents from one utterance (English)', () => {
  const d = R('spent 250 on lunch at swiggy and finished the DSA problems, remind me to call amma tomorrow at 6pm');
  assert.deepEqual(d.map(x => x.type), ['money', 'complete', 'reminder']);
  assert.equal(d[1].f.taskId, 'task-dsa'); assert.deepEqual([d[2].f.dueDate, d[2].f.dueTime, d[2].f.title], ['2026-10-20', '18:00', 'Call amma']);
});
test('rules planner: Telugu-English code-mix and Telugu numbers', () => {
  const [m] = R('ivala 500 petrol ki karchu ayyindi'); assert.deepEqual([m.type, m.f.amount, m.f.category], ['money', 500, 'Transport']);
  const [n] = R('ఐదు వందలు పెట్రోల్ కి ఖర్చు'); assert.deepEqual([n.type, n.f.amount], ['money', 500]);
  const [c] = R('DSA problems chesanu'); assert.equal(c.type, 'complete'); assert.equal(c.f.taskId, 'task-dsa');
});
test('rules planner: progress, goal, thought, same-as-yesterday, learned correction', () => {
  assert.equal(R('sent 3 cold DMs today')[0].type, 'progress');
  const g = R('my goal is to crack a product role by 30 dec')[0]; assert.deepEqual([g.type, g.f.title, g.f.target], ['goal', 'Crack a product role', '2026-12-30']);
  const t = R('idea: a voice-first habit app')[0]; assert.deepEqual([t.type, t.f.kind], ['thought', 'idea']);
  const s = R('lunch same as yesterday')[0]; assert.deepEqual([s.f.amount, s.f.category, s.f.date], [120, 'Food', '2026-10-19']);
  assert.equal(R('chai 30 rupees')[0].f.category, 'Snacks');
  const k = R('gym tomorrow 6am 45m')[0]; assert.deepEqual([k.type, k.f.dueTime, k.f.durationMin, k.f.goalId], ['task', '06:00', 45, 'g-gym']);
});
test('learning: categories, payees, and the wording behind a correction', () => {
  const before = { type: 'money', evidence: 'rapido 80', f: { kind: 'expense', amount: 80, category: 'Other', payee: 'Rapido', note: 'Rapido' } };
  const after = { type: 'money', f: { ...before.f, category: 'Transport' } };
  const m = learn(null, [{ before, after }, { before: null, after: { type: 'task', f: { title: 'x' } } }, { after: { type: 'evil' } }]);
  assert.equal(m.accepted, 2); assert.equal(m.edited, 1); assert.equal(m.categories.Transport, 1);
  assert.deepEqual(m.payees.rapido.category, 'Transport'); assert.deepEqual(m.corrections[0], { w: 'rapido', c: 'Transport', at: m.corrections[0].at });
  const again = learn(m, [{ before, after: { ...after, f: { ...after.f, category: 'Commute' } } }]);
  assert.equal(again.corrections.filter(x => x.w === 'rapido').length, 1); assert.equal(again.corrections[0].c, 'Commute');
});

// v1.4: "remind me in 5 minutes" must become a real clock time (the model returns an offset; the app does the maths)
test('in_minutes and "reminder for N minutes" become an exact time in his zone', async () => {
  const { compactContext, validatePlan, rulesPlan, zonedNow } = await import('../../js/core/agent.js');
  const now = zonedNow('Asia/Kolkata', new Date('2026-10-20T09:39:40Z'));   // 15:09:40 IST
  const c = compactContext({ tz: 'Asia/Kolkata', tasks: [], goals: [], money: [], categories: [], thoughts: [], profile: {} }, null, now);
  const A = o => ({ type: 'reminder', title: 'Drink water', date: null, time: null, in_minutes: null, duration_min: null, priority: null, confidence: 0.9, evidence: '', ...o });
  const one = acts => validatePlan({ actions: acts }, c).drafts[0].f;
  let f = one([A({ in_minutes: 5 })]); assert.equal(f.dueTime, '15:15'); assert.equal(f.dueDate, '2026-10-20'); assert.equal(f.reminder, true);
  f = one([A({ duration_min: 5 })]); assert.equal(f.dueTime, '15:15'); assert.equal(f.durationMin, null);
  f = one([A({ in_minutes: 600 })]); assert.equal(f.dueDate, '2026-10-21'); assert.equal(f.dueTime, '01:10');
  f = one([A({ time: '19:00', duration_min: 20 })]); assert.equal(f.dueTime, '19:00'); assert.equal(f.durationMin, 20);
  const r = t => validatePlan(rulesPlan(t, c), c).drafts[0].f;
  assert.equal(r('set a reminder for 5 minutes').dueTime, '15:15');
  assert.equal(r('set an alarm for 30 min').dueTime, '15:40');
  assert.equal(r('remind me to call amma in 10 minutes').title, 'Call amma');
});
