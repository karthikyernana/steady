// The Ask button: tap opens Chat, press-and-hold is the voice agent (hold-to-talk), exactly as the mic was.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HOLD_MS, RELEASE_MS, releaseOutcome } from '../../js/ui/press.js';

test('ask: a quick press is a tap (opens Chat)', () => {
  assert.equal(releaseOutcome(0), 'tap');
  assert.equal(releaseOutcome(120), 'tap');
  assert.equal(releaseOutcome(HOLD_MS - 1), 'tap');
});
test('ask: a press the browser takes over (scroll, cancel) does nothing', () => {
  assert.equal(releaseOutcome(80, true), 'none');
});
test('ask: holding past the threshold is the voice agent; a long hold finishes on release (hold-to-talk)', () => {
  assert.equal(releaseOutcome(HOLD_MS + RELEASE_MS + 1), 'stop');
  assert.equal(releaseOutcome(8000), 'stop');
  assert.equal(releaseOutcome(8000, true), 'stop', 'a cancelled long hold still finishes the turn, like a release');
});
test('ask: a hold let go of right after it opens keeps listening hands-free (Done or a pause ends it)', () => {
  assert.equal(releaseOutcome(HOLD_MS), 'keep');
  assert.equal(releaseOutcome(HOLD_MS + RELEASE_MS), 'keep');
});
test('ask: the hold threshold is short enough to feel instant, long enough to never steal a tap', () => {
  assert.ok(HOLD_MS >= 300 && HOLD_MS <= 500);
});
