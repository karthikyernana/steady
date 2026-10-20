package dev.karthikyernana.steady.ui.screens

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import dev.karthikyernana.steady.core.Dates
import dev.karthikyernana.steady.data.*
import dev.karthikyernana.steady.ui.*
import kotlinx.serialization.json.*

fun weekLabel(k: String?): String {
    val ws = Dates.weekStart().toString()
    return when (k) { null -> "Unscheduled"; ws -> "This week"; Dates.keyAdd(ws, 7) -> "Next week"; Dates.keyAdd(ws, -7) -> "Last week"; else -> "Week of ${Dates.fmtDateKey(k, relative = false)}" }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun GoalsScreen() {
    val c = LocalCtx.current
    var editing by remember { mutableStateOf<Goal?>(null) }
    var creating by remember { mutableStateOf(false) }
    val ws = Dates.weekStart().toString()
    LazyColumn(Modifier.fillMaxSize().testTag("goals"), contentPadding = PaddingValues(start = 18.dp, end = 18.dp, top = 6.dp, bottom = 170.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item(key = "head") { PageHead("GOALS", "What you're ", "building") }
        if (c.snap.goals.isEmpty()) item(key = "empty") {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                EmptyNote("No goals yet.", "One thing you want true in three months.")
                PrimaryButton("Add a goal") { creating = true }
            }
        }
        items(c.snap.goals, key = { it.id }) { g ->
            val ms = g.milestones
            val p = if (ms.isEmpty()) 0f else ms.count { it.done }.toFloat() / ms.size
            val current = ms.firstOrNull { !it.done && (it.week ?: "") <= ws } ?: ms.firstOrNull { !it.done }
            val weekDone = c.snap.tasks.count { it.goalId == g.id && it.isDone && it.doneAt != null && Dates.keyOf(it.doneAt!!) >= ws }
            SCard(Modifier.animateItem().testTag("goal")) {
                Row(verticalAlignment = Alignment.Top) {
                    Column(Modifier.weight(1f)) {
                        Text(g.title, style = Type.h2, color = P.ink)
                        if (g.why.isNotBlank()) Text(g.why, style = Type.small, color = P.muted)
                    }
                    IconButton(onClick = { editing = g }) { Icon(Icons.Outlined.MoreHoriz, "Edit goal ${g.title}", tint = P.muted) }
                }
                Spacer(Modifier.height(10.dp))
                LinearProgressIndicator(progress = { p }, modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)), color = P.accent, trackColor = P.line, drawStopIndicator = {})
                Spacer(Modifier.height(6.dp))
                Row {
                    Text(if (ms.isEmpty()) "No milestones yet" else "${ms.count { it.done }} of ${ms.size} milestones", style = Type.small, color = P.muted, modifier = Modifier.weight(1f))
                    g.target?.let { Text("by ${Dates.fmtDateKey(it, relative = false)}", style = Type.small, color = P.muted) }
                }
                if (ms.isNotEmpty() && ms.all { it.done }) { Spacer(Modifier.height(10.dp)); Text("All milestones done. Time to set the next ones.", style = Type.small, color = P.accent) }
                if (ms.isEmpty()) { Spacer(Modifier.height(6.dp)); Text("Plan weekly milestones →", style = Type.label.copy(fontSize = 13.sp), color = P.accent, modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable { editing = g }.padding(vertical = 6.dp)) }
                if (current != null) {
                    Spacer(Modifier.height(12.dp))
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(P.surface2.copy(alpha = 0.7f)).padding(end = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        CheckDot(done = current.done) { toggleMilestone(c, g, current.id) }
                        Column(Modifier.weight(1f).padding(vertical = 10.dp)) { Eyebrow(weekLabel(current.week)); Spacer(Modifier.height(2.dp)); Text(current.title, style = Type.bodyM.copy(fontSize = 16.sp), color = P.ink) }
                    }
                }
                val actions = g.raw.arr("actions").mapNotNull { it as? JsonObject }
                if (actions.isNotEmpty()) {
                    Spacer(Modifier.height(12.dp))
                    HorizontalDivider(color = P.line)
                    Spacer(Modifier.height(10.dp))
                    Eyebrow("Daily actions · $weekDone done this week")
                    actions.forEach { a ->
                        val title = a.str("title") ?: return@forEach
                        val onToday = c.snap.tasks.any { it.goalId == g.id && it.dueDate == Dates.todayKey() && it.title == title }
                        Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(title, style = Type.body, color = P.ink2, modifier = Modifier.weight(1f))
                            if (onToday) Text("On today", style = Type.small, color = P.muted)
                            else TextButton(onClick = {
                                c.app.store.save("tasks", buildJsonObject { put("id", uid()); put("title", title); put("priority", 2); put("dueDate", Dates.todayKey()); put("dueTime", JsonNull)
                                    put("durationMin", a.int("durationMin")); put("reminder", false); put("status", "open"); put("doneAt", JsonNull); put("goalId", g.id) })
                                c.toast("Added to today.", null)
                            }) { Text("Today", color = P.accent, style = Type.label) }
                        }
                    }
                }
            }
        }
        if (c.snap.goals.isNotEmpty()) item(key = "add") { Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { GhostButton("Add a goal") { creating = true } } }
    }
    if (creating) GoalSheet(null) { creating = false }
    editing?.let { g -> GoalSheet(g) { editing = null } }
}

fun toggleMilestone(c: Ctx, g: Goal, id: String) {
    var nowDone = false
    val ms = JsonArray(g.raw.arr("milestones").map { el -> val m = el.jsonObject; if (m.str("id") == id) { nowDone = m.bool("done") != true; m.with("done" to nowDone, "doneAt" to if (nowDone) System.currentTimeMillis() else null) } else m })
    val prev = g.raw
    c.app.store.save("goals", g.raw.with("milestones" to ms))
    c.toast(if (nowDone) "Milestone done. That is real progress." else "Milestone reopened.") { c.app.store.save("goals", prev) }
}

@Composable
fun GoalSheet(g: Goal?, onClose: () -> Unit) {
    val c = LocalCtx.current
    var title by remember { mutableStateOf(g?.title ?: "") }
    var why by remember { mutableStateOf(g?.why ?: "") }
    var target by remember { mutableStateOf(g?.target ?: Dates.today().plusDays(84).toString()) }
    var milestones by remember { mutableStateOf(g?.milestones?.joinToString("\n") { it.title } ?: "") }
    var actions by remember { mutableStateOf(g?.actions?.joinToString("\n") ?: "") }
    SSheet(onClose, if (g == null) "New goal" else "Edit goal") {
        SField(title, { title = it }, "Goal", testTag = "goal-title")
        Spacer(Modifier.height(8.dp))
        SField(why, { why = it }, "Why it matters (optional)", singleLine = false)
        DateField("Target date", target, { if (it != null) target = it })
        Spacer(Modifier.height(8.dp))
        SField(milestones, { milestones = it }, "Weekly milestones, one per line", singleLine = false, minLines = 3)
        Spacer(Modifier.height(8.dp))
        SField(actions, { actions = it }, "Daily actions, one per line (optional)", singleLine = false, minLines = 2)
        Spacer(Modifier.height(16.dp))
        PrimaryButton("Save", Modifier.fillMaxWidth(), enabled = title.isNotBlank()) {
            val ws = Dates.weekStart().toString()
            val old = g?.milestones.orEmpty(); val oldRaw = g?.raw?.arr("milestones")?.mapNotNull { it as? JsonObject }.orEmpty()
            val ms = milestones.lines().map { it.trim() }.filter { it.isNotEmpty() }.mapIndexed { i, t ->
                val keep = old.indexOfFirst { it.title == t }
                if (keep >= 0) oldRaw[keep] else buildJsonObject { put("id", uid()); put("title", t); put("week", Dates.keyAdd(ws, i * 7L)); put("done", false) }
            }
            val oldActs = g?.raw?.arr("actions")?.mapNotNull { it as? JsonObject }.orEmpty()
            val acts = actions.lines().map { it.trim() }.filter { it.isNotEmpty() }.map { t -> oldActs.firstOrNull { it.str("title") == t } ?: buildJsonObject { put("id", uid()); put("title", t) } }
            val base = g?.raw ?: buildJsonObject { put("id", uid()); put("order", c.snap.goals.size) }
            c.app.store.save("goals", base.with("title" to title.trim(), "why" to why.trim(), "target" to target, "milestones" to JsonArray(ms), "actions" to JsonArray(acts)))
            onClose()
        }
        if (g != null) {
            Spacer(Modifier.height(8.dp))
            GhostButton("Delete goal", Modifier.fillMaxWidth(), color = P.danger) { val prev = g.raw; c.app.store.remove("goals", g.id); onClose(); c.toast("Goal deleted.") { c.app.store.save("goals", prev) } }
        }
    }
}
