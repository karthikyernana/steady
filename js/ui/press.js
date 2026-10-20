// The Ask button's one rule, kept pure so it is unit-tested (tests/unit/press.test.mjs):
// let go before HOLD_MS → a TAP (open Chat). Held past HOLD_MS → the button itself records (no sheet while you hold);
// letting go sends what you said (transcribe → sheet with the text and drafts). Let go very soon (< MIN_HOLD_MS) with
// nothing heard, and it was a fumbled hold: cancelled with a "Hold to talk" hint. Slide the finger more than
// CANCEL_PX away before letting go and the recording is thrown away ("Release to cancel" shows while you are out there).
export const HOLD_MS = 380, MIN_HOLD_MS = 600, CANCEL_PX = 80;
// kept for older callers: the gap after the hold opened in which a release used to keep listening hands-free
export const RELEASE_MS = MIN_HOLD_MS - HOLD_MS;
/**
 * @param {number} pressedMs time from press to release
 * @param {{ cancelled?: boolean, outside?: boolean, heard?: boolean }} o cancelled = the browser took the gesture
 *   (scroll, a permission prompt, the window lost focus); outside = the finger is > CANCEL_PX from where it went down;
 *   heard = the recording picked up speech
 * @returns {'tap'|'none'|'cancel'|'short'|'send'}
 */
export function releaseOutcome(pressedMs, o = {}) {
  if (typeof o === 'boolean') o = { cancelled: o };
  if (pressedMs < HOLD_MS) return o.cancelled ? 'none' : 'tap';
  if (o.outside) return 'cancel';
  if (pressedMs < MIN_HOLD_MS && !o.heard) return 'short';
  return 'send';
}
export const isOutside = (dx, dy) => Math.hypot(dx, dy) > CANCEL_PX;
