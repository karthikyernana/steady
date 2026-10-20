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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.text.drawText
import androidx.compose.ui.graphics.drawscope.clipRect
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

/** Whether this card's charts animate in (a fresh answer, the starter, a chat first shown this session). */
val LocalCardMotion = androidx.compose.runtime.compositionLocalOf { true }

@Composable private fun motion(): Boolean = LocalCardMotion.current && !reducedMotion()

/** Count-up for a figure the server formatted ("₹1,200", "40%", "10 days"): the same shape, ending on the exact text. */
internal object CountUp {
    private val NUM = Regex("""^(\D*?)(\d[\d,]*(?:\.\d+)?)(.*)$""")
    data class Parts(val prefix: String, val value: Double, val decimals: Int, val grouped: Boolean, val indian: Boolean, val suffix: String)
    fun parts(display: String): Parts? {
        val m = NUM.find(display) ?: return null
        val (pre, num, suf) = m.destructured
        val v = num.replace(",", "").toDoubleOrNull() ?: return null
        return Parts(pre, v, num.substringAfter('.', "").length, num.contains(','), pre.contains('₹'), suf)
    }
    fun format(p: Parts, v: Double): String {
        val r = if (p.decimals == 0) Math.round(v).toString() else "%.${p.decimals}f".format(java.util.Locale.ENGLISH, v)
        val int = r.substringBefore('.'); val frac = r.substringAfter('.', "")
        val g = if (!p.grouped || int.length <= 3) int else if (p.indian) {
            val last = int.takeLast(3); val head = int.dropLast(3)
            head.reversed().chunked(2).joinToString(",").reversed() + "," + last
        } else int.reversed().chunked(3).joinToString(",").reversed()
        val suf = if (Math.round(v) == 1L && p.decimals == 0) p.suffix.replace(Regex("""^ (day|task|thought|entry|item|milestone)s\b""")) { " ${it.groupValues[1]}" }.replace(" entrys", " entry") else p.suffix
        return p.prefix + g + (if (frac.isNotEmpty()) ".$frac" else "") + suf
    }
}

@Composable
private fun Stat(card: ChatCard) {
    val anim = motion()
    val parts = remember(card.display) { CountUp.parts(card.display) }
    val p by rememberGrow(anim && parts != null && parts.value > 0, androidx.compose.animation.core.tween(720, 60, androidx.compose.animation.core.FastOutSlowInEasing), key = card.display)
    val shown = if (parts == null || p >= 1f) card.display else CountUp.format(parts, parts.value * p)
    Text(shown, style = Type.display.copy(fontSize = 34.sp, lineHeight = 38.sp, fontFeatureSettings = "tnum"), color = P.ink, modifier = Modifier.testTag("cc-value").semantics { contentDescription = card.display })
    val label = card.statLabel?.takeIf { !it.equals(card.title, ignoreCase = true) }
    if (label != null) Text(label, style = Type.body, color = P.ink2)
    card.compareText?.let { t ->
        Spacer(Modifier.height(8.dp))
        val delta = (card.data["compare"] as? kotlinx.serialization.json.JsonObject)?.let { (it["delta"] as? kotlinx.serialization.json.JsonPrimitive)?.content?.toDoubleOrNull() } ?: 0.0
        // a positive delta means more: good for things done, not for money spent
        val good = if (card.money) delta < 0 else delta > 0
        val (bg, fg) = when { delta == 0.0 -> P.surface2 to P.muted; good -> P.accentSoft to P.ink2; else -> P.warn.copy(alpha = 0.12f) to P.ink2 }
        Text(t, style = Type.small, color = fg, modifier = Modifier.clip(RoundedCornerShape(999.dp)).background(bg).padding(horizontal = 10.dp, vertical = 4.dp).enterUp(anim, 380, 6))
    }
    val trend = card.trend
    if (trend.size >= 2 && trend.any { it.value > 0 }) {
        Spacer(Modifier.height(10.dp))
        val acc = P.accent; val stub = P.line2; val muted = P.muted
        val grow by rememberGrow(anim, androidx.compose.animation.core.spring(dampingRatio = 0.85f, stiffness = 120f), key = card.id + "-trend")
        val mx = trend.maxOf { it.value }.coerceAtLeast(1e-9)
        Canvas(Modifier.fillMaxWidth().height(34.dp).testTag("cc-trend").semantics { contentDescription = "Last ${trend.size} days: " + trend.joinToString { "${it.short ?: it.label} ${it.display}" } }) {
            val n = trend.size; val gap = 6.dp.toPx(); val bw = (size.width - gap * (n - 1)) / n; val r = CornerRadius(minOf(3.dp.toPx(), bw / 3))
            trend.forEachIndexed { i, p ->
                val x0 = i * (bw + gap)
                if (p.value <= 0) drawRoundRect(stub, Offset(x0, size.height - 2.dp.toPx()), Size(bw, 2.dp.toPx()), CornerRadius(1.dp.toPx()))
                else { val h = ((p.value / mx).toFloat() * size.height * grow).coerceAtLeast(2.dp.toPx()); drawRoundRect(if (i == n - 1) acc else acc.copy(alpha = 0.4f), Offset(x0, size.height - h), Size(bw, h), r) }
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = 3.dp)) { trend.forEach { p -> Text(dev.karthikyernana.steady.agent.ChatSeries.short(p, trend.size), style = Type.label.copy(fontSize = 9.5.sp), color = muted, textAlign = TextAlign.Center, maxLines = 1, softWrap = false, modifier = Modifier.weight(1f)) } }
    }
}

/** Compact label over a bar ("₹1.2k"), from the real value; the exact figure stays in the card's text. */
private fun compact(p: dev.karthikyernana.steady.agent.Point, money: Boolean): String {
    if (p.display.length <= 5) return p.display
    val v = p.value; val pre = if (money) "₹" else ""
    return when { v >= 1e7 -> "$pre${"%.1f".format(v / 1e7).removeSuffix(".0")}Cr"; v >= 1e5 -> "$pre${"%.1f".format(v / 1e5).removeSuffix(".0")}L"
        v >= 1e3 -> "$pre${"%.1f".format(v / 1e3).removeSuffix(".0")}k"; else -> p.display }
}

@Composable
private fun Line(card: ChatCard) {
    val pts = card.series
    if (card.empty || pts.size < 2) { Empty(card, "Not enough data to draw a trend yet."); return }
    val acc = P.accent; val ink = P.ink; val grid = P.line; val muted = P.muted; val surface = P.surface
    val max = pts.maxOf { it.value }.coerceAtLeast(1e-9)
    val hi = pts.indices.maxByOrNull { pts[it].value } ?: 0
    val days = dev.karthikyernana.steady.agent.ChatSeries.isDays(pts)
    val prog by rememberGrow(motion(), androidx.compose.animation.core.tween(900, 80, androidx.compose.animation.core.FastOutSlowInEasing), key = card.id)
    val tm = androidx.compose.ui.text.rememberTextMeasurer()
    val hiLabel = pts[hi].display; val labelStyle = Type.label.copy(fontSize = 11.sp, color = ink)
    Text("Highest ${pts[hi].display} · ${pts[hi].label}", style = Type.label.copy(fontSize = 12.sp), color = P.muted)
    Spacer(Modifier.height(8.dp))
    val measure = remember { androidx.compose.ui.graphics.PathMeasure() }
    Canvas(Modifier.fillMaxWidth().height(124.dp).semantics { contentDescription = "${card.title ?: "Trend"}: total ${card.totalDisplay}" }) {
        val w = size.width; val h = size.height - 2.dp.toPx(); val top = 22.dp.toPx()
        val x = { i: Int -> i * w / (pts.size - 1) }
        val y = { v: Double -> (h - (v / max) * (h - top)).toFloat() }
        // soft grid
        for (k in 1..2) drawLine(grid.copy(alpha = 0.6f), Offset(0f, top + (h - top) * k / 3f), Offset(w, top + (h - top) * k / 3f), 1.dp.toPx(), pathEffect = androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(), 4.dp.toPx())))
        drawLine(grid, Offset(0f, h), Offset(w, h), 1.dp.toPx())
        val line = Path().apply { pts.forEachIndexed { i, p -> if (i == 0) moveTo(x(i), y(p.value)) else lineTo(x(i), y(p.value)) } }
        // area fades in under the line as it draws
        val reach = w * prog
        clipRect(right = reach) {
            val area = Path().apply { addPath(line); lineTo(w, h); lineTo(0f, h); close() }
            drawPath(area, androidx.compose.ui.graphics.Brush.verticalGradient(listOf(acc.copy(alpha = 0.22f), acc.copy(alpha = 0.02f)), startY = top, endY = h))
        }
        val drawn = if (prog >= 1f) line else Path().also { seg -> measure.setPath(line, false); measure.getSegment(0f, measure.length * prog, seg, true) }
        drawPath(drawn, acc, style = Stroke(2.2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
        if (pts.size <= 14) pts.forEachIndexed { i, p -> if (x(i) <= reach + 1f) drawCircle(if (p.value > 0) acc else grid, 2.2.dp.toPx(), Offset(x(i), y(p.value))) }
        if (prog > 0.92f) {
            val a = ((prog - 0.92f) / 0.08f).coerceIn(0f, 1f)
            val c = Offset(x(hi), y(pts[hi].value))
            drawCircle(surface, 5.dp.toPx(), c, alpha = a); drawCircle(ink, 3.6.dp.toPx(), c, alpha = a)
            val t = tm.measure(hiLabel, labelStyle)
            val tx = (c.x - t.size.width / 2f).coerceIn(0f, w - t.size.width); val ty = (c.y - t.size.height - 6.dp.toPx()).coerceAtLeast(0f)
            drawText(t, topLeft = Offset(tx, ty), alpha = a)
        }
    }
    Spacer(Modifier.height(4.dp))
    Row(Modifier.fillMaxWidth()) {
        val n = pts.size
        val idx = if (days && n <= 7) pts.indices.toList() else listOf(0, n / 3, 2 * n / 3, n - 1).distinct()
        idx.forEachIndexed { k, i ->
            val l = if (days) (if (n <= 7) dev.karthikyernana.steady.agent.ChatSeries.short(pts[i], n) else pts[i].label.split(" ").takeLast(2).joinToString(" ")) else pts[i].label.removePrefix("Week of ")
            Text(l, style = Type.label.copy(fontSize = 10.5.sp), color = muted, maxLines = 1, softWrap = false,
                textAlign = when (k) { 0 -> TextAlign.Start; idx.lastIndex -> TextAlign.End; else -> TextAlign.Center }, modifier = Modifier.weight(1f))
        }
    }
    card.totalDisplay?.let { Spacer(Modifier.height(6.dp)); Text("Total $it", style = Type.small, color = P.muted) }
}

/** Column bars for a series (days, weekdays, hours): every slot drawn, zero days as stubs, value labels on top. */
@Composable
private fun ColumnBars(card: ChatCard, pts: List<dev.karthikyernana.steady.agent.Point>, days: Boolean) {
    val n = pts.size
    val max = pts.maxOf { it.value }.coerceAtLeast(1e-9)
    val hi = pts.indices.maxByOrNull { pts[it].value } ?: -1
    val acc = P.accent; val stub = P.line2; val ink = P.ink; val muted = P.muted
    val prog by rememberGrow(motion(), androidx.compose.animation.core.spring(dampingRatio = 0.82f, stiffness = 110f), key = card.id)
    val tm = androidx.compose.ui.text.rememberTextMeasurer()
    val money = card.money
    val labels = remember(card.id, n) { pts.map { if (n <= 7 || !days) compact(it, money) else it.display } }
    val valueStyle = Type.label.copy(fontSize = 10.sp, color = ink)
    val every = if (n <= 7) 1 else 0          // > 7 bars: only the highest gets a label
    Canvas(Modifier.fillMaxWidth().height(132.dp).semantics { contentDescription = "${card.title ?: "Bars"}: highest ${pts[hi].display} on ${pts[hi].label}" }) {
        val top = 16.dp.toPx(); val base = size.height
        val gap = (if (n > 20) 2 else if (n > 12) 3 else 8).dp.toPx(); val bw = (size.width - gap * (n - 1)) / n
        val r = CornerRadius(minOf(5.dp.toPx(), bw / 3))
        pts.forEachIndexed { i, p ->
            // a gentle left-to-right stagger inside one spring
            val t = ((prog * 1.25f) - i.toFloat() / n * 0.25f).coerceIn(0f, 1.05f)
            val x0 = i * (bw + gap)
            if (p.value <= 0) { drawRoundRect(stub, Offset(x0, base - 3.dp.toPx()), Size(bw, 3.dp.toPx()), CornerRadius(1.5.dp.toPx())); return@forEachIndexed }
            val h = ((p.value / max).toFloat() * (base - top) * t).coerceAtLeast(3.dp.toPx())
            drawRoundRect(if (i == hi) acc else acc.copy(alpha = 0.5f), Offset(x0, base - h), Size(bw, h), r)
            if ((every == 1 || i == hi) && t > 0.85f) {
                val tl = tm.measure(labels[i], valueStyle)
                val tx = (x0 + bw / 2 - tl.size.width / 2f).coerceIn(0f, size.width - tl.size.width)
                drawText(tl, topLeft = Offset(tx, (base - h - tl.size.height - 2.dp.toPx()).coerceAtLeast(0f)), alpha = ((t - 0.85f) / 0.15f).coerceIn(0f, 1f))
            }
        }
    }
    Row(Modifier.fillMaxWidth().padding(top = 5.dp)) {
        val step = when { n <= 14 -> 1; n <= 31 -> 5; else -> n / 6 }
        pts.forEachIndexed { i, p ->
            val l = if (days) dev.karthikyernana.steady.agent.ChatSeries.short(p, n) else p.label
            Box(Modifier.weight(1f), contentAlignment = Alignment.TopCenter) {
                if (i % step == 0 || i == n - 1 && n <= 14) Text(if (n > 14 && days) l else l, style = Type.label.copy(fontSize = if (n > 7) 9.5.sp else 11.sp), color = if (i == hi) ink else muted,
                    maxLines = 1, softWrap = false, modifier = Modifier.wrapContentWidth(unbounded = true))
            }
        }
    }
}

@Composable
private fun BarCard(card: ChatCard) {
    val pts = card.series
    if (card.empty || pts.isEmpty()) { Empty(card); return }
    val hi = pts.indices.maxByOrNull { pts[it].value } ?: -1
    val days = dev.karthikyernana.steady.agent.ChatSeries.isDays(pts)
    if (days || (pts.size in 2..31 && pts.all { it.label.length <= 6 })) {
        ColumnBars(card, pts, days)
        Spacer(Modifier.height(6.dp)); Text("Highest ${pts[hi].display} · ${pts[hi].label}" + (card.totalDisplay?.let { "  ·  Total $it" } ?: ""), style = Type.small, color = P.muted)
        return
    }
    // categories, payees: rows that grow in one after another
    val max = pts.maxOf { it.value }.coerceAtLeast(1e-9)
    val anim = motion()
    val prog by rememberGrow(anim, androidx.compose.animation.core.spring(dampingRatio = 0.85f, stiffness = 120f), key = card.id)
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        pts.take(12).forEachIndexed { i, p ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(p.label, style = Type.small, color = P.ink2, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.width(96.dp))
                val track = P.surface2; val fill = if (i == hi) P.accent else P.accent.copy(alpha = 0.45f)
                Canvas(Modifier.weight(1f).height(10.dp)) {
                    val rr = CornerRadius(size.height / 2); drawRoundRect(track, cornerRadius = rr)
                    val t = ((prog * 1.3f) - i * 0.06f).coerceIn(0f, 1f)
                    val w = (size.width * (p.value / max).toFloat() * t).coerceAtLeast(if (p.value > 0) size.height else 0f)
                    if (w > 0f) drawRoundRect(fill, size = Size(w, size.height), cornerRadius = rr)
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
    val sweepP by rememberGrow(motion(), androidx.compose.animation.core.tween(850, 60, androidx.compose.animation.core.FastOutSlowInEasing), key = card.id)
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(112.dp), contentAlignment = Alignment.Center) {
            Canvas(Modifier.fillMaxSize().semantics { contentDescription = "${card.title ?: "Shares"}: total ${card.totalDisplay}" }) {
                val sw = 14.dp.toPx(); val inset = sw / 2; val sz = Size(size.width - sw, size.height - sw)
                drawArc(track, 0f, 360f, false, Offset(inset, inset), sz, style = Stroke(sw))
                var start = -90f; val limit = -90f + 360f * sweepP
                pts.forEachIndexed { i, p -> val sweep = (p.value / total * 360).toFloat(); val s0 = minOf(sweep, limit - start)
                    if (s0 > 0f) drawArc(cols[i % cols.size], start, s0 - if (pts.size > 1 && s0 > 2f) 1.2f else 0f, false, Offset(inset, inset), sz, style = Stroke(sw)); start += sweep }
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
    val prog by rememberGrow(motion(), androidx.compose.animation.core.tween(700, 60), key = card.id)
    val lead = (LocalDate.parse(days[0].date).dayOfWeek.value - 1)        // Monday = 0
    val weeks = (lead + days.size + 6) / 7
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val gap = 3.dp; val cell = ((maxWidth - gap * (weeks - 1)) / weeks).coerceAtMost(16.dp)
        Canvas(Modifier.width(cell * weeks + gap * (weeks - 1)).height(cell * 7 + gap * 6).semantics { contentDescription = card.title ?: "Activity by day" }) {
            val cp = cell.toPx(); val gp = gap.toPx(); val r = CornerRadius(cp * 0.22f)
            days.forEachIndexed { i, d ->
                val p = lead + i; val w = p / 7; val row = p % 7
                val lvl = if (d.value <= 0) 0 else minOf(4, Math.ceil(d.value / max * 4).toInt())
                val a = (prog * (weeks + 3) - w).coerceIn(0f, 3f) / 3f
                if (a > 0f) drawRoundRect(heat[lvl], Offset(w * (cp + gp), row * (cp + gp)), Size(cp, cp), r, alpha = a)
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
    val prog by rememberGrow(motion(), androidx.compose.animation.core.spring(dampingRatio = 0.85f, stiffness = 110f), key = card.id)
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        items.forEach { g ->
            Column {
                Row { Text(g.label, style = Type.bodyM, color = P.ink, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis); Text(g.display, style = Type.small, color = P.muted) }
                Spacer(Modifier.height(6.dp))
                Canvas(Modifier.fillMaxWidth().height(8.dp)) {
                    val r = CornerRadius(size.height / 2); drawRoundRect(track, cornerRadius = r)
                    val w = size.width * g.frac * prog; if (w > 0f) drawRoundRect(acc, size = Size(maxOf(w, size.height), size.height), cornerRadius = r)
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
