package dev.karthikyernana.steady

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.karthikyernana.steady.data.*
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

@RunWith(AndroidJUnit4::class)
@Config(application = TestApp::class, sdk = [34])
class SyncTest {
    private lateinit var app: SteadyApp
    private val email = "qa-android-${System.currentTimeMillis()}@example.com"
    private val pw = "correct horse battery"
    @Before fun setup() { app = ApplicationProvider.getApplicationContext() }

    private fun task(title: String, extra: Map<String, Any?> = emptyMap()) = buildJsonObject {
        put("id", uid()); put("title", title); put("priority", 2); put("dueDate", "2026-10-20"); put("dueTime", "18:30"); put("durationMin", 20); put("reminder", true); put("status", "open"); put("doneAt", JsonNull); put("goalId", JsonNull)
    }.with(*extra.toList().toTypedArray())

    @Test fun phoneAndWebSyncBothWays() = runBlocking {
        // made offline before an account exists: must join the account at sign-up
        val early = app.store.save("tasks", task("Made before sign-up", mapOf("futureField" to "kept")))
        app.sync.signUp(email, pw, "QA")
        assertTrue(app.sync.signedIn)
        assertEquals(0, app.store.pendingCount())

        val web = WebClient(); web.login(email, pw)
        var remote = web.pullAll().associateBy { it["id"]!!.jsonPrimitive.content }
        val r1 = remote[early.str("id")]!!
        assertEquals("tasks", r1.str("coll")); assertEquals("Made before sign-up", r1["data"]!!.jsonObject.str("title"))
        assertEquals("kept", r1["data"]!!.jsonObject.str("futureField"))   // unknown fields survive

        // web -> phone: a new money entry and a thought with a field this app doesn't know
        val now = System.currentTimeMillis()
        web.push("money", buildJsonObject { put("id", "m-web-1"); put("kind", "expense"); put("amount", 250); put("category", "Food"); put("note", "Lunch"); put("payee", "Swiggy"); put("date", "2026-10-20"); put("source", "voice"); put("updatedAt", now); put("createdAt", now) })
        web.push("thoughts", buildJsonObject { put("id", "th-web-1"); put("text", "ship it #steady"); putJsonArray("tags") { add("steady") }; put("mood", 4); put("kind", "idea"); put("jx", buildJsonObject { put("area", "career") }); put("updatedAt", now); put("createdAt", now) })
        assertTrue(app.sync.syncNow())
        val s = app.store.snapshot.value
        assertEquals(250.0, s.money.single { it.id == "m-web-1" }.amount, 0.0)
        assertEquals("career", s.thoughts.single { it.id == "th-web-1" }.raw["jx"]!!.jsonObject.str("area"))

        // phone edit -> web, keeping the unknown field
        val th = app.store.get("thoughts", "th-web-1")!!
        app.store.save("thoughts", th.with("text", "shipped it #steady"))
        assertTrue(app.sync.syncNow())
        remote = web.pullAll().associateBy { it["id"]!!.jsonPrimitive.content }
        assertEquals("shipped it #steady", remote["th-web-1"]!!["data"]!!.jsonObject.str("text"))
        assertEquals("career", remote["th-web-1"]!!["data"]!!.jsonObject["jx"]!!.jsonObject.str("area"))

        // delete on phone -> tombstone on web
        app.store.remove("money", "m-web-1"); assertTrue(app.sync.syncNow())
        assertEquals(true, web.pullAll().last { it.str("id") == "m-web-1" }.bool("deleted"))

        // conflict: an older web write never beats a newer phone edit
        val t = app.store.get("tasks", early.str("id")!!)!!
        val newer = app.store.save("tasks", t.with("title", "Phone wins"))
        web.push("tasks", t.with("title", "Stale web", "updatedAt", newer.long("updatedAt")!! - 5000))
        assertTrue(app.sync.syncNow())
        assertEquals("Phone wins", app.store.get("tasks", early.str("id")!!)!!.str("title"))
        // and a newer web write wins on the phone
        web.push("tasks", t.with("title", "Web newer", "updatedAt", System.currentTimeMillis() + 60_000))
        assertTrue(app.sync.syncNow())
        assertEquals("Web newer", app.store.get("tasks", early.str("id")!!)!!.str("title"))
        assertEquals(0, app.store.pendingCount())

        // offline edits queue and flush later
        val off = app.store.save("tasks", task("Queued"))
        assertTrue(app.store.pendingCount() >= 1)
        assertTrue(app.sync.syncNow())
        assertNotNull(web.pullAll().firstOrNull { it.str("id") == off.str("id") })

        // session survives a restart (cookie persisted), sign-out clears it; data stays on the phone
        assertEquals(true, app.api.call("GET", "auth/me").bool("signedIn"))
        val stored = app.store.local("session")!!
        assertFalse("session token must be sealed at rest", stored.contains("steady") || stored.contains("\t"))
        assertNull(app.store.local("cookies"))
        app.sync.signOut()
        assertFalse(app.sync.signedIn)
        assertEquals(false, app.api.call("GET", "auth/me").bool("signedIn"))
        assertNotNull(app.store.get("tasks", off.str("id")!!))
        // clean up the QA account
        app.sync.logIn(email, pw); app.sync.deleteAccount(pw)
    }

    private fun JsonObject.with(k: String, v: Any?, k2: String? = null, v2: Any? = null): JsonObject = if (k2 == null) this.with(k to v) else this.with(k to v, k2 to v2)
}
