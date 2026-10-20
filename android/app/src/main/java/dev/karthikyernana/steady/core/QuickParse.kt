package dev.karthikyernana.steady.core

import dev.karthikyernana.steady.data.Goal
import java.time.LocalDate
import java.time.LocalDateTime

/**
 * Natural quick-add, a faithful port of js/core/parse.js:
 *   "remind me to call mom tomorrow evening"   "gym fri 6am 45m"   "dsa 2 problems at 9 !"   "pay rent on 1st"
 */
data class Parsed(
    val title: String, val priority: Int, val dueDate: String, val dueTime: String?, val durationMin: Int?,
    val reminder: Boolean, val goalId: String?, val chips: List<String>,
)

object QuickParse {
    private val WD = listOf("sun", "mon", "tue", "wed", "thu", "fri", "sat")
    private val MON = listOf("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")
    private val STOP = "a an the to for of and or with on in at my me i be do get go make take have has is are this that it up out some more".split(" ").toSet()
    private val FILLER = Regex("^\\s*(?:(?:please\\s+)?remind me (?:to|about)|reminder(?: to)?:?|don'?t forget (?:to)?|do not forget (?:to)?|i (?:need|have|want|got) to|need to|have to|gotta|i should|should|todo:?|to-do:?|task:?)\\s+", RegexOption.IGNORE_CASE)
    private val DAYPART = linkedMapOf("morning" to 9, "this morning" to 9, "afternoon" to 15, "this afternoon" to 15, "evening" to 19, "this evening" to 19, "tonight" to 21, "at night" to 21,
        "noon" to 12, "midnight" to 0, "after lunch" to 14, "before lunch" to 12, "eod" to 18, "end of day" to 18, "at lunch" to 13)
    private fun ci(p: String) = Regex(p, RegexOption.IGNORE_CASE)

    fun parse(input: String, now: LocalDateTime = LocalDateTime.now(Dates.zone), wake: String = "07:00", sleep: String = "23:30", defaultReminder: Boolean = true, goals: List<Goal> = emptyList()): Parsed {
        var s = " ${input.replace(FILLER, " ")} "
        val today = now.toLocalDate()
        var priority = 2; var dueDate = today; var dueTime: String? = null; var durationMin: Int? = null
        var reminder = Regex("^\\s*(?:please\\s+)?remind me", RegexOption.IGNORE_CASE).containsMatchIn(input)
        fun cut(re: Regex): MatchResult? { val m = re.find(s) ?: return null; s = s.substring(0, m.range.first) + " " + s.substring(m.range.last + 1); return m }

        if (cut(ci("\\s(?:!{1,3}|urgent|important|asap|p1|!high|high priority)(?=\\s)")) != null) priority = 3
        else if (cut(ci("\\s(?:p3|!low|low priority|someday|maybe)(?=\\s)")) != null) priority = 1
        if (cut(ci("\\s(?:remind(?: me)?|reminder|ping me|notify me|alert me)(?=\\s)")) != null) reminder = true

        var rel: Int? = null
        cut(ci("\\sin (\\d+|an?|one|two|half an?) (hours?|hrs?|h|minutes?|mins?|m)(?=\\s)"))?.let { m ->
            val w = m.groupValues[1].lowercase()
            val n = if (w.startsWith("half")) 0.5 else mapOf("a" to 1.0, "an" to 1.0, "one" to 1.0, "two" to 2.0)[w] ?: w.toDouble()
            rel = Math.round(if (m.groupValues[2].lowercase().startsWith("h")) n * 60 else n).toInt()
        }

        var m = cut(ci("\\s(?:for\\s)?(\\d+)\\s?h(?:rs?|ours?)?\\s?(\\d{1,2})\\s?m?(?:in(?:ute)?s?)?(?=\\s)"))
        if (m != null) durationMin = m.groupValues[1].toInt() * 60 + m.groupValues[2].toInt()
        else {
            m = cut(ci("\\s(?:for\\s)?(\\d+(?:\\.\\d+)?)\\s?(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)(?=\\s)"))
            if (m != null) { val n = m.groupValues[1].toDouble(); durationMin = Math.round(if (m.groupValues[2].lowercase().startsWith("h")) n * 60 else n).toInt() }
            else if (cut(ci("\\s(?:for\\s)?half an? hour(?=\\s)")) != null) durationMin = 30
            else if (cut(ci("\\s(?:for\\s)?(?:an|one) hour(?=\\s)")) != null) durationMin = 60
        }

        var dateSet = false
        fun setDate(d: LocalDate) { dueDate = d; dateSet = true }
        fun nextWd(target: Int): LocalDate { var diff = (target - today.dayOfWeek.value % 7 + 7) % 7; if (diff == 0) diff = 7; return today.plusDays(diff.toLong()) }
        fun future(d: Int, mo: Int, y: String?): LocalDate? {
            val yr = if (!y.isNullOrEmpty()) (if (y.toInt() < 100) 2000 + y.toInt() else y.toInt()) else today.year
            var dt = runCatching { LocalDate.of(yr, mo + 1, d) }.getOrNull() ?: return null
            if (y.isNullOrEmpty() && dt < today) dt = runCatching { LocalDate.of(yr + 1, mo + 1, d) }.getOrNull() ?: return null
            return dt
        }
        val dow = today.dayOfWeek.value % 7 // 0 = Sunday, as in JS
        if (cut(ci("\\s(?:day after tomorrow|overmorrow)(?=\\s)")) != null) setDate(today.plusDays(2))
        else if (cut(ci("\\s(?:tomorrow|tmrw|tmr|tom)(?=\\s)")) != null) setDate(today.plusDays(1))
        else if (cut(ci("\\stoday(?=\\s)")) != null) dateSet = true
        else if (cut(ci("\\sin (\\d+|a|one|two|three) (day|days|week|weeks)(?=\\s)")).also { m = it } != null) {
            val w = m!!.groupValues[1].lowercase(); val n = mapOf("a" to 1, "one" to 1, "two" to 2, "three" to 3)[w] ?: w.toInt()
            setDate(today.plusDays((if (m!!.groupValues[2].lowercase().startsWith("w")) n * 7 else n).toLong()))
        } else if (cut(ci("\\snext week(?=\\s)")) != null) setDate(nextWd(1))
        else if (cut(ci("\\s(?:this |the )?weekend(?=\\s)")) != null) setDate(if (dow == 6 || dow == 0) today else nextWd(6))
        else if (cut(Regex("\\s(?:on\\s)?(\\d{4})-(\\d{1,2})-(\\d{1,2})(?=\\s)")).also { m = it } != null) runCatching { LocalDate.of(m!!.groupValues[1].toInt(), m!!.groupValues[2].toInt(), m!!.groupValues[3].toInt()) }.getOrNull()?.let(::setDate)
        else if (cut(Regex("\\s(?:on\\s)?(\\d{1,2})[/.-](\\d{1,2})(?:[/.-](\\d{2,4}))?(?=\\s)")).also { m = it } != null) future(m!!.groupValues[1].toInt(), m!!.groupValues[2].toInt() - 1, m!!.groupValues[3])?.let(::setDate)
        else if (cut(ci("\\s(?:on\\s)?(\\d{1,2})(?:st|nd|rd|th)?\\s(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*(?:\\s(\\d{4}))?(?=\\s)")).also { m = it } != null)
            future(m!!.groupValues[1].toInt(), MON.indexOf(m!!.groupValues[2].take(3).lowercase()), m!!.groupValues[3])?.let(::setDate)
        else if (cut(ci("\\s(?:on\\s)?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\s(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s(\\d{4}))?(?=\\s)")).also { m = it } != null)
            future(m!!.groupValues[2].toInt(), MON.indexOf(m!!.groupValues[1].take(3).lowercase()), m!!.groupValues[3])?.let(::setDate)
        else if (cut(ci("\\s(?:on\\s)?(?:the\\s)?(\\d{1,2})(st|nd|rd|th)(?=\\s)")).also { m = it } != null) {
            val d = m!!.groupValues[1].toInt()
            var dt = runCatching { LocalDate.of(today.year, today.monthValue, d) }.getOrNull()
            if (dt == null || dt < today) dt = runCatching { today.plusMonths(1).withDayOfMonth(d) }.getOrNull()
            dt?.let(::setDate)
        } else if (cut(ci("\\s(?:on\\s|this\\s|(next)\\s)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|urday|sday)?(?=\\s)")).also { m = it } != null) {
            val target = WD.indexOf(m!!.groupValues[2].take(3).lowercase())
            var diff = (target - dow + 7) % 7; if (diff == 0) diff = 7
            setDate(today.plusDays(diff.toLong()))
        }

        var h: Int? = null; var mi = 0; var ap: String? = null
        if (rel != null) {
            val t = now.plusMinutes(rel!!.toLong())
            dueTime = "%02d:%02d".format(t.hour, t.minute); dueDate = t.toLocalDate(); dateSet = true
            if (!reminder) reminder = defaultReminder
        } else {
            val tm = cut(ci("\\s(?:at|@|by|around|~)\\s?(\\d{1,2})(?:[:.](\\d{2}))?\\s?(am|pm|a|p)?(?=\\s)"))
                ?: cut(ci("\\s(\\d{1,2})(?:[:.](\\d{2}))?\\s?(am|pm)(?=\\s)"))
                ?: cut(Regex("\\s(\\d{1,2}):(\\d{2})()(?=\\s)"))
            if (tm != null) { h = tm.groupValues[1].toInt(); mi = tm.groupValues[2].ifEmpty { "0" }.toInt(); ap = tm.groupValues[3].lowercase().ifEmpty { null } }
            else for ((k, v) in DAYPART.entries.sortedByDescending { it.key.length }) {
                val re = ci("\\s(?:in the |at |by )?$k(?=\\s)")
                val at = re.find(s)?.range?.first ?: -1
                if (at > 0 && s.substring(0, at).isNotBlank()) { cut(re); h = v; ap = "x"; break }
            }
        }
        if (h != null && h!! <= 24 && mi < 60) {
            var hh = h!!
            when (ap) {
                "pm", "p" -> if (hh < 12) hh += 12
                "am", "a" -> if (hh == 12) hh = 0
                null -> if (hh <= 12) hh = resolveAmbiguous(hh, mi, now, wake, sleep, dueDate == today)
            }
            dueTime = "%02d:%02d".format(hh % 24, mi)
            if (!dateSet && (hh % 24) * 60 + mi <= now.hour * 60 + now.minute) { dueDate = today.plusDays(1); dateSet = true }
            if (!reminder) reminder = defaultReminder
        }

        var title = s.replace(Regex("\\s+"), " ").replace(ci("^\\s*(?:to|and|of)\\s+"), "").replace(ci("\\s+(?:on|at|by|for)\\s*$"), "").trim().ifEmpty { input.trim() }
        if (title.isNotEmpty()) title = title.substring(0, 1).uppercase() + title.substring(1)

        fun words(t: String) = Regex("[a-z0-9]+").findAll(t.lowercase()).map { it.value }.filter { it.length > 2 && it !in STOP }.toSet()
        val tw = words(title); var best: Goal? = null; var bestScore = 0
        for (g in goals) {
            val gw = words((listOf(g.title) + g.actions + g.milestones.map { it.title }).joinToString(" "))
            var score = 0
            for (w in tw) if (w in gw || (w.length > 4 && gw.any { x -> x.length > 4 && (x.startsWith(w) || w.startsWith(x)) })) score++
            if (score > bestScore) { bestScore = score; best = g }
        }
        val goalId = if (best != null && bestScore >= 1) best!!.id else null

        val chips = buildList {
            if (dateSet || dueDate != today) add(Dates.fmtDateKey(dueDate.toString()))
            dueTime?.let { add(Dates.fmtTime(it)) }
            durationMin?.let { d -> add(if (d >= 60 && d % 60 == 0) "${d / 60} h" else if (d > 60) "${d / 60} h ${d % 60} min" else "$d min") }
            if (priority == 3) add("High priority"); if (priority == 1) add("Low priority")
            if (reminder) add("Reminder")
            if (goalId != null) add("→ ${best!!.title}")
        }
        return Parsed(title, priority, dueDate.toString(), dueTime, durationMin, reminder, goalId, chips)
    }

    private fun resolveAmbiguous(h: Int, mi: Int, now: LocalDateTime, wake: String, sleep: String, isToday: Boolean): Int {
        val w = Dates.toMin(wake) ?: 420; val sl0 = Dates.toMin(sleep) ?: 1410; val sl = if (sl0 <= w) sl0 + 1440 else sl0
        val cands = listOf(h % 12, h % 12 + 12)
        fun inWindow(c: Int): Boolean { val v = c * 60 + mi; return (v in w..sl) || (v + 1440 in w..sl) }
        val nowMin = now.hour * 60 + now.minute
        val ok = cands.filter(::inWindow)
        if (isToday) ok.firstOrNull { it * 60 + mi > nowMin }?.let { return it }
        if (ok.isNotEmpty()) return if (h == 12) 12 else ok[0]
        return h
    }
}
