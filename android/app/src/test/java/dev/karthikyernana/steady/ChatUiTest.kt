package dev.karthikyernana.steady

import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.karthikyernana.steady.agent.*
import dev.karthikyernana.steady.data.Store
import dev.karthikyernana.steady.net.ApiError
import dev.karthikyernana.steady.ui.SteadyTheme
import dev.karthikyernana.steady.ui.screens.ChatCardView
import dev.karthikyernana.steady.ui.screens.ChatSheet
import dev.karthikyernana.steady.ui.screens.ChatState
import kotlinx.coroutines.CompletableDeferred
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.unit.dp

/** A backend that answers on a gate, with follow-up suggestions and an optional starter. */
private class ChipChat(val starter: ChatStarter?) : ChatBackend {
    val gate = CompletableDeferred<Unit>(); val asked = mutableListOf<String>(); private var n = 0
    override suspend fun send(chatId: String?, message: String): ChatReply {
        asked += message; if (asked.size == 1) gate.await()
        val k = ++n; val now = System.currentTimeMillis()
        val card = ChatCard.parse(buildJsonObject { put("id", "s$k"); put("component", "Stat"); put("title", "Open"); putJsonObject("query") { put("tool", "query_tasks") }
            putJsonObject("data") { put("value", 1); put("display", "1"); put("label", "items") } })!!
        return ChatReply("chat-1", "Tasks", ChatMessage("u$k", true, message, emptyList(), now),
            ChatMessage("a$k", false, "You have one open task.", listOf(card), now, listOf("What’s due tomorrow?", "Show my week")))
    }
    override suspend fun list() = emptyList<ChatSummary>()
    override suspend fun open(id: String): Pair<ChatSummary, List<ChatMessage>> = throw ApiError(404, "gone")
    override suspend fun delete(id: String) {}
    override suspend fun rename(id: String, title: String) {}
    override suspend fun starter(): ChatStarter? = starter
}

@RunWith(AndroidJUnit4::class)
@Config(application = TestApp::class, sdk = [34], qualifiers = "w411dp-h891dp-xxhdpi")
class ChatUiTest {
    @get:Rule val rule = createComposeRule()
    private val starter = ChatStarter.parse(Store.json.parseToJsonElement("""{"greeting":"Good evening, Karthik.","unknown":1,
        "cards":[{"id":"h1","component":"Stat","title":"Done this week","query":{"tool":"query_tasks"},"data":{"value":12,"display":"12","label":"done this week"}}],
        "suggestions":["How did I sleep on money?", {"text":"What’s due this week?"}, 3, "", "How did I sleep on money?"]}""").jsonObject)

    private fun show(api: ChipChat, theme: String = "light") {
        rule.setContent { SteadyTheme(theme) {
            val scope = rememberCoroutineScope()
            val st = remember { ChatState(api, null, null, scope) {} }
            ChatSheet(st, enabled = true, onClose = {}, onMic = {}, signedIn = true)
        } }
    }

    @Test fun emptyStateShowsGreetingHeadlineAndStarterChips() {
        show(ChipChat(starter)); rule.waitForIdle()
        rule.onNodeWithTag("chat-greeting").assertTextEquals("Good evening, Karthik.")
        rule.onNodeWithTag("chat-starter-card").assertExists()
        rule.onNodeWithTag("cc-value", useUnmergedTree = true).assertTextEquals("12")
        rule.onNodeWithTag("chat-suggest-0").assertTextEquals("How did I sleep on money?")
        rule.onNodeWithTag("chat-suggest-1").assertTextEquals("What’s due this week?")
        rule.onNodeWithTag("chat-suggest-2").assertDoesNotExist()               // junk entries and duplicates dropped
    }

    @Test fun noStarterFallsBackToBuiltInChips() {
        show(ChipChat(null)); rule.waitForIdle()
        rule.onNodeWithTag("chat-starter-card").assertDoesNotExist()
        rule.onNodeWithTag("chat-suggest-0").assertTextEquals("Spending by category this month")
        rule.onNodeWithTag("chat-greeting").assertExists()
    }

    @Test fun typingIndicatorThenAnswerWithChipsThatSend() {
        val api = ChipChat(null); show(api); rule.waitForIdle()
        rule.onNodeWithTag("chat-input").performTextInput("what's open?")
        rule.onNodeWithTag("chat-send").performClick(); rule.waitForIdle()
        rule.onNodeWithTag("chat-wait").assertExists()                         // the animated dots while it thinks
        rule.onNodeWithTag("chat-msg-user").assertTextEquals("what's open?")
        rule.onNodeWithTag("chat-msg-agent").assertDoesNotExist()
        api.gate.complete(Unit); rule.waitUntil(5_000) { rule.onAllNodesWithTag("chat-msg-agent").fetchSemanticsNodes().isNotEmpty() }
        rule.waitForIdle()
        rule.onNodeWithTag("chat-wait").assertDoesNotExist()
        rule.onNodeWithText("You have one open task.").assertExists()
        rule.onNodeWithText("task").assertExists(); rule.onNodeWithText("items").assertDoesNotExist()      // Stat grammar: "1 task", never "1 items"
        rule.onNodeWithTag("chat-time").assertExists()
        rule.onNodeWithTag("chat-chip-0").assertTextEquals("What’s due tomorrow?")
        rule.onNodeWithTag("chat-chip-1").performClick(); rule.waitUntil(5_000) { rule.onAllNodesWithTag("chat-msg-agent").fetchSemanticsNodes().size == 2 }
        assertEquals(listOf("what's open?", "Show my week"), api.asked)
        // chips only under the newest answer
        rule.waitForIdle(); assertEquals(1, rule.onAllNodesWithTag("chat-chips").fetchSemanticsNodes().size)
    }

    @Test fun barAndLineShowEveryDayWithLabels() {
        val bar = ChatCard.parse(buildJsonObject { put("id", "b"); put("component", "Bar"); put("title", "Tasks done")
            putJsonObject("data") { put("unit", "number"); putJsonArray("points") {
                addJsonObject { put("key", "2026-10-12"); put("label", "Mon 12 Oct"); put("value", 2); put("display", "2") }
                addJsonObject { put("key", "2026-10-15"); put("label", "Thu 15 Oct"); put("value", 5); put("display", "5") }
                addJsonObject { put("key", "2026-10-18"); put("label", "Sun 18 Oct"); put("value", 1); put("display", "1") } } } })!!
        assertEquals(7, bar.series.size); assertEquals(listOf(2.0, 0.0, 0.0, 5.0, 0.0, 0.0, 1.0), bar.series.map { it.value })
        rule.setContent { SteadyTheme("dark") { ChatCardView(bar) } }
        rule.waitForIdle()
        for (d in listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")) rule.onNodeWithText(d).assertExists()
        rule.onNodeWithText("Highest 5", substring = true).assertExists()
    }

    @Test fun askButtonTapHoldAndPermission() {
        val voice = dev.karthikyernana.steady.ui.VoiceHold(null)
        var taps = 0; var asks = 0; var typing = 0; var sends = 0; var permitted = false
        rule.setContent { SteadyTheme("light") { androidx.compose.foundation.layout.Box(androidx.compose.ui.Modifier.padding(top = 200.dp)) {
            dev.karthikyernana.steady.ui.AskFab({ taps++ }, voice, canRecord = { true }, permitted = { permitted }, onRequestPermission = { asks++ }, onOpenTyping = { typing++ }, onSend = { sends++ })
        } } }
        rule.onNodeWithTag("ask-fab").performTouchInput { down(center); advanceEventTime(100); up() }; rule.waitForIdle()
        assertEquals(1, taps)
        // no microphone permission: the hold only asks, nothing records, nothing opens
        rule.onNodeWithTag("ask-fab").performTouchInput { down(center); advanceEventTime(900); up() }; rule.waitForIdle()
        assertEquals(1, asks); assertEquals(0, sends); assertEquals(0, typing); assertEquals(1, taps); assertFalse(voice.recording)
        voice.showHint("Hold again to talk"); rule.waitForIdle()
        rule.onNodeWithTag("ask-rec-label").assertTextEquals("Hold again to talk")
        // permitted, but the recorder can't start (no mic here): a calm hint, no sheet
        permitted = true
        rule.onNodeWithTag("ask-fab").performTouchInput { down(center); advanceEventTime(900); up() }; rule.waitForIdle()
        assertEquals(0, sends); assertFalse(voice.recording); assertEquals(1, taps)
    }
}
