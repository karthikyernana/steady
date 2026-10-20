package dev.karthikyernana.steady.core

import dev.karthikyernana.steady.data.Task
import dev.karthikyernana.steady.data.bool
import dev.karthikyernana.steady.data.long
import dev.karthikyernana.steady.data.str
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.TextStyle
import java.time.temporal.ChronoUnit
import java.util.Locale

/**
 * Which tasks belong to a calendar day, for Today's day navigation (‹ ›, swipe) and the "Yesterday · N done" row.
 * Pure. Mirrors the web's js/core/history.js; keep the two in step (tests: DayHistoryTest.kt, tests/unit/history.test.mjs).
 *
 *  - done: on the LOCAL day of doneAt (when you actually did it); a done task without doneAt falls back to dueDate.
 *    doneAt is epoch ms, turned into a day in [zone] (never Instant.toString(), which is the UTC day).
 *  - skipped: on its dueDate (skip and "let go" keep the original date).
 *  - moved: on a PAST day, a task due that day that did not get done there: still open (waiting in today's carry-over),
 *    carried forward (carriedFrom = that day) or done on a later day.
 *  - open: on today or a future day, the open tasks planned for it.
 */
object DayHistory {
    enum class Kind { Past, Today, Future }
    enum class How { Open, Carried, Done }
    data class Moved(val task: Task, val to: String, val how: How)
    data class Day(val day: String, val kind: Kind, val done: List<Task>, val skipped: List<Task>, val moved: List<Moved>, val open: List<Task>) {
        val total get() = done.size + skipped.size + moved.size + open.size
        val hadActivity get() = done.size + skipped.size > 0
    }

    const val BACK = 366L
    const val FORWARD = 60L

    fun localDay(ms: Long?, zone: ZoneId = Dates.zone): String? = ms?.let { Instant.ofEpochMilli(it).atZone(zone).toLocalDate().toString() }
    fun doneDay(t: Task, zone: ZoneId = Dates.zone): String? = if (!t.isDone) null else localDay(t.doneAt, zone) ?: t.dueDate

    private val byTime = compareBy<Task>({ it.dueTime ?: "99:99" }, { -it.priority }, { it.createdAt })

    fun dayTasks(tasks: List<Task>, day: String, today: String = Dates.todayKey(), zone: ZoneId = Dates.zone): Day {
        val kind = when { day < today -> Kind.Past; day == today -> Kind.Today; else -> Kind.Future }
        val done = mutableListOf<Task>(); val skipped = mutableListOf<Task>(); val moved = mutableListOf<Moved>(); val open = mutableListOf<Task>()
        for (t in tasks) {
            if (t.raw.bool("deleted") == true) continue
            val due = t.dueDate; val from = t.raw.str("carriedFrom")
            when (t.status) {
                "done" -> {
                    val dd = doneDay(t, zone)
                    if (dd == day) done += t
                    else if (kind == Kind.Past && dd != null && dd > day && (due == day || from == day)) moved += Moved(t, dd, How.Done)
                }
                "skipped" -> {
                    if (due == day) skipped += t
                    else if (kind == Kind.Past && from == day && due != null && due > day) moved += Moved(t, due, How.Carried)
                }
                else -> {
                    if (due == day) { if (kind == Kind.Past) { if (t.raw.bool("letGo") != true) moved += Moved(t, today, How.Open) } else open += t }
                    else if (kind == Kind.Past && from == day && due != null && due > day) moved += Moved(t, due, How.Carried)
                }
            }
        }
        return Day(day, kind,
            done.sortedBy { it.doneAt ?: it.raw.long("updatedAt") ?: 0L },
            skipped.sortedWith(byTime), moved.sortedWith(compareBy(byTime) { it.task }), open.sortedWith(byTime))
    }

    fun summaryLine(d: Day): String {
        val bits = listOfNotNull(
            if (d.done.isNotEmpty()) "${d.done.size} done" else null,
            if (d.skipped.isNotEmpty()) "${d.skipped.size} skipped" else null,
            if (d.moved.isNotEmpty()) "${d.moved.size} moved" else null,
            if (d.open.isNotEmpty()) "${d.open.size} ${if (d.kind == Kind.Future) "planned" else "open"}" else null)
        if (bits.isNotEmpty()) return bits.joinToString(" · ")
        return when (d.kind) { Kind.Future -> "Nothing planned yet."; Kind.Today -> "Nothing here yet."; Kind.Past -> "Nothing logged this day." }
    }

    /** Today / Yesterday / Tomorrow / "Mon, 19 Oct" (+ year when not this year). */
    fun dayLabel(k: String, today: String): String {
        if (k == today) return "Today"
        if (k == Dates.keyAdd(today, -1)) return "Yesterday"
        if (k == Dates.keyAdd(today, 1)) return "Tomorrow"
        val d = LocalDate.parse(k); val t = LocalDate.parse(today)
        val s = "${d.dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.ENGLISH)}, ${d.dayOfMonth} ${d.month.getDisplayName(TextStyle.SHORT, Locale.ENGLISH)}"
        return if (d.year != t.year) "$s ${d.year}" else s
    }

    fun movedLabel(m: Moved, today: String): String {
        val w = dayLabel(m.to, today)
        return if (m.how == How.Done) "done ${if (w in setOf("Today", "Yesterday", "Tomorrow")) w.lowercase() else w}"
        else "moved to ${if (w in setOf("Today", "Tomorrow")) w.lowercase() else w}"
    }

    fun dayTitle(k: String, today: String): String = when (k) {
        Dates.keyAdd(today, -1) -> "Yesterday"
        Dates.keyAdd(today, 1) -> "Tomorrow"
        else -> LocalDate.parse(k).dayOfWeek.getDisplayName(TextStyle.FULL, Locale.ENGLISH)
    }

    fun dayDistance(k: String, today: String): String {
        val n = ChronoUnit.DAYS.between(LocalDate.parse(today), LocalDate.parse(k))
        return when { kotlin.math.abs(n) <= 1 -> ""; n < 0 -> "${-n} days ago"; else -> "in $n days" }
    }

    /** "WEDNESDAY, 21 OCTOBER" (+ year when not this year). */
    fun eyebrow(k: String, today: String): String {
        val d = LocalDate.parse(k)
        val s = Dates.longDate(d)
        return (if (d.year != LocalDate.parse(today).year) "$s ${d.year}" else s).uppercase()
    }

    fun clamp(k: String, today: String): String {
        val lo = Dates.keyAdd(today, -BACK); val hi = Dates.keyAdd(today, FORWARD)
        return if (k < lo) lo else if (k > hi) hi else k
    }
    fun step(k: String, n: Long, today: String): String = clamp(Dates.keyAdd(k, n), today)
}
