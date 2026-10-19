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

// ---- v1.2: understands more of how people type ----
test('filler words are dropped; "remind me to" turns on the reminder', () => {
  const r = parseQuick('remind me to pay rent on the 1st', opts(at(9)));
  assert.equal(r.title, 'Pay rent'); assert.equal(r.reminder, true); assert.equal(r.dueDate, '2026-11-01');
  assert.equal(parseQuick('I need to call the bank', opts(at(9))).title, 'Call the bank');
  assert.equal(parseQuick('have dinner with Ravi', opts(at(9))).title, 'Have dinner with Ravi');
});
test('month dates, day/month and "next week"', () => {
  assert.equal(parseQuick('dentist 25 oct at 4', opts(at(9))).dueDate, '2026-10-25');
  assert.equal(parseQuick('dentist 25 oct at 4', opts(at(9))).dueTime, '16:00');
  assert.equal(parseQuick('renew passport jan 5', opts(at(9))).dueDate, '2027-01-05');
  assert.equal(parseQuick('fees 30/10', opts(at(9))).dueDate, '2026-10-30');
  assert.equal(parseQuick('plan sprint next week', opts(at(9))).dueDate, '2026-10-19');
  assert.equal(parseQuick('call dad day after tomorrow', opts(at(9))).dueDate, '2026-10-18');
});
test('relative times, eod and asap', () => {
  const r = parseQuick('stretch in 2 hours', opts(at(9, 10)));
  assert.equal(r.title, 'Stretch'); assert.equal(r.dueTime, '11:10'); assert.equal(r.durationMin, null);
  const e = parseQuick('submit report by eod asap', opts(at(9)));
  assert.equal(e.title, 'Submit report'); assert.equal(e.dueTime, '18:00'); assert.equal(e.priority, 3);
  assert.equal(parseQuick('lunch with team at lunch', opts(at(9))).dueTime, '13:00');
});
test('durations like 1h30 and half an hour', () => {
  assert.equal(parseQuick('deep work 1h30', opts(at(9))).durationMin, 90);
  assert.equal(parseQuick('walk for half an hour', opts(at(9))).durationMin, 30);
});
test('links itself to a goal when it names one of its actions', () => {
  const goals = [{ id: 'g1', title: 'Land my first paying client', actions: [{ title: 'Send 3 cold DMs' }, { title: 'Post on LinkedIn' }] }, { id: 'g2', title: 'Gym 4x a week', actions: [{ title: 'Gym session' }] }];
  assert.equal(parseQuick('post on linkedin at 6pm', { ...opts(at(9)), goals }).goalId, 'g1');
  assert.equal(parseQuick('gym session 45m', { ...opts(at(9)), goals }).goalId, 'g2');
  assert.equal(parseQuick('pitch a client in Jalandhar', { ...opts(at(9)), goals }).goalId, 'g1');
  assert.equal(parseQuick('buy milk', { ...opts(at(9)), goals }).goalId, null);
});
