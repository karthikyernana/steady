package dev.karthikyernana.steady.ui.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.karthikyernana.steady.core.Dates
import dev.karthikyernana.steady.data.Task
import dev.karthikyernana.steady.ui.*
import kotlinx.coroutines.delay

/** "in 35 min", "now", "2 h 10 min ago" relative to the current minute. */
fun untilLabel(target: Int, now: Int): String {
    val d = target - now
    fun span(m: Int) = if (m >= 60) "${m / 60} h" + (if (m % 60 != 0) " ${m % 60} min" else "") else "$m min"
    return when { d in -4..4 -> "now"; d > 0 -> "in ${span(d)}"; else -> "${span(-d)} ago" }
}

/**
 * Today at a glance: the next thing with a live countdown, then the waking day as a line with every timed task
 * as a dot (filled when done) and a "now" marker. Reads in one second, no sentences.
 */
@Composable
fun DayStrip(todays: List<Task>, wake: String, sleep: String) {
    var now by remember { mutableIntStateOf(Dates.nowMin()) }
    LaunchedEffect(Unit) { while (true) { delay(30_000); now = Dates.nowMin() } }
    val timed = todays.filter { it.dueTime != null }.sortedBy { Dates.toMin(it.dueTime) }
    if (timed.isEmpty()) return
    val next = timed.firstOrNull { it.isOpen && (Dates.toMin(it.dueTime) ?: 0) >= now - 15 }
    val w0 = (Dates.toMin(wake) ?: 420).coerceAtMost(timed.minOf { Dates.toMin(it.dueTime)!! } - 30).coerceAtLeast(0)
    var w1 = Dates.toMin(sleep) ?: 1410; if (w1 <= w0) w1 += 1440
    w1 = maxOf(w1, timed.maxOf { Dates.toMin(it.dueTime)!! } + 30)
    val accent = P.accent; val line = P.line2; val ink = P.ink; val hi = P.hi; val surface = P.surface

    SCard(Modifier.testTag("daystrip")) {
        if (next != null) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Eyebrow("Next up · " + untilLabel(Dates.toMin(next.dueTime)!!, now), color = P.accent)
                    Spacer(Modifier.height(2.dp))
                    Text(next.title, style = Type.h3, color = P.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Text(Dates.fmtTime(next.dueTime), style = Type.h3.copy(fontSize = 18.sp), color = P.ink2)
            }
        } else {
            Eyebrow("Timed tasks"); Spacer(Modifier.height(2.dp))
            Text(if (timed.all { !it.isOpen }) "All timed tasks done." else "Nothing else timed today.", style = Type.h3, color = P.ink)
        }
        Spacer(Modifier.height(14.dp))
        Canvas(Modifier.fillMaxWidth().height(22.dp)) {
            val span = (w1 - w0).toFloat(); val y = size.height / 2
            fun x(m: Int) = ((m - w0) / span).coerceIn(0f, 1f) * size.width
            drawRoundRect(line, Offset(0f, y - 1.5.dp.toPx()), Size(size.width, 3.dp.toPx()), CornerRadius(2.dp.toPx()))
            val nx = x(now); if (now in w0..w1) drawRoundRect(accent.copy(alpha = 0.35f), Offset(0f, y - 1.5.dp.toPx()), Size(nx, 3.dp.toPx()), CornerRadius(2.dp.toPx()))
            for (t in timed) {
                val cx = x(Dates.toMin(t.dueTime)!!); val r = if (t == next) 7.dp.toPx() else 5.dp.toPx()
                drawCircle(surface, r + 2.dp.toPx(), Offset(cx, y))
                if (t.isOpen) drawCircle(if (t.priority == 3) hi else ink, r, Offset(cx, y), style = androidx.compose.ui.graphics.drawscope.Stroke(2.dp.toPx()))
                else drawCircle(accent, r, Offset(cx, y))
            }
            if (now in w0..w1) { drawRoundRect(ink, Offset(nx - 1.dp.toPx(), 0f), Size(2.dp.toPx(), size.height), CornerRadius(1.dp.toPx())) }
        }
        Spacer(Modifier.height(6.dp))
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(Dates.fmtTime(Dates.hhmm(w0)), style = Type.label.copy(fontSize = 11.sp), color = P.muted)
            Spacer(Modifier.weight(1f))
            Legend(P.accent, true, "done"); Spacer(Modifier.width(10.dp)); Legend(P.ink, false, "to do"); Spacer(Modifier.weight(1f))
            Text(Dates.fmtTime(Dates.hhmm(w1)), style = Type.label.copy(fontSize = 11.sp), color = P.muted)
        }
    }
}

@Composable
private fun Legend(c: androidx.compose.ui.graphics.Color, filled: Boolean, label: String) {
    Box(Modifier.size(9.dp).clip(CircleShape).then(if (filled) Modifier.background(c) else Modifier.border(1.5.dp, c, CircleShape)))
    Spacer(Modifier.width(4.dp)); Text(label, style = Type.label.copy(fontSize = 11.sp), color = P.muted)
}
