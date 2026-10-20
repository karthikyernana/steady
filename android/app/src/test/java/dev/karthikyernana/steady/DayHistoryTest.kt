package dev.karthikyernana.steady

import dev.karthikyernana.steady.core.DayHistory
import dev.karthikyernana.steady.core.DayHistory.How
import dev.karthikyernana.steady.core.DayHistory.Kind
import dev.karthikyernana.steady.data.Task
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZonedDateTime

/** Mirrors tests/unit/history.test.mjs (web js/core/history.js). */
class DayHistoryTest {
    private val ist = ZoneId.of("Asia/Kolkata")
    private val today = "2026-10-21"
    private fun at(s: String, z: ZoneId = ist) = LocalDateTime.parse(s).atZone(z).toInstant().toEpochMilli()
    private fun t(id: String, status: String = "open", due: String? = null, doneAt: Long? = null, dueTime: String? = null, carriedFrom: String? = null, letGo: Boolean = false) =
        Task(buildJsonObject {
            put("id", id); put("title", id); put("priority", 2); put("status", status); put("dueDate", due); put("dueTime", dueTime)
            if (doneAt != null) put("doneAt", doneAt) else put("doneAt", JsonNull)
            carriedFrom?.let { put("carriedFrom", it) }; if (letGo) put("letGo", true); put("createdAt", 1); put("updatedAt", 1)
        })
    private fun ids(xs: List<Task>) = xs.map { it.id }

    @Test fun localDayIsTheLocalNotTheUtcDay() {
        val ms = at("2026-10-21T00:30")                                     // 19:00 UTC on the 20th
        assertEquals("2026-10-21", DayHistory.localDay(ms, ist))
        assertEquals("2026-10-20", java.time.Instant.ofEpochMilli(ms).toString().take(10))   // the off-by-one we avoid
        assertEquals("2026-10-20", DayHistory.localDay(ms, ZoneId.of("UTC")))
        assertEquals(null, DayHistory.localDay(null, ist))
    }

    @Test fun doneDayFallsBackToDueDate() {
        assertEquals("2026-10-20", DayHistory.doneDay(t("a", "done", "2026-10-19", at("2026-10-20T09:00")), ist))
        assertEquals("2026-10-19", DayHistory.doneDay(t("b", "done", "2026-10-19"), ist))
        assertEquals(null, DayHistory.doneDay(t("c", "open", "2026-10-19"), ist))
    }

    @Test fun theReportedCase() {
        val x = t("hark", "done", "2026-10-20", at("2026-10-20T21:40"))
        val y = DayHistory.dayTasks(listOf(x), "2026-10-20", today, ist)
        assertEquals(Kind.Past, y.kind)
        assertEquals(listOf("hark"), ids(y.done))
        assertTrue(y.hadActivity)
        assertEquals("1 done", DayHistory.summaryLine(y))
        assertTrue(DayHistory.dayTasks(listOf(x), today, today, ist).done.isEmpty())
    }

    @Test fun justAfterMidnightLandsOnTheNewDay() {
        val x = t("late", "done", "2026-10-20", at("2026-10-21T00:20"))
        assertEquals(listOf("late"), ids(DayHistory.dayTasks(listOf(x), today, today, ist).done))
        val y = DayHistory.dayTasks(listOf(x), "2026-10-20", today, ist)
        assertTrue(y.done.isEmpty())
        assertEquals(How.Done, y.moved.single().how)
        assertEquals("done today", DayHistory.movedLabel(y.moved.single(), today))
    }

    @Test fun aPastDay() {
        val d = "2026-10-19"
        val xs = listOf(
            t("d1", "done", d, at("2026-10-19T08:00")), t("d2", "done", d, at("2026-10-19T18:00")),
            t("early", "done", "2026-10-22", at("2026-10-19T12:00")),
            t("s1", "skipped", d), t("letgo", "skipped", d, letGo = true),
            t("open", "open", d), t("carried", "open", today, carriedFrom = d), t("later", "open", "2026-10-23", carriedFrom = d),
            t("other", "done", "2026-10-18", at("2026-10-18T10:00")))
        val r = DayHistory.dayTasks(xs, d, today, ist)
        assertEquals(listOf("d1", "early", "d2"), ids(r.done))
        assertEquals(listOf("letgo", "s1"), ids(r.skipped).sorted())
        assertEquals(listOf("carried", "later", "open"), r.moved.map { it.task.id }.sorted())
        assertTrue(r.open.isEmpty())
        val m = r.moved.associate { it.task.id to DayHistory.movedLabel(it, today) }
        assertEquals("moved to today", m["open"]); assertEquals("moved to today", m["carried"]); assertEquals("moved to Fri, 23 Oct", m["later"])
        assertEquals("3 done · 2 skipped · 3 moved", DayHistory.summaryLine(r))
    }

    @Test fun futureAndEmptyDays() {
        val xs = listOf(t("p1", due = "2026-10-24", dueTime = "09:00"), t("p0", due = "2026-10-24", dueTime = "07:00"), t("x", due = "2026-10-25"))
        val f = DayHistory.dayTasks(xs, "2026-10-24", today, ist)
        assertEquals(Kind.Future, f.kind)
        assertEquals(listOf("p0", "p1"), ids(f.open))
        assertEquals("2 planned", DayHistory.summaryLine(f))
        assertEquals("Nothing planned yet.", DayHistory.summaryLine(DayHistory.dayTasks(emptyList(), "2026-10-24", today, ist)))
        assertEquals("Nothing logged this day.", DayHistory.summaryLine(DayHistory.dayTasks(emptyList(), "2026-10-01", today, ist)))
        val onlyOpen = DayHistory.dayTasks(listOf(t("o", due = "2026-10-20")), "2026-10-20", today, ist)
        assertFalse(onlyOpen.hadActivity); assertEquals(1, onlyOpen.moved.size)
    }

    @Test fun labelsAndRange() {
        assertEquals("Yesterday", DayHistory.dayLabel("2026-10-20", today))
        assertEquals("Mon, 19 Oct", DayHistory.dayLabel("2026-10-19", today))
        assertEquals("Wed, 31 Dec 2025", DayHistory.dayLabel("2025-12-31", today))
        assertEquals("Monday", DayHistory.dayTitle("2026-10-19", today))
        assertEquals("3 days ago", DayHistory.dayDistance("2026-10-18", today))
        assertEquals("in 4 days", DayHistory.dayDistance("2026-10-25", today))
        assertEquals("TUESDAY, 20 OCTOBER", DayHistory.eyebrow("2026-10-20", today))
        assertEquals("2025-10-20", DayHistory.clamp("2020-01-01", today))
        assertEquals("2026-12-20", DayHistory.clamp("2030-01-01", today))
        assertEquals("2026-10-20", DayHistory.step(today, -1, today))
    }

    @Test fun usZoneAcrossDst() {
        val la = ZoneId.of("America/Los_Angeles")
        val ms = ZonedDateTime.parse("2026-11-01T06:30:00Z").toInstant().toEpochMilli()
        assertEquals("2026-10-31", DayHistory.localDay(ms, la))
        assertEquals(listOf("us"), ids(DayHistory.dayTasks(listOf(t("us", "done", "2026-10-31", ms)), "2026-10-31", "2026-11-02", la).done))
    }
}
