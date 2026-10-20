package dev.karthikyernana.steady

import dev.karthikyernana.steady.data.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import java.io.File

/** Persistence on a real SQLite file: survives a restart, dirty queue semantics, monotonic clock, tombstones. */
class StoreTest {
    @Test fun persistsAcrossRestartAndQueues() {
        val f = File.createTempFile("steady", ".db"); f.delete()
        val url = "jdbc:sqlite:${f.absolutePath}"
        val a = Store(JdbcSql(url))
        val t = a.save("tasks", buildJsonObject { put("id", "t1"); put("title", "One"); put("zz", "future") })
        assertEquals(2, t.int("priority"))                       // defaults filled
        assertEquals("future", t.str("zz"))                       // unknown kept
        val t2 = a.save("tasks", t.with("title" to "Two"))
        assertTrue(t2.long("updatedAt")!! > t.long("updatedAt")!!)
        a.save("thoughts", buildJsonObject { put("id", "x"); put("text", "hi") }); a.remove("thoughts", "x")
        a.setLocal("syncCursor", "42")
        val pending = a.dirty()
        assertEquals(2, pending.size)
        // edited during push: stays dirty
        a.save("tasks", a.get("tasks", "t1")!!.with("title" to "Three"))
        a.clearDirty(pending)
        assertEquals(1, a.pendingCount())

        val b = Store(JdbcSql(url))                               // app restart
        assertEquals("Three", b.get("tasks", "t1")!!.str("title"))
        assertNull(b.get("thoughts", "x")); assertEquals(true, b.rawGet("thoughts", "x")!!.bool("deleted"))
        assertEquals("42", b.local("syncCursor"))
        assertEquals(1, b.pendingCount())
        assertEquals(1, b.snapshot.value.tasks.size); assertEquals(0, b.snapshot.value.thoughts.size)
        b.putRemote(listOf("tasks" to b.get("tasks", "t1")!!.with("title" to "Remote", "updatedAt" to Long.MAX_VALUE / 2)))
        assertEquals(0, b.pendingCount())
        f.delete()
    }

    @Test fun backupRoundTripNeverOverwritesNewer() {
        val a = Store(JdbcSql())
        a.save("tasks", buildJsonObject { put("id", "t1"); put("title", "Old title") })
        a.save("money", buildJsonObject { put("id", "m1"); put("amount", 250); put("category", "Food"); put("date", "2026-10-20") })
        a.save("thoughts", buildJsonObject { put("id", "x"); put("text", "gone") }); a.remove("thoughts", "x")
        val backup = a.exportJson()
        assertTrue(backup.contains("\"app\":\"steady\""))
        // a fresh phone gets everything, tombstones included
        val b = Store(JdbcSql())
        assertEquals(3, b.importJson(backup))
        assertEquals("Old title", b.get("tasks", "t1")!!.str("title")); assertNull(b.get("thoughts", "x"))
        // newer local edit survives importing the older backup
        b.save("tasks", b.get("tasks", "t1")!!.with("title" to "New title"))
        assertEquals(0, b.importJson(backup))
        assertEquals("New title", b.get("tasks", "t1")!!.str("title"))
        assertThrows(IllegalArgumentException::class.java) { b.importJson("{\"hello\":1}") }
        assertThrows(IllegalArgumentException::class.java) { b.importJson("not json") }
    }
}
