package dev.karthikyernana.steady.ui.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.karthikyernana.steady.agent.ChatCard
import dev.karthikyernana.steady.ui.*
import java.time.LocalDate

/**
 * Chat cards, drawn natively in Compose (Canvas + Text). Input is a card the server already resolved from the user's
 * own rows (server/chat-cards.js), so every figure here is real; the renderers only draw. Mirrors js/ui/cards.js.
 * Each card is tagged "card-<kind>" (exposed as a resource id), the big Stat figure "cc-value".
 */
@Composable
fun ChatCardView(card: ChatCard, modifier: Modifier = Modifier) {
    val tag = "card-${card.kind.lowercase()}"
    if (card.kind == "Callout") { Callout(card, modifier.testTag(tag)); return }
    SCard(modifier.testTag(tag), pad = 16.dp) {
        if (card.title != null || card.period != null) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text(card.title ?: "", style = Type.bodyM, color = P.ink, modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
                card.period?.let { Text(it, style = Type.label.copy(fontSize = 12.sp), color = P.muted, maxLines = 1) }
            }
            Spacer(Modifier.height(10.dp))
        }
        when (card.kind) {
            "Stat" -> Stat(card)
            "Line" -> Line(card)
            "Bar" -> BarCard(card)
            "Donut" -> Donut(card)
            "Heatmap" -> Heat(card)
            "ProgressList" -> Progress(card)
            "TaskList" -> TaskRows(card)
            "Timeline" -> Timeline(card)
            "Table" -> Table(card)
            "Note" -> Text(card.text, style = Type.body, color = P.ink2)
        }
    }
}

@Composable private fun Empty(card: ChatCard, fallback: String = "Nothing here yet.") = Text(card.message ?: fallback, style = Type.small, color = P.muted)

@Composable
private fun Stat(card: ChatCard) {
    Text(card.display, style = Type.display.copy(fontSize = 32.sp, lineHeight = 36.sp), color = P.ink, modifier = Modifier.testTag("cc-value"))
    val label = card.label?.takeIf { !it.equals(card.title, ignoreCase = true) }
    if (label != null) Text(label, style = Type.body, color = P.ink2)
    card.compareText?.let { Spacer(Modifier.height(4.dp)); Text(it, style = Type.small, color = P.muted) }
}

@Composable
private fun Line(card: ChatCard) {
    val pts = card.points
    if (card.empty || pts.size < 2) { Empty(card, "Not enough data to draw a trend yet."); return }
    val acc = P.accent; val ink = P.ink; val grid = P.line
    val max = pts.maxOf { it.value }.coerceAtLeast(1e-9)
    val hi = pts.indices.maxByOrNull { pts[it].value } ?: 0
    Text("Highest ${pts[hi].display} · ${pts[hi].label}", style = Type.label.copy(fontSize = 12.sp), color = P.muted)
    Spacer(Modifier.height(8.dp))
    Canvas(Modifier.fillMaxWidth().height(110.dp).semantics { contentDescription = "${card.title ?: "Trend"}: total ${card.totalDisplay}" }) {
        val w = size.width; val h = size.height - 2.dp.toPx(); val top = 6.dp.toPx()
        val x = { i: Int -> i * w / (pts.size - 1) }
        val y = { v: Double -> (h - (v / max) * (h - top)).toFloat() }
        val line = Path().apply { pts.forEachIndexed { i, p -> if (i == 0) moveTo(x(i), y(p.value)) else lineTo(x(i), y(p.value)) } }
        val area = Path().apply { addPath(line); lineTo(w, h); lineTo(0f, h); close() }
        drawLine(grid, Offset(0f, h), Offset(w, h), 1.dp.toPx())
        drawPath(area, acc.copy(alpha = 0.14f))
        drawPath(line, acc, style = Stroke(2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
        drawCircle(ink, 3.5.dp.toPx(), Offset(x(hi), y(pts[hi].value)))
    }
    Spacer(Modifier.height(4.dp))
    Row(Modifier.fillMaxWidth()) {
        val idx = listOf(0, pts.size / 2, pts.lastIndex).distinct()
        idx.forEachIndexed { k, i -> Text(pts[i].label.removePrefix("Week of "), style = Type.label.copy(fontSize = 10.5.sp), color = P.muted, maxLines = 1, softWrap = false,
            textAlign = when (k) { 0 -> TextAlign.Start; idx.lastIndex -> TextAlign.End; else -> TextAlign.Center }, modifier = Modifier.weight(1f)) }
    }
    card.totalDisplay?.let { Spacer(Modifier.height(6.dp)); Text("Total $it", style = Type.small, color = P.muted) }
}

@Composable
private fun BarCard(card: ChatCard) {
    val pts = card.points
    if (card.empty || pts.isEmpty()) { Empty(card); return }
    val hi = pts.indices.maxByOrNull { pts[it].value } ?: -1
    if (pts.size <= 8 && pts.all { it.label.length <= 6 }) {
        Bars(pts.map { it.value.toFloat() }, pts.map { it.label }, height = 100.dp, highlightLast = false, highlight = hi)
        Spacer(Modifier.height(4.dp)); Text("Highest ${pts[hi].display} · ${pts[hi].label}", style = Type.small, color = P.muted)
        return
    }
    // long labels (categories, payees) read better as rows
    val max = pts.maxOf { it.value }.coerceAtLeast(1e-9)
    Column(verticalArrangement = Arrangement.spacedBy(9.dp)) {
        pts.take(12).forEachIndexed { i, p ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(p.label, style = Type.small, color = P.ink2, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.width(96.dp))
                Box(Modifier.weight(1f).height(10.dp).clip(RoundedCornerShape(999.dp)).background(P.surface2)) {
                    Box(Modifier.fillMaxWidth((p.value / max).toFloat().coerceIn(0.02f, 1f)).fillMaxHeight().clip(RoundedCornerShape(999.dp)).background(if (i == hi) P.accent else P.line2))
                }
                Text(p.display, style = Type.small.copy(fontWeight = FontWeight.Medium), color = P.ink, modifier = Modifier.padding(start = 10.dp), maxLines = 1)
            }
        }
    }
}

@Composable
private fun segColors(): List<Color> = listOf(P.accent, P.hi, P.heat[2], P.warn, P.heat[3], P.line2)

@Composable
private fun Donut(card: ChatCard) {
    val pts = card.points.filter { it.value > 0 }
    if (card.empty || pts.isEmpty()) { Empty(card); return }
    val total = pts.sumOf { it.value }; val cols = segColors(); val track = P.surface2
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(112.dp), contentAlignment = Alignment.Center) {
            Canvas(Modifier.fillMaxSize().semantics { contentDescription = "${card.title ?: "Shares"}: total ${card.totalDisplay}" }) {
                val sw = 14.dp.toPx(); val inset = sw / 2; val sz = Size(size.width - sw, size.height - sw)
                drawArc(track, 0f, 360f, false, Offset(inset, inset), sz, style = Stroke(sw))
                var start = -90f
                pts.forEachIndexed { i, p -> val sweep = (p.value / total * 360).toFloat(); drawArc(cols[i % cols.size], start, sweep, false, Offset(inset, inset), sz, style = Stroke(sw)); start += sweep }
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(card.totalDisplay ?: "", style = Type.bodyM.copy(fontSize = 14.sp), color = P.ink, maxLines = 1)
                Text("total", style = Type.label.copy(fontSize = 10.sp), color = P.muted)
            }
        }
        Spacer(Modifier.width(16.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            pts.forEachIndexed { i, p ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(10.dp).clip(RoundedCornerShape(3.dp)).background(cols[i % cols.size]))
                    Text(p.label, style = Type.small, color = P.ink2, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(start = 8.dp))
                    Text(p.display, style = Type.small.copy(fontWeight = FontWeight.Medium), color = P.ink, maxLines = 1)
                    Text("${Math.round(p.value / total * 100)}%", style = Type.small, color = P.muted, textAlign = TextAlign.End, modifier = Modifier.width(40.dp))
                }
            }
        }
    }
}

@Composable
private fun Heat(card: ChatCard) {
    val days = card.days
    if (days.isEmpty()) { Empty(card); return }
    val heat = P.heat; val max = card.max.coerceAtLeast(1.0)
    val lead = (LocalDate.parse(days[0].date).dayOfWeek.value - 1)        // Monday = 0
    val weeks = (lead + days.size + 6) / 7
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val gap = 3.dp; val cell = ((maxWidth - gap * (weeks - 1)) / weeks).coerceAtMost(16.dp)
        Canvas(Modifier.width(cell * weeks + gap * (weeks - 1)).height(cell * 7 + gap * 6).semantics { contentDescription = card.title ?: "Activity by day" }) {
            val cp = cell.toPx(); val gp = gap.toPx(); val r = CornerRadius(cp * 0.22f)
            days.forEachIndexed { i, d ->
                val p = lead + i; val w = p / 7; val row = p % 7
                val lvl = if (d.value <= 0) 0 else minOf(4, Math.ceil(d.value / max * 4).toInt())
                drawRoundRect(heat[lvl], Offset(w * (cp + gp), row * (cp + gp)), Size(cp, cp), r)
            }
        }
    }
    Spacer(Modifier.height(8.dp))
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.End, modifier = Modifier.fillMaxWidth()) {
        Text("Less ", style = Type.label.copy(fontSize = 11.sp), color = P.muted)
        heat.forEach { Box(Modifier.padding(horizontal = 2.dp).size(10.dp).clip(RoundedCornerShape(3.dp)).background(it)) }
        Text(" More", style = Type.label.copy(fontSize = 11.sp), color = P.muted)
    }
}

@Composable
private fun Progress(card: ChatCard) {
    val items = card.progress
    if (items.isEmpty()) { Empty(card, "No goals yet."); return }
    val track = P.line; val acc = P.accent
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        items.forEach { g ->
            Column {
                Row { Text(g.label, style = Type.bodyM, color = P.ink, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis); Text(g.display, style = Type.small, color = P.muted) }
                Spacer(Modifier.height(6.dp))
                Canvas(Modifier.fillMaxWidth().height(8.dp)) {
                    val r = CornerRadius(size.height / 2); drawRoundRect(track, cornerRadius = r)
                    val w = size.width * g.frac; if (w > 0f) drawRoundRect(acc, size = Size(maxOf(w, size.height), size.height), cornerRadius = r)
                }
            }
        }
    }
}

private fun fmtTime(hhmm: String): String = runCatching { val (h, m) = hhmm.split(":").map(String::toInt); "${if (h % 12 == 0) 12 else h % 12}${if (m > 0) ":%02d".format(m) else ""} ${if (h >= 12) "PM" else "AM"}" }.getOrDefault(hhmm)

@Composable
private fun TaskRows(card: ChatCard) {
    val items = card.tasks
    if (items.isEmpty()) { Empty(card, "No tasks there."); return }
    items.forEachIndexed { i, t ->
        if (i > 0) HorizontalDivider(color = P.line)
        Row(Modifier.fillMaxWidth().heightIn(min = 40.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(16.dp).clip(CircleShape).let { if (t.done) it.background(P.accent) else it.border(1.6.dp, P.line2, CircleShape) })
            Text(t.title, style = Type.body.copy(textDecoration = if (t.done) TextDecoration.LineThrough else null), color = if (t.done) P.muted else P.ink,
                modifier = Modifier.weight(1f).padding(horizontal = 10.dp), maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(listOfNotNull(t.due, t.time?.let(::fmtTime)).joinToString(" · "), style = Type.label.copy(fontSize = 12.sp), color = P.muted, maxLines = 1)
        }
    }
    if (card.count > items.size) Text("and ${card.count - items.size} more", style = Type.small, color = P.muted, modifier = Modifier.padding(top = 6.dp))
}

@Composable
private fun Timeline(card: ChatCard) {
    val items = card.timeline
    if (items.isEmpty()) { Empty(card, "Nothing found."); return }
    val acc = P.accent; val line = P.line; val surface = P.surface
    Column {
        items.forEachIndexed { i, x ->
            Row(Modifier.height(IntrinsicSize.Min)) {
                Canvas(Modifier.width(16.dp).fillMaxHeight()) {
                    val cx = 5.dp.toPx()
                    if (i < items.lastIndex) drawLine(line, Offset(cx, 14.dp.toPx()), Offset(cx, size.height), 2.dp.toPx())
                    if (i > 0) drawLine(line, Offset(cx, 0f), Offset(cx, 6.dp.toPx()), 2.dp.toPx())
                    drawCircle(surface, 5.dp.toPx(), Offset(cx, 10.dp.toPx())); drawCircle(acc, 5.dp.toPx(), Offset(cx, 10.dp.toPx()), style = Stroke(2.dp.toPx()))
                }
                Column(Modifier.weight(1f).padding(start = 8.dp, bottom = if (i < items.lastIndex) 12.dp else 0.dp)) {
                    Text(x.date + (x.time?.let { " · ${fmtTime(it)}" } ?: ""), style = Type.label.copy(fontSize = 12.sp), color = P.muted)
                    Text(x.title, style = Type.body, color = P.ink)
                    x.sub?.let { Text(it, style = Type.small, color = P.muted) }
                }
            }
        }
    }
}

private val NUMERIC = Regex("^[−+\\-₹\\d.,\\s%]+$|^–$")
@Composable
private fun Table(card: ChatCard) {
    val cols = card.columns; val rows = card.rows
    if (rows.isEmpty() || cols.isEmpty()) { Empty(card); return }
    val numeric = cols.indices.map { i -> rows.all { NUMERIC.matches(it.getOrNull(i) ?: "") } }
    val weights = cols.indices.map { i -> if (numeric[i]) 0.8f else 1.3f }
    Row(Modifier.fillMaxWidth().padding(bottom = 6.dp)) {
        cols.forEachIndexed { i, c -> Text(c.uppercase(), style = Type.eyebrow.copy(fontSize = 10.sp), color = P.muted, textAlign = if (numeric[i]) TextAlign.End else TextAlign.Start, modifier = Modifier.weight(weights[i]).padding(horizontal = 3.dp), maxLines = 1) }
    }
    rows.forEach { r ->
        HorizontalDivider(color = P.line)
        Row(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
            cols.indices.forEach { i -> Text(r.getOrNull(i) ?: "", style = Type.small, color = P.ink, textAlign = if (numeric[i]) TextAlign.End else TextAlign.Start,
                modifier = Modifier.weight(weights[i]).padding(horizontal = 3.dp), maxLines = 2, overflow = TextOverflow.Ellipsis) }
        }
    }
}

@Composable
private fun Callout(card: ChatCard, modifier: Modifier) {
    val (bg, border) = when (card.tone) { "good" -> P.accentSoft to P.accentLine; "warn" -> P.warn.copy(alpha = 0.10f) to P.warn.copy(alpha = 0.3f); else -> P.surface2 to P.line }
    Text(listOfNotNull(card.title, card.text).joinToString("  "), style = Type.body, color = P.ink,
        modifier = modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(bg).border(1.dp, border, RoundedCornerShape(12.dp)).padding(horizontal = 14.dp, vertical = 12.dp))
}
