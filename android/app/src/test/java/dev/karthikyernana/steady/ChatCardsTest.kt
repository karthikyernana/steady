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
}
