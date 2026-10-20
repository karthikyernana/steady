package dev.karthikyernana.steady.agent

import dev.karthikyernana.steady.core.Dates
import dev.karthikyernana.steady.core.MoneyParse
import dev.karthikyernana.steady.core.QuickParse
import dev.karthikyernana.steady.data.Snapshot
import dev.karthikyernana.steady.data.Task
import dev.karthikyernana.steady.data.str
import dev.karthikyernana.steady.data.bool
import kotlinx.serialization.json.*
import java.time.LocalDateTime

/**
 * On-device understanding (mirror of rulesPlan in js/core/agent.js, kept modest): used when the phone is offline,
 * signed out, or the server can't be reached. Splits the utterance into clauses and reuses the app's own quick-add
 * and money parsers, so "remind me to call amma in 10 minutes, spent 200 on lunch" becomes two drafts with no network.
 */
object Rules {
    private fun ci(p: String) = Regex(p, setOf(RegexOption.IGNORE_CASE))
    private val SPLIT = ci("""\s*(?:[;.!?]+\s+|,\s*(?:and\s+|then\s+)?|\s+(?:and then|and also|and|then|also|plus)\s+|\s+(?:ఇంకా|తర్వాత|మరియు|inka|tarvata)\s+)\s*""")
    private val DONE = ci("""\b(done|did|finished|completed|wrapped up|sent|posted|called|wrote|studied|practi[cs]ed|solved|submitted|shipped|attended|cleaned|worked on)\b|చేశాను|చేసాను|అయిపోయింది|\b(chesanu|chesa|ayipoyindi)\b""")
    private val FUTURE = ci("""\b(will|need to|have to|should|tomorrow|later|remind)\b|రేపు""")
    private val REMIND = ci("""^\s*(?:please\s+)?(?:remind(?: me)?|reminder|set (?:a|an) (?:reminder|alarm)|alarm|notify me|ping me|alert me)\b|గుర్తు\s*చేయ|\bgurthu\s*chey""")
    private val GOAL = ci("""\b(?:my (?:new )?goal(?: is)?|new goal|goal:)\s*|లక్ష్యం""")
    private val THOUGHT = ci("""^\s*(?:idea|note|thought|journal)\s*[:\-]|^\s*(?:i feel|i felt|feeling|i think|i wonder|i realised|i realized)\b|ఆలోచన|అనిపిస్తుంది""")
    private val MONEY = ci("""\b(spent|spend|paid|pay|bought|cost|rs|inr|rupees?|bucks|received|credited|salary|stipend|refund|kharchu)\b|₹|ఖర్చు|రూపాయ""")
    // "set a reminder for 5 minutes" / "alarm for 30 min" mean from now (same rule as the server)
    private val FOR_MIN = ci("""\bfor (\d{1,3}) ?(minutes?|mins?|m|hours?|hrs?|h)\b""")

    private fun words(s: String) = Regex("[\\p{L}\\p{N}]+").findAll(s.lowercase()).map { it.value }.filter { it.length > 2 }.toSet()
    fun similarity(a: String, b: String): Double { val A = words(a); val B = words(b); if (A.isEmpty() || B.isEmpty()) return 0.0; return A.count { it in B }.toDouble() / minOf(A.size, B.size) }

    fun plan(text: String, s: Snapshot, now: LocalDateTime = LocalDateTime.now(Dates.zone)): Plan {
        val wake = s.profile.str("wake") ?: "07:00"; val sleep = s.profile.str("sleep") ?: "23:30"
        val open = s.tasks.filter(Task::isOpen)
        val drafts = mutableListOf<Draft>()
        for (c0 in text.split(SPLIT).map { it.trim() }.filter { it.length > 1 }) {
            var c = c0
            val evidence = c0
            fun draft(type: String, f: JsonObject, conf: Double, labels: JsonObject = JsonObject(emptyMap())) = Draft(type, f, labels, conf, Draft.missing(type, f), evidence)
            when {
                REMIND.containsMatchIn(c) -> {
                    FOR_MIN.find(c)?.let { m -> c = c.replace(m.value, "in ${m.groupValues[1]} ${m.groupValues[2]}") }
                    val bare = c.replace(ci("""^\s*(?:please\s+)?(?:set (?:a|an) (?:reminder|alarm)|alarm|notify me|ping me|alert me)\s*(?:to|for|about|that)?\s*"""), "remind me to ")
                    val q = QuickParse.parse(" $bare ", now, wake, sleep, true, s.goals)
                    val title = if (Regex("^(?:remind me\\b|\\d|$)", RegexOption.IGNORE_CASE).containsMatchIn(q.title.trim())) "Reminder" else q.title
                    drafts += draft("reminder", buildJsonObject { put("title", title); put("dueDate", q.dueDate); put("dueTime", q.dueTime); put("durationMin", q.durationMin); put("priority", q.priority); put("reminder", true); put("goalId", q.goalId) }, if (q.dueTime != null) 0.8 else 0.55)
                }
                GOAL.containsMatchIn(c) -> {
                    val t = c.replace(GOAL, "").replace(ci("^\\s*(to|is)\\s+"), "").trim().replaceFirstChar { it.uppercase() }
                    if (t.isNotEmpty()) drafts += draft("goal", buildJsonObject { put("title", t); put("milestones", JsonArray(emptyList())) }, 0.65)
                }
                THOUGHT.containsMatchIn(c) -> {
                    val kind = if (ci("^\\s*idea").containsMatchIn(c)) "idea" else if (ci("\\b(feel|felt|feeling)\\b").containsMatchIn(c)) "journal" else "note"
                    drafts += draft("thought", buildJsonObject { put("text", c.replace(ci("^\\s*(?:idea|note|thought|journal)\\s*[:\\-]\\s*"), "")); put("kind", kind); put("mood", 3) }, 0.7)
                }
                MONEY.containsMatchIn(c) || (Regex("\\d").containsMatchIn(c) && MoneyParse.payee(c) != null) -> {
                    val m = MoneyParse.parse(c, now.toLocalDate())
                    drafts += draft("money", buildJsonObject { put("kind", m.kind); put("amount", m.amount); put("category", m.category); put("payee", m.payee); put("note", m.note); put("date", m.date) }, if (m.amount != null) 0.8 else 0.4)
                }
                DONE.containsMatchIn(c) && !FUTURE.containsMatchIn(c) -> {
                    val what = c.replace(DONE, " ").replace(ci("\\b(today|i|i've|have|the|my|just|already)\\b"), " ").replace(Regex("\\s+"), " ").trim()
                    val best = open.map { it to similarity(what, it.title) }.filter { it.second >= 0.5 }.maxByOrNull { it.second }?.first
                    drafts += draft("complete", buildJsonObject { put("taskId", best?.id); put("title", best?.title ?: what.replaceFirstChar { it.uppercase() }); put("goalId", best?.goalId) }, if (best != null) 0.75 else 0.5)
                }
                else -> {
                    val q = QuickParse.parse(" $c ", now, wake, sleep, s.settings.bool("defaultReminder") != false, s.goals)
                    if (q.title.length >= 2) drafts += draft(if (q.reminder && q.dueTime != null) "reminder" else "task",
                        buildJsonObject { put("title", q.title); put("dueDate", q.dueDate); put("dueTime", q.dueTime); put("durationMin", q.durationMin); put("priority", q.priority); put("reminder", q.reminder); put("goalId", q.goalId) }, 0.6)
                }
            }
        }
        return Plan(drafts.take(8), if (drafts.isEmpty()) "I couldn't find anything to add. Try “spent 200 on lunch” or “remind me to call home at 7”." else null, "device")
    }
}
