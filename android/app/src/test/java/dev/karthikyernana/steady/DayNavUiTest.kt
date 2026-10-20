package dev.karthikyernana.steady

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.karthikyernana.steady.core.Dates
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** Today's day navigation: the Yesterday row, ‹ ›, swipe, Back to today, un-check on a past day (web: tests/qa/history_e2e.py). */
@RunWith(AndroidJUnit4::class)
@Config(application = TestApp::class, sdk = [34], qualifiers = "w411dp-h891dp-xxhdpi")
class DayNavUiTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()
    private val app get() = rule.activity.application as SteadyApp

    private fun seed() {
        val tk = Dates.todayKey(); val y = Dates.keyAdd(tk, -1)
        val at = { k: String, h: Int -> Dates.epochAt(k, h * 60) }
        fun task(id: String, title: String, due: String, status: String = "open", doneAt: Long? = null, extra: Map<String, String> = emptyMap()) = app.store.save("tasks", buildJsonObject {
            put("id", id); put("title", title); put("priority", 2); put("dueDate", due); put("dueTime", JsonNull); put("status", status)
            if (doneAt != null) put("doneAt", doneAt) else put("doneAt", JsonNull); extra.forEach { (k, v) -> put(k, v) }
        })
        task("y1", "Send chat about business to hark", y, "done", at(y, 21))
        task("y2", "DSA two pointers", y, "done", at(y, 10))
        task("y3", "Read 20 pages", y, "skipped")
        task("c1", "Reply to Capgemini mail", tk, extra = mapOf("carriedFrom" to y))
        task("t1", "Plan the week", tk)
        task("f1", "Mock interview", Dates.keyAdd(tk, 1))
    }

    @Test fun yesterdayRowArrowsSwipeAndBack() {
        rule.onNodeWithText("Use on this phone only").performClick()
        rule.onNodeWithTag("onb-name").performTextInput("Karthik")
        rule.onNodeWithText("Start").performClick()
        repeat(5) { rule.onNodeWithTag("guide-next").performClick(); rule.waitForIdle() }
        rule.onNodeWithText("Start using Steady").performClick(); rule.waitForIdle()
        seed(); rule.waitForIdle()

        // the Yesterday row at the end of Today
        rule.onNodeWithTag("today").performScrollToNode(hasTestTag("yesterday-row"))
        rule.onNodeWithText("2 done · 1 skipped").assertExists()
        rule.onNodeWithTag("yesterday-peek-btn").performClick(); rule.waitForIdle()
        rule.onNodeWithTag("yesterday-peek").assertExists()
        rule.onNodeWithTag("yesterday-go").performClick(); rule.mainClock.advanceTimeBy(800); rule.waitForIdle()

        // yesterday: what got done, skipped and moved on
        rule.onNodeWithTag("day-summary").assertTextContains("2 done · 1 skipped · 1 moved", substring = true)
        rule.onNodeWithText("Send chat about business to hark").assertExists()
        rule.onNodeWithText("moved to today").assertExists()
        rule.onNodeWithTag("back-today").assertExists()

        // un-check still works on a past day
        rule.onAllNodesWithContentDescription("Mark not done")[0].performClick(); rule.waitForIdle()
        assertTrue(app.store.snapshot.value.tasks.filter { it.id == "y1" || it.id == "y2" }.any { it.isOpen })
        rule.onNodeWithText("Undo").performClick(); rule.waitForIdle()
        assertTrue(app.store.snapshot.value.tasks.filter { it.id == "y1" || it.id == "y2" }.all { it.isDone })

        // › back to today, › again = tomorrow (planned), then Back to today
        rule.onNodeWithTag("day-next").performClick(); rule.mainClock.advanceTimeBy(800); rule.waitForIdle()
        rule.onNodeWithTag("qa").assertExists()
        rule.onNodeWithTag("today-pager").performTouchInput { swipeLeft() }; rule.mainClock.advanceTimeBy(800); rule.waitForIdle()
        rule.onNodeWithTag("day-summary").assertTextContains("1 planned", substring = true)
        rule.onNodeWithText("Mock interview").assertExists()
        rule.onNodeWithTag("back-today").performClick(); rule.mainClock.advanceTimeBy(800); rule.waitForIdle()
        rule.onNodeWithTag("qa").assertExists()

        // swipe right = yesterday; system Back returns to today
        rule.onNodeWithTag("today-pager").performTouchInput { swipeRight() }; rule.mainClock.advanceTimeBy(800); rule.waitForIdle()
        rule.onNodeWithTag("day-summary").assertExists()
        rule.activityRule.scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }; rule.mainClock.advanceTimeBy(800); rule.waitForIdle()
        rule.onNodeWithTag("qa").assertExists()
    }
}
