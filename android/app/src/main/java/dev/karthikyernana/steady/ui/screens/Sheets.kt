package dev.karthikyernana.steady.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import dev.karthikyernana.steady.core.Dates
import dev.karthikyernana.steady.data.*
import dev.karthikyernana.steady.ui.*
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import java.time.Instant
import java.time.ZoneOffset

@OptIn(ExperimentalMaterial3Api::class, androidx.compose.ui.ExperimentalComposeUiApi::class)
@Composable
fun SSheet(onClose: () -> Unit, title: String, content: @Composable ColumnScope.() -> Unit) {
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = onClose, sheetState = state, containerColor = P.ground, contentColor = P.ink, dragHandle = { BottomSheetDefaults.DragHandle(color = P.line2) }) {
        // a sheet is its own window, so test tags must be re-exposed as resource ids here for the emulator e2e flow
        Column(Modifier.semantics { testTagsAsResourceId = true }.fillMaxWidth().imePadding().verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, bottom = 28.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(title, style = Type.h2.copy(fontSize = 23.sp), color = P.ink, modifier = Modifier.weight(1f))
                IconButton(onClick = onClose) { Icon(Icons.Rounded.Close, "Close", tint = P.ink2) }
            }
            Spacer(Modifier.height(10.dp))
            content()
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DateField(label: String, value: String?, onChange: (String?) -> Unit, allowClear: Boolean = false) {
    var open by remember { mutableStateOf(false) }
    FieldRow(label, if (value == null) "None" else Dates.fmtDateKey(value)) { open = true }
    if (open) {
        val st = rememberDatePickerState(initialSelectedDateMillis = (Dates.parse(value) ?: Dates.today()).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
        DatePickerDialog(onDismissRequest = { open = false }, confirmButton = {
            TextButton(onClick = { st.selectedDateMillis?.let { onChange(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString()) }; open = false }) { Text("OK") }
        }, dismissButton = { Row { if (allowClear) TextButton(onClick = { onChange(null); open = false }) { Text("Clear") }; TextButton(onClick = { open = false }) { Text("Cancel") } } }) {
            DatePicker(st)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TimeField(label: String, value: String?, onChange: (String?) -> Unit) {
    var open by remember { mutableStateOf(false) }
    FieldRow(label, if (value == null) "No time" else Dates.fmtTime(value)) { open = true }
    if (open) {
        val m = Dates.toMin(value) ?: (Dates.nowMin() / 30 + 1) * 30
        val st = rememberTimePickerState(initialHour = (m / 60) % 24, initialMinute = m % 60, is24Hour = false)
        AlertDialog(onDismissRequest = { open = false }, confirmButton = { TextButton(onClick = { onChange("%02d:%02d".format(st.hour, st.minute)); open = false }) { Text("OK") } },
            dismissButton = { Row { TextButton(onClick = { onChange(null); open = false }) { Text("No time") }; TextButton(onClick = { open = false }) { Text("Cancel") } } },
            text = { TimePicker(st) }, containerColor = P.surface)
    }
}

@Composable
fun FieldRow(label: String, value: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = Type.body, color = P.ink2, modifier = Modifier.weight(1f))
        Text(value, style = Type.bodyM, color = P.ink)
    }
    HorizontalDivider(color = P.line)
}

@Composable
fun SwitchRow(label: String, value: Boolean, hint: String? = null, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().clickable { onChange(!value) }.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) { Text(label, style = Type.body, color = P.ink2); hint?.let { Text(it, style = Type.small, color = P.muted) } }
        Switch(value, onChange, colors = SwitchDefaults.colors(checkedTrackColor = P.accent, checkedThumbColor = P.accentInk, uncheckedTrackColor = P.surface2, uncheckedBorderColor = P.line2))
    }
    HorizontalDivider(color = P.line)
}

@Composable
fun TaskSheet(t: Task, onClose: () -> Unit) {
    val c = LocalCtx.current
    var title by remember { mutableStateOf(t.title) }
    var date by remember { mutableStateOf(t.dueDate) }
    var time by remember { mutableStateOf(t.dueTime) }
    var dur by remember { mutableStateOf(t.durationMin?.toString() ?: "") }
    var prio by remember { mutableStateOf(t.priority.toString()) }
    var rem by remember { mutableStateOf(t.reminder) }
    var goal by remember { mutableStateOf(t.goalId) }
    SSheet(onClose, "Edit task") {
        SField(title, { title = it }, "Task", testTag = "edit-title")
        Spacer(Modifier.height(6.dp))
        DateField("Day", date, { v -> if (v != null) date = v })
        TimeField("Time", time) { time = it; if (it != null && c.snap.settings.bool("defaultReminder") != false) rem = true }
        Spacer(Modifier.height(8.dp))
        SField(dur, { v -> dur = v.filter(Char::isDigit).take(3) }, "Minutes (optional)", keyboard = KeyboardType.Number)
        Spacer(Modifier.height(12.dp))
        Segmented(listOf("1" to "Low", "2" to "Normal", "3" to "High"), prio, { prio = it }, Modifier.fillMaxWidth())
        Spacer(Modifier.height(6.dp))
        SwitchRow("Remind me", rem && time != null, if (time == null) "Pick a time first" else null) { if (time != null) rem = it }
        if (c.snap.goals.isNotEmpty()) {
            var open by remember { mutableStateOf(false) }
            FieldRow("Goal", c.snap.goals.firstOrNull { it.id == goal }?.title ?: "None") { open = true }
            DropdownMenu(open, { open = false }) {
                DropdownMenuItem(text = { Text("None") }, onClick = { goal = null; open = false })
                c.snap.goals.forEach { g -> DropdownMenuItem(text = { Text(g.title) }, onClick = { goal = g.id; open = false }) }
            }
        }
        Spacer(Modifier.height(18.dp))
        PrimaryButton("Save", Modifier.fillMaxWidth().then(Modifier), enabled = title.isNotBlank()) {
            c.app.store.save("tasks", t.raw.with("title" to title.trim(), "dueDate" to date, "dueTime" to time, "durationMin" to dur.toIntOrNull()?.takeIf { it > 0 },
                "priority" to prio.toInt(), "reminder" to (rem && time != null), "goalId" to goal))
            onClose()
        }
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (t.isOpen) GhostButton("Skip", Modifier.weight(1f)) { setStatus(c, t, "skipped"); onClose() }
            GhostButton("Delete", Modifier.weight(1f), color = P.danger) {
                val prev = t.raw; c.app.store.remove("tasks", t.id); onClose(); c.toast("Deleted.") { c.app.store.save("tasks", prev) }
            }
        }
    }
}

