package dev.karthikyernana.steady.data

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

/**
 * Local-first store: SQLite on the device is the source of truth; everything is also held in memory (a personal
 * tracker is a few thousand records at most) and published as an immutable [Snapshot] so Compose recomposes on change.
 * Every write stamps a monotonic updatedAt (an edit always beats the version it replaced) and queues the record for sync.
 */
/** The only SQL surface the store needs, so tests can run it on a JVM SQLite (sqlite-jdbc) with the same statements. */
interface Sql {
    fun query(sql: String, args: Array<Any?> = emptyArray()): List<Array<String?>>
    fun exec(sql: String, args: Array<Any?> = emptyArray())
    fun <T> tx(block: () -> T): T
}

private class AndroidSql(ctx: Context) : Sql {
    private val db: SQLiteDatabase = object : SQLiteOpenHelper(ctx.applicationContext, "steady.db", null, 1) {
        override fun onCreate(db: SQLiteDatabase) { SCHEMA.forEach(db::execSQL) }
        override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {}
    }.writableDatabase
    override fun query(sql: String, args: Array<Any?>): List<Array<String?>> =
        db.rawQuery(sql, args.map { it?.toString() }.toTypedArray()).use { c -> buildList { while (c.moveToNext()) add(Array(c.columnCount) { c.getString(it) }) } }
    override fun exec(sql: String, args: Array<Any?>) = db.execSQL(sql, args)
    override fun <T> tx(block: () -> T): T { db.beginTransaction(); try { val r = block(); db.setTransactionSuccessful(); return r } finally { db.endTransaction() } }
}

val SCHEMA = listOf(
    "create table if not exists records (coll text not null, id text not null, json text not null, updated_at integer not null, dirty integer not null default 0, primary key (coll, id))",
    "create index if not exists records_dirty on records(dirty)",
    "create table if not exists kv (k text primary key, v text not null)",
)

/**
 * Local-first store: SQLite on the device is the source of truth; everything is also held in memory (a personal
 * tracker is a few thousand records at most) and published as an immutable [Snapshot] so Compose recomposes on change.
 * Every write stamps a monotonic updatedAt (an edit always beats the version it replaced) and queues the record for sync.
 */
class Store(private val db: Sql) {
    private val mem: Map<String, MutableMap<String, JsonObject>> = COLLECTIONS.associateWith { linkedMapOf() }
    private val kv = mutableMapOf<String, String>()
    private val _snap = MutableStateFlow(Snapshot.EMPTY)
    val snapshot: StateFlow<Snapshot> = _snap
    /** Called after every local write (sync debounce + reminders). Set by the app. */
    @Volatile var onLocalChange: (() -> Unit)? = null

    init {
        SCHEMA.forEach { db.exec(it) }
        for (r in db.query("select coll, id, json from records")) {
            val obj = runCatching { json.parseToJsonElement(r[2]!!).jsonObject }.getOrNull() ?: continue
            mem[r[0]]?.put(r[1]!!, obj)
        }
        for (r in db.query("select k, v from kv")) kv[r[0]!!] = r[1]!!
        publish()
    }

    private fun publish() { _snap.value = Snapshot(mem.mapValues { (_, m) -> m.values.filter { it.bool("deleted") != true } }, _snap.value.version + 1) }

    fun get(coll: String, id: String): JsonObject? = mem[coll]?.get(id)?.takeIf { it.bool("deleted") != true }
    fun rawGet(coll: String, id: String): JsonObject? = mem[coll]?.get(id)
    fun meta(key: String): JsonObject = get("meta", key) ?: JsonObject(mapOf("id" to toJson(key)))

    private fun stamp(prev: JsonObject?): Long { val now = System.currentTimeMillis(); val p = prev?.long("updatedAt") ?: 0L; return if (p >= now) p + 1 else now }

    /** Local edit: stamp, normalize, persist, mark dirty, publish. Returns the stored record. */
    fun save(coll: String, rec: JsonObject): JsonObject {
        val next = synchronized(this) {
            val id = rec.str("id") ?: error("record without id")
            val prev = mem[coll]?.get(id)
            var n = rec.with("updatedAt" to stamp(prev))
            if (n.long("createdAt") == null) n = n.with("createdAt" to (prev?.long("createdAt") ?: System.currentTimeMillis()))
            n = JsonObject(n.filterKeys { it != "deleted" })
            n = normalize(coll, n) ?: error("bad record")
            write(coll, id, n, dirty = true)
            publish(); n
        }
        onLocalChange?.invoke()
        return next
    }

    fun remove(coll: String, id: String) {
        synchronized(this) {
            val prev = mem[coll]?.get(id) ?: return
            val tomb = JsonObject(mapOf("id" to toJson(id), "deleted" to toJson(true), "updatedAt" to toJson(stamp(prev))))
            write(coll, id, tomb, dirty = true)
            publish()
        }
        onLocalChange?.invoke()
    }

    fun setMeta(key: String, vararg pairs: Pair<String, Any?>) = save("meta", meta(key).with(*pairs, "id" to key))

    /** Remote records that won last-write-wins (clears the dirty flag, no local-change callback). */
    @Synchronized fun putRemote(rows: List<Pair<String, JsonObject>>) {
        if (rows.isEmpty()) return
        db.tx { for ((coll, rec) in rows) write(coll, rec.str("id")!!, rec, dirty = false) }
        publish()
    }

    private fun write(coll: String, id: String, rec: JsonObject, dirty: Boolean) {
        mem[coll]?.set(id, rec)
        db.exec("insert or replace into records (coll, id, json, updated_at, dirty) values (?, ?, ?, ?, ?)", arrayOf(coll, id, rec.toString(), rec.long("updatedAt") ?: 0L, if (dirty) 1 else 0))
    }

    // ---- sync queue ----
    data class Dirty(val coll: String, val id: String, val updatedAt: Long, val rec: JsonObject)
    @Synchronized fun dirty(limit: Int = 500): List<Dirty> =
        db.query("select coll, id, updated_at from records where dirty=1 order by updated_at limit $limit").mapNotNull { r -> mem[r[0]]?.get(r[1])?.let { Dirty(r[0]!!, r[1]!!, r[2]!!.toLong(), it) } }
    /** Clear the flag only if the record was not edited again while the push was in flight. */
    @Synchronized fun clearDirty(items: List<Dirty>) = db.tx { for (d in items) db.exec("update records set dirty=0 where coll=? and id=? and updated_at=?", arrayOf(d.coll, d.id, d.updatedAt)) }
    @Synchronized fun markDirty(coll: String, id: String) = db.exec("update records set dirty=1 where coll=? and id=?", arrayOf(coll, id))
    @Synchronized fun markAllDirty() = db.exec("update records set dirty=1")
    @Synchronized fun pendingCount(): Int = db.query("select count(*) from records where dirty=1").first()[0]!!.toInt()

    // ---- device-only key/value (never synced) ----
    fun local(key: String): String? = kv[key]
    @Synchronized fun setLocal(key: String, value: String?) {
        if (value == null) { kv.remove(key); db.exec("delete from kv where k=?", arrayOf(key)) }
        else { kv[key] = value; db.exec("insert or replace into kv (k, v) values (?, ?)", arrayOf(key, value)) }
    }

    companion object {
        val json = Json { ignoreUnknownKeys = true; explicitNulls = true }
        @Volatile private var inst: Store? = null
        /** Tests swap in a JVM SQLite here; the app uses the platform's. */
        @Volatile var sqlFactory: ((Context) -> Sql)? = null
        fun get(ctx: Context): Store = inst ?: synchronized(this) { inst ?: Store(sqlFactory?.invoke(ctx) ?: AndroidSql(ctx)).also { inst = it } }
        /** Robolectric gives every test a fresh app; drop the old instance with it. */
        fun resetForTests() { inst = null }
    }
}

/** Immutable view of all live (non-deleted) records. */
data class Snapshot(val colls: Map<String, List<JsonObject>>, val version: Long) {
    val tasks by lazy { colls["tasks"].orEmpty().map(::Task) }
    val goals by lazy { colls["goals"].orEmpty().map(::Goal).sortedWith(compareBy({ it.order }, { it.createdAt })) }
    val thoughts by lazy { colls["thoughts"].orEmpty().map(::Thought).sortedByDescending { it.createdAt } }
    val money by lazy { colls["money"].orEmpty().map(::Money).sortedWith(compareByDescending<Money> { it.date }.thenByDescending { it.createdAt }) }
    val checkins by lazy { colls["checkins"].orEmpty().map(::Checkin) }
    fun meta(key: String): JsonObject = colls["meta"].orEmpty().firstOrNull { it.str("id") == key } ?: JsonObject(emptyMap())
    val profile get() = meta("profile")
    val settings get() = meta("settings")
    companion object { val EMPTY = Snapshot(COLLECTIONS.associateWith { emptyList() }, 0) }
}
