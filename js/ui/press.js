// The Ask button's one rule, kept pure so it is unit-tested (tests/unit/press.test.mjs):
// let go before HOLD_MS → a TAP (open Chat). Held to HOLD_MS → the voice agent opens and records while held; letting go
// more than RELEASE_MS after that finishes the turn (hold-to-talk), letting go sooner keeps listening hands-free.
export const HOLD_MS = 380, RELEASE_MS = 450;
/** @param {number} pressedMs time from press to release @param {boolean} cancelled the browser took the gesture (scroll) */
export function releaseOutcome(pressedMs, cancelled = false) {
  if (pressedMs < HOLD_MS) return cancelled ? 'none' : 'tap';
  return pressedMs - HOLD_MS > RELEASE_MS ? 'stop' : 'keep';
}
