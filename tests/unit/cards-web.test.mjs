// Web chat cards (js/ui/cards.js): every component renders natively from server-resolved data, escapes everything,
// and draws only the figures the server computed. Uses the real server resolver over in-memory rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCard, renderCards, KINDS } from '../../js/ui/cards.js';
import { validateCard, resolveCards, COMPONENTS } from '../../server/chat-cards.js';
import { runTool } from '../../server/chat-tools.js';

const today = '2026-10-20', ist = (d, t = '10:00') => Date.parse(`${d}T${t}:00+05:30`);
const DATA = {
  tasks: [{ id: 't1', title: 'Gym <b>hard</b>', status: 'done', dueDate: '2026-10-20', doneAt: ist('2026-10-20') }, { id: 't2', title: 'Pay rent', status: 'open', dueDate: '2026-10-25', dueTime: '18:30' }],
  goals: [{ id: 'g1', title: 'Ship v2', milestones: [{ id: 'm', title: 'a', done: true }, { id: 'n', title: 'b', done: false }] }],
  money: [{ id: 'm1', kind: 'expense', amount: 1250, category: 'Food', note: 'Lunch "team"', date: '2026-10-20' }, { id: 'm2', kind: 'expense', amount: 80, category: 'Transport', date: '2026-10-19' }],
  thoughts: [{ id: 'h1', text: '<img src=x onerror=alert(1)> idea', tags: ['x'], createdAt: ist('2026-10-18') }], checkins: [],
};
const ctx = { load: async c => DATA[c] || [], sql: async () => ({ rows: [] }), today, tz: 'Asia/Kolkata', at: ist(today, '14:00') };
const resolved = async raw => (await resolveCards([validateCard(raw, { today }).card], (t, p) => runTool(t, p, ctx)))[0];

test('the web kit covers exactly the server kit', () => assert.deepEqual(KINDS, COMPONENTS));

test('every component renders with its test id and only server-computed figures', async () => {
  const specs = {
    Stat: { component: 'Stat', title: 'Spent', query: { tool: 'query_money', params: { range: 'this_week' } }, bind: { value: 'total' }, compare: { params: { range: 'last_week' }, label: 'last week' } },
    Line: { component: 'Line', title: 'By day', query: { tool: 'query_money', params: { range: 'this_week', group_by: 'day' } } },
    Bar: { component: 'Bar', query: { tool: 'query_money', params: { range: 'this_month', group_by: 'category' } } },
    Donut: { component: 'Donut', query: { tool: 'query_money', params: { range: 'this_month', group_by: 'category' } } },
    Heatmap: { component: 'Heatmap', query: { tool: 'query_tasks', params: { status: 'done', range: 'last_30_days' } } },
    ProgressList: { component: 'ProgressList', query: { tool: 'query_goals', params: {} } },
    TaskList: { component: 'TaskList', query: { tool: 'query_tasks', params: { status: 'any', range: 'this_week' } } },
    Timeline: { component: 'Timeline', query: { tool: 'query_thoughts', params: { range: 'this_month' } } },
    Table: { component: 'Table', query: { tool: 'query_money', params: { range: 'this_month' } }, bind: { columns: ['date', 'note', 'amount'] } },
    Note: { component: 'Note', title: 'Note', text: 'Keep the next step tiny <script>x</script>' },
    Callout: { component: 'Callout', tone: 'good', text: 'Small days count.' },
  };
  for (const [kind, raw] of Object.entries(specs)) {
    const c = await resolved(raw);
    const html = renderCard(c);
    assert.ok(html.includes(`data-testid="card-${kind.toLowerCase()}"`), `${kind}: ${html.slice(0, 120)}`);
    assert.ok(!/<script|<img|<b>/i.test(html), `${kind} escapes everything`);
  }
  const stat = renderCard(await resolved(specs.Stat));
  assert.match(stat, /₹1,330/); assert.match(stat, /₹1,330 more than last week/);
  assert.match(renderCard(await resolved(specs.Donut)), /Food[\s\S]*₹1,250[\s\S]*94%/);
  assert.match(renderCard(await resolved(specs.Table)), /Lunch &quot;team&quot;[\s\S]*₹1,250/);
  assert.match(renderCard(await resolved(specs.TaskList)), /Gym &lt;b&gt;hard&lt;\/b&gt;[\s\S]*Pay rent[\s\S]*25 Oct · 6:30 PM/);
  assert.match(renderCard(await resolved(specs.ProgressList)), /aria-valuenow="50"/);
  assert.match(renderCard(await resolved(specs.Note)), /tiny x</, 'the server strips tags from model text');
  assert.match(renderCard({ component: 'Note', data: { text: '<script>x</script>' } }), /&lt;script&gt;/, 'and the client escapes whatever it is given');
});

test('empty data reads calmly; unknown or broken cards render nothing', async () => {
  const c = await resolved({ component: 'Line', query: { tool: 'query_money', params: { range: 'last_month', group_by: 'day' } } });
  assert.match(renderCard(c), /Not enough data|Nothing here/);
  assert.equal(renderCard({ component: 'Iframe', data: {} }), '');
  assert.equal(renderCard(null), '');
  assert.equal(renderCard({ component: 'Bar', data: null }).includes('card-bar'), true);
  assert.equal(renderCards([{ component: 'Nope' }, { component: 'Callout', data: { text: 'ok', tone: 'evil' } }]).includes('tone-info'), true);
});

test('a card can only show what the server computed (no data → no numbers)', () => {
  const html = renderCard({ component: 'Stat', title: 'Spent', value: 999999, data: {} });
  assert.ok(!html.includes('999999')); assert.match(html, /–/);
});
