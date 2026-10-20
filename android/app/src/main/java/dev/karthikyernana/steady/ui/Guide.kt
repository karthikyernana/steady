package dev.karthikyernana.steady.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

/** One page of the tour: what the place is for, and exactly what to type or say there. */
private data class GuidePage(val icon: ImageVector, val title: String, val line: String, val type: String, val becomes: List<String>)

private val PAGES = listOf(
    GuidePage(Icons.Rounded.Mic, "Just say it", "Tap the mic and talk, in English or Telugu. Steady turns it into tasks, goals or money entries for you to accept.", "\"Remind me to call amma in 10 minutes\"", listOf("Task", "Today, in 10 min", "Reminder on")),
    GuidePage(Icons.Outlined.Schedule, "Today", "Type tasks the way you'd text a friend. Time, length and day are picked up for you.", "gym 7pm 45m", listOf("Gym", "7:00 PM", "45 min")),
    GuidePage(Icons.Outlined.Flag, "Goals", "A big goal becomes one small milestone a week, so you always know the next step.", "Crack placements by March", listOf("Week 1: resume", "Week 2: mocks", "…")),
    GuidePage(Icons.Outlined.AccountBalanceWallet, "Money", "Log spending in a few words. Steady sorts the category and shows where it went.", "250 lunch swiggy", listOf("₹250", "Food", "Swiggy")),
    GuidePage(Icons.Outlined.ChatBubbleOutline, "Thoughts", "Catch ideas and notes. Add #tags to group them; long notes pasted from AI read cleanly.", "pricing idea for Steady #startup", listOf("Idea", "#startup")),
    GuidePage(Icons.Outlined.BarChart, "Insights", "Your week in one look: tasks done, streak, goal progress, spending and what's on your mind.", "", emptyList()),
)

@Composable
fun Guide(onDone: () -> Unit) {
    val pager = rememberPagerState { PAGES.size }
    val scope = rememberCoroutineScope()
    Box(Modifier.fillMaxSize().background(P.ground).testTag("guide")) {
        Ambient()
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("How Steady works", style = Type.label.copy(fontSize = 13.sp), color = P.muted, modifier = Modifier.weight(1f))
                Text("Skip", style = Type.bodyM, color = P.ink2, modifier = Modifier.clip(RoundedCornerShape(10.dp)).clickable(onClick = onDone).padding(10.dp).testTag("guide-skip"))
            }
            HorizontalPager(pager, Modifier.weight(1f).fillMaxWidth()) { i ->
                val p = PAGES[i]
                Column(Modifier.fillMaxSize().widthIn(max = 520.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(Modifier.size(88.dp).clip(CircleShape).background(P.accentSoft), contentAlignment = Alignment.Center) { Icon(p.icon, null, tint = P.accent, modifier = Modifier.size(40.dp)) }
                    Spacer(Modifier.height(26.dp))
                    Text(p.title, style = Type.display.copy(fontSize = 32.sp), color = P.ink, textAlign = TextAlign.Center)
                    Spacer(Modifier.height(10.dp))
                    Text(p.line, style = Type.body.copy(fontSize = 17.sp, lineHeight = 25.sp), color = P.ink2, textAlign = TextAlign.Center)
                    if (p.type.isNotEmpty()) {
                        Spacer(Modifier.height(26.dp))
                        // a tiny "you type → it becomes" demo
                        SCard(pad = 14.dp) {
                            Eyebrow("You type or say")
                            Spacer(Modifier.height(4.dp))
                            Text(p.type, style = Type.bodyM.copy(fontSize = 16.sp), color = P.ink)
                            Spacer(Modifier.height(10.dp))
                            Eyebrow("It becomes")
                            Spacer(Modifier.height(6.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { p.becomes.forEach { Pill(it, color = P.accent, bg = P.accentSoft) } }
                        }
                    }
                }
            }
            Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), horizontalArrangement = Arrangement.Center) {
                repeat(PAGES.size) { i ->
                    val on = pager.currentPage == i
                    val w by androidx.compose.animation.core.animateDpAsState(if (on) 22.dp else 7.dp, label = "dot")
                    Box(Modifier.padding(horizontal = 3.dp).height(7.dp).width(w).clip(CircleShape).background(if (on) P.ink else P.line2))
                }
            }
            val last = pager.currentPage == PAGES.lastIndex
            PrimaryButton(if (last) "Start using Steady" else "Next", Modifier.fillMaxWidth().testTag("guide-next")) {
                if (last) onDone() else scope.launch { pager.animateScrollToPage(pager.currentPage + 1) }
            }
        }
    }
}
