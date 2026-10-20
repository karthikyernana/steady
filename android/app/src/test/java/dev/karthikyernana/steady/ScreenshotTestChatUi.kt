package dev.karthikyernana.steady

import android.graphics.Bitmap
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.karthikyernana.steady.agent.*
import dev.karthikyernana.steady.data.Store
import dev.karthikyernana.steady.net.ApiError
import dev.karthikyernana.steady.ui.SteadyTheme
import dev.karthikyernana.steady.ui.screens.ChatSheet
import dev.karthikyernana.steady.ui.screens.ChatState
import kotlinx.coroutines.CompletableDeferred
import kotlinx.serialization.json.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/** Needs Robolectric native graphics (x86_64 hosts; not available on aarch64). Pixel renders of the 1.6 chat UI with a fake backend (no server): empty state, typing, answer + chips; light and dark. STEADY_SHOTS=dir only. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(application = TestApp::class, sdk = [34], qualifiers = "w411dp-h891dp-xxhdpi")
class ScreenshotTestChatUi {
    @get:Rule val rule = createAndroidComposeRule<androidx.activity.ComponentActivity>()
    private val out = File(System.getProperty("steady.shots") ?: "build/shots").apply { mkdirs() }
    private val fixture = ChatMessage.parse(Store.json.parseToJsonElement(javaClass.getResource("/chat/reply-all-kinds.json")!!.readText()).jsonObject["message"]!!.jsonObject)
    private fun shot(name: String) {
        rule.waitForIdle(); rule.mainClock.advanceTimeBy(2500); rule.waitForIdle()
        val root = rule.activity.window.decorView
        val bmp = Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888)
        rule.runOnUiThread { root.draw(android.graphics.Canvas(bmp)) }
        File(out, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
    private inner class Fake : ChatBackend {
        val gate = CompletableDeferred<Unit>(); var n = 0
        override suspend fun send(chatId: String?, message: String): ChatReply {
            if (n++ == 0) gate.await()
            val now = System.currentTimeMillis()
            val cards = if (n == 1) fixture.cards.filter { it.kind in setOf("Stat", "Line") } else fixture.cards.filter { it.kind in setOf("Bar", "Donut") }
            val bar = ChatCard.parse(buildJsonObject { put("id", "wk$n"); put("component", "Bar"); put("title", "Tasks done this week"); put("period", "Mon – Sun")
                putJsonObject("data") { put("unit", "number"); putJsonArray("points") { listOf(3, 0, 5, 2, 0, 6, 1).forEachIndexed { i, v -> addJsonObject {
                    put("key", "2026-10-${12 + i}"); put("label", "${12 + i} Oct"); put("value", v); put("display", "$v") } } } } })!!
            return ChatReply("c1", "Spending this week", ChatMessage("u$n", true, message, emptyList(), now),
                ChatMessage("a$n", false, if (n == 1) "You spent ₹829 this week, ₹371 less than last week. Shopping was the biggest slice." else "Saturday was your best day.",
                    if (n == 1) cards else listOf(bar) + cards.take(1), now, listOf("Compare with last month", "Which day cost most?", "Show my goals")))
        }
        override suspend fun list() = emptyList<ChatSummary>()
        override suspend fun open(id: String): Pair<ChatSummary, List<ChatMessage>> = throw ApiError(404, "gone")
        override suspend fun delete(id: String) {}
        override suspend fun rename(id: String, title: String) {}
        override suspend fun starter() = ChatStarter(fixture.cards.filter { it.kind == "Stat" }.take(1), listOf("What's left for today?", "Spending this week", "How are my goals?", "What did I write lately?"), headline = "2 of 5 tasks done today.")
    }

    private fun run(theme: String) {
        val api = Fake()
        rule.setContent { SteadyTheme(theme) { val scope = rememberCoroutineScope(); val st = remember { ChatState(api, null, null, scope) {} }
            ChatSheet(st, enabled = true, onClose = {}, onMic = {}, signedIn = true) } }
        shot("$theme-1-empty")
        rule.onNodeWithTag("chat-input").performTextInput("how much did I spend this week?"); rule.onNodeWithTag("chat-send").performClick()
        rule.mainClock.autoAdvance = false; rule.mainClock.advanceTimeBy(500)
        val root = rule.activity.window.decorView
        val bmp = Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888); rule.runOnUiThread { root.draw(android.graphics.Canvas(bmp)) }
        File(out, "$theme-2-typing.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        rule.mainClock.autoAdvance = true
        api.gate.complete(Unit); rule.waitUntil(5000) { rule.onAllNodesWithTag("chat-msg-agent").fetchSemanticsNodes().isNotEmpty() }
        shot("$theme-3-answer")
        rule.onNodeWithTag("chat-chip-1").performClick(); rule.waitUntil(5000) { rule.onAllNodesWithTag("chat-msg-agent").fetchSemanticsNodes().size == 2 }
        shot("$theme-4-bars")
    }
    @Test fun light() = run("light")
    @Test fun dark() = run("dark")
}
