package dev.karthikyernana.steady.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
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
 * "Ask": the one floating button (the mic it replaced). TAP opens Chat. PRESS AND HOLD is the voice agent: the capture
 * sheet opens and records while the finger is down (a pause never ends it); letting go finishes the turn
 * (transcribe → drafts → Accept). A hold let go of right after it opens keeps listening hands-free. Same rule as the web
 * (js/ui/press.js), kept pure so it is unit-tested.
 */
object AskPress {
    const val HOLD_MS = 380L
    const val RELEASE_MS = 450L
    /** "tap" (open Chat) · "none" (gesture taken by the system) · "stop" (finish the voice turn) · "keep" (keep listening) */
    fun outcome(pressedMs: Long, cancelled: Boolean = false): String = when {
        pressedMs < HOLD_MS -> if (cancelled) "none" else "tap"
        pressedMs - HOLD_MS > RELEASE_MS -> "stop"
        else -> "keep"
    }
}

/** Shared between the Ask button and the voice sheet while a hold is in progress. */
class HoldState {
    var down by mutableStateOf(false)
    var openedAt by mutableLongStateOf(0L)
    /** set when the finger lifts: true = finish the recording now (hold-to-talk), false = keep listening */
    var finish by mutableStateOf<Boolean?>(null)
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
fun AskFab(onTap: () -> Unit, onHold: () -> Unit, onRelease: (pressedMs: Long, cancelled: Boolean) -> Unit, modifier: Modifier = Modifier) {
    val scope = rememberCoroutineScope()
    var pressed by remember { mutableStateOf(false) }
    var holding by remember { mutableStateOf(false) }
    val s by animateFloatAsState(if (pressed) 0.93f else 1f, label = "ask-press")
    // the ring closes in while you press (it is "armed" at HOLD_MS), then stays while it listens
    val ring by animateFloatAsState(if (holding) 1f else if (pressed) 0.85f else 0f, tween(if (pressed && !holding) AskPress.HOLD_MS.toInt() else 160), label = "ask-ring")
    val shape = RoundedCornerShape(999.dp)
    val bg = if (P.dark) P.accent else Color(0xFF1C1B18)
    val fg = if (P.dark) P.accentInk else Color(0xFFFBF8F1)
    Box(modifier, contentAlignment = Alignment.Center) {
        Box(Modifier.matchParentSize().padding(0.dp).graphicsLayer { alpha = ring; scaleX = 1.12f - 0.12f * ring; scaleY = 1.12f - 0.12f * ring }
            .border(2.dp, if (P.dark) P.ink else P.accent, shape))
        Row(Modifier.padding(5.dp).scale(s).height(56.dp).shadow(if (P.dark) 2.dp else 14.dp, shape, ambientColor = Color(0x551C1B18), spotColor = Color(0x771C1B18))
            .clip(shape).background(bg)
            .semantics {
                role = Role.Button
                contentDescription = "Ask about your data. Press and hold to talk to Steady"
                onClick("Open chat") { onTap(); true }
                onLongClick("Talk to Steady") { onHold(); onRelease(AskPress.HOLD_MS, false); true }      // assistive long-press: hands-free
            }
            .pointerInput(Unit) {
                detectTapGestures(onPress = {
                    pressed = true; holding = false
                    val t0 = System.currentTimeMillis()
                    val job: Job = scope.launch { delay(AskPress.HOLD_MS); holding = true; onHold() }
                    val released = tryAwaitRelease()
                    job.cancel()
                    val ms = System.currentTimeMillis() - t0
                    pressed = false
                    if (holding) { holding = false; onRelease(maxOf(ms, AskPress.HOLD_MS), !released) }
                    else if (AskPress.outcome(minOf(ms, AskPress.HOLD_MS - 1), !released) == "tap") onTap()
                })
            }
            .padding(start = 16.dp, end = 20.dp).testTag("ask-fab"), verticalAlignment = Alignment.CenterVertically) {
            Icon(AskIcon, null, tint = fg, modifier = Modifier.size(24.dp))
            Spacer(Modifier.width(8.dp))
            Text("Ask", style = Type.bodyM.copy(fontSize = 16.sp, fontWeight = FontWeight.SemiBold), color = fg)
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
