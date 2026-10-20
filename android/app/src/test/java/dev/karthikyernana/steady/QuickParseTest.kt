package dev.karthikyernana.steady

import dev.karthikyernana.steady.core.QuickParse
import dev.karthikyernana.steady.data.Goal
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDateTime

/** The same cases as tests/unit/parse.test.mjs, so the phone and the web parse a quick-add identically. */
class QuickParseTest {
    private fun at(h: Int, m: Int = 0) = LocalDateTime.of(2026, 10, 16, h, m) // Fri 16 Oct 2026
    private fun p(s: String, now: LocalDateTime, goals: List<Goal> = emptyList()) = QuickParse.parse(s, now, wake = "08:00", sleep = "01:00", goals = goals)

    @Test fun briefExample() { val r = p("linkedin 20 min at 6pm", at(15, 30)); assertEquals("Linkedin", r.title); assertEquals(20, r.durationMin); assertEquals("18:00", r.dueTime); assertEquals("2026-10-16", r.dueDate); assertEquals(true, r.reminder) }
    @Test fun tomorrowPriorityColon() { val r = p("call mom tomorrow 7:30pm !", at(10)); assertEquals("Call mom", r.title); assertEquals(3, r.priority); assertEquals("2026-10-17", r.dueDate); assertEquals("19:30", r.dueTime) }
    @Test fun ambiguous() { assertEquals("21:00", p("dsa at 9", at(15)).dueTime); assertEquals("09:00", p("dsa at 9", at(7)).dueTime) }
    @Test fun passedRolls() { val r = p("gym at 7am", at(21)); assertEquals("2026-10-17", r.dueDate); assertEquals("07:00", r.dueTime) }
    @Test fun units() { assertEquals(120, p("deep work 2h", at(9)).durationMin); assertEquals(45, p("read 45m", at(9)).durationMin) }
    @Test fun weekday() { assertEquals("2026-10-23", p("review fri", at(9)).dueDate) }
    @Test fun noTime() { val r = p("read 10 pages", at(9)); assertEquals("Read 10 pages", r.title); assertNull(r.dueTime); assertEquals(false, r.reminder) }
    @Test fun lowPrio() { val r = p("remind me water plants p3", at(9)); assertEquals(1, r.priority); assertEquals(true, r.reminder); assertEquals("Water plants", r.title) }
    @Test fun filler() {
        val r = p("remind me to pay rent on the 1st", at(9)); assertEquals("Pay rent", r.title); assertEquals(true, r.reminder); assertEquals("2026-11-01", r.dueDate)
        assertEquals("Call the bank", p("I need to call the bank", at(9)).title); assertEquals("Have dinner with Ravi", p("have dinner with Ravi", at(9)).title)
    }
    @Test fun dates() {
        assertEquals("2026-10-25", p("dentist 25 oct at 4", at(9)).dueDate); assertEquals("16:00", p("dentist 25 oct at 4", at(9)).dueTime)
        assertEquals("2027-01-05", p("renew passport jan 5", at(9)).dueDate); assertEquals("2026-10-30", p("fees 30/10", at(9)).dueDate)
        assertEquals("2026-10-19", p("plan sprint next week", at(9)).dueDate); assertEquals("2026-10-18", p("call dad day after tomorrow", at(9)).dueDate)
    }
    @Test fun relative() {
        val r = p("stretch in 2 hours", at(9, 10)); assertEquals("Stretch", r.title); assertEquals("11:10", r.dueTime); assertNull(r.durationMin)
        val e = p("submit report by eod asap", at(9)); assertEquals("Submit report", e.title); assertEquals("18:00", e.dueTime); assertEquals(3, e.priority)
        assertEquals("13:00", p("lunch with team at lunch", at(9)).dueTime)
    }
    @Test fun durations() { assertEquals(90, p("deep work 1h30", at(9)).durationMin); assertEquals(30, p("walk for half an hour", at(9)).durationMin) }
    @Test fun goals() {
        val goals = listOf(
            """{"id":"g1","title":"Land my first paying client","actions":[{"title":"Send 3 cold DMs"},{"title":"Post on LinkedIn"}]}""",
            """{"id":"g2","title":"Gym 4x a week","actions":[{"title":"Gym session"}]}""",
        ).map { Goal(Json.parseToJsonElement(it).jsonObject) }
        assertEquals("g1", p("post on linkedin at 6pm", at(9), goals).goalId); assertEquals("g2", p("gym session 45m", at(9), goals).goalId)
        assertEquals("g1", p("pitch a client in Jalandhar", at(9), goals).goalId); assertNull(p("buy milk", at(9), goals).goalId)
    }
}
