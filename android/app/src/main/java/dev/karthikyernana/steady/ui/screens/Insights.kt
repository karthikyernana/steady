package dev.karthikyernana.steady.ui.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.CurrencyRupee
import androidx.compose.material.icons.rounded.Flag
import androidx.compose.material.icons.rounded.LocalFireDepartment
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.karthikyernana.steady.agent.fmtAmount
import dev.karthikyernana.steady.core.Dates
import dev.karthikyernana.steady.core.Engine
import dev.karthikyernana.steady.core.Overview
import dev.karthikyernana.steady.ui.*
import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale

/** A glanceable number: icon, big value, one short label, optional comparison line. */
@Composable
private fun Stat(icon: ImageVector, value: String, label: String, sub: String?, tint: Color, modifier: Modifier, tag: String) {
    SCard(modifier.testTag(tag), pad = 14.dp) {
        Box(Modifier.size(30.dp).clip(CircleShape).background(tint.copy(alpha = 0.14f)), contentAlignment = Alignment.Center) { Icon(icon, null, tint = tint, modifier = Modifier.size(17.dp)) }
        Spacer(Modifier.height(10.dp))
        Text(value, style = Type.display.copy(fontSize = 26.sp, lineHeight = 30.sp), color = P.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(label, style = Type.small, color = P.ink2, maxLines = 1)
        Text(sub ?: " ", style = Type.label.copy(fontSize = 12.sp), color = P.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun Meter(frac: Float, color: Color, modifier: Modifier = Modifier) {
    val track = P.line
    Canvas(modifier.fillMaxWidth().height(8.dp)) {
        val r = CornerRadius(size.height / 2)
        drawRoundRect(track, cornerRadius = r)
        val w = size.width * frac.coerceIn(0f, 1f)
        if (w > 0f) drawRoundRect(color, size = Size(maxOf(w, size.height), size.height), cornerRadius = r)
    }
}

@Composable
fun InsightsScreen() {
    val c = LocalCtx.current
    val s = c.snap
    val a = remember(s.version) { Engine.analyze(s) }
    val o = remember(s.version) { Overview.of(s) }
    LazyColumn(Modifier.fillMaxSize().testTag("insights"), contentPadding = PaddingValues(start = 18.dp, end = 18.dp, top = 6.dp, bottom = 170.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item(key = "head") { PageHead("INSIGHTS", "Your ", "week", sub = "Tasks, goals, money and thoughts in one look.") }

        // 1. four numbers you can read in a second
        item(key = "stats") {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Stat(Icons.Rounded.CheckCircle, "${o.doneWeek}", "done this week", Overview.vs(o.doneWeek - o.doneLastWeek, "last week"), P.accent, Modifier.weight(1f), "st-done")
                    Stat(Icons.Rounded.LocalFireDepartment, "${a.streakCurrent}", if (a.streakCurrent == 1) "day streak" else "day streak", "best ${a.streakLongest}", P.hi, Modifier.weight(1f), "st-streak")
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Stat(Icons.Rounded.Flag, if (o.msTotal == 0) "–" else "${o.msDone}/${o.msTotal}", "milestones", if (o.goals.isEmpty()) "no goals yet" else "${o.goals.size} goal${if (o.goals.size == 1) "" else "s"}", P.accent, Modifier.weight(1f), "st-goals")
                    Stat(Icons.Rounded.CurrencyRupee, "₹" + fmtAmount(o.spentWeek), "spent this week", Overview.vsMoney(o.spentWeek - o.spentLastWeek), P.warn, Modifier.weight(1f), "st-money")
                }
            }
        }

        // 2. what Steady has learned (only real patterns)
        item(key = "learned") {
            val learned = Engine.remember(a)
            val shape = RoundedCornerShape(22.dp)
            Column(Modifier.fillMaxWidth().clip(shape).background(Color(0xFF1F1E19)).padding(18.dp).testTag("remember")) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Rounded.AutoAwesome, null, tint = Color(0xFF8EC3A2), modifier = Modifier.size(18.dp)); Spacer(Modifier.width(8.dp))
                    Text("What I've learned about you", style = Type.bodyM.copy(fontSize = 16.sp), color = Color(0xFFF2EEE4))
                }
                learned.forEachIndexed { i, (t, d) ->
                    if (i > 0) HorizontalDivider(color = Color(0x22FFFFFF), modifier = Modifier.padding(vertical = 12.dp)) else Spacer(Modifier.height(12.dp))
                    Text(t, style = Type.h3.copy(fontSize = 17.sp, lineHeight = 23.sp), color = Color(0xFFF2EEE4))
                    if (d != null) { Spacer(Modifier.height(4.dp)); Text(d, style = Type.small, color = Color(0xFFA8A295)) }
                }
            }
        }

        // 3. when you get things done: by weekday and by hour (same charts as the web)
        item(key = "weekday") {
            val vals = a.wdRate.map { (it ?: 0.0).toFloat() }
            val best = a.wdRate.withIndex().filter { it.value != null }.maxByOrNull { it.value!! }
            SCard(Modifier.testTag("weekday")) {
                Eyebrow("By weekday")
                Spacer(Modifier.height(4.dp))
                Text(best?.let { "${listOf("Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays")[it.index]} are your best" } ?: "Needs a few weeks of planned tasks", style = Type.h3, color = P.ink)
                Text("Planned tasks finished, last 8 weeks.", style = Type.small, color = P.muted)
                Spacer(Modifier.height(12.dp))
                Bars(vals, listOf("M", "T", "W", "T", "F", "S", "S"), height = 90.dp, highlightLast = false, highlight = best?.index ?: -1)
            }
        }
        item(key = "hours") {
            val h = a.hourHist; val peak = a.bestStart
            SCard(Modifier.testTag("hours")) {
                Eyebrow("By time of day")
                Spacer(Modifier.height(4.dp))
                Text(peak?.let { "Peak: ${Engine.fmtHour(it)} to ${Engine.fmtHour((it + 2) % 24)}" } ?: "Finish a few things to see your hours", style = Type.h3, color = P.ink)
                Text("When you finish things, last 60 days.", style = Type.small, color = P.muted)
                Spacer(Modifier.height(12.dp))
                Bars(h.map { it.toFloat() }, (0 until 24).map { if (it % 6 == 0) Engine.fmtHour(it).replace(" ", "") else "" }, height = 80.dp, highlightLast = false,
                    highlight = peak ?: -1, highlight2 = peak?.let { (it + 1) % 24 } ?: -1)
            }
        }

        // 4. consistency calendar, full width, with weekday rows and a legend
        item(key = "heat") { SCard(Modifier.testTag("heatmap")) { Heatmap(a.doneOn) } }

        // 5. goals: one meter per goal
        if (o.goals.isNotEmpty()) item(key = "goals") {
            SCard(Modifier.testTag("ins-goals")) {
                Eyebrow("Goals")
                o.goals.forEach { g ->
                    Spacer(Modifier.height(12.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(g.title, style = Type.bodyM, color = P.ink, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(if (g.total == 0) "no milestones" else "${g.done}/${g.total}", style = Type.small, color = P.muted)
                    }
                    Spacer(Modifier.height(6.dp))
                    Meter(if (g.total == 0) 0f else g.done.toFloat() / g.total, P.accent)
                    if (g.tasksWeek > 0) Text("${g.tasksWeek} task${if (g.tasksWeek == 1) "" else "s"} done for it this week", style = Type.label.copy(fontSize = 12.sp), color = P.muted, modifier = Modifier.padding(top = 4.dp))
                }
            }
        }

        // 6. money: where it went this month
        if (o.spentMonth > 0) item(key = "money") {
            SCard(Modifier.testTag("ins-money")) {
                Eyebrow("Money · this month")
                Spacer(Modifier.height(4.dp))
                Text("₹" + fmtAmount(o.spentMonth) + " spent", style = Type.h3, color = P.ink)
                Text(Overview.vsMoney(o.spentMonth - o.spentLastMonthSameDay, "last month by today") ?: "First month logged.", style = Type.small, color = P.muted)
                o.cats.forEach { (cat, v) ->
                    Spacer(Modifier.height(10.dp))
                    Row { Text(cat, style = Type.body, color = P.ink, modifier = Modifier.weight(1f)); Text("₹" + fmtAmount(v), style = Type.body, color = P.ink2) }
                    Spacer(Modifier.height(4.dp))
                    Meter((v / o.spentMonth).toFloat(), P.warn)
                }
            }
        }

        // 7. thoughts: what you keep coming back to
        if (o.thoughtsMonth > 0) item(key = "thoughts") {
            SCard(Modifier.testTag("ins-thoughts")) {
                Eyebrow("Thoughts · last 30 days")
                Spacer(Modifier.height(4.dp))
                Text(if (o.thoughtsMonth == 1) "1 thought saved" else "${o.thoughtsMonth} thoughts saved", style = Type.h3, color = P.ink)
                if (o.topTags.isNotEmpty()) {
                    Spacer(Modifier.height(10.dp))
                    @OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        o.topTags.forEach { (t, n) -> Pill("#$t  $n", color = P.ink, bg = P.accentSoft) }
                    }
                }
                o.moodAvg?.let { m ->
                    Spacer(Modifier.height(12.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Mood", style = Type.small, color = P.muted, modifier = Modifier.width(52.dp))
                        Meter(((m - 1) / 4).toFloat(), MOOD_COLORS[(Math.round(m).toInt() - 1).coerceIn(0, 4)], Modifier.weight(1f))
                        Text("  " + MOODS[(Math.round(m).toInt() - 1).coerceIn(0, 4)], style = Type.small, color = P.ink2)
                    }
                }
            }
        }

    }
}

/** GitHub-style calendar that always fills the card width; more weeks on wider screens. */
@Composable
private fun Heatmap(doneOn: Map<String, Int>) {
    val heat = P.heat; val muted = P.muted
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val labelW = 18.dp; val gap = 4.dp; val full = maxWidth
        val weeks = ((maxWidth - labelW) / 22.dp).toInt().coerceIn(12, 30)
        val cell = (maxWidth - labelW - gap * (weeks - 1)) / weeks
        val today = Dates.today(); val start = Dates.weekStart(today).minusWeeks((weeks - 1).toLong())
        val active = (0 until weeks * 7).count { val d = start.plusDays(it.toLong()); d <= today && (doneOn[d.toString()] ?: 0) > 0 }
        Column {
            Row(verticalAlignment = Alignment.Bottom) {
                Eyebrow("Last $weeks weeks", modifier = Modifier.weight(1f))
                Text("$active active day${if (active == 1) "" else "s"}", style = Type.small, color = P.ink2)
            }
            Spacer(Modifier.height(12.dp))
            Row {
                Column(Modifier.width(labelW), verticalArrangement = Arrangement.spacedBy(gap)) {
                    listOf("M", "", "W", "", "F", "", "S").forEach { l -> Box(Modifier.height(cell), contentAlignment = Alignment.CenterStart) { Text(l, style = Type.label.copy(fontSize = 10.sp), color = muted) } }
                }
                Canvas(Modifier.width(full - labelW).height(cell * 7 + gap * 6)) {
                    val cp = cell.toPx(); val gp = gap.toPx(); val r = CornerRadius(cp * 0.22f)
                    for (w in 0 until weeks) for (d in 0 until 7) {
                        val day = start.plusDays((w * 7 + d).toLong()); if (day > today) continue
                        val n = doneOn[day.toString()] ?: 0
                        drawRoundRect(heat[when { n == 0 -> 0; n == 1 -> 1; n <= 3 -> 2; n <= 5 -> 3; else -> 4 }], Offset(w * (cp + gp), d * (cp + gp)), Size(cp, cp), r)
                        if (day == today) drawRoundRect(Color(0x661C1B18), Offset(w * (cp + gp), d * (cp + gp)), Size(cp, cp), r, style = androidx.compose.ui.graphics.drawscope.Stroke(1.5f))
                    }
                }
            }
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.End, modifier = Modifier.fillMaxWidth()) {
                Text("Less ", style = Type.label.copy(fontSize = 11.sp), color = muted)
                heat.forEach { Box(Modifier.padding(horizontal = 2.dp).size(11.dp).clip(RoundedCornerShape(3.dp)).background(it)) }
                Text(" More", style = Type.label.copy(fontSize = 11.sp), color = muted)
            }
        }
    }
}
