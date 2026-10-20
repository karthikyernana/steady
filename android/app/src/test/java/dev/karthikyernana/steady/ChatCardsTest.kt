package dev.karthikyernana.steady

import dev.karthikyernana.steady.agent.ChatCard
import dev.karthikyernana.steady.agent.ChatKinds
import dev.karthikyernana.steady.agent.ChatMessage
import dev.karthikyernana.steady.data.Store
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

/** Parsing the server's resolved cards (fixture = real /api/agent/chat replies from the local stack + AI mock). */
class ChatCardsTest {
    private val reply = Store.json.parseToJsonElement(javaClass.getResource("/chat/reply-all-kinds.json")!!.readText()).jsonObject
    private val msg = ChatMessage.parse(reply["message"]!!.jsonObject)
    private fun card(kind: String) = msg.cards.first { it.kind == kind }

    @Test fun everyKindParsesAndUnknownKindsAreSkipped() {
        assertEquals(ChatKinds.ALL.toSet(), msg.cards.map { it.kind }.toSet())
        assertFalse(msg.cards.any { it.kind == "Hologram" })
        assertFalse(msg.user)
        assertTrue(ChatMessage.parse(reply["user"]!!.jsonObject).user)
    }

    @Test fun figuresComeFromTheServerData() {
        val stat = msg.cards.first { it.kind == "Stat" }
        assertEquals("₹829", stat.display)
        assertTrue(stat.compareText!!.endsWith("than last week") || stat.compareText!!.startsWith("same as"))
        val donut = card("Donut")
        assertEquals(listOf("Shopping", "Food", "Transport"), donut.points.map { it.label })
        assertEquals(829.0, donut.points.sumOf { it.value }, 0.001)
        assertEquals("₹829", donut.totalDisplay)
        val line = card("Line"); assertEquals(30, line.points.size); assertEquals("₹2,179", line.totalDisplay)
        assertTrue(card("Heatmap").days.size >= 90); assertTrue(card("Heatmap").max >= 1.0)
        assertEquals("1/2", card("ProgressList").progress.single().display)
        assertEquals(0.5f, card("ProgressList").progress.single().frac, 0.001f)
        assertEquals("Send proposal", card("TaskList").tasks.single().title)
        assertTrue(card("Timeline").timeline.single().title.contains("weekly money summary"))
        val table = card("Table"); assertEquals(listOf("Date", "Note", "Category", "Amount"), table.columns); assertTrue(table.rows.isNotEmpty())
        assertEquals("good", card("Callout").tone); assertEquals("Keep the next step tiny.", card("Note").text)
    }

    @Test fun malformedDataNeverCrashesAndInventsNothing() {
        val c = ChatCard.parse(buildJsonObject { put("component", "Stat"); put("value", 999999); put("data", JsonPrimitive("nope")) })!!
        assertEquals("–", c.display); assertNull(c.compareText); assertTrue(c.points.isEmpty())
        assertNull(ChatCard.parse(buildJsonObject { put("component", "Iframe") }))
        assertNull(ChatCard.parse(buildJsonObject { put("type", "Stat") }))
        val bad = ChatCard.parse(buildJsonObject { put("component", "Callout"); putJsonObject("data") { put("text", "hi"); put("tone", "evil") } })!!
        assertEquals("info", bad.tone)
        val pts = ChatCard.parse(buildJsonObject { put("component", "Bar"); putJsonObject("data") { putJsonArray("points") { add(JsonPrimitive(3)); addJsonObject { put("label", "A"); put("value", 2) } } } })!!
        assertEquals(listOf("A"), pts.points.map { it.label })
    }

    @Test fun newFieldsParseLeniently() {
        val m = ChatMessage.parse(buildJsonObject { put("id", "a"); put("role", "assistant"); put("text", "Hi"); put("brandNew", true)
            putJsonArray("suggestions") { add("  Show   my week "); add(JsonPrimitive(4)); addJsonObject { put("label", "Due tomorrow?") }; add("x".repeat(81)); add("Show my week"); add("a"); add("b"); add("c") } })
        assertEquals(listOf("Show my week", "Due tomorrow?", "a", "b"), m.suggestions)
        assertTrue(ChatMessage.parse(buildJsonObject { put("text", "old server") }).suggestions.isEmpty())
        assertTrue(ChatMessage.parse(buildJsonObject { put("suggestions", "nope") }).suggestions.isEmpty())
        assertTrue(msg.suggestions.isEmpty())                                     // the 1.5 fixture has none
        val st = dev.karthikyernana.steady.agent.ChatStarter.parse(buildJsonObject { put("cards", 3) })
        assertTrue(st.cards.isEmpty() && st.suggestions.isEmpty() && st.greeting == null)
    }

    @Test fun statLabelsReadAsPlainEnglish() {
        val g = dev.karthikyernana.steady.agent.ChatGrammar
        assertEquals("task", g.statLabel("items", 1.0, "query_tasks")); assertEquals("tasks", g.statLabel("items", 2.0, "query_tasks"))
        assertEquals("entries", g.statLabel("items", 0.0, "query_money")); assertEquals("entry", g.statLabel("items", 1.0, "query_money"))
        assertEquals("item", g.statLabel("items", 1.0, null)); assertEquals("thought this month", g.statLabel("thoughts this month", 1.0, "get_insights_summary"))
        assertEquals("day streak", g.statLabel("day streak", 5.0, null)); assertEquals("milestone done", g.statLabel("milestones done", 1.0, null))
        assertEquals("query_money", card("Stat").tool)
    }

    @Test fun countUpKeepsTheFigureShape() {
        val c = dev.karthikyernana.steady.ui.screens.CountUp
        val p = c.parts("₹1,23,450")!!; assertEquals("₹1,23,450", c.format(p, p.value)); assertEquals("₹61,725", c.format(p, p.value / 2))
        val w = c.parts("12,500")!!; assertEquals("12,500", c.format(w, 12500.0))
        assertEquals("40%", c.parts("40%")!!.let { c.format(it, 40.0) })
        assertEquals("1 day", c.parts("10 days")!!.let { c.format(it, 1.0) }); assertEquals("10 days", c.parts("10 days")!!.let { c.format(it, 10.0) })
        assertNull(c.parts("–"))
    }

    @Test fun dayLabelsAndTimes() {
        val line = card("Line"); assertEquals(30, line.series.size)                // already complete: unchanged
        assertEquals("Mon", dev.karthikyernana.steady.agent.ChatSeries.short("2026-10-19", 7)); assertEquals("19", dev.karthikyernana.steady.agent.ChatSeries.short("2026-10-19", 30))
        val z = java.time.ZoneId.of("Asia/Kolkata"); val now = java.time.ZonedDateTime.of(2026, 10, 21, 21, 0, 0, 0, z).toInstant().toEpochMilli()
        assertEquals("Today 9:41 PM", dev.karthikyernana.steady.ui.screens.chatTime(now + 41 * 60_000, now, z))
        assertEquals("Yesterday 8:05 AM", dev.karthikyernana.steady.ui.screens.chatTime(now - (36 * 60 + 55) * 60_000L, now, z))
    }
}
