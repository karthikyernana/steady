package dev.karthikyernana.steady.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import dev.karthikyernana.steady.R

/** Steady's palette, the same tokens as css/app.css (light) and [data-theme="dark"]. */
@Immutable
data class Palette(
    val ground: Color, val surface: Color, val surface2: Color, val line: Color, val line2: Color,
    val ink: Color, val ink2: Color, val muted: Color,
    val accent: Color, val accentInk: Color, val accentSoft: Color, val accentLine: Color,
    val warn: Color, val danger: Color, val hi: Color, val heat: List<Color>, val dark: Boolean,
)

val LightPalette = Palette(
    ground = Color(0xFFFBF8F1), surface = Color(0xFFFFFDF8), surface2 = Color(0xFFF4EFE4), line = Color(0xFFE7E0D2), line2 = Color(0xFFD9D0BF),
    ink = Color(0xFF1C1B18), ink2 = Color(0xFF4A4740), muted = Color(0xFF67635A),
    accent = Color(0xFF3D6B52), accentInk = Color.White, accentSoft = Color(0xFFE6EEE6), accentLine = Color(0xFFC9DACB),
    warn = Color(0xFF9A4A26), danger = Color(0xFFA63A2B), hi = Color(0xFFB4552C),
    heat = listOf(Color(0xFFEDE7DA), Color(0xFFCFE0D0), Color(0xFF9EC1A6), Color(0xFF63946F), Color(0xFF3D6B52)), dark = false,
)
val DarkPalette = Palette(
    ground = Color(0xFF16150F), surface = Color(0xFF1F1E18), surface2 = Color(0xFF27261F), line = Color(0xFF33312A), line2 = Color(0xFF45423A),
    ink = Color(0xFFF2EEE4), ink2 = Color(0xFFD6D1C5), muted = Color(0xFFA8A295),
    accent = Color(0xFF8EC3A2), accentInk = Color(0xFF0F1A13), accentSoft = Color(0xFF1E2B23), accentLine = Color(0xFF34503F),
    warn = Color(0xFFE0A07E), danger = Color(0xFFEE8F80), hi = Color(0xFFE39A73),
    heat = listOf(Color(0xFF2A2922), Color(0xFF2C4535), Color(0xFF3F6B50), Color(0xFF5F9875), Color(0xFF8EC3A2)), dark = true,
)

/** One family everywhere: Host Grotesk, a plain, quiet grotesk (no poster-style display serif). */
val Sans = FontFamily(
    Font(R.font.host_grotesk_400, FontWeight.Normal), Font(R.font.host_grotesk_500, FontWeight.Medium),
    Font(R.font.host_grotesk_600, FontWeight.SemiBold), Font(R.font.host_grotesk_700, FontWeight.Bold),
)
/** Kept as a name so headline call sites read clearly; it is the same family, set heavier and tighter. */
val Serif = Sans

val LocalPalette = staticCompositionLocalOf { LightPalette }
val P: Palette @Composable get() = LocalPalette.current

object Type {
    val display = TextStyle(fontFamily = Sans, fontWeight = FontWeight.SemiBold, fontSize = 31.sp, lineHeight = 36.sp, letterSpacing = (-0.8).sp, lineBreak = androidx.compose.ui.text.style.LineBreak.Simple)
    val h2 = TextStyle(fontFamily = Sans, fontWeight = FontWeight.SemiBold, fontSize = 21.sp, lineHeight = 26.sp, letterSpacing = (-0.4).sp)
    val h3 = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Medium, fontSize = 18.sp, lineHeight = 24.sp, letterSpacing = (-0.2).sp)
    val body = TextStyle(fontFamily = Sans, fontSize = 15.sp, lineHeight = 21.sp)
    val bodyM = TextStyle(fontFamily = Sans, fontSize = 15.sp, lineHeight = 21.sp, fontWeight = FontWeight.Medium)
    val small = TextStyle(fontFamily = Sans, fontSize = 13.sp, lineHeight = 18.sp)
    val eyebrow = TextStyle(fontFamily = Sans, fontSize = 11.sp, lineHeight = 14.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 1.1.sp)
    val label = TextStyle(fontFamily = Sans, fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium)
}

@Composable
fun SteadyTheme(mode: String = "system", content: @Composable () -> Unit) {
    val dark = when (mode) { "dark" -> true; "light" -> false; else -> isSystemInDarkTheme() }
    val p = if (dark) DarkPalette else LightPalette
    val scheme = if (dark) darkColorScheme(primary = p.accent, onPrimary = p.accentInk, background = p.ground, onBackground = p.ink, surface = p.surface, onSurface = p.ink,
        surfaceVariant = p.surface2, onSurfaceVariant = p.muted, outline = p.line2, outlineVariant = p.line, error = p.danger, secondaryContainer = p.accentSoft, onSecondaryContainer = p.ink,
        surfaceContainer = p.surface, surfaceContainerHigh = p.surface, surfaceContainerLow = p.surface, surfaceContainerHighest = p.surface2)
    else lightColorScheme(primary = p.accent, onPrimary = p.accentInk, background = p.ground, onBackground = p.ink, surface = p.surface, onSurface = p.ink,
        surfaceVariant = p.surface2, onSurfaceVariant = p.muted, outline = p.line2, outlineVariant = p.line, error = p.danger, secondaryContainer = p.accentSoft, onSecondaryContainer = p.ink,
        surfaceContainer = p.surface, surfaceContainerHigh = p.surface, surfaceContainerLow = p.surface, surfaceContainerHighest = p.surface2)
    val typo = Typography(bodyLarge = Type.body, bodyMedium = Type.body, bodySmall = Type.small, labelLarge = Type.bodyM, labelMedium = Type.label, labelSmall = Type.label,
        titleLarge = Type.h2, titleMedium = Type.bodyM, titleSmall = Type.label, headlineSmall = Type.h2, headlineMedium = Type.display)
    CompositionLocalProvider(LocalPalette provides p) { MaterialTheme(colorScheme = scheme, typography = typo, content = content) }
}
