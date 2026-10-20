package dev.karthikyernana.steady

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.karthikyernana.steady.data.str
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** The whole app, driven like a person would: first run, add, finish, undo, every tab, every sheet. */
@RunWith(AndroidJUnit4::class)
@Config(application = TestApp::class, sdk = [34], qualifiers = "w411dp-h891dp-xxhdpi")
class UiFlowTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()
    private val app get() = rule.activity.application as SteadyApp

    @Test fun firstRunThenEveryTab() {
        rule.onNodeWithText("Use on this phone only").performClick()
        rule.onNodeWithTag("onb-name").performTextInput("Karthik")
        rule.onNodeWithText("Start").performClick()
        // first run shows the short tour once; walk it, then it never comes back on its own
        rule.onNodeWithTag("guide").assertExists()
        repeat(5) { rule.onNodeWithTag("guide-next").performClick(); rule.waitForIdle() }
        rule.onNodeWithText("Start using Steady").performClick(); rule.waitForIdle()
        rule.onNodeWithTag("guide").assertDoesNotExist()
        assertEquals("1", app.store.local("guideSeen"))
        rule.onNodeWithText("Karthik", substring = true).assertExists()
        assertEquals("Karthik", app.store.meta("profile").str("name"))

        // quick add with natural language
        rule.onNodeWithTag("qa").performTextInput("gym tomorrow 7am 45m")
        rule.onNodeWithText("45 min").assertExists()       // parse chip
        rule.onNodeWithTag("qa-add").performClick()
        val t = app.store.snapshot.value.tasks.single()
        assertEquals("Gym", t.title); assertEquals("07:00", t.dueTime); assertEquals(45, t.durationMin); assertTrue(t.reminder)

        rule.onNodeWithTag("qa").performTextInput("dsa 2 problems")
        rule.onNodeWithTag("qa-add").performClick()
        rule.onNodeWithText("Dsa 2 problems").assertExists()
        // check off, then undo from the snackbar
        rule.onAllNodesWithContentDescription("Mark done")[0].performClick()
        rule.waitForIdle()
        assertTrue(app.store.snapshot.value.tasks.first { it.title == "Dsa 2 problems" }.isDone)
        rule.onNodeWithText("Undo").performClick()
        rule.waitForIdle()
        assertTrue(app.store.snapshot.value.tasks.first { it.title == "Dsa 2 problems" }.isOpen)

        // edit sheet
        rule.onNodeWithText("Dsa 2 problems").performClick()
        rule.onNodeWithTag("edit-title").performTextReplacement("DSA: 2 problems")
        rule.onNodeWithText("Save").performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick)
        rule.waitForIdle()
        assertNotNull(app.store.snapshot.value.tasks.firstOrNull { it.title == "DSA: 2 problems" })

        // Goals
        rule.onNodeWithTag("tab-goals").performClick()
        rule.onNodeWithText("Add a goal").performClick()
        rule.onNodeWithTag("goal-title").performTextInput("Land first client")
        for (m in listOf("Portfolio", "Outreach list")) { rule.onNodeWithTag("ms-new").performTextInput(m); rule.onNodeWithTag("ms-add").performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick) }
        rule.onNodeWithTag("ms-new").performTextInput("First pitch")   // typed but not added: Save keeps it
        assertEquals(2, rule.onAllNodesWithTag("ms-row").fetchSemanticsNodes().size)
        rule.onNodeWithText("Save").performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick)
        rule.waitForIdle()
        val g = app.store.snapshot.value.goals.single()
        assertEquals(3, g.milestones.size)
        assertEquals(3, g.milestones.mapNotNull { it.week }.toSet().size)     // one per week
        rule.onNodeWithText("0 of 3 milestones").assertExists()

        // Money
        rule.onNodeWithTag("tab-money").performClick()
        rule.onNodeWithTag("money-quick-inline").performTextInput("250 lunch swiggy")
        rule.onNodeWithText("Swiggy").assertExists()           // parse chips
        rule.onNodeWithTag("money-add").performClick()
        rule.waitForIdle()
        val m = app.store.snapshot.value.money.single()
        assertEquals(250.0, m.amount, 0.0); assertEquals("Food", m.category); assertEquals("Swiggy", m.payee)
        rule.onNodeWithTag("money-spent").assertTextEquals("₹250")

        // Thoughts with a Telugu tag
        rule.onNodeWithTag("tab-thoughts").performClick()
        rule.onNodeWithTag("th-text").performTextInput("calm week ahead #ఆలోచన")
        rule.onNodeWithTag("th-save").performClick()
        rule.waitForIdle()
        assertEquals(listOf("ఆలోచన"), app.store.snapshot.value.thoughts.single().tags)

        // Insights renders with data
        rule.onNodeWithTag("tab-insights").performClick()
        rule.onNodeWithTag("remember").assertExists()

        // Voice while signed out (press and hold Ask): typing is understood on the phone; drafts can be fixed before accepting
        rule.onNodeWithTag("ask-fab").performTouchInput { longClick(durationMillis = 900) }; rule.waitForIdle()
        rule.onNodeWithText("Typing works right here", substring = true).assertExists()
        rule.onNodeWithTag("voice-text").performTextInput("paid swiggy for lunch, remind me to call amma in 10 minutes")
        rule.onNodeWithTag("voice-understand").performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick); rule.waitForIdle()
        assertEquals(2, rule.onAllNodesWithTag("draft").fetchSemanticsNodes().size)
        // the money draft has no amount: Accept stays locked until it is typed in
        rule.onNodeWithTag("draft-needs").assertExists()
        rule.onNodeWithTag("de-amount").performTextInput("180"); rule.waitForIdle()
        rule.onNodeWithTag("draft-needs").assertDoesNotExist()
        rule.onNodeWithTag("accept-all").performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick); rule.waitForIdle()
        val snap = app.store.snapshot.value
        val sw = snap.money.single { it.raw.str("source") == "voice" }; assertEquals(180.0, sw.amount, 0.0); assertEquals("Swiggy", sw.payee)
        val rem = snap.tasks.first { it.title.contains("amma", true) }
        assertTrue(rem.reminder); assertNotNull(rem.dueTime)

        // You / settings
        rule.onNodeWithTag("you-btn").performClick()
        rule.onNodeWithText("kept simple", substring = true).assertExists()
        rule.onNodeWithText("Dark").performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick)
        assertEquals("dark", app.store.local("theme"))
        rule.onNodeWithText("Evening check-in nudge").assertDoesNotExist()
    }
}
