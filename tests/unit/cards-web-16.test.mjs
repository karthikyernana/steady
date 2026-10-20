// Chat 1.6 card polish (js/ui/cards.js): unit grammar on Stat, every day drawn on day charts (zero days as stubs,
// weekday labels), the delta pill, the sparkline, and the count-up's number format.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCard, statParts, daySeries, countParts } from '../../js/ui/cards.js';

const stat = (value, extra = {}) => ({ component: 'Stat', title: 'Tasks done today', query: { tool: 'query_tasks', params: {} }, bind: { value: 'count' }, data: { value, display: String(value), label: 'items', period: '21 Oct', ...extra } });

test('Stat counts read with their noun: 1 task, 2 tasks, never "1 items"', () => {
  assert.deepEqual(statParts(stat(1)), { display: '1', unit: 'task', label: '' });
  assert.equal(statParts(stat(2)).unit, 'tasks');
  const thoughts = { ...stat(1), query: { tool: 'search_thoughts', params: {} } };
  assert.equal(statParts(thoughts).unit, 'thought');
  const html = renderCard(stat(1));
  assert.match(html, /data-testid="cc-value">1<\/span><span class="cc-unit">task<\/span>/);
  assert.ok(!/items/.test(html));
  // a label that names its own noun agrees with the figure
  assert.equal(statParts({ ...stat(1), bind: { value: 'done_this_week' }, query: { tool: 'get_insights_summary' }, data: { value: 1, display: '1', label: 'tasks done this week' } }).label, 'task done this week');
  // "5 days" + "day streak" does not say "day" twice
  assert.equal(statParts({ component: 'Stat', query: { tool: 'get_insights_summary' }, bind: { value: 'streak_current' }, data: { value: 5, display: '5 days', label: 'day streak' } }).label, 'streak');
  // money keeps its figure, no noun
  assert.deepEqual(statParts({ component: 'Stat', query: { tool: 'query_money' }, bind: { value: 'total' }, data: { value: 949, display: '₹949', label: 'spent' } }), { display: '₹949', unit: '', label: 'spent' });
});

test('Stat delta pill: direction and a calm tone (spending less / doing more is good)', () => {
  const up = renderCard(stat(3, { compare: { value: 1, display: '1', delta: 2, deltaDisplay: '+2', label: 'yesterday' } }));
  assert.match(up, /data-dir="up"/); assert.match(up, /t-good/); assert.match(up, /\+2 vs yesterday/);
  const money = renderCard({ component: 'Stat', query: { tool: 'query_money' }, bind: { value: 'total' }, data: { value: 900, display: '₹900', label: 'spent', compare: { delta: 300, deltaDisplay: '+₹300', label: 'last week' } } });
  assert.match(money, /t-warn/); assert.match(money, /₹300 more than last week/);
});

test('Stat trend draws a 7-day sparkline with zero stubs', () => {
  const pts = ['15', '16', '17', '18', '19', '20', '21'].map((d, i) => ({ key: `2026-10-${d}`, label: `${d} Oct`, value: i === 6 ? 2 : 0, display: String(i === 6 ? 2 : 0) }));
  const html = renderCard(stat(2, { trend: { points: pts, unit: 'number' } }));
  assert.match(html, /cc-spark/);
  assert.equal((html.match(/class="bar zero"/g) || []).length, 6);
});

test('day series: an older server that sent one day still gets every day of its period', () => {
  const d = { points: [{ key: '2026-10-21', label: '21 Oct', value: 1, display: '1' }], period: '15 Oct – 21 Oct', unit: 'number' };
  const s = daySeries(d);
  assert.equal(s.length, 7);
  assert.deepEqual(s.map(p => p.short), ['Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed']);
  assert.deepEqual(s.map(p => p.value), [0, 0, 0, 0, 0, 0, 1]);
  assert.equal(daySeries({ points: [{ key: 'Food', label: 'Food', value: 1 }] }), null, 'categories are not days');
  // a period across the new year
  assert.equal(daySeries({ points: [{ key: '2027-01-02', label: '2 Jan', value: 1, display: '1' }], period: '30 Dec – 2 Jan' }).length, 4);
});

test('Bar by day: all days, zero bars as faint stubs, weekday labels, one bar never fills the card', () => {
  const html = renderCard({ component: 'Bar', title: 'Last 7 days', data: { points: [{ key: '2026-10-21', label: '21 Oct', value: 1, display: '1' }], period: '15 Oct – 21 Oct', unit: 'number', total: 1, totalDisplay: '1' } });
  assert.equal((html.match(/<rect /g) || []).length, 7);
  assert.equal((html.match(/class="bar zero"/g) || []).length, 6);
  for (const w of ['Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed']) assert.ok(html.includes(`>${w}</text>`), w);
  const widths = [...html.matchAll(/width="([\d.]+)"/g)].map(m => +m[1]);
  assert.ok(Math.max(...widths) <= 34, 'bars are capped');
  // 1.6 servers send `short` themselves; it is used as is
  const s16 = renderCard({ component: 'Bar', data: { points: [{ key: '2026-10-20', label: '20 Oct', short: 'Tue', value: 0, display: '0' }, { key: '2026-10-21', label: '21 Oct', short: 'Wed', value: 3, display: '3' }], unit: 'number' } });
  assert.match(s16, />Tue<\/text>[\s\S]*>Wed<\/text>/);
});

test('count-up keeps the figure format', () => {
  const inr = countParts('₹1,330');
  assert.equal(inr.target, 1330); assert.equal(inr.fmt(1330), '₹1,330'); assert.equal(inr.fmt(0), '₹0');
  assert.equal(countParts('₹1,23,456').fmt(123456), '₹1,23,456');
  assert.equal(countParts('40%').fmt(20), '20%');
  assert.equal(countParts('5 days').fmt(5), '5 days');
  assert.equal(countParts('2.5').fmt(2.5), '2.5');
  assert.equal(countParts('–'), null); assert.equal(countParts('0'), null);
});
