package dev.karthikyernana.steady

import dev.karthikyernana.steady.agent.Draft
import dev.karthikyernana.steady.agent.Rules
import dev.karthikyernana.steady.core.Dates
import dev.karthikyernana.steady.data.Snapshot
import dev.karthikyernana.steady.data.str
import dev.karthikyernana.steady.data.num
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDateTime

/** On-device understanding: what the phone does offline or signed out. */
class RulesTest {
    private val now = LocalDateTime.of(2026, 10, 20, 15, 9)
    private val snap = Snapshot(mapOf("tasks" to listOf(buildJsonObject { put("id", "t1"); put("title", "Solve 3 DSA problems"); put("status", "open"); put("dueDate", "2026-10-20") })), 1)

    @Test fun reminderFiveMinutesFromNow() {
        val d = Rules.plan("set a reminder for 5 minutes", snap, now).drafts.single()
        assertEquals("reminder", d.type); assertEquals("15:14", d.f.str("dueTime")); assertEquals("2026-10-20", d.f.str("dueDate")); assertTrue(d.needs.isEmpty())
    }
    @Test fun splitsClausesIntoKinds() {
        val p = Rules.plan("spent 250 on lunch swiggy, remind me to call amma at 7pm and idea: chart my week", snap, now)
        assertEquals(listOf("money", "reminder", "thought"), p.drafts.map { it.type })
        assertEquals(250.0, p.drafts[0].f.num("amount")!!, 0.0); assertEquals("19:00", p.drafts[1].f.str("dueTime")); assertEquals("idea", p.drafts[2].f.str("kind"))
    }
    @Test fun doneMatchesAnOpenTask() {
        val d = Rules.plan("finished the DSA problems", snap, now).drafts.single()
        assertEquals("complete", d.type); assertEquals("t1", d.f.str("taskId"))
    }
    @Test fun missingAndEditUnlock() {
        val d = Rules.plan("paid swiggy for dinner", snap, now).drafts.single()
        assertEquals(listOf("amount"), d.needs)
        assertTrue(d.edit("amount" to 320.0).needs.isEmpty())
        assertEquals(listOf("time"), Draft.missing("reminder", buildJsonObject { put("title", "x") }))
    }
    @Test fun nothingUnderstood() { assertNotNull(Rules.plan("  ", snap, now).clarification) }
}
