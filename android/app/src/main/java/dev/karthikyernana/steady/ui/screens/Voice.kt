package dev.karthikyernana.steady.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.outlined.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.sp
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import dev.karthikyernana.steady.agent.Agent
import dev.karthikyernana.steady.agent.Draft
import dev.karthikyernana.steady.agent.Recorder
import dev.karthikyernana.steady.net.ApiError
import dev.karthikyernana.steady.ui.*
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import dev.karthikyernana.steady.data.str
import dev.karthikyernana.steady.data.num
import dev.karthikyernana.steady.data.bool

/**
 * Speak (or type) once; Steady turns it into draft cards — a to-do, a reminder, money, a goal step, a thought — and nothing
 * is written until you accept a card. Telugu, English, or both mixed.
 */
@Composable
fun VoiceSheet(onClose: () -> Unit, heard: List<ByteArray>? = null) {
    val c = LocalCtx.current
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val agent = remember { Agent(c.app.store, c.app.api) }
    val recorder = remember { Recorder(ctx) }
    val signedIn = c.app.sync.signedIn
    var phase by remember { mutableStateOf("idle") } // idle | rec | thinking | drafts
    var transcript by remember { mutableStateOf("") }
    var typed by remember { mutableStateOf("") }
    var drafts by remember { mutableStateOf<List<Draft>>(emptyList()) }
    var original by remember { mutableStateOf<List<Draft>>(emptyList()) }
    var clarification by remember { mutableStateOf<String?>(null) }
    var provider by remember { mutableStateOf<String?>(null) }
    var tookMs by remember { mutableLongStateOf(0L) }
    var err by remember { mutableStateOf<String?>(null) }
    var level by remember { mutableFloatStateOf(0f) }
    // one undo for the whole session, and the (proposed, accepted) pairs the agent learns from
    val applied = remember { mutableStateListOf<dev.karthikyernana.steady.agent.Applied>() }
    val learned = remember { mutableStateListOf<Pair<Draft, Draft>>() }
    fun finish() {
        recorder.stopQuietly()
        if (applied.isNotEmpty()) {
            val all = applied.toList()
            c.toast(if (all.size == 1) all[0].label else "${all.size} changes saved") { all.reversed().forEach { agent.undo(it) } }
        }
        val pairs = learned.toList(); if (signedIn && pairs.isNotEmpty()) scope.launch { agent.learn(pairs) }
        onClose()
    }
    DisposableEffect(Unit) { onDispose { recorder.stopQuietly() } }

    fun plan(text: String) {
        if (text.isBlank()) return
        phase = "thinking"; err = null; transcript = text
        val t0 = System.currentTimeMillis()
        scope.launch {
            try { val p = agent.plan(text, signedIn); drafts = p.drafts; original = p.drafts; clarification = p.clarification; provider = p.provider; tookMs = System.currentTimeMillis() - t0; phase = "drafts" }
            catch (e: ApiError) { err = e.message; phase = "idle" }
        }
    }
    fun stopRec() {
        val pieces = recorder.stop()
        if (pieces.isEmpty()) { phase = "idle"; err = "That was too short. Speak a little longer, or type it."; return }
        phase = "thinking"
        scope.launch {
            try {
                val parts = pieces.map { agent.transcribe(it, "audio/mp4").trim() }.filter { it.isNotEmpty() }
                if (parts.isEmpty()) { phase = "idle"; err = "I didn't catch that. Try again, or type it." } else plan(parts.joinToString(" "))
            } catch (e: ApiError) { err = e.message; phase = "idle" }
        }
    }
    fun startRec() {
        err = null
        try {
            recorder.start(); phase = "rec"
            scope.launch {
                // stop by itself after a pause once you've spoken; split long speech at pauses (Sarvam takes ≤30 s a file)
                var spoke = false; var quietSince = 0L
                while (recorder.isRecording) {
                    level = recorder.level(); val now = System.currentTimeMillis()
                    if (level > 0.08f) { spoke = true; quietSince = 0L } else if (quietSince == 0L) quietSince = now
                    val quietMs = if (quietSince == 0L) 0L else now - quietSince
                    when {
                        recorder.turnMs >= 120_000 -> { stopRec(); break }
                        spoke && quietMs >= 1_800 -> { stopRec(); break }
                        recorder.pieceMs >= 28_000 || (recorder.pieceMs >= 24_000 && quietMs >= 300) -> recorder.rotate()
                    }
                    delay(80)
                }
            }
        } catch (e: Exception) { err = "Couldn't start the microphone."; phase = "idle" }
    }
    val micPerm = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok -> if (ok) startRec() else err = "Steady needs the microphone to hear you. You can type instead." }
    // opened by letting go of Ask after a hold: what it recorded is written down here ("thinking"), then planned into drafts
    LaunchedEffect(heard) {
        val pieces = heard ?: return@LaunchedEffect
        phase = "thinking"; transcript = ""; err = null
        try {
            val parts = pieces.map { agent.transcribe(it, "audio/mp4").trim() }.filter { it.isNotEmpty() }
            if (parts.isEmpty()) { phase = "idle"; err = "I didn't catch that. Hold Ask and try again, or type it." } else plan(parts.joinToString(" "))
        } catch (e: ApiError) { err = e.message; phase = "idle" }
    }
    SSheet(::finish, "Tell Steady") {
        when (phase) {
            "idle", "rec" -> {
                Text("Tasks, reminders, money, goal progress, thoughts. English, Telugu, or both.", style = Type.small, color = P.muted)
                Spacer(Modifier.height(20.dp))
                if (signedIn) {
                    val s by animateFloatAsState(if (phase == "rec") 1f + level * 0.6f else 1f, label = "lvl")
                    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                        Box(Modifier.size(96.dp).scale(s).clip(CircleShape).background(if (phase == "rec") P.accentSoft else P.surface2))
                        FilledIconButton(onClick = {
                            if (phase == "rec") stopRec()
                            else if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) startRec()
                            else micPerm.launch(Manifest.permission.RECORD_AUDIO)
                        }, modifier = Modifier.size(72.dp).semantics { contentDescription = if (phase == "rec") "Stop and send" else "Start speaking" }.testTag("voice-mic"),
                            colors = IconButtonDefaults.filledIconButtonColors(containerColor = if (phase == "rec") P.danger else P.ink, contentColor = P.ground)) {
                            Icon(if (phase == "rec") Icons.Rounded.Stop else Icons.Rounded.Mic, null, modifier = Modifier.size(32.dp))
                        }
                    }
                    Spacer(Modifier.height(10.dp))
                    Text(if (phase == "rec") "Listening… stops when you pause" else "Tap and speak", style = Type.small, color = P.muted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
                } else {
                    Text("Speaking needs your account (speech is understood on Steady's server). Typing works right here, even offline.", style = Type.small, color = P.ink2)
                }
                Spacer(Modifier.height(18.dp))
                if (phase == "idle") {
                    SField(typed, { typed = it }, "Or type it", singleLine = false, testTag = "voice-text")
                    Spacer(Modifier.height(8.dp))
                    PrimaryButton("Understand", Modifier.fillMaxWidth().testTag("voice-understand"), enabled = typed.isNotBlank()) { plan(typed.trim()) }
                }
            }
            "thinking" -> {
                if (transcript.isNotEmpty()) Text("“$transcript”", style = Type.h3, color = P.ink2, modifier = Modifier.testTag("voice-heard-text"))
                Spacer(Modifier.height(16.dp))
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.testTag("voice-thinking")) { CircularProgressIndicator(Modifier.size(20.dp), color = P.accent, strokeWidth = 2.dp); Spacer(Modifier.width(10.dp))
                    Text(if (transcript.isEmpty()) "Writing down what you said…" else "Understanding…", style = Type.body, color = P.muted) }
            }
            "drafts" -> {
                // what was heard, editable: fix a word and run it again
                var heard by remember(transcript) { mutableStateOf(transcript) }
                Eyebrow("You said")
                Spacer(Modifier.height(6.dp))
                SField(heard, { heard = it }, "", singleLine = false, testTag = "voice-heard")
                if (heard.trim() != transcript.trim()) { Spacer(Modifier.height(6.dp)); GhostButton("Understand again", Modifier.fillMaxWidth().testTag("voice-rerun")) { plan(heard.trim()) } }
                clarification?.let { Spacer(Modifier.height(8.dp)); Text(it, style = Type.body, color = P.warn) }
                Spacer(Modifier.height(10.dp))
                Text((if (drafts.isEmpty()) "Nothing left to review." else "${drafts.size} thing${if (drafts.size == 1) "" else "s"} to review") +
                    (provider?.let { "  ·  understood ${if (it == "device") "on this phone" else "by ${it.replaceFirstChar { ch -> ch.uppercase() }}"} · ${"%.1f".format(tookMs / 1000.0)} s" } ?: ""), style = Type.small, color = P.muted)
                Spacer(Modifier.height(10.dp))
                drafts.forEachIndexed { i, d ->
                    key(i, d.type, original.getOrNull(i)?.evidence) {
                        DraftCard(d, c.snap, onChange = { nd -> drafts = drafts.toMutableList().also { it[i] = nd } }, onAccept = {
                            try {
                                applied += agent.apply(d); original.getOrNull(i)?.let { learned += it to d }
                                drafts = drafts.filterIndexed { j, _ -> j != i }; original = original.filterIndexed { j, _ -> j != i }
                                if (drafts.isEmpty()) finish()
                            } catch (e: Exception) { err = e.message }
                        }, onSkip = { drafts = drafts.filterIndexed { j, _ -> j != i }; original = original.filterIndexed { j, _ -> j != i }; if (drafts.isEmpty()) finish() })
                    }
                    Spacer(Modifier.height(10.dp))
                }
                Spacer(Modifier.height(4.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    GhostButton(if (drafts.isEmpty()) "Try again" else "Discard", Modifier.weight(1f)) { phase = "idle"; drafts = emptyList(); original = emptyList(); transcript = ""; typed = "" }
                    if (drafts.size > 1) PrimaryButton("Accept all ${drafts.size}", Modifier.weight(1.4f).testTag("accept-all")) {
                        // stops at the first card that still needs something, so nothing half-filled is saved
                        val ready = drafts.takeWhile { it.needs.isEmpty() }
                        ready.forEachIndexed { k, d -> applied += agent.apply(d); original.getOrNull(k)?.let { learned += it to d } }
                        drafts = drafts.drop(ready.size); original = original.drop(ready.size)
                        if (drafts.isEmpty()) finish() else err = "Fill in what's missing on the next card, then accept it."
                    }
                }
            }
        }
        err?.let { Spacer(Modifier.height(10.dp)); Text(it, style = Type.small, color = P.danger) }
    }
}

@Composable
private fun DraftCard(d: Draft, snap: dev.karthikyernana.steady.data.Snapshot, onChange: (Draft) -> Unit, onAccept: () -> Unit, onSkip: () -> Unit) {
    val icon = when (d.type) { "money" -> Icons.Outlined.AccountBalanceWallet; "complete" -> Icons.Rounded.Check; "reminder" -> Icons.Outlined.Notifications; "goal", "progress" -> Icons.Outlined.Flag; "thought" -> Icons.Outlined.ChatBubbleOutline; else -> Icons.Outlined.CheckCircle }
    var editing by remember { mutableStateOf(d.needs.isNotEmpty()) }
    SCard(Modifier.testTag("draft")) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(30.dp).clip(RoundedCornerShape(9.dp)).background(P.surface2), contentAlignment = Alignment.Center) { Icon(icon, null, tint = P.ink2, modifier = Modifier.size(17.dp)) }
            Spacer(Modifier.width(10.dp))
            Eyebrow(d.kindLabel + (if (d.type == "complete" && !d.f.str("taskId").isNullOrBlank()) " · existing task" else ""), color = P.ink2)
            Spacer(Modifier.weight(1f))
            IconButton(onClick = onSkip, modifier = Modifier.size(32.dp)) { Icon(Icons.Rounded.Close, "Skip", tint = P.muted, modifier = Modifier.size(18.dp)) }
        }
        Spacer(Modifier.height(8.dp))
        Text(d.sentence, style = Type.h3.copy(fontSize = 17.sp, lineHeight = 23.sp), color = P.ink)
        if (d.evidence.isNotBlank()) { Spacer(Modifier.height(4.dp)); Text("“${d.evidence}”", style = Type.small, color = P.muted) }
        if (d.confidence < 0.55) Text("Not fully sure about this one. Check it before accepting.", style = Type.small, color = P.warn, modifier = Modifier.padding(top = 4.dp))
        if (editing) { Spacer(Modifier.height(8.dp)); DraftEditor(d, snap, onChange) }
        if (d.needs.isNotEmpty()) Text("Add the ${d.needs.joinToString(" and ")} to accept.", style = Type.small, color = P.warn, modifier = Modifier.padding(top = 6.dp).testTag("draft-needs"))
        Spacer(Modifier.height(10.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
            if (!editing) TextButton(onClick = { editing = true }, modifier = Modifier.testTag("draft-edit")) { Text("Edit", color = P.ink2) }
            Spacer(Modifier.width(6.dp))
            PrimaryButton("Accept", Modifier.testTag("draft-accept"), enabled = d.needs.isEmpty(), onClick = onAccept)
        }
    }
}

/** The fields that matter for each kind of draft, edited in place before anything is saved. */
@Composable
private fun DraftEditor(d: Draft, snap: dev.karthikyernana.steady.data.Snapshot, onChange: (Draft) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        when (d.type) {
            "task", "reminder" -> {
                SField(d.f.str("title") ?: "", { onChange(d.edit("title" to it)) }, "Title", testTag = "de-title")
                DateField("Day", d.f.str("dueDate") ?: dev.karthikyernana.steady.core.Dates.todayKey(), { v -> v?.let { onChange(d.edit("dueDate" to it)) } })
                TimeField("Time", d.f.str("dueTime")) { onChange(d.edit("dueTime" to it, "reminder" to (it != null && (d.type == "reminder" || d.f.bool("reminder") == true)))) }
                if (snap.goals.isNotEmpty()) {
                    val opts = listOf("" to "No goal") + snap.goals.map { it.id to it.title }
                    Picker("Goal", opts, d.f.str("goalId") ?: "") { onChange(d.edit("goalId" to it.ifEmpty { null })) }
                }
            }
            "money" -> {
                Segmented(listOf("expense" to "Spent", "income" to "Came in"), d.f.str("kind") ?: "expense", { onChange(d.edit("kind" to it)) }, Modifier.fillMaxWidth())
                var amt by remember { mutableStateOf(d.f.num("amount")?.let { if (it % 1.0 == 0.0) "%.0f".format(it) else "$it" } ?: "") }
                SField(amt, { v -> amt = v; onChange(d.edit("amount" to v.replace(",", "").trim().toDoubleOrNull()?.takeIf { it > 0 && it < 1e8 })) }, "Amount (₹)",
                    keyboard = androidx.compose.ui.text.input.KeyboardType.Decimal, testTag = "de-amount")
                SField(d.f.str("category") ?: "", { onChange(d.edit("category" to it)) }, "Category", testTag = "de-category")
                SField(d.f.str("note") ?: "", { onChange(d.edit("note" to it)) }, "Note")
                DateField("Date", d.f.str("date") ?: dev.karthikyernana.steady.core.Dates.todayKey(), { v -> v?.let { onChange(d.edit("date" to it)) } })
            }
            "thought" -> {
                SField(d.f.str("text") ?: "", { onChange(d.edit("text" to it)) }, "Thought", singleLine = false)
                Segmented(listOf("note" to "Note", "idea" to "Idea", "journal" to "Journal"), d.f.str("kind") ?: "note", { onChange(d.edit("kind" to it)) }, Modifier.fillMaxWidth())
            }
            "goal" -> {
                SField(d.f.str("title") ?: "", { onChange(d.edit("title" to it)) }, "Goal")
                val ms = (d.f["milestones"] as? kotlinx.serialization.json.JsonArray).orEmpty().mapNotNull { (it as? kotlinx.serialization.json.JsonPrimitive)?.contentOrNull }
                SField(ms.joinToString("\n"), { v -> onChange(d.edit("milestones" to kotlinx.serialization.json.JsonArray(v.split("\n").map { it.trim() }.filter { it.isNotEmpty() }.map(::JsonPrimitive)))) }, "Weekly milestones, one per line", singleLine = false, minLines = 2)
            }
            "complete" -> {
                val open = snap.tasks.filter { it.isOpen }.take(30)
                if (open.isNotEmpty()) Picker("Which task", listOf("" to "A new done item") + open.map { it.id to it.title }, d.f.str("taskId") ?: "") { id ->
                    val t = open.firstOrNull { it.id == id }
                    onChange(d.edit("taskId" to id.ifEmpty { null }, "title" to (t?.title ?: d.f.str("title")), "goalId" to t?.goalId))
                }
                if (d.f.str("taskId").isNullOrBlank()) SField(d.f.str("title") ?: "", { onChange(d.edit("title" to it)) }, "What you did")
            }
            "progress" -> SField(d.f.str("title") ?: "", { onChange(d.edit("title" to it)) }, "What you did")
        }
    }
}

/** A compact dropdown field in the same row style as DateField/TimeField. */
@Composable
private fun Picker(label: String, options: List<Pair<String, String>>, value: String, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        FieldRow(label, options.firstOrNull { it.first == value }?.second ?: options.first().second) { open = true }
        DropdownMenu(open, { open = false }, containerColor = P.surface) {
            options.forEach { (k, l) -> DropdownMenuItem(text = { Text(l, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis) }, onClick = { onPick(k); open = false }) }
        }
    }
}
