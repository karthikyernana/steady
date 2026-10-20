package dev.karthikyernana.steady.data

import kotlinx.serialization.json.*

// Steady's data contract (see js/core/schema.js, docs/DATA_MODEL.md). Records are kept as JSON objects so fields this
// app does not know (written by a newer web version) survive every edit: typed views read, `with` writes.

const val SCHEMA_VERSION = 2
val COLLECTIONS = listOf("tasks", "goals", "thoughts", "checkins", "meta", "money")

fun JsonObject.str(k: String): String? = (this[k] as? JsonPrimitive)?.takeIf { it !is JsonNull && it.isString }?.content
fun JsonObject.num(k: String): Double? = (this[k] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.doubleOrNull
fun JsonObject.long(k: String): Long? = num(k)?.toLong()
fun JsonObject.int(k: String): Int? = num(k)?.toInt()
fun JsonObject.bool(k: String): Boolean? = (this[k] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.booleanOrNull
fun JsonObject.arr(k: String): JsonArray = (this[k] as? JsonArray) ?: JsonArray(emptyList())

fun JsonObject.with(vararg pairs: Pair<String, Any?>): JsonObject = buildJsonObject {
    for ((k, v) in this@with) put(k, v)
    for ((k, v) in pairs) put(k, toJson(v))
}

fun toJson(v: Any?): JsonElement = when (v) {
    null -> JsonNull
    is JsonElement -> v
    is String -> JsonPrimitive(v)
    is Boolean -> JsonPrimitive(v)
    is Int -> JsonPrimitive(v)
    is Long -> JsonPrimitive(v)
    is Double -> JsonPrimitive(if (v == Math.floor(v) && !v.isInfinite() && Math.abs(v) < 1e15) v.toLong() as Number else v)
    is Float -> toJson(v.toDouble())
    is List<*> -> JsonArray(v.map { toJson(it) })
    is Map<*, *> -> JsonObject(v.entries.associate { (k, x) -> k.toString() to toJson(x) })
    else -> JsonPrimitive(v.toString())
}

data class Task(val raw: JsonObject) {
    val id get() = raw.str("id")!!
    val title get() = raw.str("title") ?: ""
    val priority get() = raw.int("priority") ?: 2
    val dueDate get() = raw.str("dueDate")
    val dueTime get() = raw.str("dueTime")
    val durationMin get() = raw.int("durationMin")
    val reminder get() = raw.bool("reminder") ?: false
    val status get() = raw.str("status") ?: "open"
    val doneAt get() = raw.long("doneAt")
    val goalId get() = raw.str("goalId")
    val createdAt get() = raw.long("createdAt") ?: 0L
    val isOpen get() = status == "open"
    val isDone get() = status == "done"
}

data class Milestone(val raw: JsonObject) {
    val id get() = raw.str("id") ?: ""
    val title get() = raw.str("title") ?: ""
    val week get() = raw.str("week")
    val done get() = raw.bool("done") ?: false
}

data class Goal(val raw: JsonObject) {
    val id get() = raw.str("id")!!
    val title get() = raw.str("title") ?: ""
    val why get() = raw.str("why") ?: ""
    val target get() = raw.str("target")
    val milestones get() = raw.arr("milestones").mapNotNull { (it as? JsonObject)?.let(::Milestone) }
    val actions get() = raw.arr("actions").mapNotNull { (it as? JsonObject)?.str("title") }
    val order get() = raw.int("order") ?: 0
    val createdAt get() = raw.long("createdAt") ?: 0L
}

data class Thought(val raw: JsonObject) {
    val id get() = raw.str("id")!!
    val text get() = raw.str("text") ?: ""
    val tags get() = raw.arr("tags").mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
    val mood get() = raw.int("mood") ?: 3
    val kind get() = raw.str("kind") ?: "note"
    val createdAt get() = raw.long("createdAt") ?: 0L
}

data class Money(val raw: JsonObject) {
    val id get() = raw.str("id")!!
    val kind get() = raw.str("kind") ?: "expense"
    val amount get() = raw.num("amount") ?: 0.0
    val category get() = raw.str("category") ?: "Other"
    val note get() = raw.str("note") ?: ""
    val payee get() = raw.str("payee")
    val date get() = raw.str("date") ?: ""
    val createdAt get() = raw.long("createdAt") ?: 0L
    val isIncome get() = kind == "income"
}

data class Checkin(val raw: JsonObject) {
    val id get() = raw.str("id")!!
    val date get() = raw.str("date") ?: ""
    val energy get() = raw.int("energy") ?: 3
    val win get() = raw.str("win") ?: ""
    val selfCare get() = raw.str("selfCare") ?: ""
}

// Entity defaults, exactly as js/core/schema.js (normalizers never drop unknown fields).
val DEFAULTS: Map<String, JsonObject> = mapOf(
    "tasks" to buildJsonObject { put("title", ""); put("priority", 2); put("dueDate", JsonNull); put("dueTime", JsonNull); put("durationMin", JsonNull); put("reminder", false); put("status", "open"); put("doneAt", JsonNull); put("goalId", JsonNull) },
    "goals" to buildJsonObject { put("title", ""); put("why", ""); put("target", JsonNull); put("milestones", JsonArray(emptyList())); put("actions", JsonArray(emptyList())) },
    "thoughts" to buildJsonObject { put("text", ""); put("tags", JsonArray(emptyList())); put("mood", 3); put("kind", "note") },
    "checkins" to buildJsonObject { put("date", JsonNull); put("energy", 3); put("win", ""); put("selfCare", "") },
    "money" to buildJsonObject { put("kind", "expense"); put("amount", 0); put("category", "Other"); put("note", ""); put("payee", JsonNull); put("date", JsonNull); put("source", "manual") },
    "meta" to buildJsonObject { },
)

fun normalize(coll: String, rec: JsonObject): JsonObject? {
    val id = rec.str("id") ?: return null
    val at = rec.long("updatedAt") ?: return null
    if (rec.bool("deleted") == true) return buildJsonObject { put("id", id); put("deleted", true); put("updatedAt", at) }
    return buildJsonObject { for ((k, v) in DEFAULTS[coll] ?: JsonObject(emptyMap())) put(k, v); for ((k, v) in rec) put(k, v) }
}

val TAG_RX = Regex("(?<![\\p{L}\\p{M}\\p{N}_&#/])#([\\p{L}\\p{M}\\p{N}_-]*[\\p{L}\\p{M}\\p{N}_])")
fun tagsIn(text: String): List<String> = TAG_RX.findAll(text).map { it.groupValues[1].lowercase() }.distinct().toList()

fun uid(): String = java.lang.Long.toString(System.currentTimeMillis(), 36) + (1..8).map { "0123456789abcdefghijklmnopqrstuvwxyz".random() }.joinToString("")
