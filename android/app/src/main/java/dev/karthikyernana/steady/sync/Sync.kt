package dev.karthikyernana.steady.sync

import android.os.Build
import dev.karthikyernana.steady.data.SCHEMA_VERSION
import dev.karthikyernana.steady.data.Store
import dev.karthikyernana.steady.data.bool
import dev.karthikyernana.steady.data.int
import dev.karthikyernana.steady.data.long
import dev.karthikyernana.steady.data.normalize
import dev.karthikyernana.steady.data.str
import dev.karthikyernana.steady.net.Api
import dev.karthikyernana.steady.net.ApiError
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

/** Same protocol as js/data/sync.js: push dirty records (LWW per record), pull by server cursor, long-poll while open. */
class Sync(private val store: Store, private val api: Api, private val scope: CoroutineScope) {
    enum class State { OFF, IDLE, SYNCING, OK, LIVE, OFFLINE, ERROR, SIGNED_OUT }
    data class Status(val state: State, val error: String? = null, val lastSyncedAt: Long? = null)

    private val _status = MutableStateFlow(Status(if (signedIn) State.IDLE else State.OFF, lastSyncedAt = store.local("lastSyncedAt")?.toLongOrNull()))
    val status: StateFlow<Status> = _status
    val account: String? get() = store.local("account")
    val signedIn: Boolean get() = account != null
    private val mutex = Mutex()
    private var liveJob: Job? = null
    private var debounceJob: Job? = null

    private fun set(s: State, err: String? = null) { _status.value = _status.value.copy(state = s, error = err) }

    // ---- auth ----
    private fun device() = "Android · ${Build.MANUFACTURER} ${Build.MODEL}".take(60)
    suspend fun check(email: String) = api.call("POST", "auth/check", buildJsonObject { put("email", email) })
    suspend fun logIn(email: String, password: String) { val r = api.call("POST", "auth/login", buildJsonObject { put("email", email); put("password", password); put("device", device()) }); afterSignIn(r.str("email") ?: email) }
    suspend fun signUp(email: String, password: String, name: String) { val r = api.call("POST", "auth/signup", buildJsonObject { put("email", email); put("password", password); put("name", name); put("device", device()) }); afterSignIn(r.str("email") ?: email) }
    private suspend fun afterSignIn(email: String) {
        store.setLocal("account", email)
        store.markAllDirty()                       // anything made before signing in joins the account
        store.setLocal("syncCursor", "0")
        syncNow()
    }
    suspend fun signOut() {
        stopLive()
        runCatching { api.call("POST", "auth/logout") }
        api.clearCookies(); store.setLocal("account", null); set(State.OFF)
    }
    suspend fun deleteAccount(password: String) {
        api.call("POST", "auth/delete", buildJsonObject { put("password", password) })
        stopLive(); api.clearCookies(); store.setLocal("account", null); store.setLocal("syncCursor", "0"); set(State.OFF)
    }
    suspend fun checkSession() {
        if (!signedIn) return
        runCatching { api.call("GET", "auth/me") }.onSuccess { if (it.bool("signedIn") != true) expired() }
    }
    private fun expired() { stopLive(); api.clearCookies(); store.setLocal("account", null); set(State.SIGNED_OUT, "Your session ended. Sign in again to keep syncing.") }

    // ---- devices: every signed-in session, sign any out (this one included) ----
    data class Device(val id: String, val name: String, val app: String, val place: String?, val firstPlace: String?, val lastSeenAt: Long, val createdAt: Long, val current: Boolean)
    suspend fun devices(): List<Device> = (api.call("GET", "auth/sessions")["sessions"] as? JsonArray).orEmpty().map { el ->
        val o = el.jsonObject; val ua = o.str("userAgent") ?: ""
        val app = when { Regex("okhttp|Dalvik", RegexOption.IGNORE_CASE).containsMatchIn(ua) -> "Steady for Android"; "Edg/" in ua -> "Edge"; "Chrome/" in ua -> "Chrome"; "Firefox/" in ua -> "Firefox"; "Safari/" in ua -> "Safari"; else -> "" }
        val os = when { Regex("Android", RegexOption.IGNORE_CASE).containsMatchIn(ua) -> "Android"; Regex("iPhone|iPad").containsMatchIn(ua) -> "iOS"; "Windows" in ua -> "Windows"; "Mac OS X" in ua -> "macOS"; "Linux" in ua -> "Linux"; else -> "" }
        val appLabel = listOf(app, os).filter { it.isNotEmpty() }.joinToString(" · ")
        Device(o.str("id") ?: "", o.str("device")?.takeIf { it.isNotBlank() } ?: appLabel.ifEmpty { "Unknown device" }, appLabel,
            o.str("lastPlace") ?: o.str("createdPlace"), o.str("createdPlace"), o.long("lastSeenAt") ?: 0, o.long("createdAt") ?: 0, o.bool("current") == true)
    }
    suspend fun signOutDevice(d: Device) {
        api.call("POST", "auth/sessions/revoke", buildJsonObject { put("id", d.id) })
        if (d.current) { stopLive(); api.clearCookies(); store.setLocal("account", null); set(State.OFF) }
    }
    suspend fun signOutOtherDevices(): Int = api.call("POST", "auth/sessions/revoke-others").int("revoked") ?: 0
    suspend fun changePassword(current: String, new: String): Int =
        api.call("POST", "auth/password", buildJsonObject { put("current", current); put("password", new) }).int("signedOutOthers") ?: 0

    // ---- sync ----
    fun requestSync(delayMs: Long = 800) {
        if (!signedIn) return
        debounceJob?.cancel()
        debounceJob = scope.launch { delay(delayMs); syncNow() }
    }

    suspend fun syncNow(): Boolean {
        if (!signedIn) { set(State.OFF); return false }
        return mutex.withLock { doSync() }
    }

    private suspend fun doSync(): Boolean {
        if (_status.value.state != State.LIVE) set(State.SYNCING)
        return try {
            while (true) {
                val batch = store.dirty(500)
                if (batch.isEmpty()) break
                val recs = JsonArray(batch.map { d ->
                    buildJsonObject { put("coll", d.coll); put("id", d.id); put("updatedAt", d.updatedAt); put("deleted", d.rec.bool("deleted") == true); put("data", d.rec); put("schemaVersion", SCHEMA_VERSION) }
                })
                api.call("POST", "sync/push", buildJsonObject { put("records", recs) })
                store.clearDirty(batch)
                if (batch.size < 500) break
            }
            var cursor = store.local("syncCursor")?.toLongOrNull() ?: 0L
            var more = true
            while (more) {
                val r = api.call("GET", "sync/pull?since=$cursor&limit=1000")
                applyRemote(r["records"] as? JsonArray ?: JsonArray(emptyList()))
                cursor = r.long("cursor") ?: cursor
                more = r.bool("more") == true
                store.setLocal("syncCursor", cursor.toString())
            }
            val t = System.currentTimeMillis()
            store.setLocal("lastSyncedAt", t.toString())
            _status.value = Status(if (liveJob?.isActive == true) State.LIVE else State.OK, null, t)
            true
        } catch (e: ApiError) {
            if (e.status == 401) { expired(); false }
            else { set(if (e.status == 0) State.OFFLINE else State.ERROR, e.message); false }
        }
    }

    private fun applyRemote(rows: JsonArray) {
        val accept = mutableListOf<Pair<String, JsonObject>>()
        for (el in rows) {
            val row = el.jsonObject
            val coll = row.str("coll") ?: continue
            val id = row.str("id") ?: continue
            if ((row.int("schemaVersion") ?: 1) > SCHEMA_VERSION) throw ApiError(409, "Your data was saved by a newer Steady. Update this app.")
            val rec = if (row.bool("deleted") == true) buildJsonObject { put("id", id); put("deleted", true); put("updatedAt", row.long("updatedAt") ?: 0L) }
                else (row["data"] as? JsonObject) ?: continue
            val migrated = normalize(coll, rec) ?: continue
            val mine = store.rawGet(coll, id)
            val mineAt = mine?.long("updatedAt") ?: -1L
            val theirAt = migrated.long("updatedAt") ?: 0L
            if (mine != null && mineAt > theirAt) { store.markDirty(coll, id); continue }   // ours is newer: keep and re-push
            if (mine != null && mine == migrated) continue
            accept += coll to migrated
        }
        store.putRemote(accept)
    }

    // ---- live: long-poll while the app is in the foreground ----
    fun startLive() {
        if (!signedIn || liveJob?.isActive == true) return
        liveJob = scope.launch {
            var backoff = 0L; var misses = 0
            syncNow()
            while (isActive && signedIn) {
                try {
                    val r = api.call("GET", "sync/wait?since=${store.local("syncCursor") ?: "0"}", timeoutSec = 35)
                    backoff = 0; misses = 0
                    // reachable again: an old "couldn't reach" must not linger (it used to stay until the next manual sync)
                    if (_status.value.state == State.OFFLINE || _status.value.state == State.ERROR) syncNow()
                    if (_status.value.state == State.OK || _status.value.state == State.IDLE) set(State.LIVE)
                    if (r.bool("changed") == true) syncNow()
                } catch (e: ApiError) {
                    if (e.status == 401) { expired(); return@launch }
                    misses++
                    backoff = (if (backoff == 0L) 2000L else backoff * 2).coerceAtMost(60_000L)
                    // one dropped long-poll on a mobile network is normal; say offline only when it keeps failing
                    if (e.status == 0 && misses >= 2) set(State.OFFLINE, e.message)
                    delay(backoff)
                }
            }
        }
    }
    fun stopLive() { liveJob?.cancel(); liveJob = null; if (_status.value.state == State.LIVE) set(State.OK) }
}
