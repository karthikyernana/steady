package dev.karthikyernana.steady.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.onLongClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * "Ask": the one floating button. TAP opens Chat. PRESS AND HOLD is hold-to-talk on the button itself: no sheet while you
 * hold. Past [AskGesture.HOLD_MS] the button grows a little, turns the recording colour, shows a live level ring and a
 * timer, and "Release to send" floats ABOVE it (never under the finger). Letting go sends: the voice sheet opens on the
 * words it heard ("thinking"), then the drafts. A hold under [AskGesture.MIN_MS] is a slip (cancel, "Hold to talk");
 * sliding the finger more than [AskGesture.CANCEL_DP] away arms cancel ("Release to cancel"). Without the microphone
 * permission the first hold only asks for it (never records hands-free afterwards): "Hold again to talk".
 * The rules are [AskGesture], pure, so they are unit-tested.
 */
object AskPress {
    const val HOLD_MS = 380L
    const val MIN_HOLD_MS = 600L
    const val CANCEL_DP = 80f
    /** Same rule as the web's js/ui/press.js releaseOutcome: "tap" (open Chat) · "none" (the system took the gesture
     *  before the hold) · "cancel" (finger slid > [CANCEL_DP] away) · "short" (fumbled hold: let go before
     *  [MIN_HOLD_MS] with nothing heard) · "send". No hands-free keep-listening any more. */
    fun outcome(pressedMs: Long, cancelled: Boolean = false, outside: Boolean = false, heard: Boolean = false): String = when {
        pressedMs < HOLD_MS -> if (cancelled) "none" else "tap"
        outside -> "cancel"
        pressedMs < MIN_HOLD_MS && !heard -> "short"
        else -> "send"
    }
}

/** Hold-to-talk on the Ask button as a pure state machine: feed it pointer events and times, act on what it returns. */
class AskGesture {
    companion object { const val HOLD_MS = AskPress.HOLD_MS; const val MIN_MS = AskPress.MIN_HOLD_MS; const val CANCEL_DP = AskPress.CANCEL_DP }
    enum class Phase { Idle, Pressed, Recording, AskedPermission, Handled }
    sealed interface Effect {
        data object Tap : Effect                         // open Chat
        data object StartRecording : Effect              // + haptic tick
        data object RequestPermission : Effect
        data object OpenTyping : Effect                  // signed out: speech needs the account, so the typing sheet
        data object Send : Effect                        // stop, transcribe, open the sheet on what was heard
        data class Cancel(val hint: String) : Effect     // stop and discard
    }
    var phase = Phase.Idle; private set
    var cancelArmed = false; private set
    private var downAt = 0L

    fun down(t: Long) { phase = Phase.Pressed; cancelArmed = false; downAt = t }
    /** Call when the finger has stayed down [HOLD_MS]. */
    fun hold(t: Long, canRecord: Boolean, permitted: Boolean): Effect? {
        if (phase != Phase.Pressed || t - downAt < HOLD_MS) return null
        return when {
            !canRecord -> { phase = Phase.Handled; Effect.OpenTyping }
            !permitted -> { phase = Phase.AskedPermission; Effect.RequestPermission }
            else -> { phase = Phase.Recording; Effect.StartRecording }
        }
    }
    /** Finger distance from where it went down, in dp. */
    fun move(distanceDp: Float) { if (phase == Phase.Recording) cancelArmed = distanceDp > CANCEL_DP }
    /** [heard] = the recording already picked up speech (a quick but real "yes" is sent, not dropped). */
    fun up(t: Long, systemCancelled: Boolean = false, heard: Boolean = false): Effect? {
        val p = phase; phase = Phase.Idle
        return when (p) {
            Phase.Pressed -> if (systemCancelled) null else Effect.Tap
            // as the web: once recording, a gesture the system took still sends what was said (unless it was a slip)
            Phase.Recording -> when (AskPress.outcome(maxOf(t - downAt, HOLD_MS), cancelled = systemCancelled, outside = cancelArmed, heard = heard)) {
                "cancel" -> Effect.Cancel("Cancelled")
                "short" -> Effect.Cancel("Hold to talk")
                else -> Effect.Send
            }
            else -> null                                  // the permission ask or the typing sheet already answered this press
        }.also { cancelArmed = false }
    }
    /** The recording was ended for us (the 2-minute cap): treat the hold as sent. */
    fun forceSend(): Effect? = if (phase == Phase.Recording) { phase = Phase.Handled; cancelArmed = false; Effect.Send } else null
}

/** The live recording behind a hold: level (~60 ms), elapsed time, pieces for long turns. */
class VoiceHold(private val recorder: dev.karthikyernana.steady.agent.Recorder?) {
    var recording by mutableStateOf(false); private set
    var cancelArmed by mutableStateOf(false)
    var level by mutableFloatStateOf(0f); private set
    var elapsedMs by mutableLongStateOf(0L); private set
    /** speech was picked up during this hold */
    var heard = false; private set
    /** a short line above the button after a slip, a cancel, or the permission ask */
    var hint by mutableStateOf<String?>(null)
    var hintSeq by mutableIntStateOf(0); private set
    private var job: Job? = null
    fun showHint(h: String) { hint = h; hintSeq++ }
    fun start(scope: kotlinx.coroutines.CoroutineScope, onCap: () -> Unit): Boolean {
        val r = recorder ?: return false
        if (runCatching { r.start() }.isFailure) { showHint("The microphone is busy"); return false }
        recording = true; level = 0f; elapsedMs = 0L; hint = null; heard = false
        job = scope.launch {
            while (recording) {
                delay(60)
                val raw = r.level().coerceIn(0f, 1f); if (raw > 0.08f) heard = true
                level = level * 0.55f + raw * 0.45f
                elapsedMs = r.turnMs
                if (r.turnMs >= 120_000) { onCap(); break }
                if (r.pieceMs >= 28_000 || (r.pieceMs >= 24_000 && level < 0.05f)) r.rotate()
            }
        }
        return true
    }
    fun stop(): List<ByteArray> { recording = false; cancelArmed = false; job?.cancel(); return recorder?.stop() ?: emptyList() }
    fun cancel() { recording = false; cancelArmed = false; job?.cancel(); recorder?.stopQuietly() }
}

/** A speech bubble holding a small voice wave: one mark for "ask" and "talk", deliberately not an AI sparkle. */
val AskIcon: ImageVector by lazy {
    ImageVector.Builder("ask", 24.dp, 24.dp, 24f, 24f).apply {
        fun stroke(d: String) = addPath(addPathNodes(d), fill = null, stroke = SolidColor(Color.Black), strokeLineWidth = 1.8f, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round)
        stroke("M4.5 6.8A2.8 2.8 0 0 1 7.3 4h9.4a2.8 2.8 0 0 1 2.8 2.8v6.1a2.8 2.8 0 0 1-2.8 2.8H11.2L7 19.3v-3.6h0.3a2.8 2.8 0 0 1-2.8-2.8z")
        stroke("M9.4 8.7v2.4M12 7.6v4.6M14.6 8.7v2.4")
    }.build()
}

@Composable
fun AskFab(onTap: () -> Unit, voice: VoiceHold, canRecord: () -> Boolean, permitted: () -> Boolean, onRequestPermission: () -> Unit,
           onOpenTyping: () -> Unit, onSend: (List<ByteArray>) -> Unit, modifier: Modifier = Modifier) {
    val scope = rememberCoroutineScope()
    val haptic = androidx.compose.ui.platform.LocalHapticFeedback.current
    val density = androidx.compose.ui.platform.LocalDensity.current
    val gesture = remember { AskGesture() }
    var pressed by remember { mutableStateOf(false) }
    val rec = voice.recording
    val onTapS by rememberUpdatedState(onTap); val onOpenTypingS by rememberUpdatedState(onOpenTyping)
    val onPermS by rememberUpdatedState(onRequestPermission); val onSendS by rememberUpdatedState(onSend)
    fun handle(e: AskGesture.Effect?) {
        when (e) {
            null -> {}
            AskGesture.Effect.Tap -> onTapS()
            AskGesture.Effect.OpenTyping -> onOpenTypingS()
            AskGesture.Effect.RequestPermission -> onPermS()
            AskGesture.Effect.StartRecording -> {
                if (voice.start(scope) { handle(gesture.forceSend()) }) haptic.performHapticFeedback(androidx.compose.ui.hapticfeedback.HapticFeedbackType.LongPress)
            }
            AskGesture.Effect.Send -> { val pieces = voice.stop(); if (pieces.isEmpty()) voice.showHint("Too short. Hold and speak") else onSendS(pieces) }
            is AskGesture.Effect.Cancel -> { voice.cancel(); voice.showHint(e.hint) }
        }
    }
    LaunchedEffect(voice.hintSeq) { if (voice.hint != null) { delay(2200); voice.hint = null } }
    val s by animateFloatAsState(if (rec) 1.08f else if (pressed) 0.93f else 1f, androidx.compose.animation.core.spring(dampingRatio = 0.6f, stiffness = 500f), label = "ask-press")
    // the ring closes in while you press (armed at HOLD_MS); while recording it breathes with your voice
    val ring by animateFloatAsState(if (rec) 1f else if (pressed) 0.85f else 0f, tween(if (pressed && !rec) AskPress.HOLD_MS.toInt() else 160), label = "ask-ring")
    val shape = RoundedCornerShape(999.dp)
    val recCol = if (voice.cancelArmed) P.muted else P.danger
    val bg by androidx.compose.animation.animateColorAsState(if (rec) recCol else if (P.dark) P.accent else Color(0xFF1C1B18), tween(160), label = "ask-bg")
    val fg = if (rec) Color.White else if (P.dark) P.accentInk else Color(0xFFFBF8F1)
    val label = when { rec && voice.cancelArmed -> "Release to cancel"; rec -> "Release to send"; else -> voice.hint }
    // the label is placed above the button without taking layout space, so the button never moves under the finger
    androidx.compose.ui.layout.Layout(content = {
        Box(contentAlignment = Alignment.Center) {
            Box(Modifier.matchParentSize().graphicsLayer {
                val k = if (rec) 1.04f + voice.level * 0.30f else 1.12f - 0.12f * ring
                alpha = if (rec) 0.30f + voice.level * 0.4f else ring; scaleX = k; scaleY = k
            }.then(if (rec) Modifier.clip(shape).background(recCol) else Modifier.border(2.dp, if (P.dark) P.ink else P.accent, shape)).testTag("ask-ring"))
            Row(Modifier.padding(5.dp).graphicsLayer { scaleX = s; scaleY = s }.height(56.dp).shadow(if (P.dark) 2.dp else 14.dp, shape, ambientColor = Color(0x551C1B18), spotColor = Color(0x771C1B18))
                .clip(shape).background(bg)
                .semantics {
                    role = Role.Button
                    contentDescription = if (rec) "Recording. Release to send" else "Ask about your data. Press and hold to talk to Steady"
                    onClick("Open chat") { onTap(); true }
                    onLongClick("Talk to Steady") { onOpenTyping(); true }      // assistive long-press: the sheet, with its own mic button
                }
                .pointerInput(Unit) {
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false)
                        pressed = true; gesture.down(down.uptimeMillis)
                        var held = false
                        try {
                            while (true) {
                                val ev = if (!held) withTimeoutOrNull(AskGesture.HOLD_MS) { awaitPointerEvent() } else awaitPointerEvent()
                                if (ev == null) {                      // stayed down: the hold
                                    held = true; pressed = false
                                    handle(gesture.hold(down.uptimeMillis + AskGesture.HOLD_MS, canRecord(), permitted()))
                                    if (gesture.phase != AskGesture.Phase.Recording) { /* permission ask / typing sheet: wait for the finger to lift */ }
                                    continue
                                }
                                val ch = ev.changes.firstOrNull { it.id == down.id } ?: ev.changes.first()
                                if (!ch.pressed) { pressed = false; handle(gesture.up(ch.uptimeMillis, heard = voice.heard)); break }
                                if (gesture.phase == AskGesture.Phase.Recording) {
                                    val d = (ch.position - down.position).getDistance() / density.density
                                    gesture.move(d); voice.cancelArmed = gesture.cancelArmed
                                    ch.consume()
                                } else if (!held && (ch.position - down.position).getDistance() > viewConfiguration.touchSlop * 3) {
                                    // a scroll that started on the button: not a tap, not a hold
                                    pressed = false; gesture.up(ch.uptimeMillis, systemCancelled = true); return@awaitEachGesture
                                }
                            }
                        } catch (e: kotlinx.coroutines.CancellationException) {
                            pressed = false; handle(gesture.up(System.currentTimeMillis(), systemCancelled = true)); throw e
                        }
                    }
                }
                .padding(start = 16.dp, end = 20.dp).testTag("ask-fab"), verticalAlignment = Alignment.CenterVertically) {
                Icon(if (rec) androidx.compose.material.icons.Icons.Rounded.Mic else AskIcon, null, tint = fg, modifier = Modifier.size(24.dp))
                Spacer(Modifier.width(8.dp))
                if (rec) {
                    val secs = (voice.elapsedMs / 1000).toInt()
                    Text("%d:%02d".format(secs / 60, secs % 60), style = Type.bodyM.copy(fontSize = 16.sp, fontWeight = FontWeight.SemiBold, fontFeatureSettings = "tnum"), color = fg, modifier = Modifier.testTag("ask-timer"))
                } else Text("Ask", style = Type.bodyM.copy(fontSize = 16.sp, fontWeight = FontWeight.SemiBold), color = fg)
            }
        }
        Box { androidx.compose.animation.AnimatedVisibility(label != null, enter = androidx.compose.animation.fadeIn(tween(140)) + androidx.compose.animation.slideInVertically(tween(180)) { it / 2 },
            exit = androidx.compose.animation.fadeOut(tween(120))) {
            Text(label ?: "", style = Type.label.copy(fontSize = 13.sp), color = if (rec && !voice.cancelArmed) P.ground else P.ground,
                modifier = Modifier.clip(RoundedCornerShape(12.dp)).background(if (rec && voice.cancelArmed) P.danger else P.ink).padding(horizontal = 12.dp, vertical = 7.dp).testTag("ask-rec-label"))
        } }                                                   // always one slot, even when the label is hidden
    }, modifier) { ms, c ->
        val loose = c.copy(minWidth = 0, minHeight = 0)
        val fab = ms[0].measure(loose); val lab = ms[1].measure(loose.copy(maxWidth = androidx.compose.ui.unit.Constraints.Infinity))
        layout(fab.width, fab.height) {
            fab.place(0, 0)
            lab.place(fab.width - lab.width - 6.dp.roundToPx(), -lab.height - 10.dp.roundToPx())
        }
    }
}

/** First runs only: a quiet note above Ask so both gestures are discoverable. Never takes a tap. */
@Composable
fun AskHint(modifier: Modifier = Modifier) {
    Row(modifier.clip(RoundedCornerShape(14.dp)).background(P.ink).padding(horizontal = 12.dp, vertical = 8.dp).testTag("ask-hint"), verticalAlignment = Alignment.CenterVertically) {
        Text(androidx.compose.ui.text.buildAnnotatedString {
            pushStyle(androidx.compose.ui.text.SpanStyle(fontWeight = FontWeight.SemiBold)); append("Tap"); pop(); append(" to ask")
        }, style = Type.small, color = P.ground)
        Box(Modifier.padding(horizontal = 8.dp).size(3.dp).clip(CircleShape).background(P.ground.copy(alpha = .6f)))
        Text(androidx.compose.ui.text.buildAnnotatedString {
            pushStyle(androidx.compose.ui.text.SpanStyle(fontWeight = FontWeight.SemiBold)); append("Hold"); pop(); append(" to talk")
        }, style = Type.small, color = P.ground)
    }
}
