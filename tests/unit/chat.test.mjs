// Chat agent, pure parts: read-only tools over in-memory rows, the card schema (strict, repairing), the
// query-not-numbers rule, resolution, and the model router's fallback (against the local AI mock).
import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, runTool, resolveRange, shiftToZone, zoned, toolSchemas } from '../../server/chat-tools.js';
import { validateCard, validateCards, resolveCards, MAX_CARDS, COMPONENTS, fmt } from '../../server/chat-cards.js';
import { createMock } from '../mocks/ai-mock.mjs';

const TZ = 'Asia/Kolkata';
const today = '2026-10-20';                     // a Tuesday
const at = Date.parse('2026-10-20T14:00:00+05:30');
const ist = (d, t = '10:00') => Date.parse(`${d}T${t}:00+05:30`);
const DATA = {
  tasks: [
    { id: 't1', title: 'DSA: 2 problems', status: 'done', dueDate: '2026-10-19', doneAt: ist('2026-10-19', '09:15'), goalId: 'g1' },
    { id: 't2', title: 'Post on LinkedIn', status: 'open', dueDate: '2026-10-20', dueTime: '18:00', goalId: 'g1' },
    { id: 't3', title: 'Gym', status: 'done', dueDate: '2026-10-20', doneAt: ist('2026-10-20', '07:30') },
    { id: 't4', title: 'Pay rent', status: 'open', dueDate: '2026-10-25' },
    { id: 't5', title: 'Old thing', status: 'skipped', dueDate: '2026-10-01' },
  ],
  goals: [{ id: 'g1', title: 'Internship by Dec', milestones: [{ id: 'm1', title: 'Portfolio', week: '2026-10-12', done: true }, { id: 'm2', title: 'Apply 10', week: '2026-10-19', done: false }] }],
  money: [
    { id: 'm1', kind: 'expense', amount: 250, category: 'Food', payee: 'Swiggy', note: 'Lunch', date: '2026-10-20' },
    { id: 'm2', kind: 'expense', amount: 80, category: 'Transport', payee: 'Rapido', date: '2026-10-19' },
    { id: 'm3', kind: 'expense', amount: 120.5, category: 'Food', date: '2026-10-14' },
    { id: 'm4', kind: 'income', amount: 5000, category: 'Stipend', date: '2026-10-01' },
    { id: 'm5', kind: 'expense', amount: 999, category: 'Shopping', date: '2026-09-30' },
  ],
  thoughts: [{ id: 'h1', text: 'idea: weekly money summary #steady', tags: ['steady'], mood: 4, kind: 'idea', createdAt: ist('2026-10-18') }],
  checkins: [],
};
const ctx = { load: async c => DATA[c] || [], sql: async () => ({ rows: [] }), today, tz: TZ, at };
const run = (tool, params) => runTool(tool, params, ctx);

test('ranges resolve in the user\'s calendar (weeks start Monday)', () => {
  assert.deepEqual(resolveRange({ range: 'this_week' }, today), { from: '2026-10-19', to: '2026-10-25' });
  assert.deepEqual(resolveRange({ range: 'last_week' }, today), { from: '2026-10-12', to: '2026-10-18' });
  assert.deepEqual(resolveRange({ range: 'last_month' }, today), { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(resolveRange({ from: '2026-10-10', to: '2026-10-01' }, today), { from: '2026-10-01', to: '2026-10-10' });
  assert.equal(resolveRange({ range: 'all' }, today), null);
  assert.equal(resolveRange({ from: '2020-01-01' }, today).from, '2024-10-19', 'spans are capped at ~2 years');
  assert.equal(zoned(Date.parse('2026-10-19T20:00:00Z'), TZ).date, '2026-10-20', '01:30 IST is already the next day');
});

test('query_money: totals, groups (with sums) and filters from real rows only', async () => {
  const r = await run('query_money', { range: 'this_month', group_by: 'category' });
  assert.equal(r.total, 450.5); assert.equal(r.count, 3);
  assert.deepEqual(r.groups.map(g => [g.key, g.sum, g.count]), [['Food', 370.5, 2], ['Transport', 80, 1]]);
  assert.equal((await run('query_money', { kind: 'income', range: 'this_month' })).total, 5000);
  assert.equal((await run('query_money', { range: 'this_week', category: 'food' })).total, 250);
  const days = await run('query_money', { range: 'this_week', group_by: 'day' });
  assert.equal(days.groups.length, 7, 'every day of the period, zero-filled'); assert.equal(days.groups[0].sum, 80);
  assert.equal((await run('query_money', { range: 'nonsense', limit: 999 })).items.length <= 50, true, 'params are clamped');
});

test('query_tasks: status, due vs done day, goal and grouping', async () => {
  const open = await run('query_tasks', { status: 'open' });
  assert.deepEqual(open.items.map(t => t.id), ['t2', 't4']);
  const done = await run('query_tasks', { status: 'done', range: 'this_week', group_by: 'weekday' });
  assert.equal(done.count, 2); assert.equal(done.groups[0].count, 1); assert.equal(done.groups[1].count, 1);
  assert.equal((await run('query_tasks', { goal: 'internship' })).count, 2);
  assert.equal((await run('query_tasks', { goal: 'no such goal' })).count, 0, 'an unknown goal matches nothing (not everything)');
  const hours = await run('query_tasks', { status: 'done', range: 'this_week', group_by: 'hour' });
  assert.equal(hours.groups[9].count, 1); assert.equal(hours.groups[7].count, 1);
});

test('query_goals, query_thoughts and get_insights_summary', async () => {
  const g = await run('query_goals', {});
  assert.equal(g.goals[0].done, 1); assert.equal(g.goals[0].total, 2); assert.equal(g.goals[0].tasks_done_this_week, 1); assert.equal(g.progress, 0.5);
  const t = await run('query_thoughts', { group_by: 'tag' });
  assert.equal(t.count, 1); assert.deepEqual(t.groups.map(x => x.key), ['steady']);
  const s = await run('get_insights_summary', {});
  assert.equal(s.done_this_week, 2); assert.equal(s.spent_this_week, 330); assert.equal(s.streak_current, 2); assert.equal(s.milestones_total, 2);
  assert.ok(Array.isArray(s.learned));
  assert.deepEqual(await run('drop_tables', {}), { error: 'unknown tool drop_tables' });
});

test('shiftToZone makes process-local getters read the user\'s wall clock', () => {
  const ms = Date.parse('2026-10-19T20:00:00Z');          // 01:30 IST on the 20th
  const d = new Date(shiftToZone(ms, TZ));
  assert.equal(d.getDate(), 20); assert.equal(d.getHours(), 1); assert.equal(d.getMinutes(), 30);
});

test('tool schemas are OpenAI-style function declarations, read tools only', () => {
  const names = toolSchemas().map(t => t.function.name);
  assert.deepEqual(names, ['query_tasks', 'query_goals', 'query_money', 'query_thoughts', 'search_thoughts', 'get_insights_summary']);
  assert.ok(!names.some(n => /add|create|update|delete|write|complete/.test(n)));
});

test('card schema: fixed kit, unknown components and tools dropped, extras stripped', () => {
  const { cards, dropped } = validateCards([
    { component: 'Html', html: '<script>alert(1)</script>' },
    { component: 'bar', title: '<b>Spend</b>', query: { tool: 'query_money', params: { range: 'this_month', group_by: 'category' } }, bind: { y: 'sum' }, onClick: 'x()' },
    { component: 'Line', query: { tool: 'rm_rf', params: {} } },
    { component: 'TaskList', query: { tool: 'query_money', params: {} } },
  ], { today });
  assert.equal(cards.length, 1); assert.deepEqual(dropped.map(d => d.index), [0, 2, 3]);
  assert.deepEqual(cards[0], { id: 'c1', component: 'Bar', title: 'Spend', bind: { y: 'sum' }, query: { tool: 'query_money', params: { kind: 'expense', group_by: 'category', from: '2026-10-01', to: '2026-10-31' } } });
  assert.equal(COMPONENTS.length, 11);
});

test('card schema repairs: missing group_by, bad bind, relative ranges frozen, caps', () => {
  const line = validateCard({ component: 'Line', query: { tool: 'query_money', params: { range: 'last_7_days', group_by: 'category' } }, bind: { y: 'banana' } }, { today }).card;
  assert.equal(line.query.params.group_by, 'day'); assert.equal(line.bind.y, 'sum');
  assert.deepEqual([line.query.params.from, line.query.params.to], ['2026-10-14', '2026-10-20']);
  const heat = validateCard({ component: 'Heatmap', query: { tool: 'query_tasks', params: { status: 'done' } } }, { today }).card;
  assert.equal(heat.query.params.group_by, 'day'); assert.equal(heat.query.params.from, '2026-07-23');
  const open = validateCard({ component: 'TaskList', query: { tool: 'query_tasks', params: { status: 'open', limit: 99 } } }, { today }).card;
  assert.equal(open.query.params.range, 'all'); assert.equal(open.query.params.limit, 20);
  const tbl = validateCard({ component: 'Table', query: { tool: 'query_money', params: {} }, bind: { columns: ['amount', 'password', 'note', 'amount'] } }, { today }).card;
  assert.deepEqual(tbl.bind, { rows: 'items', columns: ['amount', 'note'] });
  const many = validateCards(Array.from({ length: 9 }, () => ({ component: 'Callout', text: 'Steady wins.' })), { today });
  assert.equal(many.cards.length, MAX_CARDS); assert.equal(many.dropped.length, 9 - MAX_CARDS);
  assert.equal(validateCard({ component: 'Callout', text: 'Steady.', tone: 'party' }, { today }).card.tone, 'info');
});

test('query-not-numbers: numbers the model writes into a card never survive', async () => {
  const raw = { component: 'Stat', title: 'Spent', value: 999999, display: '₹9,99,999', data: { value: 1 }, query: { tool: 'query_money', params: { range: 'this_month' } }, bind: { value: 'total', number: 42 } };
  const { card } = validateCard(raw, { today });
  assert.ok(!JSON.stringify(card).includes('999999') && !JSON.stringify(card).includes('42'), JSON.stringify(card));
  const [res] = await resolveCards([card], run);
  assert.equal(res.data.value, 450.5); assert.equal(res.data.display, fmt(450.5, 'inr'));
  const donut = validateCard({ component: 'Donut', data: { points: [{ label: 'Fake', value: 123456 }] }, values: [1, 2], query: { tool: 'query_money', params: { range: 'this_month' } } }, { today }).card;
  const [d] = await resolveCards([donut], run);
  assert.deepEqual(d.data.points.map(p => [p.label, p.value]), [['Food', 370.5], ['Transport', 80]]);
  assert.ok(!JSON.stringify(d).includes('123456') && !JSON.stringify(d).includes('Fake'));
  // free-text cards may not smuggle figures either
  assert.match(validateCard({ component: 'Note', text: 'You spent ₹5,000 on food' }, { today }).error, /figures/);
  assert.match(validateCard({ component: 'Callout', text: 'Up 40% this week' }, { today }).error, /figures/);
});

test('resolution follows the data: same spec, new rows, new numbers', async () => {
  const { card } = validateCard({ component: 'Stat', query: { tool: 'query_money', params: { range: 'this_week' } }, bind: { value: 'total' }, compare: { params: { range: 'last_week' }, label: 'last week' } }, { today });
  const [a] = await resolveCards([card], run);
  assert.equal(a.data.value, 330); assert.equal(a.data.compare.value, 120.5); assert.equal(a.data.compare.delta, 209.5);
  DATA.money.push({ id: 'm6', kind: 'expense', amount: 70, category: 'Food', date: '2026-10-20' });
  try { const [b] = await resolveCards([card], run); assert.equal(b.data.value, 400); }
  finally { DATA.money.pop(); }
});

test('every component resolves to its documented data shape', async () => {
  const specs = [
    { component: 'Stat', query: { tool: 'get_insights_summary', params: {} }, bind: { value: 'streak_current' } },
    { component: 'Line', query: { tool: 'query_money', params: { range: 'this_week', group_by: 'day' } } },
    { component: 'Bar', query: { tool: 'query_tasks', params: { status: 'done', range: 'this_week', group_by: 'weekday' } } },
    { component: 'Donut', query: { tool: 'query_money', params: { range: 'this_month' } } },
    { component: 'Heatmap', query: { tool: 'query_tasks', params: { status: 'done', range: 'last_30_days' } } },
    { component: 'ProgressList', query: { tool: 'query_goals', params: {} } },
    { component: 'TaskList', query: { tool: 'query_tasks', params: { status: 'open' } } },
    { component: 'Timeline', query: { tool: 'query_money', params: { range: 'this_week' } } },
    { component: 'Table', query: { tool: 'query_money', params: { range: 'this_month', group_by: 'category' } }, bind: { rows: 'groups', columns: ['label', 'sum'] } },
    { component: 'Note', title: 'Note', text: 'Keep it small.' },
    { component: 'Callout', tone: 'warn', text: 'Heavy week.' },
  ].map((c, i) => validateCard(c, { today, index: i }).card);
  assert.equal(specs.filter(Boolean).length, 11);
  const out = await resolveCards(specs, run);
  const [stat, line, bar, donut, heat, prog, list, tl, table, note, callout] = out.map(c => c.data);
  assert.equal(stat.display, '2 days');
  assert.equal(line.points.length, 7); assert.equal(line.total, 330);
  assert.equal(bar.points.length, 7); assert.equal(bar.points[0].label, 'Mon');
  assert.equal(donut.points[0].label, 'Food');
  assert.equal(heat.days.length, 30); assert.equal(heat.max, 1);
  assert.deepEqual(prog.items.map(x => x.display), ['1/2']);
  assert.deepEqual(list.items.map(x => x.title), ['Post on LinkedIn', 'Pay rent']);
  assert.deepEqual(tl.items.map(x => x.date), ['2026-10-19', '2026-10-20']);
  assert.deepEqual(table.columns.map(c => c.label), ['Category', 'Total']); assert.equal(table.rows[0][0], 'Food');
  assert.equal(note.text, 'Keep it small.'); assert.equal(callout.tone, 'warn');
  // a card whose data cannot be read degrades to an empty card instead of failing the reply
  const [bad] = await resolveCards([specs[1]], async () => { throw new Error('db down'); });
  assert.equal(bad.data.empty, true);
});

test('router: comma-separated keys rotate; a 429 parks that key and the next one answers', async () => {
  const keep = { ...process.env };
  Object.assign(process.env, { GROQ_API_KEY: 'k1, k2', CEREBRAS_API_KEY: 'c1', OPENROUTER_API_KEY: 'o1' });
  try {
    const { providers, parkProvider, resetCooldowns } = await import('../../server/chat.js');
    resetCooldowns();
    const names = providers().map(p => p.name);
    assert.deepEqual(names.slice(0, 5), ['groq', 'groq#2', 'cerebras', 'groq-20b', 'groq-20b#2']);
    assert.ok(names.includes('openrouter'));
    assert.deepEqual(providers().filter(p => p.name.startsWith('groq')).map(p => p.key).slice(0, 2), ['k1', 'k2']);
    parkProvider('groq', 30_000); resetCooldowns();
  } finally { process.env = keep; }
});

test('router: Groq first, falls back to Gemini then Cloudflare; none → graceful 502', async () => {
  const mock = createMock(); const port = await mock.listen();
  const keep = { ...process.env };
  Object.assign(process.env, { GROQ_API_KEY: 'g', GROQ_BASE_URL: `http://127.0.0.1:${port}/openai/v1`, GEMINI_API_KEY: 'm', GEMINI_BASE_URL: `http://127.0.0.1:${port}`,
    CF_ACCOUNT_ID: 'acc', CF_API_TOKEN: 'cf', CF_BASE_URL: `http://127.0.0.1:${port}/client/v4` });
  try {
    const { runChain, providers, chatConfig, systemPrompt, MAX_TOOL_STEPS, resetCooldowns } = await import('../../server/chat.js');
    resetCooldowns();
    assert.deepEqual(chatConfig(), { on: true, providers: ['groq', 'groq-20b', 'gemini', 'groq-qwen', 'cloudflare'] });
    assert.equal(providers()[0].model, 'openai/gpt-oss-120b');
    const base = [{ role: 'system', content: systemPrompt({ weekday: 'Tuesday', date: today, time: '14:00', tz: TZ }) }, { role: 'user', content: 'how much did I spend this month' }];
    const a = await runChain(base, ctx);
    assert.equal(a.provider, 'groq'); assert.deepEqual(a.tools, ['query_money']); assert.equal(a.steps, 1);
    assert.match(a.text, /₹450\.5/, 'text quotes the tool figure');
    const groqCall = mock.calls.find(c => c.provider === 'groq');
    assert.equal(groqCall.headers.authorization, 'Bearer g'); assert.equal(groqCall.body.reasoning_effort, 'low');
    assert.ok(groqCall.body.tools.some(t => t.function.name === 'reply'));
    mock.state.chat.groq = 429;
    const b = await runChain(base, ctx);
    assert.equal(b.provider, 'gemini'); assert.match(b.errors[0], /groq 429/);
    mock.state.chat.gemini = 503;
    assert.equal((await runChain(base, ctx)).provider, 'cloudflare');
    mock.state.chat.cloudflare = 500;
    await assert.rejects(runChain(base, ctx), e => e.status === 502 && /could not reach a model/.test(e.message));
    mock.state.chat = { groq: 200, gemini: 200, cloudflare: 200 }; resetCooldowns();
    // a model that never stops calling tools is cut off after MAX_TOOL_STEPS rounds and forced to reply
    mock.calls.length = 0;
    const loop = await runChain([base[0], { role: 'user', content: 'loop forever' }], ctx);
    assert.equal(loop.steps, MAX_TOOL_STEPS); assert.equal(mock.calls.length, MAX_TOOL_STEPS + 1);
    assert.equal(mock.calls.at(-1).body.tool_choice.function.name, 'reply');
    // a model that answers in plain content (no reply tool) still gives text
    assert.equal((await runChain([base[0], { role: 'user', content: 'just text' }], ctx)).text, 'Plain words only, no tools.');
    delete process.env.GROQ_API_KEY; delete process.env.GEMINI_API_KEY; delete process.env.CF_API_TOKEN;
    assert.deepEqual(chatConfig(), { on: false, providers: [] });
  } finally { process.env = keep; await mock.close(); }
});
