package dev.karthikyernana.steady

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.LineBreak
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.karthikyernana.steady.ui.Type
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/** Probe for the display title breaking mid-line on real phones (native graphics, CI only). Records line counts per variant. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(application = TestApp::class, sdk = [34], qualifiers = "w411dp-h891dp-xxhdpi")
class ScreenshotTestTitle {
    @get:Rule val rule = createComposeRule()

    @Test fun probe() {
        val out = StringBuilder()
        val base = Type.display
        val variants = listOf(
            "plain-display" to base,
            "no-letterspacing" to base.copy(letterSpacing = 0.sp),
            "linebreak-unspecified" to base.copy(lineBreak = LineBreak.Unspecified),
            "linebreak-paragraph" to base.copy(lineBreak = LineBreak.Paragraph),
            "both" to base.copy(letterSpacing = 0.sp, lineBreak = LineBreak.Unspecified),
            "no-fontfamily" to base.copy(fontFamily = null),
        )
        rule.setContent {
            Column(Modifier.width(375.dp).padding(0.dp)) {
                variants.forEach { (name, st) ->
                    Text(buildAnnotatedString { append("Your "); pushStyle(SpanStyle(color = Color.Green)); append("week"); pop(); append(".") }, style = st, modifier = Modifier.fillMaxWidth(),
                        onTextLayout = { r -> out.append("span/$name lines=${r.lineCount} w=${r.size.width} lineEnd0=${r.getLineEnd(0)}\n") })
                    Text("Your week.", style = st, modifier = Modifier.fillMaxWidth(),
                        onTextLayout = { r -> out.append("plain/$name lines=${r.lineCount} w=${r.size.width} lineEnd0=${r.getLineEnd(0)}\n") })
                }
            }
        }
        rule.waitForIdle()
        println("TITLEPROBE\n$out")
        System.getProperty("steady.shots")?.takeIf { it.isNotEmpty() }?.let { File(it).mkdirs(); File(it, "title-probe.txt").writeText(out.toString()) }
    }
}
