package dev.karthikyernana.steady.core

import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.time.temporal.TemporalAdjusters
import java.util.Locale

/** Date keys are local "YYYY-MM-DD" strings and times "HH:MM", exactly as the web app stores them. */
object Dates {
    val zone: ZoneId get() = ZoneId.systemDefault()
    fun today(): LocalDate = LocalDate.now(zone)
    fun todayKey(): String = today().toString()
    fun key(d: LocalDate): String = d.toString()
    fun parse(k: String?): LocalDate? = k?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
    fun keyAdd(k: String, days: Long): String = LocalDate.parse(k).plusDays(days).toString()
    fun keyOf(ms: Long): String = Instant.ofEpochMilli(ms).atZone(zone).toLocalDate().toString()
    fun toMin(hhmm: String?): Int? = hhmm?.split(":")?.takeIf { it.size == 2 }?.let { (h, m) -> h.toIntOrNull()?.let { hh -> m.toIntOrNull()?.let { hh * 60 + it } } }
    fun hhmm(min: Int): String { val m = ((min % 1440) + 1440) % 1440; return "%02d:%02d".format(m / 60, m % 60) }
    fun epochAt(dateKey: String, minuteOfDay: Int): Long = LocalDate.parse(dateKey).atStartOfDay(zone).plusMinutes(minuteOfDay.toLong()).toInstant().toEpochMilli()
    fun weekStart(d: LocalDate = today()): LocalDate = d.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))

    fun fmtTime(hhmm: String?): String {
        val m = toMin(hhmm) ?: return ""
        val h = m / 60; val mi = m % 60
        val ap = if (h >= 12) "PM" else "AM"
        val h12 = if (h % 12 == 0) 12 else h % 12
        return if (mi == 0) "$h12 $ap" else "$h12:%02d $ap".format(mi)
    }
    fun fmtDateKey(k: String?, relative: Boolean = true): String {
        val d = parse(k) ?: return ""
        val t = today()
        if (relative) when (d) { t -> return "Today"; t.plusDays(1) -> return "Tomorrow"; t.minusDays(1) -> return "Yesterday" }
        val dow = d.dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.ENGLISH)
        val mon = d.month.getDisplayName(TextStyle.SHORT, Locale.ENGLISH)
        return if (d.year == t.year) "$dow, ${d.dayOfMonth} $mon" else "${d.dayOfMonth} $mon ${d.year}"
    }
    fun longDate(d: LocalDate = today()): String = d.format(DateTimeFormatter.ofPattern("EEEE, d MMMM", Locale.ENGLISH))
    fun greeting(now: LocalDateTime = LocalDateTime.now(zone)): String = when (now.hour) {
        in 0..4 -> "Still up"; in 5..11 -> "Good morning"; in 12..16 -> "Good afternoon"; else -> "Good evening"
    }
    fun nowMin(): Int { val t = LocalTime.now(zone); return t.hour * 60 + t.minute }
}
