package dev.karthikyernana.steady.ui

import android.provider.Settings
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.AnimationSpec
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp

/**
 * Motion rules shared by Chat and its cards. Everything animates through graphicsLayer (draw phase only, no relayout),
 * delays are part of the animation spec (frame-clock driven, so tests and the system's animator scale apply), and when
 * the system animator scale is 0 ("Remove animations") every entrance and chart lands at its end state at once.
 */
val LocalReducedMotion = compositionLocalOf<Boolean?> { null }

@Composable
fun reducedMotion(): Boolean {
    LocalReducedMotion.current?.let { return it }
    val ctx = LocalContext.current
    return remember(ctx) { runCatching { Settings.Global.getFloat(ctx.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }.getOrDefault(false) }
}

/** 0→1 once, after [delayMs]; already 1 when [animate] is false or motion is reduced. */
@Composable
fun rememberEntrance(animate: Boolean, delayMs: Int = 0, durationMs: Int = 420, key: Any? = Unit): State<Float> {
    val reduced = reducedMotion()
    val a = remember(key) { Animatable(if (animate && !reduced) 0f else 1f) }
    LaunchedEffect(a) { if (a.value < 1f) a.animateTo(1f, tween(durationMs, delayMs, FastOutSlowInEasing)) }
    return a.asState()
}

/** Same, with any spec (springs for charts). */
@Composable
fun rememberGrow(animate: Boolean, spec: AnimationSpec<Float>, key: Any? = Unit): State<Float> {
    val reduced = reducedMotion()
    val a = remember(key) { Animatable(if (animate && !reduced) 0f else 1f) }
    LaunchedEffect(a) { if (a.value < 1f) a.animateTo(1f, spec) }
    return a.asState()
}

/** Fade in and rise 14dp, read in the draw phase only. */
@Composable
fun Modifier.enterUp(animate: Boolean, delayMs: Int = 0, rise: Int = 14, key: Any? = Unit): Modifier {
    val p = rememberEntrance(animate, delayMs, key = key)
    val px = with(LocalDensity.current) { rise.dp.toPx() }
    return this.graphicsLayer { val v = p.value; alpha = v; translationY = (1f - v) * px }
}
