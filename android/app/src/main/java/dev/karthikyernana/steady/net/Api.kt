package dev.karthikyernana.steady.net

import dev.karthikyernana.steady.BuildConfig
import dev.karthikyernana.steady.data.KeystoreSecrets
import dev.karthikyernana.steady.data.Secrets
import dev.karthikyernana.steady.data.Store
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

class ApiError(val status: Int, message: String, val revoked: Boolean = false) : Exception(message)

/**
 * Steady's own HTTP API (server/routes.js). Auth is the same httpOnly session cookie the web app uses; the app keeps it
 * in its private database. Every call sends X-Steady: 1 (the server's CSRF guard) and no Origin header.
 */
class Api(private val store: Store, private val secrets: Secrets = KeystoreSecrets()) {
    companion object { /** Tests point the app at a local server. */ @Volatile var baseOverride: String? = null }
    private val base: HttpUrl = (baseOverride ?: BuildConfig.API_BASE).toHttpUrl()

    private val jar = object : CookieJar {
        override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
            val keep = load().filter { c -> cookies.none { it.name == c.name } } + cookies.filter { it.expiresAt > System.currentTimeMillis() }
            store.setLocal("session", if (keep.isEmpty()) null else secrets.seal(keep.joinToString("\n") { "${it.name}\t${it.value}\t${it.expiresAt}" }))
        }
        override fun loadForRequest(url: HttpUrl): List<Cookie> = if (url.host == base.host) load() else emptyList()
        private fun load(): List<Cookie> = store.local("session")?.let(secrets::open).orEmpty().lines().mapNotNull { l ->
            val p = l.split("\t"); if (p.size != 3) return@mapNotNull null
            val exp = p[2].toLongOrNull() ?: return@mapNotNull null
            if (exp <= System.currentTimeMillis()) null
            else Cookie.Builder().name(p[0]).value(p[1]).domain(base.host).path("/").expiresAt(exp).httpOnly().apply { if (base.isHttps) secure() }.build()
        }
    }
    init {   // 1.0.0 kept the session unencrypted: seal it once and drop the plain copy
        store.local("cookies")?.let { if (it.isNotBlank()) store.setLocal("session", secrets.seal(it)); store.setLocal("cookies", null) }
    }
    fun clearCookies() { store.setLocal("session", null); store.setLocal("cookies", null) }

    private val http = OkHttpClient.Builder().cookieJar(jar)
        .connectTimeout(15, TimeUnit.SECONDS).readTimeout(40, TimeUnit.SECONDS).writeTimeout(40, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true).build()

    private val JSON = "application/json".toMediaType()

    suspend fun call(method: String, path: String, body: JsonElement? = null, timeoutSec: Long? = null): JsonObject = withContext(Dispatchers.IO) {
        val rb = when { body != null -> body.toString().toRequestBody(JSON); method == "POST" -> "{}".toRequestBody(JSON); else -> null }
        val req = Request.Builder().url(base.resolve(path)!!).method(method, rb)
            .header("X-Steady", "1").header("Accept", "application/json").header("Cache-Control", "no-store").build()
        val client = if (timeoutSec != null) http.newBuilder().readTimeout(timeoutSec, TimeUnit.SECONDS).callTimeout(timeoutSec + 5, TimeUnit.SECONDS).build() else http
        try {
            client.newCall(req).execute().use { res -> parse(res.code, res.body?.string()) }
        } catch (e: IOException) { throw ApiError(0, "Couldn't reach Steady's server.") }
    }

    private fun parse(code: Int, text: String?): JsonObject {
        val obj = runCatching { Store.json.parseToJsonElement(text ?: "").jsonObject }.getOrNull()
        if (code !in 200..299 || obj == null) {
            val msg = (obj?.get("error") as? JsonPrimitive)?.content ?: "Server error $code"
            throw ApiError(code, msg, (obj?.get("revoked") as? JsonPrimitive)?.content == "true")
        }
        return obj
    }

    /** Raw audio → transcript (server: Sarvam Saaras). */
    suspend fun transcribe(bytes: ByteArray, mime: String): JsonObject = withContext(Dispatchers.IO) {
        val req = Request.Builder().url(base.resolve("agent/transcribe")!!)
            .post(bytes.toRequestBody("application/octet-stream".toMediaType()))
            .header("X-Steady", "1").header("X-Audio-Type", mime).build()
        try { http.newCall(req).execute().use { parse(it.code, it.body?.string()) } }
        catch (e: IOException) { throw ApiError(0, "Couldn't reach Steady's server.") }
    }
}
