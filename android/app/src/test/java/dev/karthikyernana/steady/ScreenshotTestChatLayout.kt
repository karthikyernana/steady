package dev.karthikyernana.steady

import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import java.io.File
import androidx.compose.ui.semantics.getOrNull

/** Pixel renders of the Chat screen against the local stack (Robolectric native graphics; runs only with STEADY_SHOTS=dir). */
@RunWith(AndroidJUnit4::class)
@Config(application = TestApp::class, sdk = [34], qualifiers = "w411dp-h891dp-xxhdpi")
/** Same flow, LEGACY graphics: dumps the real Compose layout (bounds, text, tags) as JSON per step, for hosts without native graphics (aarch64). */
class ScreenshotTestChatLayout {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()
    private val app get() = rule.activity.application as SteadyApp
    private val out = File(System.getProperty("steady.shots") ?: "build/shots").apply { mkdirs() }
    private fun shot(name: String) {
        rule.waitForIdle(); rule.mainClock.advanceTimeBy(1500); rule.waitForIdle()
        val nodes = buildJsonArray {
            fun walk(n: androidx.compose.ui.semantics.SemanticsNode) {
                val b = n.boundsInWindow; val c = n.config      // window coords: a ModalBottomSheet is its own (full-screen) window
                val text = c.getOrNull(androidx.compose.ui.semantics.SemanticsProperties.Text)?.joinToString(" ") { it.text }
                val edit = c.getOrNull(androidx.compose.ui.semantics.SemanticsProperties.EditableText)?.text
                val tag = c.getOrNull(androidx.compose.ui.semantics.SemanticsProperties.TestTag)
                val desc = c.getOrNull(androidx.compose.ui.semantics.SemanticsProperties.ContentDescription)?.joinToString(" ")
                if (b.width > 0 && b.height > 0 && (text != null || tag != null || desc != null || edit != null)) addJsonObject {
                    put("x", b.left); put("y", b.top); put("w", b.width); put("h", b.height)
                    text?.let { put("text", it) }; edit?.let { put("edit", it) }; tag?.let { put("tag", it) }; desc?.let { put("desc", it) }
                }
                n.children.forEach(::walk)
            }
            rule.onAllNodes(isRoot(), useUnmergedTree = true).fetchSemanticsNodes().forEach(::walk)      // the app, then any sheet on top
        }
        val root = rule.activity.window.decorView
        File(out, "$name.json").writeText(buildJsonObject { put("w", root.width); put("h", root.height); put("density", rule.activity.resources.displayMetrics.density); put("nodes", nodes) }.toString())
    }
    private fun ask(q: String, tag: String) {
        rule.onNodeWithTag("chat-input").performTextInput(q); rule.onNodeWithTag("chat-send").performClick()
        // the thread is a lazy list in its own viewport above the dock: wait for this answer's card (each ask expects a new kind)
        rule.waitUntil(20_000) { rule.onAllNodesWithTag("chat-wait").fetchSemanticsNodes().isEmpty() && runCatching { rule.onNodeWithTag("chat").performScrollToNode(hasTestTag(tag)) }.isSuccess }
    }

    private fun run(prefix: String, dark: Boolean) {
        rule.onNodeWithText("Use on this phone only").performScrollTo().performClick()
        rule.onNodeWithTag("onb-name").performTextInput("Karthik")
        rule.onNodeWithText("Start").performScrollTo().performClick()
        rule.onNodeWithTag("guide-skip").performClick()
        if (dark) { rule.onNodeWithTag("you-btn").performClick(); rule.onNodeWithText("Dark").performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick); rule.onNodeWithTag("tab-today").performClick() }
        shot("$prefix-chat-00-today-ask"); rule.onNodeWithTag("ask-fab").performClick(); shot("$prefix-chat-0-signed-out")
        val email = "shots-${System.currentTimeMillis()}@example.com"
        runBlocking { app.sync.signUp(email, "correct horse battery", "Karthik") }
        val web = WebClient(); web.login(email, "correct horse battery")
        val now = System.currentTimeMillis(); val today = dev.karthikyernana.steady.core.Dates.today()
        listOf(Triple(250, "Food", 0), Triple(80, "Transport", 0), Triple(499, "Shopping", 1), Triple(120, "Food", 1), Triple(1200, "Bills", 6), Triple(340, "Groceries", 9)).forEachIndexed { i, (a, c, d) ->
            web.push("money", buildJsonObject { put("id", "s$i"); put("kind", "expense"); put("amount", a); put("category", c); put("note", c); put("date", today.minusDays(d.toLong()).toString()); put("updatedAt", now); put("createdAt", now) }) }
        web.push("goals", buildJsonObject { put("id", "g1"); put("title", "Crack campus placements"); put("updatedAt", now); put("createdAt", now); putJsonArray("milestones") {
            listOf(true, true, false, false).forEachIndexed { i, d -> addJsonObject { put("id", "m$i"); put("title", "M$i"); put("done", d) } } } })
        for (i in 0 until 30) web.push("tasks", buildJsonObject { put("id", "d$i"); put("title", "DSA"); put("status", "done"); put("dueDate", today.minusDays((i * 2).toLong()).toString()); put("doneAt", now - i * 2 * 86_400_000L); put("updatedAt", now); put("createdAt", now) })
        web.push("tasks", buildJsonObject { put("id", "o1"); put("title", "Send proposal to Ravi"); put("status", "open"); put("dueDate", today.plusDays(1).toString()); put("dueTime", "11:00"); put("updatedAt", now); put("createdAt", now) })
        rule.onNodeWithTag("chat-close").performClick(); rule.onNodeWithTag("ask-fab").performClick(); shot("$prefix-chat-1-empty")
        ask("how much did I spend this week?", "card-donut"); shot("$prefix-chat-2-spend")
        ask("show my spending trend", "card-line"); rule.onNodeWithTag("chat").performScrollToNode(hasTestTag("card-line")); shot("$prefix-chat-3-trend")
        ask("goals and tasks due", "card-tasklist"); rule.onNodeWithTag("chat").performScrollToNode(hasTestTag("card-progresslist")); shot("$prefix-chat-4-goals")
        ask("how is my streak?", "card-heatmap"); rule.onNodeWithTag("chat").performScrollToNode(hasTestTag("card-heatmap")); shot("$prefix-chat-5-streak")
        ask("table of spends", "card-table"); rule.onNodeWithTag("chat").performScrollToNode(hasTestTag("card-table")); shot("$prefix-chat-6-table")
        rule.onNodeWithTag("chat-hist-btn").performClick(); rule.waitUntil(10_000) { rule.onAllNodesWithTag("chat-hist-item", useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }; shot("$prefix-chat-7-history")
    }

    @Test fun chatLight() = run("411-light", false)
    @Test fun chatDark() = run("411-dark", true)
}
