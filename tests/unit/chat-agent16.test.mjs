// Chat 1.6: zero-filled series, Stat compare + trend, the deterministic UI layer (auto cards), suggestions, search
// (RRF + in-memory fallback), the single system prompt with bounded slots, compact tool results.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runTool } from '../../server/chat-tools.js';
import { validateCard, validateCards, resolveCards, pickCards, hasDataCard, cleanSuggestions, fallbackSuggestions, previousPeriod } from '../../server/chat-cards.js';
import { rrf, terms, tsQuery, rankInMemory } from '../../server/chat-search.js';
import { systemPrompt, formatProfile } from '../../server/chat-prompt.js';
import { finishReply, compactResult } from '../../server/chat.js';

const TZ = 'Asia/Kolkata', today = '2026-10-20';          // a Tuesday
const ist = (d, t = '10:00') => Date.parse(`${d}T${t}:00+05:30`);
const DATA = {
  tasks: [
    { id: 't1', title: 'DSA: 2 problems', status: 'done', dueDate: '2026-10-19', doneAt: ist('2026-10-19', '09:15') },
    { id: 't2', title: 'Post on LinkedIn', status: 'open', dueDate: '2026-10-20', dueTime: '18:00' },
    { id: 't3', title: 'Gym', status: 'done', dueDate: '2026-10-20', doneAt: ist('2026-10-20', '07:30') },
    { id: 't4', title: 'Visa documents', notes: 'passport photo', status: 'done', dueDate: '2026-10-15', doneAt: ist('2026-10-15', '11:00') },
  ],
  goals: [{ id: 'g1', title: 'Internship by Dec', milestones: [{ title: 'Portfolio', done: true }, { title: 'Apply 10', done: false }] }],
  money: [
    { id: 'm1', kind: 'expense', amount: 250, category: 'Food', payee: 'Swiggy', note: 'Lunch', date: '2026-10-20' },
    { id: 'm2', kind: 'expense', amount: 80, category: 'Transport', payee: 'Rapido', date: '2026-10-19' },
    { id: 'm3', kind: 'expense', amount: 120, category: 'Food', date: '2026-10-13' },
  ],
  thoughts: [
    { id: 'h1', text: 'pricing idea: weekly money summary #steady', tags: ['steady'], kind: 'idea', createdAt: ist('2026-10-18') },
    { id: 'h2', text: 'felt tired after gym', tags: ['health'], kind: 'journal', createdAt: ist('2026-10-12') },
  ],
  checkins: [], meta: [],
};
const ctx = { load: async c => DATA[c] || [], sql: async () => ({ rows: [] }), today, tz: TZ, at: ist(today, '14:00') };
const run = (tool, params) => runTool(tool, params, ctx);
const resolve = cards => resolveCards(cards, run, { today });

test('day charts carry every day of the period, zero days included, with labels and short labels', async () => {
  const { card } = validateCard({ component: 'Bar', query: { tool: 'query_tasks', params: { status: 'done', range: 'last_7_days', group_by: 'day' } }, bind: { y: 'count' } }, { today });
  const [r] = await resolve([card]);
  assert.equal(r.data.points.length, 7);
  assert.deepEqual(r.data.points.map(p => p.value), [0, 1, 0, 0, 0, 1, 1]);
  assert.ok(r.data.points.every(p => p.label && p.short && p.display != null));
  assert.equal(r.data.points[0].label, '14 Oct'); assert.equal(r.data.points[6].short, 'Tue');
  assert.equal(r.data.max, 1);
  // "all" period: filled from the first to the last day with data
  const all = await run('query_money', { range: 'all', group_by: 'day' });
  assert.equal(all.groups.length, 8); assert.equal(all.groups[1].sum, 0);
  // weeks with nothing logged are kept too
  const wk = await run('query_money', { from: '2026-09-28', to: '2026-10-20', group_by: 'week' });
  assert.deepEqual(wk.groups.map(g => [g.key, g.sum]), [['2026-09-28', 0], ['2026-10-05', 0], ['2026-10-12', 120], ['2026-10-19', 330]]);
});

test('a one-day day-chart becomes the 7 days ending that day', () => {
  const c = validateCard({ component: 'Bar', query: { tool: 'query_tasks', params: { status: 'done', range: 'today', group_by: 'day' } } }, { today }).card;
  assert.deepEqual([c.query.params.from, c.query.params.to], ['2026-10-14', '2026-10-20']);
});

test('Stat: automatic comparison with the period before (same elapsed days) and a 7-day trend', async () => {
  assert.deepEqual(previousPeriod({ from: today, to: today }, today), { params: { from: '2026-10-19', to: '2026-10-19' }, label: 'yesterday' });
  assert.deepEqual(previousPeriod({ from: '2026-10-19', to: '2026-10-25' }, today), { params: { from: '2026-10-12', to: '2026-10-13' }, label: 'same point last week' });
  assert.deepEqual(previousPeriod({ from: '2026-10-12', to: '2026-10-18' }, today), { params: { from: '2026-10-05', to: '2026-10-11' }, label: 'last week' });
  assert.deepEqual(previousPeriod({ from: '2026-10-01', to: '2026-10-31' }, today), { params: { from: '2026-09-01', to: '2026-09-20' }, label: 'last month to date' });
  assert.deepEqual(previousPeriod({ from: '2026-09-01', to: '2026-09-30' }, today).label, 'last month');
  const { card } = validateCard({ component: 'Stat', query: { tool: 'query_tasks', params: { status: 'done', range: 'today' } }, bind: { value: 'count' } }, { today });
  assert.equal(card.compare.label, 'yesterday');
  const [s] = await resolve([card]);
  assert.equal(s.data.value, 1); assert.equal(s.data.compare.value, 1); assert.equal(s.data.compare.delta, 0);
  assert.equal(s.data.trend.points.length, 7); assert.deepEqual(s.data.trend.points.slice(-2).map(p => p.value), [1, 1]);
  const money = (await resolve([validateCard({ component: 'Stat', query: { tool: 'query_money', params: { range: 'this_week' } }, bind: { value: 'total' } }, { today }).card]))[0];
  assert.equal(money.data.value, 330); assert.equal(money.data.compare.value, 120); assert.equal(money.data.compare.label, 'same point last week');
  assert.equal(money.data.trend.unit, 'inr');
  // compare: false keeps a bare figure; labels with figures are dropped (the model may not smuggle numbers in)
  const bare = validateCard({ component: 'Stat', compare: false, query: { tool: 'query_money', params: {} }, bind: { value: 'total', label: '₹ left of ₹2500' }, title: 'Budget ₹2500' }, { today }).card;
  assert.equal(bare.compare, undefined); assert.equal(bare.bind.label, undefined); assert.equal(bare.title, undefined);
});

test('deterministic UI layer: tool calls → the best card, no model involved', () => {
  const p = (name, params, out = { count: 2 }) => ({ name, params, out });
  const k = calls => pickCards(calls).map(c => c.component);
  assert.deepEqual(k([p('query_tasks', { status: 'done', range: 'today' })]), ['Stat']);
  assert.deepEqual(k([p('query_tasks', { status: 'open' })]), ['TaskList']);
  assert.deepEqual(k([p('query_tasks', { status: 'done', group_by: 'day' })]), ['Bar']);
  assert.deepEqual(k([p('query_tasks', { group_by: 'goal' })]), ['Donut']);
  assert.deepEqual(k([p('query_money', { range: 'this_week' }, { total: 3 })]), ['Stat']);
  assert.deepEqual(k([p('query_money', { group_by: 'category' })]), ['Donut']);
  assert.deepEqual(k([p('query_goals', {})]), ['ProgressList']);
  assert.deepEqual(k([p('search', { query: 'visa' })]), ['Timeline']);
  assert.deepEqual(k([p('search', { query: 'x' }, { count: 0 })]), [], 'nothing found → no empty card');
  assert.deepEqual(k([p('query_money', { range: 'this_week' }), p('query_money', { group_by: 'category' }), p('query_tasks', { status: 'open' })]), ['Donut', 'TaskList'], 'last calls first, one per tool, at most 2');
  assert.deepEqual(k([p('query_tasks', {}, { error: 'bad' })]), []);
  assert.equal(hasDataCard([{ component: 'Callout' }]), false); assert.equal(hasDataCard([{ component: 'Bar' }]), true);
});

test('finishReply: text-only answers about data get cards; small talk does not; suggestions cleaned or filled', () => {
  const calls = [{ name: 'query_tasks', params: { status: 'done', range: 'today' }, out: { count: 3 } }];
  const a = finishReply({ text: '3 done today.', cards: [], calls, tools: ['query_tasks'] }, { today, asked: 'How many tasks done today?' });
  assert.equal(a.auto, 1); assert.equal(a.cards[0].component, 'Stat'); assert.ok(a.cards[0].compare, 'with a comparison');
  assert.ok(a.suggestions.length >= 2 && a.suggestions.every(s => s.length <= 40));
  const b = finishReply({ text: 'Hi!', cards: [], calls: [], tools: [] }, { today, asked: 'hi' });
  assert.deepEqual([b.cards.length, b.auto, b.suggestions.length], [0, 0, 0]);
  const c = finishReply({ text: 'ok', cards: [{ component: 'Callout', text: 'Nice.' }], calls, tools: ['query_tasks'], suggestions: ['Compare with last week'] }, { today, asked: 'x' });
  assert.deepEqual(c.cards.map(x => x.component), ['Stat', 'Callout'], 'a Callout alone is not a data card');
  assert.deepEqual(c.suggestions, ['Compare with last week']);
  const d = finishReply({ text: 'ok', cards: [{ component: 'Bar', query: { tool: 'query_tasks', params: { status: 'done', group_by: 'day' } } }], calls, tools: ['query_tasks'] }, { today, asked: 'x' });
  assert.equal(d.auto, 0, 'the model\'s own data card is kept as is');
});

test('suggestions: ≤ 3, ≤ 40 chars, plain, no figures/links/duplicates, not the question again', () => {
  const out = cleanSuggestions(['  "Compare with last week"  ', '**Which goal is behind?**', 'Compare with last week', 'Spent ₹500 more?', 'see https://x.y',
    'How many tasks done today?', 'A very long suggestion that goes on and on about many things at once', 42, 'Show food by day'], { asked: 'how many tasks done today' });
  assert.deepEqual(out, ['Compare with last week', 'Which goal is behind?', 'A very long suggestion that goes on and']);
  assert.ok(out.every(s => s.length <= 40));
  assert.deepEqual(cleanSuggestions('nope'), ['nope']); assert.deepEqual(cleanSuggestions(null), []);
  assert.ok(fallbackSuggestions(['query_money']).includes('Compare with last month'));
});

test('search: RRF fuses ranked lists; terms are safe; in-memory fallback ranks across collections', async () => {
  assert.deepEqual(rrf([['a', 'b', 'c'], ['b', 'd']]).map(x => x.key), ['b', 'a', 'd', 'c']);
  assert.equal(rrf([['a'], ['a'], ['a']])[0].hits, 3);
  assert.deepEqual(terms('What did I write about Pricing & visa?!'), ['pricing', 'visa']);
  assert.equal(tsQuery("it's'); drop table x;--"), 'drop:* | table:*');
  assert.equal(rankInMemory([{ coll: 'tasks', title: 'Visa documents' }, { coll: 'thoughts', text: 'nothing' }], 'visa')[0].title, 'Visa documents');
  const r = await run('search', { query: 'visa passport' });
  assert.equal(r.count, 1); assert.equal(r.items[0].coll, 'tasks'); assert.equal(r.items[0].date, '2026-10-15');
  const m = await run('search', { query: 'swiggy', collections: ['money'] });
  assert.equal(m.items[0].amount, 250);
  const t = await run('search_thoughts', { query: 'pricing' });
  assert.equal(t.items[0].kind, 'idea', 'alias keeps the 1.5 thought shape');
  assert.equal((await run('search', { query: 'gym', range: 'last_7_days' })).count, 1, 'period filter (the journal line is older)');
  assert.match((await run('search', { query: 'a' })).error, /2 characters/);
  const [tl] = await resolve([validateCard({ component: 'Timeline', query: { tool: 'search', params: { query: 'swiggy lunch' } } }, { today }).card]);
  assert.equal(tl.data.items[0].title, 'Lunch'); assert.match(tl.data.items[0].sub, /Food/);
});

test('system prompt: one template, bounded slots, every section present', () => {
  const now = { weekday: 'Tuesday', date: today, time: '14:00', tz: TZ };
  const big = { counts: { tasks: 99999, goals: 3, money: 5, thoughts: 7 }, today: { done: 2, open: 3, overdue: 1 }, goals: Array.from({ length: 50 }, (_, i) => `Goal ${i} ${'x'.repeat(200)}`),
    tags: Array.from({ length: 50 }, (_, i) => `tag${i}`), categories: Array.from({ length: 50 }, (_, i) => `Cat${i}`), budget: true };
  const small = systemPrompt(now, { counts: {}, today: { done: 0, open: 0, overdue: 0 }, goals: [], tags: [], categories: [] });
  const large = systemPrompt(now, big);
  assert.ok(large.length - small.length < 900, `profile slot is bounded (${large.length - small.length})`);
  for (const s of ['identity', 'context', 'how_to_work', 'tools', 'cards', 'truth', 'reply', 'proactive', 'failures', 'examples', 'final']) assert.match(large, new RegExp(`<${s}>[\\s\\S]+</${s}>`));
  assert.match(large, /Tuesday 2026-10-20, 14:00 \(Asia\/Kolkata\)/);
  assert.match(formatProfile(big), /Active goals: (Goal \d+ x+…; ){5}Goal 5/);
  assert.equal(formatProfile({ goals: ['<script>'] }).includes('<'), false);
  assert.match(systemPrompt(now, null), /Not available right now/);
});

test('compact tool results stay valid JSON under the size cap', () => {
  const out = { count: 500, items: Array.from({ length: 500 }, (_, i) => ({ id: `t${i}`, title: 'x'.repeat(80) })) };
  const j = compactResult(out); const o = JSON.parse(j);
  assert.ok(j.length <= 4000); assert.equal(o.count, 500); assert.match(o.truncated, /items cut/);
  assert.ok(!('id' in o.items[0]), 'record ids are not sent to the model');
  assert.ok(compactResult(out, 1500).length <= 1500);
  assert.equal(compactResult({ a: 1 }), '{"a":1}');
  assert.deepEqual(Object.keys(JSON.parse(compactResult({ count: 1, goals: [{ id: 'g', title: 'x' }], items: [{ id: 'g', title: 'x' }] }))), ['count', 'goals']);
});
