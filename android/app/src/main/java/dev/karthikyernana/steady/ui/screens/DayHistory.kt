package dev.karthikyernana.steady.ui.screens

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.KeyboardArrowUp
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.karthikyernana.steady.core.DayHistory
import dev.karthikyernana.steady.core.Dates
import dev.karthikyernana.steady.data.Task
import dev.karthikyernana.steady.ui.*

// Today's day navigation (‹ date ›, a past or future day, Back to today) and the "Yesterday · N done" row.
// Rules: core/DayHistory.kt (mirrors the web's js/core/history.js and views/today.js renderDay / yesterdayRow).

/** "‹ WEDNESDAY, 21 OCTOBER ›": the date eyebrow with a step on each side. */
@Composable
fun DayNav(day: String, today: String, go: (String) -> Unit) {
    val prev = Dates.keyAdd(day, -1); val next = Dates.keyAdd(day, 1)
    val atStart = day <= Dates.keyAdd(today, -DayHistory.BACK); val atEnd = day >= Dates.keyAdd(today, DayHistory.FORWARD)
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.offset(x = (-12).dp).testTag("day-nav")) {
        IconButton(onClick = { go(prev) }, enabled = !atStart, modifier = Modifier.size(40.dp).testTag("day-prev")) {
            Icon(Icons.AutoMirrored.Rounded.KeyboardArrowLeft, "Previous day, ${DayHistory.dayLabel(prev, today)}", tint = P.muted, modifier = Modifier.size(20.dp))
        }
        Eyebrow(DayHistory.eyebrow(day, today), modifier = Modifier.testTag("day-eyebrow"))
        IconButton(onClick = { go(next) }, enabled = !atEnd, modifier = Modifier.size(40.dp).testTag("day-next")) {
            Icon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, "Next day, ${DayHistory.dayLabel(next, today)}", tint = P.muted, modifier = Modifier.size(20.dp))
        }
    }
}

/** The page head with the day navigation in place of the plain eyebrow (Components.PageHead otherwise). */
@Composable
fun DayPageHead(day: String, today: String, go: (String) -> Unit, before: String, accent: String, after: String, sub: String?, subTag: String?,
                below: (@Composable () -> Unit)? = null, trailing: (@Composable () -> Unit)? = null) {
    Row(verticalAlignment = Alignment.Top, modifier = Modifier.padding(top = 0.dp, bottom = 4.dp)) {
        Column(Modifier.weight(1f)) {
            DayNav(day, today, go)
            Spacer(Modifier.height(2.dp))
            Text(androidx.compose.ui.text.buildAnnotatedString {
                append(before)
                pushStyle(androidx.compose.ui.text.SpanStyle(color = P.accent)); append(accent); pop()
                append(after)
            }, style = Type.display, color = P.ink, softWrap = (before + accent + after).length > 16, maxLines = if ((before + accent + after).length > 16) Int.MAX_VALUE else 1)
            if (sub != null) { Spacer(Modifier.height(6.dp)); Text(sub, style = Type.body.copy(fontSize = 16.sp), color = P.muted, modifier = if (subTag != null) Modifier.testTag(subTag) else Modifier) }
            below?.invoke()
        }
        trailing?.invoke()
    }
}

/** "Back to today" chip on a past or future day. */
@Composable
fun BackToToday(past: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(999.dp)
    Row(Modifier.padding(top = 12.dp).clip(shape).background(P.accentSoft).border(1.dp, P.accentLine, shape).springClick(onClick = onClick)
        .heightIn(min = 44.dp).padding(start = if (past) 14.dp else 8.dp, end = if (past) 8.dp else 14.dp).testTag("back-today"), verticalAlignment = Alignment.CenterVertically) {
        if (!past) Icon(Icons.AutoMirrored.Rounded.KeyboardArrowLeft, null, tint = P.accent, modifier = Modifier.size(18.dp))
        Text("Back to today", style = Type.label.copy(fontSize = 14.sp), color = P.accent)
        if (past) Icon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, null, tint = P.accent, modifier = Modifier.size(18.dp))
    }
}

/** At the end of Today: "Yesterday · 3 done" (tap = open yesterday), the chevron peeks at it in place. Only when yesterday had activity. */
@Composable
fun YesterdayRow(tasks: List<Task>, today: String, go: (String) -> Unit) {
    val y = remember(tasks, today) { DayHistory.dayTasks(tasks, Dates.keyAdd(today, -1), today) }
    if (!y.hadActivity) return
    var peek by rememberSaveable { mutableStateOf(false) }
    val label = listOfNotNull(if (y.done.isNotEmpty()) "${y.done.size} done" else null, if (y.skipped.isNotEmpty()) "${y.skipped.size} skipped" else null).joinToString(" · ")
    Column(Modifier.fillMaxWidth().padding(top = 6.dp).animateContentSize().testTag("yesterday-row")) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(P.line))
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
            Row(Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).clickable { go(Dates.keyAdd(today, -1)) }.heightIn(min = 48.dp).padding(horizontal = 6.dp)
                .semantics { contentDescription = "Open yesterday: $label" }.testTag("yesterday-go"), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.History, null, tint = P.muted, modifier = Modifier.size(19.dp))
                Spacer(Modifier.width(10.dp))
                Text("Yesterday", style = Type.bodyM, color = P.ink)
                Spacer(Modifier.width(8.dp))
                Text(label, style = Type.body, color = P.muted, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Icon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, null, tint = P.muted, modifier = Modifier.size(18.dp))
            }
            IconButton(onClick = { peek = !peek }, modifier = Modifier.testTag("yesterday-peek-btn")) {
                Icon(if (peek) Icons.Rounded.KeyboardArrowUp else Icons.Rounded.KeyboardArrowDown, if (peek) "Hide yesterday's tasks" else "Show yesterday's tasks", tint = P.muted)
            }
        }
        if (peek) Column(Modifier.padding(start = 36.dp, bottom = 6.dp).testTag("yesterday-peek"), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            (y.done + y.skipped).take(6).forEach { t ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(18.dp).clip(RoundedCornerShape(999.dp)).background(if (t.isDone) P.accentSoft else P.surface2), contentAlignment = Alignment.Center) {
                        if (t.isDone) Icon(Icons.Rounded.Check, null, tint = P.accent, modifier = Modifier.size(12.dp))
                    }
                    Spacer(Modifier.width(8.dp))
                    Text(t.title, style = Type.small.copy(fontSize = 14.sp), color = P.muted, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        textDecoration = if (t.isDone) TextDecoration.LineThrough else null)
                }
            }
            val more = y.done.size + y.skipped.size - 6
            if (more > 0) Text("+$more more", style = Type.label, color = P.accent, modifier = Modifier.clickable { go(Dates.keyAdd(today, -1)) }.padding(vertical = 4.dp))
        }
    }
}

/** A past or future day: done (by the local day of doneAt), skipped, moved on; or what is planned. Rows still un-check and edit. */
@Composable
fun DayList(day: String, today: String, go: (String) -> Unit, onEdit: (Task) -> Unit) {
    val c = LocalCtx.current
    val s = c.snap
    val r = remember(s.version, day, today) { DayHistory.dayTasks(s.tasks, day, today) }
    val past = r.kind == DayHistory.Kind.Past
    val countable = r.done.size + r.moved.size + r.open.size
    val dist = DayHistory.dayDistance(day, today)
    LazyColumn(Modifier.fillMaxSize().testTag("today-day"), contentPadding = PaddingValues(start = 18.dp, end = 18.dp, top = 6.dp, bottom = 170.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item(key = "head") {
            DayPageHead(day, today, go, DayHistory.dayTitle(day, today), "", "", null, null,
                below = {
                    Spacer(Modifier.height(6.dp))
                    Text(DayHistory.summaryLine(r) + if (dist.isNotEmpty()) " · $dist" else "", style = Type.body.copy(fontSize = 16.sp), color = P.muted, modifier = Modifier.testTag("day-summary"))
                    BackToToday(past) { go(today) }
                },
                trailing = if (past && countable > 0) ({ Spacer(Modifier.width(10.dp)); Ring(r.done.size.toFloat() / countable, "${r.done.size}") }) else null)
        }
        if (r.total == 0) item(key = "empty") {
            EmptyNote(if (past) "A quiet day." else "Nothing planned yet.",
                if (past) "Nothing was done or planned for this day." else "Add something for this day from Today, e.g. \u201cgym ${DayHistory.dayLabel(day, today).lowercase()} 7pm\u201d.")
        }
        if (r.open.isNotEmpty()) {
            item(key = "sh-open") { SectionHead("Planned", "${r.open.size} open") }
            items(r.open, key = { "o-" + it.id }) { t -> TaskRow(t, s, Modifier.animateItem(), onEdit = { onEdit(t) }) }
        }
        if (r.done.isNotEmpty()) {
            item(key = "sh-done") { SectionHead("Done", "${r.done.size}") }
            items(r.done, key = { "d-" + it.id }) { t -> TaskRow(t, s, Modifier.animateItem().testTag("day-done"), note = t.doneAt?.let { "done " + Dates.fmtTime(doneClock(it)) }, onEdit = { onEdit(t) }) }
        }
        if (r.skipped.isNotEmpty()) {
            item(key = "sh-skip") { SectionHead("Skipped", "${r.skipped.size}") }
            items(r.skipped, key = { "s-" + it.id }) { t -> TaskRow(t, s, Modifier.animateItem(), onEdit = { onEdit(t) }) }
        }
        if (r.moved.isNotEmpty()) {
            item(key = "sh-moved") { SectionHead("Moved on", "${r.moved.size}") }
            items(r.moved, key = { "m-" + it.task.id }) { m -> TaskRow(m.task, s, Modifier.animateItem().testTag("day-moved"), note = DayHistory.movedLabel(m, today), moved = true, onEdit = { onEdit(m.task) }) }
        }
    }
}

private fun doneClock(ms: Long): String {
    val t = java.time.Instant.ofEpochMilli(ms).atZone(Dates.zone).toLocalTime()
    return "%02d:%02d".format(t.hour, t.minute)
}
