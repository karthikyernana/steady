package dev.karthikyernana.steady

import dev.karthikyernana.steady.ui.AskGesture
import dev.karthikyernana.steady.ui.AskGesture.Effect
import org.junit.Assert.*
import org.junit.Test

/** Hold-to-talk on the Ask button: the pure rules behind the gesture. */
class AskGestureTest {
    private fun g() = AskGesture()

    @Test fun quickTapOpensChat() {
        val g = g(); g.down(1000)
        assertNull("not held long enough", g.hold(1000 + 200, true, true))
        assertEquals(Effect.Tap, g.up(1000 + 150))
        assertEquals(AskGesture.Phase.Idle, g.phase)
    }

    @Test fun holdRecordsOnTheButtonAndReleaseSends() {
        val g = g(); g.down(0)
        assertEquals(Effect.StartRecording, g.hold(AskGesture.HOLD_MS, canRecord = true, permitted = true))
        assertEquals(AskGesture.Phase.Recording, g.phase)
        g.move(20f); assertFalse(g.cancelArmed)
        assertEquals(Effect.Send, g.up(2400))
    }

    @Test fun veryShortHoldCancelsWithAHint() {
        val g = g(); g.down(0); g.hold(AskGesture.HOLD_MS, true, true)
        assertEquals(Effect.Cancel("Hold to talk"), g.up(AskGesture.MIN_MS - 1))
        g.down(0); g.hold(AskGesture.HOLD_MS, true, true)
        assertEquals(Effect.Send, g.up(AskGesture.MIN_MS))
        g.down(0); g.hold(AskGesture.HOLD_MS, true, true)
        assertEquals("a quick but real word is sent", Effect.Send, g.up(AskGesture.MIN_MS - 100, heard = true))
    }

    @Test fun draggingAwayArmsCancelAndComingBackDisarms() {
        val g = g(); g.down(0); g.hold(AskGesture.HOLD_MS, true, true)
        g.move(AskGesture.CANCEL_DP + 1); assertTrue(g.cancelArmed)
        g.move(30f); assertFalse("finger came back", g.cancelArmed)
        g.move(120f)
        assertEquals(Effect.Cancel("Cancelled"), g.up(3000))
        assertFalse(g.cancelArmed)
    }

    @Test fun withoutPermissionTheHoldOnlyAsks() {
        val g = g(); g.down(0)
        assertEquals(Effect.RequestPermission, g.hold(AskGesture.HOLD_MS, canRecord = true, permitted = false))
        g.move(200f); assertFalse("not recording, nothing to cancel", g.cancelArmed)
        assertNull("letting go after the ask never starts or sends a recording", g.up(5000))
        assertNull(g.forceSend())
        // next hold, permission granted: records
        g.down(10_000); assertEquals(Effect.StartRecording, g.hold(10_000 + AskGesture.HOLD_MS, true, true))
    }

    @Test fun signedOutHoldOpensTheTypingSheet() {
        val g = g(); g.down(0)
        assertEquals(Effect.OpenTyping, g.hold(AskGesture.HOLD_MS, canRecord = false, permitted = true))
        assertNull(g.up(900))
    }

    @Test fun systemCancelAndTheTwoMinuteCap() {
        val g = g(); g.down(0); assertNull("a scroll that began on the button", g.up(100, systemCancelled = true))
        g.down(0); g.hold(AskGesture.HOLD_MS, true, true)
        assertEquals("past the hold, a gesture the system took still sends (web parity)", Effect.Send, g.up(5000, systemCancelled = true))
        g.down(0); g.hold(AskGesture.HOLD_MS, true, true)
        assertEquals(Effect.Cancel("Hold to talk"), g.up(450, systemCancelled = true))
        g.down(0); g.hold(AskGesture.HOLD_MS, true, true)
        assertEquals(Effect.Send, g.forceSend())
        assertNull("the lift after the cap sends nothing twice", g.up(130_000))
        // a stale hold timer never fires after release
        g.down(0); g.up(100); assertNull(g.hold(AskGesture.HOLD_MS, true, true))
    }

    @Test fun doneDayIsTheLocalDayNotUtc() {
        val ist = java.time.ZoneId.of("Asia/Kolkata")
        val at = java.time.ZonedDateTime.of(2026, 10, 21, 1, 30, 0, 0, ist).toInstant().toEpochMilli()      // 20 Oct 20:00 UTC
        assertEquals("2026-10-21", dev.karthikyernana.steady.agent.doneDay(at, ist))
        assertEquals("2026-10-20", dev.karthikyernana.steady.agent.doneDay(at, java.time.ZoneOffset.UTC))
    }
}
