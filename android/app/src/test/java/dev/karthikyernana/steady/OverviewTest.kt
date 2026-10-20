package dev.karthikyernana.steady

import dev.karthikyernana.steady.core.Dates
import dev.karthikyernana.steady.core.Overview
import dev.karthikyernana.steady.data.Snapshot
import kotlinx.serialization.json.*
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate

class OverviewTest {
    private val today = LocalDate.of(2026, 10, 21) // a Wednesday
    private fun at(d: LocalDate, h: Int = 10) = d.atTime(h, 0).atZone(Dates.zone).toInstant().toEpochMilli()
    private fun task(id: String, d: LocalDate, goal: String? = null) = buildJsonObject { put("id", id); put("title", id); put("status", "done"); put("doneAt", at(d)); goal?.let { put("goalId", it) } }
    private fun money(v: Double, d: LocalDate, cat: String, income: Boolean = false) = buildJsonObject { put("id", "m$v$d"); put("amount", v); put("date", d.toString()); put("category", cat); put("kind", if (income) "income" else "expense") }

    @Test fun weekMonthGoalsThoughts() {
        val s = Snapshot(mapOf(
            "tasks" to listOf(task("a", today, "g1"), task("b", today.minusDays(1)), task("c", today.minusDays(7)), task("d", today.minusDays(20))),
            "goals" to listOf(buildJsonObject { put("id", "g1"); put("title", "Get placed"); put("milestones", buildJsonArray {
                add(buildJsonObject { put("id", "1"); put("title", "x"); put("done", true) }); add(buildJsonObject { put("id", "2"); put("title", "y"); put("done", false) }) }) }),
            "money" to listOf(money(200.0, today, "Food"), money(100.0, today.minusDays(2), "Travel"), money(50.0, today.minusDays(8), "Food"),
                money(5000.0, today, "Salary", income = true), money(90.0, LocalDate.of(2026, 9, 10), "Food"), money(999.0, LocalDate.of(2026, 9, 25), "Food")),
            "thoughts" to listOf(buildJsonObject { put("id", "t1"); put("text", "x #dsa"); put("tags", buildJsonArray { add("dsa") }); put("mood", 4); put("createdAt", at(today)) },
                buildJsonObject { put("id", "t2"); put("text", "y #dsa #job"); put("tags", buildJsonArray { add("dsa"); add("job") }); put("mood", 2); put("createdAt", at(today.minusDays(3))) },
                buildJsonObject { put("id", "t3"); put("text", "old"); put("mood", 5); put("createdAt", at(today.minusDays(60))) }),
        ), 1)
        val o = Overview.of(s, today)
        assertEquals(2, o.doneWeek)          // Mon 19 – Wed 21: a, b
        assertEquals(1, o.doneLastWeek)      // c (Wed 14)
        assertEquals(1, o.goals[0].done); assertEquals(2, o.goals[0].total); assertEquals(1, o.goals[0].tasksWeek)
        assertEquals(300.0, o.spentWeek, 0.0); assertEquals(50.0, o.spentLastWeek, 0.0)
        assertEquals(350.0, o.spentMonth, 0.0)            // income excluded
        assertEquals(90.0, o.spentLastMonthSameDay, 0.0)  // Sep 1–21 only, the 25th is later in the month
        assertEquals("Food" to 250.0, o.cats[0])
        assertEquals(2, o.thoughtsMonth); assertEquals("dsa" to 2, o.topTags[0]); assertEquals(3.0, o.moodAvg!!, 0.0)
        assertEquals("+1 vs last week", Overview.vs(1, "last week"))
    }
}
