package dev.karthikyernana.steady.core

import dev.karthikyernana.steady.data.Snapshot
import dev.karthikyernana.steady.data.Task
import dev.karthikyernana.steady.data.str
import java.time.LocalDateTime

/** The parts of js/core/engine.js + js/core/voice.js the phone shows: streaks, best hours, the 14-day ledger, the day's line. */
data class Analysis(
    val today: String,
    val streakCurrent: Int, val streakLongest: Int,
    val bestStart: Int?, val doneOn: Map<String, Int>, val hourHist: IntArray,
    val last14: List<Pair<String, Int>>, val avgDone: Double, val daysAway: Int?,
    val bestShare: Double = 0.0, val enough: Boolean = false, val loadCap: Int = 3, val checkins14: Int = 0, val rate30: Double? = null,
    val bestDay: Pair<Int, Double>? = null, val worstDay: Pair<Int, Double>? = null,
)

object Engine {
    private const val MIN_DATA = 6

    fun analyze(s: Snapshot, now: LocalDateTime = LocalDateTime.now(Dates.zone)): Analysis {
        val today = now.toLocalDate().toString()
        val doneOn = HashMap<String, Int>(); val hourHist = IntArray(24)
        val done = s.tasks.filter { it.isDone && it.doneAt != null }
        for (t in done) {
            val k = Dates.keyOf(t.doneAt!!)
            doneOn[k] = (doneOn[k] ?: 0) + 1
            if (k >= Dates.keyAdd(today, -60)) hourHist[java.time.Instant.ofEpochMilli(t.doneAt!!).atZone(Dates.zone).hour]++
        }
        val checkinDays = s.checkins.map { it.date }.toSet()
        val total = hourHist.sum()
        var bestStart: Int? = null; var bestCount = 0
        if (total >= MIN_DATA) for (h in 0 until 24) { val c = hourHist[h] + hourHist[(h + 1) % 24]; if (c > bestCount) { bestCount = c; bestStart = h } }
        fun active(k: String) = (doneOn[k] ?: 0) > 0 || k in checkinDays
        var cur = 0; var k = if (active(today)) today else Dates.keyAdd(today, -1)
        while (active(k)) { cur++; k = Dates.keyAdd(k, -1) }
        var longest = 0; var run = 0
        val keys = (doneOn.keys + checkinDays).filter { it.isNotEmpty() }.sorted()
        if (keys.isNotEmpty()) { var x = keys.first(); var guard = 0; while (x <= today && guard++ < 4000) { if (active(x)) { run++; longest = maxOf(longest, run) } else run = 0; x = Dates.keyAdd(x, 1) } }
        var d14 = 0; var act = 0
        for (i in 1..14) { val c = doneOn[Dates.keyAdd(today, -i.toLong())] ?: 0; d14 += c; if (c > 0) act++ }
        val last14 = (13 downTo 0).map { i -> val kk = Dates.keyAdd(today, -i.toLong()); kk to (doneOn[kk] ?: 0) }
        val lastActive = (done.mapNotNull { it.doneAt } + s.checkins.mapNotNull { it.raw["updatedAt"]?.toString()?.toLongOrNull() }).maxOrNull()
        val away = lastActive?.let { java.time.temporal.ChronoUnit.DAYS.between(java.time.LocalDate.parse(Dates.keyOf(it)), now.toLocalDate()).toInt() }
        val avg = if (act > 0) d14.toDouble() / maxOf(act, 7) else 0.0
        // planned vs done per day (by due date), for weekday rates and the 30-day rate
        val planned = HashMap<String, IntArray>()
        for (t in s.tasks) { val k = t.dueDate ?: continue; if (k > today) continue; val a = planned.getOrPut(k) { IntArray(2) }; a[0]++; if (t.isDone) a[1]++ }
        val wdP = IntArray(7); val wdD = IntArray(7)
        for ((k, a) in planned) { if (k < Dates.keyAdd(today, -56) || k == today) continue; val wd = java.time.LocalDate.parse(k).dayOfWeek.value % 7; wdP[wd] += a[0]; wdD[wd] += a[1] }
        val rated = (0 until 7).filter { wdP[it] >= 3 }.map { it to wdD[it].toDouble() / wdP[it] }
        val bestDay = if (rated.size >= 3) rated.maxBy { it.second } else null
        val worstDay = if (rated.size >= 3) rated.minBy { it.second } else null
        var p30 = 0; var d30 = 0; for (i in 1..30) planned[Dates.keyAdd(today, -i.toLong())]?.let { p30 += it[0]; d30 += it[1] }
        val ci14 = (1..14).count { Dates.keyAdd(today, -it.toLong()) in checkinDays }
        return Analysis(today, cur, longest, bestStart, doneOn, hourHist, last14, avg, away,
            bestShare = if (total > 0) bestCount.toDouble() / total else 0.0, enough = done.size >= MIN_DATA, loadCap = maxOf(3, Math.round(avg * 1.25).toInt() + 1),
            checkins14 = ci14, rate30 = if (p30 > 0) d30.toDouble() / p30 else null, bestDay = bestDay, worstDay = worstDay)
    }

    private val DAYS = listOf("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")
    private fun windowLabel(h: Int): String {
        val a = fmtHour(h); val b = fmtHour((h + 2) % 24)
        return if (a.endsWith("AM") == b.endsWith("AM")) "${a.dropLast(3)}–$b" else "$a and $b"
    }
    /** What Steady has learned, the same lines as remember() in js/core/engine.js (text, detail). */
    fun remember(a: Analysis): List<Pair<String, String?>> {
        if (!a.enough) return listOf("I'm still learning you. After a few days of finishing things, the patterns show up here." to null)
        val out = mutableListOf<Pair<String, String?>>()
        val pct = { x: Double -> "${Math.round(x * 100)}%" }
        if (a.bestStart != null && a.bestShare >= 0.25) out += "You finish most of your tasks between ${windowLabel(a.bestStart)}." to "${pct(a.bestShare)} of completions in the last 60 days."
        if (a.bestDay != null && a.worstDay != null && a.bestDay.first != a.worstDay.first && a.bestDay.second - a.worstDay.second >= 0.15)
            out += "${DAYS[a.bestDay.first]}s are your strongest day. ${DAYS[a.worstDay.first]}s run lighter." to "${pct(a.bestDay.second)} vs ${pct(a.worstDay.second)} of planned tasks done."
        if (a.avgDone >= 1) out += "You usually finish about ${Math.round(a.avgDone)} things a day. Planning around ${a.loadCap} keeps days winnable." to "Based on the last 14 days."
        if (a.streakLongest >= 3) out += (if (a.streakCurrent >= 2) "You're on a ${a.streakCurrent}-day run. Your best so far is ${a.streakLongest}." else "Your best run so far is ${a.streakLongest} days in a row. One small thing today starts the next one.") to null
        return out
    }

    fun sortTasks(xs: List<Task>) = xs.sortedWith(compareBy<Task>({ Dates.toMin(it.dueTime) ?: 9999 }, { -it.priority }, { it.createdAt }))

    fun fmtHour(h: Int): String { val ap = if (h in 12..23) "PM" else "AM"; return "${if (h % 12 == 0) 12 else h % 12} $ap" }

    fun todayLine(s: Snapshot, a: Analysis, total: Int, done: Int, open: Int, now: LocalDateTime = LocalDateTime.now(Dates.zone)): String {
        val h = now.hour; val m = h * 60 + now.minute
        var sleep = Dates.toMin(s.profile.str("sleep") ?: "23:30") ?: 1410; if (sleep < 360) sleep += 1440
        val mNow = if (m < 360) m + 1440 else m
        val yEnergy = s.checkins.firstOrNull { it.date == Dates.keyAdd(a.today, -1) }?.energy
        val best = a.bestStart
        if (total > 0 && open == 0) return if (done > 0) "All $done done. Rest is part of the plan." else "Everything decided. Rest is part of the plan."
        if (mNow >= sleep - 45 && open > 0) return "It's late. Whatever's left can wait for tomorrow; sleep is the better investment."
        if ((a.daysAway ?: 0) >= 2) return "Welcome back. No catching up needed; start with one small thing."
        if (yEnergy != null && yEnergy <= 2) return "Your energy was low yesterday. Go gentle and pick the easy wins first."
        if (total == 0) return if (h < 12) "Pick the one thing that would make today count." else "Nothing planned yet. One small thing is enough to start."
        if (best != null) {
            if (h >= best && h < best + 2) return "You're in your best hours now. Good time for the hard one."
            if (h < best && best - h <= 3) return "Your best hours start at ${fmtHour(best)}. Save the hardest task for then."
        }
        if (a.streakCurrent >= 3) return "Day ${a.streakCurrent + if (done > 0) 0 else 1} of your run. Keep it small and keep it going."
        if (done > 0 && open > 0) return "$done down, $open to go. Steady pace."
        return if (h < 12) "$open on the list. Start with the smallest; momentum does the rest." else "$open still open. Pick one and finish it."
    }

    fun isCheckinTime(s: Snapshot, now: LocalDateTime = LocalDateTime.now(Dates.zone)): Boolean {
        var sleep = Dates.toMin(s.profile.str("sleep") ?: "23:30") ?: 1410; if (sleep < 360) sleep += 1440
        val n = now.hour * 60 + now.minute
        return n >= minOf(sleep - 180, 18 * 60) || n < 4 * 60
    }
}
