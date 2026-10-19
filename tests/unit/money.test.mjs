import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, parseMoney, fmtINR, summarize, moneyLine, canonicalCategory, monthAdd, guessCategory } from '../../js/core/money.js';

const NOW = new Date('2026-10-19T12:00:00');

test('amounts: digits, shorthands, English words', () => {
  assert.equal(parseAmount('500'), 500); assert.equal(parseAmount('₹1,200'), 1200); assert.equal(parseAmount('2.5k'), 2500);
  assert.equal(parseAmount('300rs'), 300); assert.equal(parseAmount('1.5 lakh'), 150000);
  assert.equal(parseAmount('five hundred'), 500); assert.equal(parseAmount('two thousand five hundred and fifty'), 2550);
  assert.equal(parseAmount('a hundred bucks'), 100);
});
test('amounts: Telugu script and romanized Telugu', () => {
  assert.equal(parseAmount('ఐదు వందలు'), 500); assert.equal(parseAmount('రెండు వేల ఐదు వందలు'), 2500);
  assert.equal(parseAmount('aidu vandalu'), 500); assert.equal(parseAmount('rendu velu'), 2000);
});
test('amounts: words that are not amounts', () => {
  assert.equal(parseAmount('thousand thoughts'), null); assert.equal(parseAmount('call mom'), null);
});
test('quick-add: expense with payee, category and note', () => {
  const r = parseMoney('spent 250 on lunch at swiggy', { now: NOW });
  assert.deepEqual([r.kind, r.amount, r.category, r.payee, r.note, r.date], ['expense', 250, 'Food', 'Swiggy', 'Lunch', '2026-10-19']);
});
test('quick-add: income, yesterday, Telugu-English mix', () => {
  const a = parseMoney('got 5000 stipend', { now: NOW }); assert.equal(a.kind, 'income'); assert.equal(a.category, 'Stipend');
  const b = parseMoney('uber 180 yesterday', { now: NOW }); assert.equal(b.date, '2026-10-18'); assert.equal(b.category, 'Transport');
  const c = parseMoney('ivala petrol ki 500 karchu ayyindi', { now: NOW }); assert.equal(c.amount, 500); assert.equal(c.category, 'Transport'); assert.equal(c.note, 'Petrol');
});
test('learned corrections beat built-in keywords', () => {
  const memory = { corrections: [{ w: 'chai', c: 'Snacks' }], payees: {} };
  assert.equal(guessCategory('chai with friends', 'expense', { memory }), 'Snacks');
  assert.equal(parseMoney('100 chai', { now: NOW, memory }).category, 'Snacks');
});
test('INR formatting uses Indian grouping', () => {
  assert.equal(fmtINR(123456.5), '₹1,23,456.50'); assert.equal(fmtINR(1500), '₹1,500'); assert.equal(fmtINR(99, { sign: true }), '+₹99'); assert.equal(fmtINR(-20), '−₹20');
});
test('categories keep the existing spelling', () => {
  assert.equal(canonicalCategory('food'), 'Food'); assert.equal(canonicalCategory('chai breaks', ['Chai Breaks']), 'Chai Breaks'); assert.equal(canonicalCategory('gifts for friends'), 'Gifts For Friends');
});
test('monthly summary, budgets and the calm line', () => {
  const e = (date, amount, category, kind = 'expense') => ({ id: date + amount, date, amount, category, kind });
  const xs = [e('2026-10-01', 200, 'Food'), e('2026-10-02', 800, 'Food'), e('2026-10-02', 1000, 'Rent'), e('2026-10-05', 5000, 'Stipend', 'income'), e('2026-09-30', 999, 'Food'), { ...e('2026-10-03', 50, 'Food'), deleted: true }];
  const s = summarize(xs, '2026-10', { budgets: { total: 1500, categories: { Food: 2000 } }, now: NOW });
  assert.equal(s.spent, 2000); assert.equal(s.income, 5000); assert.equal(s.net, 3000); assert.equal(s.cats[0].category, 'Food'); assert.equal(s.byDay[1], 1800);
  assert.equal(s.budget.total.left, -500); assert.equal(s.budget.categories[0].left, 1000);
  assert.match(moneyLine(s, null, { now: NOW }), /₹500 over budget/);
  assert.equal(monthAdd('2026-01', -1), '2025-12');
});
