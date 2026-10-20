package dev.karthikyernana.steady.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.unit.sp
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

val CardShape = RoundedCornerShape(18.dp)

/** Spring dip for a component that owns its own click (Button etc.); pass the same interaction source. */
@Composable
fun Modifier.pressScale(src: MutableInteractionSource, scaleTo: Float = 0.96f): Modifier {
    val pressed by src.collectIsPressedAsState()
    val s by animateFloatAsState(if (pressed) scaleTo else 1f, spring(dampingRatio = 0.55f, stiffness = 700f), label = "press")
    return this.graphicsLayer { scaleX = s; scaleY = s }
}

/** Tap feedback like the web's spring press: the element dips to 97% and springs back, with the normal ripple. */
@Composable
fun Modifier.springClick(enabled: Boolean = true, role: Role? = null, scaleTo: Float = 0.97f, onClick: () -> Unit): Modifier {
    val src = remember { MutableInteractionSource() }
    val pressed by src.collectIsPressedAsState()
    val s by animateFloatAsState(if (pressed && enabled) scaleTo else 1f, spring(dampingRatio = 0.55f, stiffness = 700f), label = "press")
    return this.graphicsLayer { scaleX = s; scaleY = s }.clickable(src, LocalIndication.current, enabled = enabled, role = role, onClick = onClick)
}

/** Frosted card, as .card in css/app.css: translucent surface, a bright rim on top, a soft long shadow. */
@Composable
fun SCard(modifier: Modifier = Modifier, tint: Color? = null, onClick: (() -> Unit)? = null, pad: Dp = 16.dp, shape: androidx.compose.ui.graphics.Shape = CardShape, content: @Composable ColumnScope.() -> Unit) {
    val rim = if (P.dark) Color.White.copy(alpha = 0.08f) else Color.White.copy(alpha = 0.85f)
    val src = remember { MutableInteractionSource() }
    val pressed by src.collectIsPressedAsState()
    val sc by animateFloatAsState(if (pressed && onClick != null) 0.985f else 1f, spring(dampingRatio = 0.6f, stiffness = 650f), label = "card-press")
    val m = modifier.fillMaxWidth()
        .graphicsLayer { scaleX = sc; scaleY = sc }
        .shadow(if (P.dark) 0.dp else 8.dp, shape, ambientColor = Color(0x261C1B18), spotColor = Color(0x331C1B18))
        .clip(shape).background(tint ?: P.surface.copy(alpha = if (P.dark) 0.86f else 0.84f))
        .border(1.dp, androidx.compose.ui.graphics.Brush.verticalGradient(listOf(rim, P.line.copy(alpha = 0.7f))), shape)
        .let { if (onClick != null) it.clickable(src, LocalIndication.current, onClick = onClick) else it }
        .animateContentSize(spring(dampingRatio = 0.85f, stiffness = 400f)).padding(pad)
    Column(m, content = content)
}

/** The world behind the glass: three soft colour fields (sage top-left, warm right, pale green bottom). */
@Composable
fun Ambient(modifier: Modifier = Modifier) {
    val a = P.accent; val hi = P.hi; val al = P.accentLine; val dark = P.dark
    Canvas(modifier.fillMaxSize()) {
        val v = maxOf(size.width, size.height)
        fun blob(c: Color, cx: Float, cy: Float, r: Float, inner: Float, mid: Float) = drawCircle(
            androidx.compose.ui.graphics.Brush.radialGradient(listOf(c.copy(alpha = inner), c.copy(alpha = mid), Color.Transparent), center = Offset(cx, cy), radius = r), r, Offset(cx, cy))
        blob(a, -0.30f * v + 0.39f * v, -0.34f * v + 0.39f * v, 0.39f * v, if (dark) .13f else .20f, if (dark) .04f else .07f)
        blob(hi, size.width + 0.28f * v - 0.31f * v, size.height * 0.18f + 0.31f * v, 0.31f * v, if (dark) .08f else .11f, .03f)
        blob(al, -0.10f * v + 0.35f * v, size.height + 0.44f * v - 0.35f * v, 0.35f * v, if (dark) .45f else .55f, .15f)
    }
}

/** The page title used on every tab: eyebrow, a serif headline with one italic accent phrase, and an optional line. */
@Composable
fun PageHead(eyebrow: String, before: String, accent: String, after: String = ".", sub: String? = null, trailing: (@Composable () -> Unit)? = null, subTag: String? = null) {
    Row(verticalAlignment = Alignment.Top, modifier = Modifier.padding(top = 4.dp, bottom = 4.dp)) {
        Column(Modifier.weight(1f)) {
            Eyebrow(eyebrow)
            Spacer(Modifier.height(6.dp))
            Text(androidx.compose.ui.text.buildAnnotatedString {
                append(before)
                pushStyle(androidx.compose.ui.text.SpanStyle(color = P.accent)); append(accent); pop()
                append(after)
            }, style = Type.display, color = P.ink)
            if (sub != null) { Spacer(Modifier.height(6.dp)); Text(sub, style = Type.body.copy(fontSize = 16.sp), color = P.muted, modifier = if (subTag != null) Modifier.testTag(subTag) else Modifier) }
        }
        trailing?.invoke()
    }
}

/** Steady's mark, exactly icons/icon.svg: dark tile (rx 16/64), the wave, the green dot. */
@Composable
fun BrandMark(size: Dp = 30.dp) {
    Canvas(Modifier.size(size)) {
        val u = this.size.width / 64f
        drawRoundRect(Color(0xFF1C1B18), cornerRadius = CornerRadius(16 * u))
        val path = androidx.compose.ui.graphics.Path().apply {
            moveTo(16 * u, 40 * u); relativeCubicTo(6 * u, -9 * u, 11 * u, -9 * u, 16 * u, 0f); relativeCubicTo(5 * u, 9 * u, 10 * u, 9 * u, 16 * u, 0f)
        }
        drawPath(path, Color(0xFFFBF8F1), style = Stroke(4.5f * u, cap = StrokeCap.Round))
        drawCircle(Color(0xFF8EC3A2), 4.5f * u, Offset(32 * u, 22 * u))
    }
}

@Composable fun Eyebrow(text: String, color: Color = P.muted, modifier: Modifier = Modifier) = Text(text.uppercase(), style = Type.eyebrow, color = color, modifier = modifier)

@Composable
fun SectionHead(title: String, trailing: String? = null, action: String? = null, onAction: (() -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 4.dp, top = 10.dp, bottom = 2.dp), verticalAlignment = Alignment.Bottom) {
        Text(title, style = Type.h2, color = P.ink, modifier = Modifier.weight(1f))
        if (action != null && onAction != null) TextButton(onClick = onAction, contentPadding = PaddingValues(horizontal = 8.dp)) { Text(action, style = Type.label, color = P.accent) }
        else if (trailing != null) Text(trailing, style = Type.small, color = P.muted)
    }
}

@Composable
fun Pill(text: String, color: Color = P.ink2, bg: Color = P.surface2, modifier: Modifier = Modifier) {
    Text(text, style = Type.label, color = color, modifier = modifier.clip(RoundedCornerShape(999.dp)).background(bg).padding(horizontal = 10.dp, vertical = 4.dp))
}

@Composable
fun PrimaryButton(text: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
    val src = remember { MutableInteractionSource() }
    Button(onClick = onClick, enabled = enabled, interactionSource = src, modifier = modifier.pressScale(src).heightIn(min = 48.dp), shape = RoundedCornerShape(999.dp),
        colors = ButtonDefaults.buttonColors(containerColor = P.ink, contentColor = P.ground, disabledContainerColor = P.line2, disabledContentColor = P.muted)) {
        Text(text, style = Type.bodyM)
    }
}

@Composable
fun GhostButton(text: String, modifier: Modifier = Modifier, color: Color = P.ink, onClick: () -> Unit) {
    val src = remember { MutableInteractionSource() }
    OutlinedButton(onClick = onClick, interactionSource = src, modifier = modifier.pressScale(src).heightIn(min = 48.dp), shape = RoundedCornerShape(999.dp), border = BorderStroke(1.dp, P.line2),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = color)) { Text(text, style = Type.bodyM) }
}

@Composable
fun SField(value: String, onChange: (String) -> Unit, label: String, modifier: Modifier = Modifier, singleLine: Boolean = true, password: Boolean = false,
           keyboard: KeyboardType = KeyboardType.Text, ime: ImeAction = ImeAction.Done, onIme: () -> Unit = {}, minLines: Int = 1, testTag: String? = null,
           caps: KeyboardCapitalization = KeyboardCapitalization.Sentences) {
    OutlinedTextField(value = value, onValueChange = onChange, label = { Text(label) }, singleLine = singleLine, minLines = minLines,
        modifier = modifier.fillMaxWidth().let { if (testTag != null) it.testTagCompat(testTag) else it },
        visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = keyboard, imeAction = ime, capitalization = if (password || keyboard == KeyboardType.Email) KeyboardCapitalization.None else caps),
        keyboardActions = KeyboardActions(onAny = { onIme() }), shape = RoundedCornerShape(14.dp),
        colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = P.accent, unfocusedBorderColor = P.line2, focusedLabelColor = P.accent, cursorColor = P.accent,
            focusedContainerColor = P.surface, unfocusedContainerColor = P.surface))
}

fun Modifier.testTagCompat(tag: String) = this.testTag(tag)

/** Round check button: open ○, done ● with a tick. */
@Composable
fun CheckDot(done: Boolean, color: Color = P.accent, onClick: () -> Unit) {
    val fill by animateFloatAsState(if (done) 1f else 0f, spring(dampingRatio = 0.5f, stiffness = 520f), label = "check")
    val haptic = androidx.compose.ui.platform.LocalHapticFeedback.current
    Box(Modifier.size(44.dp).clip(CircleShape).springClick(role = Role.Checkbox, scaleTo = 0.86f) { if (!done) haptic.performHapticFeedback(androidx.compose.ui.hapticfeedback.HapticFeedbackType.LongPress); onClick() }.semantics { contentDescription = if (done) "Mark not done" else "Mark done" }, contentAlignment = Alignment.Center) {
        val ring = P.line2
        Canvas(Modifier.size(24.dp)) {
            drawCircle(ring, style = Stroke(1.6.dp.toPx()))
            if (fill > 0f) {
                drawCircle(color, radius = size.minDimension / 2 * fill.coerceAtMost(1.12f))
                if (fill > 0.6f) {
                    val w = size.width
                    val p1 = Offset(w * 0.28f, w * 0.52f); val p2 = Offset(w * 0.44f, w * 0.68f); val p3 = Offset(w * 0.73f, w * 0.36f)
                    drawLine(Color.White, p1, p2, 2.dp.toPx(), StrokeCap.Round); drawLine(Color.White, p2, p3, 2.dp.toPx(), StrokeCap.Round)
                }
            }
        }
    }
}

@Composable
fun Ring(progress: Float, label: String, size: Dp = 56.dp) {
    val anim by animateFloatAsState(progress.coerceIn(0f, 1f), spring(stiffness = 120f), label = "ring")
    val track = P.line; val acc = P.accent
    Box(Modifier.size(size), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val sw = 3.5.dp.toPx(); val inset = sw / 2
            drawArc(track, 0f, 360f, false, Offset(inset, inset), Size(this.size.width - sw, this.size.height - sw), style = Stroke(sw))
            drawArc(acc, -90f, 360f * anim, false, Offset(inset, inset), Size(this.size.width - sw, this.size.height - sw), style = Stroke(sw, cap = StrokeCap.Round))
        }
        Text(label, style = Type.h3, color = P.ink)
    }
}

/** Simple bar chart with day labels under each bar. */
@Composable
fun Bars(values: List<Float>, labels: List<String>, modifier: Modifier = Modifier, height: Dp = 110.dp, highlightLast: Boolean = true, color: Color = P.accent, highlight: Int = -1, highlight2: Int = -1) {
    val max = (values.maxOrNull() ?: 0f).coerceAtLeast(1f)
    val empty = P.line; val muted = P.muted; val ink = P.ink
    val grow = remember { androidx.compose.animation.core.Animatable(0f) }
    LaunchedEffect(Unit) { grow.animateTo(1f, spring(dampingRatio = 0.8f, stiffness = 140f)) }
    Column(modifier) {
        Canvas(Modifier.fillMaxWidth().height(height)) {
            val n = values.size.coerceAtLeast(1); val gap = (if (n > 12) 2 else 6).dp.toPx(); val bw = (size.width - gap * (n - 1)) / n
            values.forEachIndexed { i, v ->
                val h = if (v <= 0f) 2.dp.toPx() else ((v / max) * (size.height - 4.dp.toPx()) * grow.value).coerceAtLeast(2.dp.toPx())
                val dim = (highlight >= 0 && i != highlight && i != highlight2)
                drawRoundRect(if (v <= 0f) empty else if (dim) color.copy(alpha = 0.45f) else color, Offset(i * (bw + gap), size.height - h), Size(bw, h), CornerRadius(minOf(4.dp.toPx(), bw / 3)))
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = 4.dp)) {
            // many bars: sparse labels that may overflow their narrow column (never wrap)
            if (labels.size > 12) labels.forEachIndexed { i, l -> Box(Modifier.weight(1f)) { if (l.isNotEmpty()) Text(l, style = Type.label.copy(fontSize = 10.sp), color = if (i == highlight) ink else muted, maxLines = 1, softWrap = false, modifier = Modifier.wrapContentWidth(Alignment.Start, unbounded = true)) } }
            else labels.forEachIndexed { i, l -> Text(l, style = Type.label, color = if ((highlightLast && i == labels.lastIndex) || i == highlight) ink else muted, textAlign = TextAlign.Center, modifier = Modifier.weight(1f)) }
        }
    }
}

@Composable
fun EmptyNote(title: String, body: String) {
    Column(Modifier.fillMaxWidth().padding(vertical = 28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(title, style = Type.h3, color = P.ink, textAlign = TextAlign.Center)
        Spacer(Modifier.height(4.dp))
        Text(body, style = Type.small, color = P.muted, textAlign = TextAlign.Center)
    }
}

@Composable
fun Segmented(options: List<Pair<String, String>>, value: String, onChange: (String) -> Unit, modifier: Modifier = Modifier) {
    val idx = options.indexOfFirst { it.first == value }.coerceAtLeast(0)
    BoxWithConstraints(modifier.clip(RoundedCornerShape(999.dp)).background(P.surface2).padding(3.dp)) {
        val w = maxWidth / options.size
        val x by androidx.compose.animation.core.animateDpAsState(w * idx, spring(dampingRatio = 0.72f, stiffness = 520f), label = "seg")
        Box(Modifier.offset(x = x).width(w).height(38.dp).shadow(if (P.dark) 0.dp else 2.dp, RoundedCornerShape(999.dp)).clip(RoundedCornerShape(999.dp)).background(P.surface))
        Row(Modifier.fillMaxWidth().height(38.dp)) {
            options.forEach { (k, l) ->
                val on = k == value
                Box(Modifier.weight(1f).fillMaxHeight().clip(RoundedCornerShape(999.dp)).clickable { onChange(k) }, contentAlignment = Alignment.Center) {
                    Text(l, style = Type.label.copy(fontSize = 13.sp), color = if (on) P.ink else P.muted)
                }
            }
        }
    }
}

val TextStyle.muted @Composable get() = this.copy(color = P.muted)
