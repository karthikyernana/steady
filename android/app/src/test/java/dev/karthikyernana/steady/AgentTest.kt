package dev.karthikyernana.steady

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.karthikyernana.steady.agent.Agent
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** Voice agent end to end against the local server + AI mock: audio bytes -> transcript -> drafts -> accept -> synced. */
@RunWith(AndroidJUnit4::class)
@Config(application = TestApp::class, sdk = [34])
class AgentTest {
    @Test fun transcribePlanApplyUndo() = runBlocking {
        val app: SteadyApp = ApplicationProvider.getApplicationContext()
        val email = "qa-android-agent-${System.currentTimeMillis()}@example.com"
        app.sync.signUp(email, "correct horse battery", "QA")
        val agent = Agent(app.store, app.api)
        val transcript = agent.transcribe(ByteArray(4000) { (it % 251).toByte() }, "audio/mp4")
        assertTrue(transcript, transcript.contains("swiggy", ignoreCase = true))
        val plan = agent.plan(transcript)
        assertTrue("drafts: ${plan.drafts}", plan.drafts.isNotEmpty())
        val before = app.store.snapshot.value
        assertEquals("plan writes nothing", 0, before.money.size + before.tasks.size)
        val money = plan.drafts.firstOrNull { it.type == "money" }
        assertNotNull("money draft", money)
        val applied = agent.apply(money!!)
        assertEquals(250.0, app.store.snapshot.value.money.single().amount, 0.0)
        agent.undo(applied)
        assertEquals(0, app.store.snapshot.value.money.size)
        plan.drafts.forEach { agent.apply(it) }
        assertTrue(app.sync.syncNow())
        assertEquals(0, app.store.pendingCount())
        app.sync.deleteAccount("correct horse battery")
    }
}
