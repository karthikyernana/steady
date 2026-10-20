package dev.karthikyernana.steady.agent

import dev.karthikyernana.steady.core.Dates
import dev.karthikyernana.steady.data.*
import dev.karthikyernana.steady.net.Api
import kotlinx.serialization.json.*
import java.time.ZoneId

/**
 * The voice agent, phone side (mirror of js/data/agent.js): build the same context the web sends, ask the server to turn
 * an utterance into drafts, and apply only the drafts Karthik accepts. Every apply returns an undo.
 */
data class Draft(val type: String, val f: JsonObject, val labels: JsonObject, val confidence: Double, val needs: List<String>, val evidence: String = "") {
    companion object {
        /** What a draft still needs before it can be accepted (same rules as missing() in js/core/agent.js). */
        fun missing(type: String, f: JsonObject): List<String> {
            fun blank(k: String) = f.str(k).isNullOrBlank()
            return when (type) {
                "task", "reminder" -> listOfNotNull("title".takeIf { blank("title") }, "time".takeIf { type == "reminder" && blank("dueTime") })
                "money" -> listOfNotNull("amount".takeIf { (f.num("amount") ?: 0.0) <= 0.0 }, "category".takeIf { blank("category") })
                "complete" -> listOfNotNull("task".takeIf { blank("taskId") && blank("title") })
                "progress" -> listOfNotNull("goal".takeIf { blank("goalId") })
                "goal" -> listOfNotNull("title".takeIf { blank("title") })
                "thought" -> listOfNotNull("text".takeIf { blank("text") })
                else -> emptyList()
            }
        }
    }
    /** A copy with some fields changed; what's missing is re-checked so Accept unlocks as soon as it's fixed. */
    fun edit(vararg pairs: Pair<String, Any?>): Draft { val nf = f.with(*pairs); return copy(f = nf, needs = missing(type, nf)) }
    /** One plain sentence saying what accepting does, like the web's draft cards. */
    val sentence: String get() {
        val whenTxt = listOfNotNull(f.str("dueDate")?.let { Dates.fmtDateKey(it).replaceFirstChar { c -> c.lowercase() } }, f.str("dueTime")?.let { "at " + Dates.fmtTime(it) }).joinToString(" ")
        return when (type) {
            "reminder" -> "Reminds you to “${f.str("title")}” $whenTxt.".replace(" .", ".")
            "task" -> "Adds “${f.str("title")}” ${if (whenTxt.isEmpty()) "for today" else whenTxt}.".replace(" .", ".")
            "complete" -> "Marks “${f.str("title")}” done."
            "progress" -> "Logs progress on “${labels.str("goal") ?: f.str("title")}”."
            "goal" -> "Adds the goal “${f.str("title")}”" + ((f["milestones"] as? JsonArray)?.size?.takeIf { it > 0 }?.let { " with $it weekly steps." } ?: ".")
            "money" -> (if (f.str("kind") == "income") "Logs income of ₹" else "Logs an expense of ₹") + fmtAmount(f.num("amount") ?: 0.0) + " · " + (f.str("category") ?: "Other") + " · " + Dates.fmtDateKey(f.str("date") ?: Dates.todayKey()).lowercase() + "."
            "thought" -> "Saves “${f.str("text")}”."
            else -> title
        }
    }
    fun s(k: String) = f.str(k)
    val title: String get() = when (type) {
        "money" -> (if (f.str("kind") == "income") "Income " else "Spent ") + "₹" + fmtAmount(f.num("amount") ?: 0.0)
        "thought" -> f.str("text") ?: ""
        "goal" -> f.str("title") ?: ""
        else -> f.str("title") ?: ""
    }
    val kindLabel: String get() = when (type) {
        "task" -> "To-do"; "reminder" -> "Reminder"; "complete" -> "Done"; "progress" -> "Goal progress"; "goal" -> "New goal"
        "money" -> if (f.str("kind") == "income") "Income" else "Expense"; "thought" -> "Thought"; else -> type
    }
    val detail: String get() = when (type) {
        "task", "reminder" -> listOfNotNull(Dates.fmtDateKey(f.str("dueDate")).takeIf { it.isNotEmpty() }, f.str("dueTime")?.let { Dates.fmtTime(it) }, f.int("durationMin")?.let { "$it min" }, labels.str("goal")?.let { "→ $it" }).joinToString(" · ")
        "money" -> listOfNotNull(f.str("category"), f.str("payee"), f.str("note")?.takeIf { it.isNotBlank() }).joinToString(" · ")
        "goal" -> (f["milestones"] as? JsonArray)?.size?.let { "$it weekly milestones" } ?: ""
        "progress" -> labels.str("goal") ?: ""
        else -> ""
    }
}

fun fmtAmount(v: Double): String {
    val whole = Math.abs(v).let { if (it % 1.0 == 0.0) "%.0f".format(it) else "%.2f".format(it) }
    val (int, frac) = whole.split(".").let { it[0] to it.getOrNull(1) }
    val last3 = int.takeLast(3); val rest = int.dropLast(3)
    val grouped = if (rest.isEmpty()) last3 else rest.reversed().chunked(2).joinToString(",").reversed() + "," + last3
    return (if (v < 0) "−" else "") + grouped + (frac?.let { ".$it" } ?: "")
}

data class Plan(val drafts: List<Draft>, val clarification: String?, val provider: String?)
data class Applied(val label: String, val changes: List<Triple<String, String, JsonObject?>>)

class Agent(private val store: Store, private val api: Api) {
    private fun clip(s: String?, n: Int): String { val v = (s ?: "").replace(Regex("[\\u0000-\\u001f\\u007f]"), " ").trim(); return if (v.length > n) v.take(n - 1) + "…" else v }

    fun context(s: Snapshot): JsonObject {
        val t = Dates.todayKey(); val limit = Dates.keyAdd(t, 14)
        val open = s.tasks.filter { it.isOpen && (it.dueDate == null || it.dueDate!! <= limit) }
            .sortedWith(compareBy<Task>({ it.dueDate ?: "9" }, { it.dueTime ?: "99" })).take(40)
        val done = s.tasks.filter { it.isDone && it.doneAt != null }.sortedByDescending { it.doneAt }.take(10)
        val cats = s.money.take(300).groupingBy { it.category }.eachCount().entries.sortedByDescending { it.value }.take(20).map { it.key }
        return buildJsonObject {
            put("v", 1); put("tz", ZoneId.systemDefault().id); put("today", t)
            putJsonObject("profile") { put("name", s.profile.str("name") ?: ""); put("wake", s.profile.str("wake") ?: "07:00"); put("sleep", s.profile.str("sleep") ?: "23:30") }
            put("defaultReminder", s.settings.bool("defaultReminder") != false)
            putJsonArray("tasks") { open.forEach { x -> addJsonObject { put("id", x.id); put("title", clip(x.title, 90)); put("due", x.dueDate); put("time", x.dueTime); put("goalId", x.goalId) } } }
            putJsonArray("done") { done.forEach { x -> addJsonObject { put("id", x.id); put("title", clip(x.title, 90)); put("doneOn", x.doneAt?.let { doneDay(it) }) } } }
            putJsonArray("goals") { s.goals.take(12).forEach { g -> addJsonObject {
                put("id", g.id); put("title", clip(g.title, 90)); put("target", g.target)
                putJsonArray("milestones") { g.milestones.filter { !it.done }.take(6).forEach { m -> addJsonObject { put("id", m.id); put("title", clip(m.title, 80)); put("week", m.week) } } }
                putJsonArray("actions") { g.raw.arr("actions").take(6).forEach { a -> (a as? JsonObject)?.let { addJsonObject { put("id", it.str("id") ?: ""); put("title", clip(it.str("title"), 60)) } } } }
            } } }
            putJsonArray("money") { s.money.take(15).forEach { m -> addJsonObject { put("date", m.date); put("kind", m.kind); put("amount", m.amount); put("category", m.category); put("payee", m.payee); put("note", clip(m.note, 60)) } } }
            putJsonArray("categories") { cats.forEach { add(it) } }
            putJsonArray("thoughts") { s.thoughts.take(5).forEach { add(clip(it.text, 140)) } }
        }
    }

    /** Server agent when signed in and reachable; otherwise the on-device rules, so typing always works. */
    suspend fun plan(text: String, signedIn: Boolean = true): Plan {
        if (!signedIn) return Rules.plan(text, store.snapshot.value)
        return try { planServer(text) } catch (e: dev.karthikyernana.steady.net.ApiError) {
            if (e.status == 0 || e.status >= 500 || e.status == 404) Rules.plan(text, store.snapshot.value) else throw e
        }
    }

    /** Tell the server which drafts were accepted and how they were corrected, so it learns categories and payees. */
    suspend fun learn(pairs: List<Pair<Draft, Draft>>) {
        if (pairs.isEmpty()) return
        fun j(d: Draft) = buildJsonObject { put("type", d.type); put("f", d.f); put("evidence", d.evidence) }
        runCatching { api.call("POST", "agent/learn", buildJsonObject { putJsonArray("pairs") { pairs.forEach { (b, a) -> addJsonObject { put("before", j(b)); put("after", j(a)) } } } }) }
    }

    private suspend fun planServer(text: String): Plan {
        val r = api.call("POST", "agent/plan", buildJsonObject { put("text", text); put("context", context(store.snapshot.value)); put("tz", ZoneId.systemDefault().id) }, timeoutSec = 60)
        val drafts = (r["drafts"] as? JsonArray).orEmpty().mapNotNull { el ->
            val o = el as? JsonObject ?: return@mapNotNull null
            Draft(o.str("type") ?: return@mapNotNull null, o["f"] as? JsonObject ?: JsonObject(emptyMap()), o["labels"] as? JsonObject ?: JsonObject(emptyMap()),
                o.num("confidence") ?: 0.6, (o["needs"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.contentOrNull }, o.str("evidence") ?: "").let { d -> d.copy(needs = (d.needs + Draft.missing(d.type, d.f)).distinct()) }
        }
        return Plan(drafts, r.str("clarification"), r.str("provider"))
    }

    suspend fun transcribe(bytes: ByteArray, mime: String): String = api.transcribe(bytes, mime).str("transcript") ?: ""

    /** Apply one accepted draft (same writes as applyDraft in js/data/agent.js). */
    fun apply(d: Draft): Applied {
        val f = d.f; val changes = mutableListOf<Triple<String, String, JsonObject?>>()
        fun put(coll: String, rec: JsonObject) { val id = rec.str("id")!!; changes += Triple(coll, id, store.get(coll, id)); store.save(coll, rec) }
        val today = Dates.todayKey()
        fun doneTask(title: String, goalId: String?) = put("tasks", buildJsonObject {
            put("id", uid()); put("title", title); put("priority", 2); put("dueDate", today); put("dueTime", JsonNull); put("durationMin", JsonNull); put("reminder", false)
            put("status", "done"); put("doneAt", System.currentTimeMillis()); put("goalId", goalId); put("via", "voice") })
        val label = when (d.type) {
            "task", "reminder" -> {
                put("tasks", buildJsonObject {
                    put("id", uid()); put("title", f.str("title") ?: ""); put("priority", f.int("priority") ?: 2); put("dueDate", f.str("dueDate") ?: today)
                    put("dueTime", f.str("dueTime")); put("durationMin", f.int("durationMin")); put("reminder", (f.bool("reminder") == true) && f.str("dueTime") != null)
                    put("status", "open"); put("doneAt", JsonNull); put("goalId", f.str("goalId")); put("via", "voice") })
                if (d.type == "reminder") "Reminder set" else "Task added"
            }
            "complete" -> {
                val t = f.str("taskId")?.let { store.get("tasks", it) }?.let(::Task)
                if (t != null) put("tasks", t.raw.with("status" to "done", "doneAt" to System.currentTimeMillis(), "dueDate" to (if (t.dueDate != null && t.dueDate!! > today) today else t.dueDate)))
                else doneTask(f.str("title") ?: "Done", f.str("goalId"))
                "Marked done"
            }
            "progress" -> {
                val g = f.str("goalId")?.let { store.get("goals", it) }?.let(::Goal) ?: throw IllegalStateException("That goal is gone.")
                if (f.bool("markMilestone") == true && f.str("milestoneId") != null)
                    put("goals", g.raw.with("milestones" to JsonArray(g.raw.arr("milestones").map { m -> val mo = m.jsonObject; if (mo.str("id") == f.str("milestoneId")) mo.with("done" to true, "doneAt" to System.currentTimeMillis()) else mo })))
                if (f.bool("logTask") != false) doneTask(f.str("title") ?: "Worked on ${g.title}", g.id)
                "Progress logged"
            }
            "goal" -> {
                val ws = Dates.weekStart().toString()
                put("goals", buildJsonObject {
                    put("id", uid()); put("title", f.str("title") ?: ""); put("why", f.str("why") ?: "")
                    put("target", f.str("target") ?: Dates.today().plusDays(84).toString())
                    putJsonArray("milestones") { (f["milestones"] as? JsonArray).orEmpty().forEachIndexed { i, m -> addJsonObject { put("id", uid()); put("title", (m as? JsonPrimitive)?.contentOrNull ?: ""); put("week", Dates.keyAdd(ws, i * 7L)); put("done", false) } } }
                    putJsonArray("actions") { (f["actions"] as? JsonArray).orEmpty().forEach { a -> addJsonObject { put("id", uid()); put("title", (a as? JsonPrimitive)?.contentOrNull ?: "") } } }
                    put("order", store.snapshot.value.goals.size)
                })
                "Goal added"
            }
            "money" -> {
                put("money", buildJsonObject {
                    put("id", uid()); put("kind", if (f.str("kind") == "income") "income" else "expense"); put("amount", Math.round((f.num("amount") ?: 0.0) * 100) / 100.0)
                    put("category", f.str("category") ?: "Other"); put("payee", f.str("payee")); put("note", f.str("note") ?: ""); put("date", f.str("date") ?: today); put("source", "voice")
                })
                if (f.str("kind") == "income") "Income logged" else "Expense logged"
            }
            "thought" -> {
                val text = f.str("text") ?: ""
                put("thoughts", buildJsonObject { put("id", uid()); put("text", text); put("tags", JsonArray(tagsIn(text).map(::JsonPrimitive))); put("mood", f.int("mood") ?: 3); put("kind", f.str("kind") ?: "note"); put("via", "voice") })
                "Thought saved"
            }
            else -> throw IllegalStateException("Unknown action ${d.type}")
        }
        return Applied(label, changes)
    }

    fun undo(a: Applied) { for ((coll, id, prev) in a.changes.reversed()) if (prev != null) store.save(coll, prev) else store.remove(coll, id) }
}

/** The local calendar day a task was finished on (ISO yyyy-MM-dd in the phone's zone, never UTC: 01:00 IST is that day, not the day before). */
internal fun doneDay(at: Long, zone: ZoneId = ZoneId.systemDefault()): String = java.time.Instant.ofEpochMilli(at).atZone(zone).toLocalDate().toString()
