package dev.karthikyernana.steady.ui.screens

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.rounded.KeyboardTab
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.sp
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import dev.karthikyernana.steady.core.Dates
import dev.karthikyernana.steady.core.Engine
import dev.karthikyernana.steady.core.QuickParse
import dev.karthikyernana.steady.data.*
import dev.karthikyernana.steady.ui.*
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

fun addTask(c: Ctx, p: dev.karthikyernana.steady.core.Parsed): JsonObjectRec = c.app.store.save("tasks", buildJsonObject {
    put("id", uid()); put("title", p.title); put("priority", p.priority); put("dueDate", p.dueDate); put("dueTime", p.dueTime); put("durationMin", p.durationMin)
    put("reminder", p.reminder); put("status", "open"); put("doneAt", JsonNull); put("goalId", p.goalId)
})
typealias JsonObjectRec = kotlinx.serialization.json.JsonObject

fun setStatus(c: Ctx, t: Task, status: String) {
    val prev = t.raw
    c.app.store.save("tasks", t.raw.with("status" to status, "doneAt" to if (status == "done") System.currentTimeMillis() else null))
    val left = c.app.store.snapshot.value.tasks.count { it.dueDate == Dates.todayKey() && it.isOpen }
    val msg = when (status) { "done" -> if (left == 0) "That was the last one. Day done." else listOf("Done. Nice.", "Done. One less thing.", "Done. Keep the rhythm.", "Checked off.").random(); "skipped" -> "Skipped. That is allowed."; else -> "Reopened." }
    c.toast(msg) { c.app.store.save("tasks", prev) }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun TodayScreen(onCheckin: () -> Unit) {
    val c = LocalCtx.current
    val s = c.snap
    val tk = Dates.todayKey()
    val a = remember(s.version) { Engine.analyze(s) }
    val todays = s.tasks.filter { it.dueDate == tk }
    val open = Engine.sortTasks(todays.filter { it.isOpen })
    val done = todays.filter { !it.isOpen }.sortedByDescending { it.doneAt ?: it.raw.long("updatedAt") ?: 0 }
    val nDone = todays.count { it.isDone }
    val carry = Engine.sortTasks(s.tasks.filter { it.isOpen && it.dueDate != null && it.dueDate!! < tk && it.raw.bool("letGo") != true })
    val later = Engine.sortTasks(s.tasks.filter { it.isOpen && it.dueDate != null && it.dueDate!! > tk && it.dueDate!! <= Dates.keyAdd(tk, 7) })
    val sub = Engine.todayLine(s, a, todays.size, nDone, open.size)
    var editing by remember { mutableStateOf<Task?>(null) }
    var showDone by rememberSaveable { mutableStateOf(false) }
    var showLater by rememberSaveable { mutableStateOf(false) }
    val name = s.profile.str("name")

    LazyColumn(Modifier.fillMaxSize().testTag("today"), contentPadding = PaddingValues(start = 18.dp, end = 18.dp, top = 6.dp, bottom = 170.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item(key = "head") {
            if (name != null) PageHead(Dates.longDate().replace(",", ",").uppercase(), Dates.greeting() + ", ", name, ".", sub, subTag = "today-sub",
                trailing = { if (todays.isNotEmpty()) { Spacer(Modifier.width(10.dp)); Ring(nDone.toFloat() / todays.size, "${todays.size - open.size}") } })
            else PageHead(Dates.longDate().uppercase(), Dates.greeting(), "", ".", sub, subTag = "today-sub",
                trailing = { if (todays.isNotEmpty()) { Spacer(Modifier.width(10.dp)); Ring(nDone.toFloat() / todays.size, "${todays.size - open.size}") } })
        }
        item(key = "composer") { Composer() }
        if (todays.any { it.dueTime != null }) item(key = "daystrip") { DayStrip(todays, s.profile.str("wake") ?: "07:00", s.profile.str("sleep") ?: "23:30") }
        if (carry.isNotEmpty()) item(key = "carry") {
            SCard(tint = P.surface2) {
                Text(if (carry.size == 1) "One thing from before is still open." else "${carry.size} things from before are still open.", style = Type.h3, color = P.ink)
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    PrimaryButton("Move to today") { carry.forEach { t -> c.app.store.save("tasks", t.raw.with("dueDate" to tk)) }; c.toast("Moved to today.", null) }
                    GhostButton("Let them go") { carry.forEach { t -> c.app.store.save("tasks", t.raw.with("letGo" to true, "status" to "skipped")) }; c.toast("Let go. Fresh start.", null) }
                }
            }
        }
        if (open.isNotEmpty()) {
            item(key = "sh-today") { SectionHead("Today", "${open.size} open") }
            items(open, key = { "t-" + it.id }) { t -> TaskRow(t, s, Modifier.animateItem(), onEdit = { editing = t }) }
        } else if (todays.isEmpty()) item(key = "empty") { EmptyNote("A clear page.", "Add one small thing above, or tap the mic and just say it.") }
        else item(key = "allDone") { EmptyNote("That's the day.", if (a.streakCurrent >= 2) "${a.streakCurrent} days in a row now." else "Be proud of that, and rest.") }
        if (later.isNotEmpty()) {
            item(key = "sh-later") { Disclosure("Next 7 days · ${later.size}", showLater) { showLater = !showLater } }
            if (showLater) items(later, key = { "l-" + it.id }) { t -> TaskRow(t, s, Modifier.animateItem(), showDate = true, onEdit = { editing = t }) }
        }
        if (done.isNotEmpty()) {
            item(key = "sh-done") { Disclosure("Done & skipped · ${done.size}", showDone) { showDone = !showDone } }
            if (showDone) items(done, key = { "d-" + it.id }) { t -> TaskRow(t, s, Modifier.animateItem(), onEdit = { editing = t }) }
        }
    }
    editing?.let { t -> TaskSheet(t, onClose = { editing = null }) }
}

@Composable
private fun Composer() {
    val c = LocalCtx.current
    val s = c.snap
    var text by rememberSaveable { mutableStateOf("") }
    val focus = LocalFocusManager.current
    val parsed = remember(text, s.version) {
        if (text.isBlank()) null else QuickParse.parse(text, wake = s.profile.str("wake") ?: "07:00", sleep = s.profile.str("sleep") ?: "23:30",
            defaultReminder = s.settings.bool("defaultReminder") != false, goals = s.goals)
    }
    fun submit() {
        val p = parsed ?: return
        val rec = addTask(c, p)
        text = ""; focus.clearFocus()
        val when_ = listOfNotNull(if (p.dueDate != Dates.todayKey()) Dates.fmtDateKey(p.dueDate) else null, p.dueTime?.let { Dates.fmtTime(it) }).joinToString(" ")
        c.toast(if (when_.isEmpty()) "Added." else "Added for $when_.") { c.app.store.remove("tasks", rec.str("id")!!) }
    }
    SCard(pad = 0.dp, shape = RoundedCornerShape(22.dp), modifier = Modifier.animateContentSize()) {
        Row(Modifier.padding(start = 14.dp, end = 6.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Rounded.Add, null, tint = P.muted)
            Spacer(Modifier.width(8.dp))
            Box(Modifier.weight(1f).padding(vertical = 12.dp)) {
                if (text.isEmpty()) Text("Add a task… e.g. gym 7pm 45m", style = Type.body.copy(fontSize = 16.sp), color = P.muted, maxLines = 1)
                BasicTextField(value = text, onValueChange = { v: String -> text = v }, textStyle = Type.body.copy(color = P.ink), cursorBrush = SolidColor(P.accent), singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { submit() }), modifier = Modifier.fillMaxWidth().testTag("qa"))
            }
            Button(onClick = ::submit, enabled = parsed != null, shape = RoundedCornerShape(999.dp), colors = ButtonDefaults.buttonColors(containerColor = P.ink, contentColor = P.ground),
                modifier = Modifier.testTag("qa-add")) { Text("Add", style = Type.bodyM) }
        }
        if (parsed != null && parsed.chips.isNotEmpty()) Row(Modifier.padding(start = 14.dp, end = 14.dp, bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            parsed.chips.take(4).forEach { Pill(it, color = P.accent, bg = P.accentSoft) }
        }
    }
}

@Composable
fun Disclosure(label: String, open: Boolean, onClick: () -> Unit) {
    Row(Modifier.clip(RoundedCornerShape(10.dp)).clickable(onClick = onClick).padding(horizontal = 4.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(if (open) Icons.Rounded.KeyboardArrowDown else Icons.AutoMirrored.Rounded.KeyboardArrowRight, null, tint = P.muted, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(4.dp))
        Text(label, style = Type.body, color = P.ink2)
    }
}

@Composable
fun TaskRow(t: Task, s: Snapshot, modifier: Modifier = Modifier, showDate: Boolean = false, onEdit: () -> Unit) {
    val c = LocalCtx.current
    val goal = t.goalId?.let { id -> s.goals.firstOrNull { it.id == id } }
    val shape = RoundedCornerShape(16.dp)
    Box(modifier.fillMaxWidth().testTag("task")) {
        SCard(pad = 0.dp, shape = shape, onClick = onEdit) {
            Row(Modifier.padding(start = 4.dp, end = 2.dp, top = 2.dp, bottom = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                CheckDot(done = t.isDone) { setStatus(c, t, if (t.isOpen) "done" else "open") }
                Column(Modifier.weight(1f).padding(vertical = 10.dp)) {
                    Text(t.title, style = Type.bodyM.copy(fontSize = 16.sp), color = if (t.isOpen) P.ink else P.muted, textDecoration = if (t.isDone) TextDecoration.LineThrough else null, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    val bits = listOfNotNull(if (showDate) Dates.fmtDateKey(t.dueDate) else null, t.dueTime?.let { Dates.fmtTime(it) }, t.durationMin?.let { "$it min" }, if (t.status == "skipped") "skipped" else null)
                    if (bits.isNotEmpty() || goal != null) Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 2.dp)) {
                        if (t.reminder && t.dueTime != null && t.isOpen) { Icon(Icons.Outlined.Notifications, "Reminder on", tint = P.muted, modifier = Modifier.size(13.dp)); Spacer(Modifier.width(3.dp)) }
                        if (bits.isNotEmpty()) Text(bits.joinToString("  "), style = Type.small, color = P.muted, maxLines = 1)
                        if (goal != null) { Spacer(Modifier.width(10.dp)); Text(goal.title, style = Type.small, color = P.accent, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                    }
                }
                if (t.isOpen && t.dueDate != null) IconButton(onClick = {
                    val prev = t.raw; val tomorrow = Dates.keyAdd(Dates.todayKey(), 1)
                    c.app.store.save("tasks", t.raw.with("dueDate" to if (t.dueDate!! >= tomorrow) Dates.keyAdd(t.dueDate!!, 1) else tomorrow))
                    c.toast("Moved to tomorrow.") { c.app.store.save("tasks", prev) }
                }) { Icon(Icons.AutoMirrored.Rounded.KeyboardTab, "Move to tomorrow", tint = P.muted, modifier = Modifier.size(20.dp)) }
                else Spacer(Modifier.width(12.dp))
            }
        }
        if (t.priority == 3 && t.isOpen) Box(Modifier.padding(vertical = 12.dp).width(3.dp).height(36.dp).align(Alignment.CenterStart).clip(RoundedCornerShape(2.dp)).background(P.hi))
    }
}
