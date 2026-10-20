// The Ask button: tap opens Chat; press-and-hold records in the button itself and sends on release.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HOLD_MS, MIN_HOLD_MS, CANCEL_PX, releaseOutcome, isOutside } from '../../js/ui/press.js';

test('ask: a quick press is a tap (opens Chat)', () => {
  assert.equal(releaseOutcome(0), 'tap');
  assert.equal(releaseOutcome(120), 'tap');
  assert.equal(releaseOutcome(HOLD_MS - 1), 'tap');
});
test('ask: a press the browser takes over (scroll, cancel) before the hold does nothing', () => {
  assert.equal(releaseOutcome(80, { cancelled: true }), 'none');
  assert.equal(releaseOutcome(80, true), 'none', 'the old boolean form still works');
});
test('ask: a real hold sends on release', () => {
  assert.equal(releaseOutcome(MIN_HOLD_MS), 'send');
  assert.equal(releaseOutcome(8000), 'send');
  assert.equal(releaseOutcome(8000, { cancelled: true }), 'send', 'losing the pointer mid-hold still sends what was said');
});
test('ask: a fumbled hold (< ~0.6 s, nothing heard) is cancelled; with speech it is sent', () => {
  assert.equal(releaseOutcome(HOLD_MS + 50), 'short');
  assert.equal(releaseOutcome(MIN_HOLD_MS - 1), 'short');
  assert.equal(releaseOutcome(HOLD_MS + 50, { heard: true }), 'send');
});
test('ask: sliding away before release cancels', () => {
  assert.equal(releaseOutcome(3000, { outside: true }), 'cancel');
  assert.equal(releaseOutcome(100, { outside: true }), 'tap', 'before the hold it is still just a press');
  assert.ok(isOutside(CANCEL_PX + 1, 0)); assert.ok(!isOutside(50, 50)); assert.ok(isOutside(60, 60));
});
test('ask: the hold threshold is short enough to feel instant, long enough to never steal a tap', () => {
  assert.ok(HOLD_MS >= 300 && HOLD_MS <= 500);
  assert.ok(MIN_HOLD_MS > HOLD_MS && MIN_HOLD_MS <= 800);
});
