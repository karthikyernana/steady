package dev.karthikyernana.steady

import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody

/** A second device speaking the web app's protocol (js/data/sync.js), to prove phone <-> web sync both ways. */
class WebClient(private val base: String = System.getProperty("steady.api")?.takeIf { it.isNotEmpty() } ?: "http://127.0.0.1:8790/api/") {
    private val cookies = mutableMapOf<String, String>()
    private val http = OkHttpClient.Builder().cookieJar(object : CookieJar {
        override fun saveFromResponse(url: HttpUrl, c: List<Cookie>) { c.forEach { cookies[it.name] = it.value } }
        override fun loadForRequest(url: HttpUrl) = cookies.map { (k, v) -> Cookie.Builder().name(k).value(v).domain(url.host).build() }
    }).build()
    fun call(method: String, path: String, body: JsonElement? = null): JsonObject {
        val rb = body?.toString()?.toRequestBody("application/json".toMediaType()) ?: if (method == "POST") "{}".toRequestBody("application/json".toMediaType()) else null
        http.newCall(Request.Builder().url(base + path).method(method, rb).header("X-Steady", "1").build()).execute().use { r ->
            val t = r.body!!.string(); check(r.isSuccessful) { "$method $path -> ${r.code} $t" }; return Json.parseToJsonElement(t).jsonObject
        }
    }
    fun login(email: String, pw: String) = call("POST", "auth/login", buildJsonObject { put("email", email); put("password", pw); put("device", "Desktop") })
    fun push(coll: String, rec: JsonObject) = call("POST", "sync/push", buildJsonObject { putJsonArray("records") { addJsonObject {
        put("coll", coll); put("id", rec["id"]!!); put("updatedAt", rec["updatedAt"]!!); put("deleted", rec["deleted"] ?: JsonPrimitive(false)); put("data", rec); put("schemaVersion", 2) } } })
    fun pullAll(): List<JsonObject> {
        val out = mutableListOf<JsonObject>(); var since = 0L
        while (true) { val r = call("GET", "sync/pull?since=$since&limit=1000"); out += r["records"]!!.jsonArray.map { it.jsonObject }; since = r["cursor"]!!.jsonPrimitive.long; if (!r["more"]!!.jsonPrimitive.boolean) break }
        return out
    }
}
