package dev.karthikyernana.steady

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.karthikyernana.steady.agent.ChatMessage
import dev.karthikyernana.steady.data.Store
import dev.karthikyernana.steady.data.str
import dev.karthikyernana.steady.ui.SteadyTheme
import dev.karthikyernana.steady.ui.screens.ChatCardView
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.testTag
import org.robolectric.annotation.Config

/** Every card kind renders natively in Compose, from the server's resolved data. */
@RunWith(AndroidJUnit4::class)
@Config(application = TestApp::class, sdk = [34], qualifiers = "w411dp-h891dp-xxhdpi")
class ChatCardsRenderTest {
    @get:Rule val rule = createComposeRule()
    private val msg = ChatMessage.parse(Store.json.parseToJsonElement(javaClass.getResource("/chat/reply-all-kinds.json")!!.readText()).jsonObject["message"]!!.jsonObject)

    @Test fun allElevenKindsRender() {
        var theme by androidx.compose.runtime.mutableStateOf("light")
        rule.setContent { SteadyTheme(theme) { androidx.compose.foundation.lazy.LazyColumn(androidx.compose.ui.Modifier.testTag("list")) { msg.cards.forEach { c -> item { ChatCardView(c) } } } } }
        for (t in listOf("light", "dark")) {
            theme = t; rule.waitForIdle()
            for (card in msg.cards) rule.onNodeWithTag("list").performScrollToNode(hasTestTag("card-${card.kind.lowercase()}")).also { rule.onAllNodesWithTag("card-${card.kind.lowercase()}")[0].assertExists() }
        }
        rule.onNodeWithTag("list").performScrollToIndex(0)
        rule.onAllNodesWithTag("cc-value", useUnmergedTree = true)[0].assertTextEquals("₹829")
        rule.onNodeWithTag("list").performScrollToNode(hasText("60%"))
        rule.onAllNodesWithText("Shopping")[0].assertExists(); rule.onAllNodesWithText("₹499")[0].assertExists()
        rule.onNodeWithTag("list").performScrollToNode(hasText("Send proposal"))
        rule.onAllNodesWithText("11 AM", substring = true)[0].assertExists()
        rule.onNodeWithTag("list").performScrollToNode(hasText("Jio recharge"))
        rule.onAllNodesWithText("AMOUNT")[0].assertExists()
    }
}

/** Chat in the real app: opened by tapping Ask (still five tabs, no chat button up top), every control at the bottom, signed out, then a live chat against the local stack. */
@RunWith(AndroidJUnit4::class)
@Config(application = TestApp::class, sdk = [34], qualifiers = "w411dp-h891dp-xxhdpi")
class ChatScreenTest {
    /** Ask's one rule (same as the web's js/ui/press.js). */
    @Test fun askPressRule() {
        val P = dev.karthikyernana.steady.ui.AskPress; val h = P.HOLD_MS; val m = P.MIN_HOLD_MS
        assertEquals("tap", P.outcome(120))
        assertEquals("none", P.outcome(80, cancelled = true))
        assertEquals("short", P.outcome(h)); assertEquals("short", P.outcome(m - 1))
        assertEquals("send", P.outcome(m - 1, heard = true)); assertEquals("send", P.outcome(m))
        assertEquals("cancel", P.outcome(4000, outside = true))
        assertEquals("send", P.outcome(8000, cancelled = true))      // past the hold, a lost gesture still sends (web parity)
    }

    @get:Rule val rule = createAndroidComposeRule<MainActivity>()
    private val app get() = rule.activity.application as SteadyApp

    private fun start() {
        rule.onNodeWithText("Use on this phone only").performClick()
        rule.onNodeWithTag("onb-name").performTextInput("Karthik")
        rule.onNodeWithText("Start").performClick()
        rule.onNodeWithTag("guide-skip").performClick(); rule.waitForIdle()
    }
    private fun waitTag(tag: String, ms: Long = 20_000) = rule.waitUntil(ms) { rule.onAllNodesWithTag(tag, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }

    @Test fun signedOutThenLiveChat() {
        start()
        assertEquals(5, rule.onAllNodes(hasTestTag("tab-today") or hasTestTag("tab-goals") or hasTestTag("tab-money") or hasTestTag("tab-thoughts") or hasTestTag("tab-insights")).fetchSemanticsNodes().size)
        rule.onNodeWithTag("chat-btn").assertDoesNotExist()            // the top-bar chat button is gone; K / You stays
        rule.onNodeWithTag("you-btn").assertExists()
        rule.onNodeWithTag("mic-fab").assertDoesNotExist()
        val ask = rule.onNodeWithTag("ask-fab").assertExists().assertHasClickAction().fetchSemanticsNode()
        val root = rule.onRoot().fetchSemanticsNode().boundsInRoot
        assertTrue("Ask sits bottom-right in the thumb zone: ${ask.boundsInRoot}", ask.boundsInRoot.right > root.right * 0.8f && ask.boundsInRoot.top > root.bottom * 0.7f)
        assertTrue("Ask offers a long press (hold to talk)", ask.config.contains(androidx.compose.ui.semantics.SemanticsActions.OnLongClick))
        rule.onNodeWithTag("ask-fab").performClick(); rule.waitForIdle()        // TAP = Chat
        rule.onNodeWithTag("chat-sheet").assertExists()
        rule.onNodeWithTag("chat-blocked").assertExists()
        rule.onNodeWithText("Chat needs your account").assertExists()
        rule.onNodeWithTag("chat-composer").assertExists()
        rule.onNodeWithTag("chat-send").assertHasClickAction()
        // the composer sits in the bottom thumb zone; History · New · Close are icon buttons in the header (as the web)
        for (t in listOf("chat-mic", "chat-send", "chat-input")) {
            val b = rule.onNodeWithTag(t, useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
            assertTrue("$t in the thumb zone: $b (screen ${root.bottom})", b.top > root.bottom * 0.75f)
        }
        val head = rule.onNodeWithTag("chat-head").fetchSemanticsNode().boundsInRoot
        assertTrue(head.bottom < root.bottom * 0.25f)
        for (t in listOf("chat-hist-btn", "chat-new", "chat-close")) rule.onNode(hasTestTag(t) and hasAnyAncestor(hasTestTag("chat-head"))).assertHasClickAction()
        rule.onNode(hasText("Steady") and hasAnyAncestor(hasTestTag("chat-head"))).assertExists()
        rule.onNodeWithTag("ask-fab").assertDoesNotExist()                      // nothing floats over the composer
        // the composer mic dictates; signed out it says so instead of opening the capture sheet
        rule.onNodeWithTag("chat-mic").performClick(); rule.waitForIdle()
        rule.onNodeWithText("Sign in from You", substring = true).assertExists()
        rule.onNodeWithTag("voice-text").assertDoesNotExist()
        // History is a bottom sheet (signed out: a calm note)
        rule.onNodeWithTag("chat-hist-btn").performClick(); rule.waitForIdle()
        rule.onNodeWithText("Your chats show up here once you sign in.").assertExists()
        rule.onNodeWithContentDescription("Close").performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick)     // the sheet's own ✕ (inside ModalBottomSheet)
        rule.waitForIdle()
        rule.onNodeWithText("Your chats show up here once you sign in.").assertDoesNotExist()
        // Close (bottom) returns to the tab; Back closes too
        rule.onNodeWithTag("chat-close").performClick(); rule.waitForIdle()
        rule.onNodeWithTag("chat-sheet").assertDoesNotExist()
        rule.onNodeWithTag("ask-fab").assertExists()
        rule.onNodeWithTag("ask-fab").performClick(); rule.waitForIdle()
        rule.onNodeWithTag("chat-sheet").assertExists()
        rule.runOnUiThread { rule.activity.onBackPressedDispatcher.onBackPressed() }; rule.waitForIdle()
        rule.onNodeWithTag("chat-sheet").assertDoesNotExist()
        // HOLD Ask = the voice agent, not Chat (signed out: the typing sheet, exactly as the mic did)
        rule.onNodeWithTag("ask-fab").performTouchInput { longClick(durationMillis = 900) }; rule.waitForIdle()
        rule.onNodeWithTag("voice-text").assertExists()
        rule.onNodeWithTag("chat-sheet").assertDoesNotExist()
        rule.onNodeWithContentDescription("Close").performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick); rule.waitForIdle()

        // sign up + seed through a second client, as if typed on the web
        val email = "qa-chat-${System.currentTimeMillis()}@example.com"
        runBlocking { app.sync.signUp(email, "correct horse battery", "Karthik") }
        val web = WebClient(); web.login(email, "correct horse battery")
        val now = System.currentTimeMillis(); val today = dev.karthikyernana.steady.core.Dates.todayKey()
        web.push("money", buildJsonObject { put("id", "cm1"); put("kind", "expense"); put("amount", 340); put("category", "Food"); put("note", "Lunch"); put("date", today); put("updatedAt", now); put("createdAt", now) })
        web.push("money", buildJsonObject { put("id", "cm2"); put("kind", "expense"); put("amount", 60); put("category", "Transport"); put("date", today); put("updatedAt", now); put("createdAt", now) })
        rule.onNodeWithTag("tab-today").performClick(); rule.onNodeWithTag("ask-fab").performClick(); rule.waitForIdle()
        rule.onNodeWithTag("chat-blocked").assertDoesNotExist()
        // the empty chat's chips come from the server's starter (1.6) or the built-in set; ask the same question either way
        waitTag("chat-suggest-0")
        val q = "Spending by category this month"
        if (rule.onAllNodesWithText(q).fetchSemanticsNodes().isNotEmpty()) rule.onNodeWithText(q).performClick()
        else { rule.onNodeWithTag("chat-input").performTextInput(q); rule.onNodeWithTag("chat-send").performClick() }
        waitTag("card-stat")
        rule.onNodeWithTag("cc-value", useUnmergedTree = true).assertTextEquals("₹400")      // computed by the server from the two rows
        rule.onNodeWithTag("card-donut").assertExists()
        rule.onNodeWithText("You spent ₹400 across 2 entries.").assertExists()
        // bottom-anchored: the answer sits right above the dock, not at the top of an empty sheet
        rule.waitForIdle()
        val ans = rule.onAllNodesWithTag("chat-msg-agent")[0].fetchSemanticsNode().boundsInRoot
        val dockTop = rule.onNodeWithTag("chat-dock").fetchSemanticsNode().boundsInRoot.top
        assertTrue("answer bottom ${ans.bottom} vs dock top $dockTop", dockTop - ans.bottom in 0f..140f)
        rule.onNodeWithTag("chat-title").assertTextEquals("Spending by category this month")
        // follow-up in the same chat, typed in the composer
        rule.onNodeWithTag("chat-input").performTextInput("how are my goals going?")
        rule.onNodeWithTag("chat-send").performClick()
        waitTag("card-progresslist")
        assertEquals(2, rule.onAllNodesWithTag("chat-msg-agent").fetchSemanticsNodes().size)
        // history: a new chat, then reopen the first
        rule.onNodeWithTag("chat-new").performClick(); rule.waitForIdle()
        rule.onNodeWithTag("chat-msg-agent").assertDoesNotExist()
        rule.onNodeWithTag("chat-hist-btn").performClick()
        waitTag("chat-hist-item")
        assertEquals(1, rule.onAllNodesWithTag("chat-hist-item").fetchSemanticsNodes().size)
        rule.onAllNodesWithTag("chat-hist-item")[0].performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick)     // inside the ModalBottomSheet
        rule.waitUntil(5_000) { rule.onAllNodesWithTag("chat-hist-item").fetchSemanticsNodes().isEmpty() }      // opening one closes the sheet
        rule.waitUntil(15_000) { rule.onAllNodesWithTag("chat-msg-agent").fetchSemanticsNodes().size == 2 }
        rule.onNodeWithTag("chat").performScrollToNode(hasTestTag("card-stat"))
        rule.onNodeWithTag("cc-value", useUnmergedTree = true).assertTextEquals("₹400")
        // closing Chat keeps the conversation; Ask brings it back
        rule.onNodeWithTag("chat-close").performClick(); rule.waitForIdle()
        rule.onNodeWithTag("chat").assertDoesNotExist()
        rule.onNodeWithTag("tab-money").performClick(); rule.onNodeWithTag("ask-fab").performClick(); rule.waitForIdle()
        assertEquals(2, rule.onAllNodesWithTag("chat-msg-agent").fetchSemanticsNodes().size)
        // nothing was written by chatting: the account still holds exactly the two seeded rows
        assertTrue(runBlocking { app.sync.syncNow() })
        assertEquals(2, app.store.snapshot.value.money.size)
        assertEquals(2, web.pullAll().count { it.str("coll") == "money" })

        // switching chats while an answer is pending (the mock answers "slow" questions slowly): New stays available,
        // the other chat works at once, and the slow answer lands in its own chat (History marks it)
        rule.onNodeWithTag("chat-new").performClick(); rule.waitForIdle()
        rule.onNodeWithTag("chat-input").performTextInput("slow: how are my goals going?")
        rule.onNodeWithTag("chat-send").performClick()
        waitTag("chat-wait")
        rule.onNodeWithTag("chat-new").performClick(); rule.waitForIdle()
        rule.onNodeWithTag("chat-wait").assertDoesNotExist()
        rule.onNodeWithTag("chat-msg-agent").assertDoesNotExist()
        rule.onNodeWithTag("chat-input").performTextInput("how is my streak?")
        rule.onNodeWithTag("chat-send").performClick()
        waitTag("card-heatmap")
        rule.onNodeWithTag("card-progresslist").assertDoesNotExist()
        waitTag("chat-hist-news", 20_000)                         // the slow one answered elsewhere
        assertEquals(1, rule.onAllNodesWithTag("chat-msg-agent").fetchSemanticsNodes().size)
        rule.onNodeWithTag("chat-hist-btn").performClick(); waitTag("chat-hist-unread")
        rule.onAllNodesWithTag("chat-hist-item").fetchSemanticsNodes().let { assertTrue(it.size >= 3) }
    }
}
