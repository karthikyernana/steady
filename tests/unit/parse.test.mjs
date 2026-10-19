import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuick } from '../../js/core/parse.js';

const at = (h, m = 0) => new Date(2026, 9, 16, h, m); // Fri 16 Oct 2026, local time
const opts = now => ({ now, wake: '08:00', sleep: '01:00' });

test('the brief example: "linkedin 20 min at 6pm"', () => {
  const r = parseQuick('linkedin 20 min at 6pm', opts(at(15, 30)));
  assert.equal(r.title, 'Linkedin'); assert.equal(r.durationMin, 20); assert.equal(r.dueTime, '18:00');
  assert.equal(r.dueDate, '2026-10-16'); assert.equal(r.reminder, true);
});
test('tomorrow + priority + minutes with colon time', () => {
  const r = parseQuick('call mom tomorrow 7:30pm !', opts(at(10)));
  assert.equal(r.title, 'Call mom'); assert.equal(r.priority, 3); assert.equal(r.dueDate, '2026-10-17'); assert.equal(r.dueTime, '19:30');
});
test('ambiguous "at 9" resolves inside waking hours, preferring later today', () => {
  assert.equal(parseQuick('dsa at 9', opts(at(15))).dueTime, '21:00');
  assert.equal(parseQuick('dsa at 9', opts(at(7))).dueTime, '09:00');
});
test('a time already passed today rolls to tomorrow', () => {
  const r = parseQuick('gym at 7am', opts(at(21)));
  assert.equal(r.dueDate, '2026-10-17'); assert.equal(r.dueTime, '07:00');
});
test('hours and short units', () => {
  assert.equal(parseQuick('deep work 2h', opts(at(9))).durationMin, 120);
  assert.equal(parseQuick('read 45m', opts(at(9))).durationMin, 45);
});
test('weekday names go to the next occurrence', () => {
  const r = parseQuick('review fri', opts(at(9))); // today is Friday -> next Friday
  assert.equal(r.dueDate, '2026-10-23');
});
test('no time means no reminder, title kept', () => {
  const r = parseQuick('read 10 pages', opts(at(9)));
  assert.equal(r.title, 'Read 10 pages'); assert.equal(r.dueTime, null); assert.equal(r.reminder, false);
});
test('low priority and explicit reminder keyword', () => {
  const r = parseQuick('remind me water plants p3', opts(at(9)));
  assert.equal(r.priority, 1); assert.equal(r.reminder, true); assert.equal(r.title, 'Water plants');
});
