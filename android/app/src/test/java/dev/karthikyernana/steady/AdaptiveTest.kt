package dev.karthikyernana.steady

import dev.karthikyernana.steady.core.Dates
import dev.karthikyernana.steady.core.Engine
import dev.karthikyernana.steady.data.Snapshot
import dev.karthikyernana.steady.data.Task
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDateTime

/** Small-day (slump) detection and picks, same rules as engine.js. */
class AdaptiveTest {
    private val now = LocalDateTime.of(2026, 10, 20, 10, 0)
    private fun t(id: String, due: String, status: String = "open", dur: Int? = null, prio: Int = 2, doneAt: Long? = null) = buildJsonObject {
        put("id", id); put("title", id); put("dueDate", due); put("status", status); put("priority", prio); dur?.let { put("durationMin", it) }; doneAt?.let { put("doneAt", it) } }
    private fun at(d: String) = java.time.LocalDate.parse(d).atTime(9, 0).atZone(Dates.zone).toInstant().toEpochMilli()

    @Test fun awayTwoDaysIsASlump() {
        val s = Snapshot(mapOf("tasks" to listOf(t("a", "2026-10-17", "done", doneAt = at("2026-10-17")), t("b", "2026-10-20"))), 1)
        assertEquals("It's been 3 days. No catching up needed.", Engine.analyze(s, now).slump)
    }
    @Test fun heavyDaysIsASlump() {
        val xs = listOf("2026-10-19", "2026-10-18").flatMap { d -> listOf(t("$d-1", d, "done", doneAt = at(d)), t("$d-2", d), t("$d-3", d), t("$d-4", d)) }
        assertEquals("The last few days were heavy.", Engine.analyze(Snapshot(mapOf("tasks" to xs), 1), now).slump)
    }
    @Test fun goodDaysNoSlump() {
        val xs = listOf("2026-10-19", "2026-10-18").flatMap { d -> listOf(t("$d-1", d, "done", doneAt = at(d)), t("$d-2", d, "done", doneAt = at(d))) }
        assertNull(Engine.analyze(Snapshot(mapOf("tasks" to xs), 1), now).slump)
    }
    @Test fun smallDayPicksTinyThings() {
        val open = listOf(t("long", "x", dur = 90), t("a", "x", dur = 10), t("b", "x"), t("c", "x", dur = 25, prio = 3), t("d", "x", dur = 30)).map(::Task)
        assertEquals(listOf("a", "b", "c"), Engine.mvdPicks(open).map { it.id })
        assertEquals(listOf("long"), Engine.mvdPicks(listOf(Task(t("long", "x", dur = 90)))).map { it.id })
    }
}
