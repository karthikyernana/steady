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

/**
 * Speak (or type) once; Steady turns it into draft cards — a to-do, a reminder, money, a goal step, a thought — and nothing
 * is written until you accept a card. Telugu, English, or both mixed.
 */
@Composable
fun VoiceSheet(onClose: () -> Unit) {
    val c = LocalCtx.current
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val agent = remember { Agent(c.app.store, c.app.api) }
    val recorder = remember { Recorder(ctx) }
    var phase by remember { mutableStateOf("idle") } // idle | rec | thinking | drafts
    var transcript by remember { mutableStateOf("") }
    var typed by remember { mutableStateOf("") }
    var drafts by remember { mutableStateOf<List<Draft>>(emptyList()) }
    var clarification by remember { mutableStateOf<String?>(null) }
    var err by remember { mutableStateOf<String?>(null) }
    var level by remember { mutableFloatStateOf(0f) }
    DisposableEffect(Unit) { onDispose { recorder.stopQuietly() } }

    fun plan(text: String) {
        if (text.isBlank()) return
        phase = "thinking"; err = null; transcript = text
        scope.launch {
            try { val p = agent.plan(text); drafts = p.drafts; clarification = p.clarification; phase = "drafts" }
            catch (e: ApiError) { err = e.message; phase = "idle" }
        }
    }
    fun startRec() {
        err = null
        try { recorder.start(); phase = "rec"; scope.launch { while (recorder.isRecording) { level = recorder.level(); delay(80) } } }
        catch (e: Exception) { err = "Couldn't start the microphone."; phase = "idle" }
    }
    fun stopRec() {
        val bytes = recorder.stop()
        if (bytes == null) { phase = "idle"; err = "That was too short. Hold on a little longer."; return }
        phase = "thinking"
        scope.launch {
            try { val t = agent.transcribe(bytes, "audio/mp4"); if (t.isBlank()) { phase = "idle"; err = "I didn't catch that. Try again, or type it." } else plan(t) }
            catch (e: ApiError) { err = e.message; phase = "idle" }
        }
    }
    val micPerm = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok -> if (ok) startRec() else err = "Steady needs the microphone to hear you. You can type instead." }
    val signedIn = c.app.sync.signedIn

    SSheet(onClose, "Tell Steady") {
        if (!signedIn) {
            Text("Voice understanding runs on Steady's server, so it needs your account. Sign in from You, or add tasks with the box on Today.", style = Type.body, color = P.ink2)
            return@SSheet
        }
        when (phase) {
            "idle", "rec" -> {
                Text("Tasks, reminders, money, goal progress, thoughts. English, Telugu, or both.", style = Type.small, color = P.muted)
                Spacer(Modifier.height(20.dp))
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
                Text(if (phase == "rec") "Listening… tap to finish" else "Tap and speak", style = Type.small, color = P.muted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
                Spacer(Modifier.height(18.dp))
                if (phase == "idle") {
                    SField(typed, { typed = it }, "Or type it", singleLine = false, testTag = "voice-text")
                    Spacer(Modifier.height(8.dp))
                    PrimaryButton("Understand", Modifier.fillMaxWidth(), enabled = typed.isNotBlank()) { plan(typed.trim()) }
                }
            }
            "thinking" -> {
                if (transcript.isNotEmpty()) Text("“$transcript”", style = Type.h3, color = P.ink2)
                Spacer(Modifier.height(16.dp))
                Row(verticalAlignment = Alignment.CenterVertically) { CircularProgressIndicator(Modifier.size(20.dp), color = P.accent, strokeWidth = 2.dp); Spacer(Modifier.width(10.dp)); Text("Understanding…", style = Type.body, color = P.muted) }
            }
            "drafts" -> {
                Eyebrow("You said")
                Spacer(Modifier.height(6.dp))
                Text(transcript, style = Type.body.copy(fontSize = 16.sp, lineHeight = 23.sp), color = P.ink,
                    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(P.surface2.copy(alpha = .8f)).padding(14.dp))
                clarification?.let { Spacer(Modifier.height(8.dp)); Text(it, style = Type.body, color = P.warn) }
                Spacer(Modifier.height(10.dp))
                Text(if (drafts.isEmpty()) "Nothing to add from that." else "${drafts.size} thing${if (drafts.size == 1) "" else "s"} to review", style = Type.small, color = P.muted)
                Spacer(Modifier.height(10.dp))
                drafts.forEachIndexed { i, d ->
                    DraftCard(d, onAccept = {
                        try {
                            val a = agent.apply(d)
                            drafts = drafts.filterIndexed { j, _ -> j != i }
                            c.toast(a.label) { agent.undo(a) }
                            if (drafts.isEmpty()) onClose()
                        } catch (e: Exception) { err = e.message }
                    }, onSkip = { drafts = drafts.filterIndexed { j, _ -> j != i }; if (drafts.isEmpty()) onClose() })
                    Spacer(Modifier.height(10.dp))
                }
                Spacer(Modifier.height(4.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    GhostButton(if (drafts.isEmpty()) "Try again" else "Discard", Modifier.weight(1f)) { phase = "idle"; drafts = emptyList(); transcript = ""; typed = "" }
                    if (drafts.size > 1 && drafts.none { it.needs.isNotEmpty() }) PrimaryButton("Accept all ${drafts.size}", Modifier.weight(1.4f).testTag("accept-all")) {
                        val applied = drafts.map { agent.apply(it) }
                        c.toast("${applied.size} added") { applied.reversed().forEach { agent.undo(it) } }
                        onClose()
                    }
                }
            }
        }
        err?.let { Spacer(Modifier.height(10.dp)); Text(it, style = Type.small, color = P.danger) }
    }
}

@Composable
private fun DraftCard(d: Draft, onAccept: () -> Unit, onSkip: () -> Unit) {
    val icon = when (d.type) { "money" -> Icons.Outlined.AccountBalanceWallet; "complete" -> Icons.Rounded.Check; "reminder" -> Icons.Outlined.Notifications; "goal", "progress" -> Icons.Outlined.Flag; "thought" -> Icons.Outlined.ChatBubbleOutline; else -> Icons.Outlined.CheckCircle }
    SCard(Modifier.testTag("draft")) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(30.dp).clip(RoundedCornerShape(9.dp)).background(P.surface2), contentAlignment = Alignment.Center) { Icon(icon, null, tint = P.ink2, modifier = Modifier.size(17.dp)) }
            Spacer(Modifier.width(10.dp))
            Eyebrow(d.kindLabel + (if (d.type == "complete" && d.f["taskId"]?.toString() !in listOf(null, "null")) " · existing task" else ""), color = P.ink2)
            Spacer(Modifier.weight(1f))
            IconButton(onClick = onSkip, modifier = Modifier.size(32.dp)) { Icon(Icons.Rounded.Close, "Skip", tint = P.muted, modifier = Modifier.size(18.dp)) }
        }
        Spacer(Modifier.height(8.dp))
        Text(d.sentence, style = Type.h3.copy(fontSize = 17.sp, lineHeight = 23.sp), color = P.ink)
        if (d.evidence.isNotBlank()) { Spacer(Modifier.height(4.dp)); Text("“${d.evidence}”", style = Type.small, color = P.muted) }
        if (d.needs.isNotEmpty()) Text("Missing: ${d.needs.joinToString()}. You can edit it after adding.", style = Type.small, color = P.warn)
        Spacer(Modifier.height(10.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            PrimaryButton("Accept", Modifier.testTag("draft-accept"), enabled = !(d.type == "money" && d.f["amount"]?.toString() in listOf(null, "null")), onClick = onAccept)
        }
    }
}
