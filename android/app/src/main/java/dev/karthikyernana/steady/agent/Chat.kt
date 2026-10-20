package dev.karthikyernana.steady.agent

import dev.karthikyernana.steady.data.arr
import dev.karthikyernana.steady.data.long
import dev.karthikyernana.steady.data.num
import dev.karthikyernana.steady.data.str
import dev.karthikyernana.steady.net.Api
import androidx.compose.runtime.Immutable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import java.time.ZoneId

/**
 * Chat with your data (agent layer, phase 1) — the same /api/agent/chat the web uses (server/chat.js), with the app's
 * session. The server runs read-only tools against the user's own rows and resolves every card, so a card here carries
 * figures computed from real data (never numbers a model wrote). This file only parses JSON into typed card data;
 * the Compose renderers are in ui/screens/ChatCards.kt.
 */
object ChatKinds {
    val ALL = listOf("Stat", "Line", "Bar", "Donut", "Heatmap", "ProgressList", "TaskList", "Timeline", "Table", "Note", "Callout")
}

@Immutable data class Point(val label: String, val value: Double, val display: String, val key: String = "", val short: String? = null)
@Immutable data class HeatDay(val date: String, val value: Double, val display: String)
@Immutable data class ProgressItem(val label: String, val frac: Float, val display: String)
@Immutable data class TaskItem(val title: String, val done: Boolean, val due: String?, val time: String?)
@Immutable data class TimelineItem(val date: String, val time: String?, val title: String, val sub: String?)

/**
 * One resolved card. [kind] is one of [ChatKinds.ALL]; everything else is read from the server's `data`, once (lazy), so
 * recomposing a card never re-parses its JSON. [tool] is the query's tool name when the server sent the spec along.
 */
@Immutable
data class ChatCard(val id: String, val kind: String, val title: String?, val data: JsonObject, val tool: String? = null) {
    val period: String? get() = data.str("period")
    val empty: Boolean get() = (data["empty"] as? JsonPrimitive)?.content == "true"
    val message: String? get() = data.str("message")
    // Stat
    val display: String get() = data.str("display") ?: "–"
    val label: String? get() = data.str("label")
    val value: Double? get() = data.num("value")
    /** The Stat line under the figure, in plain grammar: "1 task", "2 tasks", "1 thought this month" (never "1 items"). */
    val statLabel: String? get() = label?.let { ChatGrammar.statLabel(it, value, tool) }
    /** "₹200 less than last week" for money, "+3 vs last week" otherwise (same wording as the web card). */
    val compareText: String? by lazy {
        val c = data["compare"] as? JsonObject ?: return@lazy null
        val delta = c.num("delta") ?: return@lazy null; val what = c.str("label") ?: return@lazy null
        val dd = c.str("deltaDisplay") ?: return@lazy null
        when {
            delta == 0.0 -> "same as $what"
            display.startsWith("₹") -> "${dd.trimStart('+', '−', '-')} ${if (delta > 0) "more" else "less"} than $what"
            else -> "$dd vs $what"
        }
    }
    // Line / Bar / Donut
    val points: List<Point> by lazy { data.arr("points").mapNotNull { (it as? JsonObject)?.let { p -> point(p) } } }
    /** Stat (1.6): the same figure per day for the last 7 days, for a sparkline; empty when the server sent none */
    val trend: List<Point> by lazy { ((data["trend"] as? JsonObject)?.arr("points") ?: JsonArray(emptyList())).mapNotNull { (it as? JsonObject)?.let(::point) } }
    private fun point(p: JsonObject) = Point(p.str("label") ?: "", p.num("value") ?: 0.0, p.str("display") ?: "", p.str("key") ?: "", p.str("short")?.takeIf { it.isNotBlank() && it.length <= 6 })
    /** money (₹) or plain counts: from the server's `unit`, else read off the figures */
    val money: Boolean get() = data.str("unit") == "inr" || points.firstOrNull()?.display?.startsWith("₹") == true || display.startsWith("₹")
    /**
     * Line / Bar points with every day present: a day series (ISO date keys) gets zero stubs for days the server left
     * out (older servers, long ranges), so a quiet day reads as a quiet day instead of vanishing from the axis.
     */
    val series: List<Point> by lazy { ChatSeries.fill(points, money) }
    val totalDisplay: String? get() = data.str("totalDisplay")
    // Heatmap
    val days: List<HeatDay> by lazy { data.arr("days").mapNotNull { (it as? JsonObject)?.let { d -> d.str("date")?.let { k -> HeatDay(k, d.num("value") ?: 0.0, d.str("display") ?: "") } } } }
    val max: Double get() = data.num("max") ?: 0.0
    // ProgressList
    val progress: List<ProgressItem> by lazy { data.arr("items").mapNotNull { (it as? JsonObject)?.let { g -> ProgressItem(g.str("label") ?: "", (g.num("frac") ?: 0.0).toFloat().coerceIn(0f, 1f), g.str("display") ?: "") } } }
    // TaskList
    val tasks: List<TaskItem> by lazy { data.arr("items").mapNotNull { (it as? JsonObject)?.let { t -> TaskItem(t.str("title") ?: "", t.str("status") == "done", t.str("dueDisplay"), t.str("time")) } } }
    val count: Int get() = data.num("count")?.toInt() ?: tasks.size
    // Timeline
    val timeline: List<TimelineItem> by lazy { data.arr("items").mapNotNull { (it as? JsonObject)?.let { x -> TimelineItem(x.str("dateDisplay") ?: x.str("date") ?: "", x.str("time"), x.str("title") ?: "", x.str("sub")) } } }
    // Table
    val columns: List<String> by lazy { data.arr("columns").mapNotNull { (it as? JsonObject)?.str("label") } }
    val rows: List<List<String>> by lazy { data.arr("rows").mapNotNull { r -> (r as? kotlinx.serialization.json.JsonArray)?.map { (it as? JsonPrimitive)?.content ?: "" } } }
    // Note / Callout
    val text: String get() = data.str("text") ?: ""
    val tone: String get() = data.str("tone")?.takeIf { it in setOf("info", "good", "warn") } ?: "info"

    companion object {
        /** null for anything outside the kit (an older app simply skips a newer card kind). */
        fun parse(o: JsonObject): ChatCard? {
            val kind = o.str("component")?.takeIf { it in ChatKinds.ALL } ?: return null
            return ChatCard(o.str("id") ?: kind, kind, o.str("title"), (o["data"] as? JsonObject) ?: JsonObject(emptyMap()), (o["query"] as? JsonObject)?.str("tool"))
        }
    }
}

/**
 * One message. [suggestions] are the follow-up chips the server offers under an answer (1.6+; an older server sends none).
 * Parsing is lenient everywhere: unknown fields are ignored, a missing or malformed field is empty.
 */
@Immutable
data class ChatMessage(val id: String, val user: Boolean, val text: String, val cards: List<ChatCard>, val at: Long, val suggestions: List<String> = emptyList()) {
    companion object {
        fun parse(o: JsonObject) = ChatMessage(o.str("id") ?: "", o.str("role") == "user", o.str("text") ?: "",
            o.arr("cards").mapNotNull { (it as? JsonObject)?.let(ChatCard::parse) }, o.long("createdAt") ?: 0L, suggestions(o["suggestions"]))
        /** strings, or objects with text/label/q; trimmed, de-duplicated, at most 4, each at most 80 characters */
        fun suggestions(e: JsonElement?): List<String> = ((e as? JsonArray) ?: JsonArray(emptyList())).mapNotNull { s ->
            when (s) { is JsonPrimitive -> s.takeIf { it.isString }?.content; is JsonObject -> s.str("text") ?: s.str("label") ?: s.str("q"); else -> null }
        }.map { it.replace(Regex("""\s+"""), " ").trim() }.filter { it.isNotEmpty() && it.length <= 80 }.distinct().take(4)
    }
}

/** The empty chat's opener (GET agent/chat/starter): a headline card or two and starter chips. Missing endpoint = null. */
@Immutable
data class ChatStarter(val cards: List<ChatCard>, val suggestions: List<String>, val greeting: String? = null, val headline: String? = null) {
    companion object {
        fun parse(o: JsonObject) = ChatStarter(o.arr("cards").mapNotNull { (it as? JsonObject)?.let(ChatCard::parse) }.take(2),
            ChatMessage.suggestions(o["suggestions"]), o.str("greeting")?.trim()?.takeIf { it.isNotEmpty() && it.length <= 120 },
            o.str("text")?.trim()?.takeIf { it.isNotEmpty() && it.length <= 160 })
    }
}

/** Plain-English counts for Stat labels the server words generically. */
object ChatGrammar {
    private val NOUN = mapOf("query_tasks" to ("task" to "tasks"), "query_money" to ("entry" to "entries"), "query_thoughts" to ("thought" to "thoughts"),
        "search_thoughts" to ("thought" to "thoughts"), "query_goals" to ("goal" to "goals"))
    private val PLURALS = mapOf("items" to "item", "tasks" to "task", "thoughts" to "thought", "entries" to "entry", "milestones" to "milestone", "goals" to "goal",
        "days" to "day", "notes" to "note", "spends" to "spend", "expenses" to "expense", "times" to "time")
    fun statLabel(label: String, value: Double?, tool: String?): String {
        val words = label.trim().split(" ").toMutableList(); if (words.isEmpty() || words[0].isEmpty()) return label
        val first = words[0].lowercase()
        // "items" says nothing: name the thing counted when the tool is known
        if (first == "items" || first == "item") NOUN[tool]?.let { words[0] = it.second }
        if (value == 1.0) PLURALS[words[0].lowercase()]?.let { words[0] = it }
        return words.joinToString(" ")
    }
}

/** Day series helpers for Line / Bar: fill missing days, short axis labels. */
object ChatSeries {
    private val ISO = Regex("""^\d{4}-\d{2}-\d{2}$""")
    fun isDays(p: List<Point>) = p.size >= 2 && p.all { ISO.matches(it.key) }
    fun fill(p: List<Point>, money: Boolean): List<Point> {
        if (!isDays(p)) return p
        val by = p.associateBy { it.key }
        val from = runCatching { java.time.LocalDate.parse(p.first().key) }.getOrNull() ?: return p
        val to = runCatching { java.time.LocalDate.parse(p.last().key) }.getOrNull() ?: return p
        if (to.isBefore(from) || java.time.temporal.ChronoUnit.DAYS.between(from, to) > 120) return p
        return generateSequence(from) { it.plusDays(1) }.takeWhile { !it.isAfter(to) }.map { d -> val k = d.toString()
            by[k] ?: Point(dayLabel(d), 0.0, if (money) "₹0" else "0", k) }.toList()
    }
    /** "Mon" for a week or less, the day of the month for longer runs */
    fun short(p: Point, n: Int): String = if (n <= 7 && p.short != null) p.short else short(p.key, n)
    fun short(key: String, n: Int): String = runCatching { val d = java.time.LocalDate.parse(key)
        if (n <= 7) d.dayOfWeek.getDisplayName(java.time.format.TextStyle.SHORT, java.util.Locale.ENGLISH) else "${d.dayOfMonth}" }.getOrDefault("")
    fun dayLabel(d: java.time.LocalDate) = "${d.dayOfWeek.getDisplayName(java.time.format.TextStyle.SHORT, java.util.Locale.ENGLISH)} ${d.dayOfMonth} ${d.month.getDisplayName(java.time.format.TextStyle.SHORT, java.util.Locale.ENGLISH)}"
}
@Immutable data class ChatSummary(val id: String, val title: String, val preview: String, val updatedAt: Long)
data class ChatReply(val chatId: String, val title: String, val user: ChatMessage, val answer: ChatMessage)

/** What Chat needs from the server (ChatApi in the app; a fake in tests, so switching chats mid-answer is tested without a network). */
interface ChatBackend {
    suspend fun send(chatId: String?, message: String): ChatReply
    suspend fun list(): List<ChatSummary>
    suspend fun open(id: String): Pair<ChatSummary, List<ChatMessage>>
    suspend fun delete(id: String)
    /** Needs PATCH agent/chats/:id on the server; a 404/405 means "not there yet" and the name stays on this device. */
    suspend fun rename(id: String, title: String)
    /** The empty chat's opener; null when the server has none (older server, 404). */
    suspend fun starter(): ChatStarter? = null
}

/**
 * Calm one-line errors (same rules as the web's js/core/chat-ui.js): raw provider text never reaches the screen. The
 * server may append debug detail in [ … ]; it is stripped, and anything that still looks like a provider / HTTP error
 * becomes the plain "busy" line. Debug detail goes to the log only.
 */
object ChatErrors {
    const val BUSY = "Busy right now, try again in a moment."
    data class Friendly(val msg: String, val retry: Boolean, val off: Boolean = false, val gone: Boolean = false, val offline: Boolean = false)
    private val RAW = Regex("""\b(groq|gemini|cloudflare|cerebras|openrouter|openai|llama|qwen|gpt|provider|model|api[ _-]?key|token|quota|rate.?limit|timeout|timed out|fetch|ECONN\w*|ETIMEDOUT|stack|undefined|null|json|http|status)\b|\d{3}\s*:|\{|\}|https?:""", RegexOption.IGNORE_CASE)
    fun strip(s: String?): String = (s ?: "").replace(Regex("""\s*\[[^\]]*\]?"""), "").replace(Regex("""\s+"""), " ").trim()
    fun friendly(status: Int, message: String?, online: Boolean = true): Friendly {
        val clean = strip(message)
        val safe = if (clean.isNotEmpty() && clean.length <= 140 && !RAW.containsMatchIn(clean)) clean else ""
        val capLine = Regex("limit|resting|midnight|tomorrow", RegexOption.IGNORE_CASE)
        return when (status) {
            0 -> if (online) Friendly("Couldn’t reach Steady. Try again in a moment.", true) else Friendly("You’re offline. Your question is back in the box.", true, offline = true)
            429 -> if (capLine.containsMatchIn(safe)) Friendly(safe, !Regex("limit|resting|midnight", RegexOption.IGNORE_CASE).containsMatchIn(safe)) else Friendly(BUSY, true)
            413 -> Friendly(safe.ifEmpty { "That’s a bit long. Keep it under 1000 characters." }, false)
            404 -> Friendly("That chat is gone. Start a new one.", false, gone = true)
            503 -> Friendly(safe.ifEmpty { "Chat isn’t set up yet." }, false, off = true)
            400 -> Friendly(safe.ifEmpty { "Try asking that another way." }, false)
            401, 403 -> Friendly("Sign in again to keep chatting.", false)
            else -> Friendly(BUSY, true)
        }
    }
}

class ChatApi(private val api: Api, private val zone: () -> String = { runCatching { ZoneId.systemDefault().id }.getOrDefault("Asia/Kolkata") }) : ChatBackend {
    /** A turn can run several tool rounds on a free-tier model: allow it time. */
    override suspend fun send(chatId: String?, message: String): ChatReply {
        val r = api.call("POST", "agent/chat", buildJsonObject { if (chatId != null) put("chatId", chatId); put("message", message); put("tz", zone()) }, timeoutSec = 120)
        return ChatReply(r.str("chatId") ?: "", r.str("title") ?: "", ChatMessage.parse(r["user"]!!.jsonObject), ChatMessage.parse(r["message"]!!.jsonObject))
    }
    override suspend fun list(): List<ChatSummary> = api.call("GET", "agent/chats").arr("chats").mapNotNull { (it as? JsonObject)?.let { c ->
        ChatSummary(c.str("id") ?: return@let null, c.str("title") ?: "Chat", c.str("preview") ?: "", c.long("updatedAt") ?: 0L) } }
    override suspend fun open(id: String): Pair<ChatSummary, List<ChatMessage>> {
        val r = api.call("GET", "agent/chats/$id?tz=${zone()}", timeoutSec = 60)
        val ch = r["chat"]!!.jsonObject
        return ChatSummary(id, ch.str("title") ?: "Chat", "", ch.long("updatedAt") ?: 0L) to r.arr("messages").mapNotNull { (it as? JsonObject)?.let(ChatMessage::parse) }
    }
    override suspend fun delete(id: String) { api.call("DELETE", "agent/chats/$id") }
    override suspend fun rename(id: String, title: String) { api.call("PATCH", "agent/chats/$id", buildJsonObject { put("title", title) }) }
    override suspend fun starter(): ChatStarter? = try { ChatStarter.parse(api.call("GET", "agent/chat/starter?tz=${zone()}", timeoutSec = 30)) }
        catch (e: dev.karthikyernana.steady.net.ApiError) { if (e.status in setOf(404, 405, 501)) null else throw e }
}
