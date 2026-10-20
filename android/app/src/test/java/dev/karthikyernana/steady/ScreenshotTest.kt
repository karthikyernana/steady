package dev.karthikyernana.steady

import android.graphics.Bitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.karthikyernana.steady.core.Dates
import kotlinx.serialization.json.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.time.LocalDate

/**
 * Real pixel renders of every screen (Robolectric native graphics, x86_64 CI only: STEADY_SHOTS=dir).
 * Seeds a realistic month of data so charts, cards and long notes are all exercised.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(application = TestApp::class, sdk = [34])
class ScreenshotTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()
    private val app get() = rule.activity.application as SteadyApp
    private val out = File(System.getProperty("steady.shots") ?: "build/shots").apply { mkdirs() }

    private fun shot(name: String) {
        rule.waitForIdle(); rule.mainClock.advanceTimeBy(2500); rule.waitForIdle()
        // draw the whole window (incl. dialogs/sheets are separate windows, so we draw the top-most decor view)
        @Suppress("UNCHECKED_CAST")
        val views = Class.forName("android.view.WindowManagerGlobal").getMethod("getInstance").invoke(null).let { g -> g.javaClass.getDeclaredField("mViews").apply { isAccessible = true }.get(g) as List<android.view.View> }.toList()
        val root = rule.activity.window.decorView
        val bmp = Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888)
        rule.runOnUiThread {
            val cv = android.graphics.Canvas(bmp)
            views.filter { it.isShown && it.width > 0 }.forEach { v -> val loc = IntArray(2); v.getLocationOnScreen(loc); cv.save(); cv.translate(loc[0].toFloat(), loc[1].toFloat()); v.draw(cv); cv.restore() }
        }
        File(out, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    private fun seed() {
        val s = app.store; val today = Dates.today()
        fun at(d: LocalDate, h: Int) = d.atTime(h, 15).atZone(Dates.zone).toInstant().toEpochMilli()
        val g1 = "g-placement"; val g2 = "g-dsa"
        s.save("goals", buildJsonObject { put("id", g1); put("title", "Crack campus placements"); put("why", "First job by March"); put("milestones", buildJsonArray {
            listOf("Resume final" to true, "Aptitude mocks x5" to true, "Mock interviews" to false, "Apply 20 companies" to false).forEachIndexed { i, (t, d) -> add(buildJsonObject { put("id", "m$i"); put("title", t); put("week", Dates.weekStart().plusWeeks(i - 2L).toString()); put("done", d) }) } }) })
        s.save("goals", buildJsonObject { put("id", g2); put("title", "300 DSA problems"); put("milestones", buildJsonArray {
            listOf("Arrays" to true, "Trees" to false, "Graphs" to false).forEachIndexed { i, (t, d) -> add(buildJsonObject { put("id", "d$i"); put("title", t); put("week", Dates.weekStart().plusWeeks(i - 1L).toString()); put("done", d) }) } }) })
        var n = 0
        for (back in 0..60) {
            val d = today.minusDays(back.toLong()); val k = (back * 7 + 3) % 5
            repeat(if (back % 6 == 5) 0 else k) { i ->
                s.save("tasks", buildJsonObject { put("id", "t${n++}"); put("title", listOf("Solve 3 DSA problems", "Gym", "Aptitude mock", "Read 20 pages", "Apply to 2 jobs")[i]); put("status", "done"); put("dueDate", d.toString()); put("doneAt", at(d, 9 + i * 3)); if (i == 0) put("goalId", g2) })
            }
        }
        listOf(Triple("Call amma", "19:30", 3), Triple("Calance GD prep", "11:00", 3), Triple("Laundry", null, 1)).forEach { (t, tm, p) ->
            s.save("tasks", buildJsonObject { put("id", "o${n++}"); put("title", t); put("status", "open"); put("priority", p); put("dueDate", today.toString()); tm?.let { put("dueTime", it) }; put("reminder", tm != null) })
        }
        listOf(Triple(240.0, "Food", 0), Triple(1200.0, "Travel", 1), Triple(180.0, "Food", 2), Triple(499.0, "Shopping", 4), Triple(90.0, "Food", 5), Triple(15000.0, "Allowance", 6)).forEachIndexed { i, (v, c, b) ->
            s.save("money", buildJsonObject { put("id", "mo$i"); put("amount", v); put("category", c); put("note", c.lowercase()); put("date", today.minusDays(b.toLong()).toString()); put("kind", if (c == "Allowance") "income" else "expense") })
        }
        s.save("thoughts", buildJsonObject { put("id", "th1"); put("kind", "note"); put("mood", 4); put("createdAt", at(today, 10)); put("tags", buildJsonArray { add("dsa") })
            put("text", "1. The Input Constraint Trick (The Golden Rule)\n\nCode execution environments usually allow around \\(10^{8}\\) operations per second.\n\nInput Size\tExpected Time Complexity\tCommon Algorithms\n\\(N \\le 10\\)\t\\(O(N!)\\) or \\(O(2^N \\cdot N)\\)\tPermutations, backtracking\n\\(N \\le 20\\)\t\\(O(2^N)\\)\tBitmask DP\n\\(N \\le 500\\)\t\\(O(N^3)\\)\tFloyd-Warshall\n\\(N \\le 10^5\\)\t\\(O(N \\log N)\\)\tSorting, heaps, two pointers\n\n2. Identify the Data Structure and its limits #dsa") })
        s.save("thoughts", buildJsonObject { put("id", "th2"); put("kind", "idea"); put("mood", 5); put("createdAt", at(today.minusDays(1), 22)); put("tags", buildJsonArray { add("startup") }); put("text", "Steady could chart anything I ask about my week #startup") })
    }

    private fun run(prefix: String, dark: Boolean) {
        rule.onNodeWithText("Use on this phone only").performScrollTo().performClick()
        rule.onNodeWithTag("onb-name").performTextInput("Karthik")
        rule.onNodeWithText("Start").performScrollTo().performClick()
        shot("$prefix-0-guide")
        rule.onNodeWithTag("guide-skip").performClick()
        if (dark) { rule.onNodeWithTag("you-btn").performClick(); rule.onNodeWithText("Dark").performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick); rule.onNodeWithTag("tab-today").performClick() }
        seed()
        shot("$prefix-1-today")
        listOf("goals", "money", "thoughts", "insights").forEachIndexed { i, t -> rule.onNodeWithTag("tab-$t").performClick(); shot("$prefix-${i + 2}-$t") }
        rule.onNodeWithTag("insights").performScrollToNode(hasTestTag("heatmap")); shot("$prefix-6-insights-scrolled")
        rule.onNodeWithTag("tab-thoughts").performClick(); rule.onNodeWithTag("thoughts").performScrollToNode(hasTestTag("thought")); rule.waitForIdle(); rule.onAllNodesWithTag("thought")[0].performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick); shot("$prefix-7-thought-read")
        rule.activity.onBackPressedDispatcher.onBackPressed()
        rule.onNodeWithTag("you-btn").performClick(); shot("$prefix-8-you")
    }

    @Test @Config(qualifiers = "w411dp-h891dp-xxhdpi") fun phoneLight() = run("411-light", false)
    @Test @Config(qualifiers = "w411dp-h891dp-xxhdpi") fun phoneDark() = run("411-dark", true)
    @Test @Config(qualifiers = "w360dp-h740dp-xhdpi") fun smallPhone() = run("360-light", false)
    @Test @Config(qualifiers = "w891dp-h411dp-land-xxhdpi") fun landscape() = run("land-light", false)
}
