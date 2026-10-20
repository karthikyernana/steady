package dev.karthikyernana.steady.ui

import android.Manifest
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.karthikyernana.steady.MainActivity
import dev.karthikyernana.steady.SteadyApp
import dev.karthikyernana.steady.data.Snapshot
import dev.karthikyernana.steady.data.str
import dev.karthikyernana.steady.ui.screens.*
import kotlinx.coroutines.launch

enum class Tab(val label: String, val icon: ImageVector) {
    Today("Today", Icons.Outlined.Schedule), Goals("Goals", Icons.Outlined.Flag), Money("Money", Icons.Outlined.AccountBalanceWallet),
    Thoughts("Thoughts", Icons.Outlined.ChatBubbleOutline), Insights("Insights", Icons.Outlined.BarChart)
}

/** Everything a screen needs: the app (store, sync, agent), the current data, and a toast with optional undo. */
class Ctx(val app: SteadyApp, val snap: Snapshot, val toast: (String, (() -> Unit)?) -> Unit, val theme: String = "system", val setTheme: (String) -> Unit = {})
val LocalCtx = staticCompositionLocalOf<Ctx> { error("no ctx") }

@Composable
fun AppRoot(activity: MainActivity) {
    val app = SteadyApp.get(LocalContext.current)
    val snap by app.store.snapshot.collectAsStateWithLifecycle()
    var theme by remember { mutableStateOf(app.store.local("theme") ?: "system") }
    SteadyTheme(theme) {
        val snackbar = remember { SnackbarHostState() }
        val scope = rememberCoroutineScope()
        val toast: (String, (() -> Unit)?) -> Unit = { msg, undo ->
            scope.launch {
                snackbar.currentSnackbarData?.dismiss()
                val r = snackbar.showSnackbar(msg, actionLabel = if (undo != null) "Undo" else null, duration = SnackbarDuration.Short)
                if (r == SnackbarResult.ActionPerformed) undo?.invoke()
            }
        }
        val onboarded = app.sync.signedIn || snap.profile.str("name") != null || app.store.local("onboarded") == "1"
        var started by remember { mutableStateOf(onboarded) }
        CompositionLocalProvider(LocalCtx provides Ctx(app, snap, toast, theme) { t -> theme = t; app.store.setLocal("theme", t) }) {
            Surface(color = P.ground, modifier = Modifier.fillMaxSize()) {
                if (!started) Welcome(onDone = { started = true })
                else Main(activity, snackbar)
            }
        }
    }
}

@Composable
private fun Main(activity: MainActivity, snackbar: SnackbarHostState) {
    val c = LocalCtx.current
    var tab by rememberSaveable { mutableStateOf(Tab.Today) }
    var you by rememberSaveable { mutableStateOf(false) }
    var voice by remember { mutableStateOf(false) }
    var checkin by remember { mutableStateOf(false) }
    var guide by remember { mutableStateOf(c.app.store.local("guideSeen") == null) }

    // notification taps
    LaunchedEffect(activity.openRequest) {
        when (activity.openRequest) { "checkin" -> { you = false; tab = Tab.Today }; "today" -> { you = false; tab = Tab.Today } }
        activity.openRequest = null
    }
    // Android 13+: ask for notifications once, the first time the main screen shows
    val notifLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= 33 && c.app.store.local("notifAsked") == null) { c.app.store.setLocal("notifAsked", "1"); notifLauncher.launch(Manifest.permission.POST_NOTIFICATIONS) }
    }
    BackHandler(enabled = you || tab != Tab.Today) { if (you) you = false else tab = Tab.Today }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        // a phone on its side: the bottom bar would eat half the height, so the tabs move to a rail on the left
        val rail = maxWidth > maxHeight && maxHeight < 520.dp
        Ambient()
        // landscape: keep clear of the camera cutout and the side navigation bar
        Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.displayCutout.union(WindowInsets.navigationBars).only(WindowInsetsSides.Horizontal)).padding(start = if (rail) 84.dp else 0.dp)) {
            TopBar(onYou = { you = !you }, youOpen = you)
            Box(Modifier.weight(1f).fillMaxWidth()) {
                AnimatedContent(targetState = if (you) "you" else tab.name, transitionSpec = {
                    // like the web's view transitions: a short directional glide + fade, springy, never a hard cut
                    val order = listOf(Tab.Today.name, Tab.Goals.name, Tab.Money.name, Tab.Thoughts.name, Tab.Insights.name)
                    val from = order.indexOf(initialState); val to = order.indexOf(targetState)
                    val glide = androidx.compose.animation.core.spring<androidx.compose.ui.unit.IntOffset>(dampingRatio = 0.86f, stiffness = 380f)
                    val fadeSpec = androidx.compose.animation.core.tween<Float>(220)
                    if (from < 0 || to < 0) {
                        (fadeIn(fadeSpec) + androidx.compose.animation.slideInVertically(glide) { it / 14 }) togetherWith (fadeOut(androidx.compose.animation.core.tween(160)) + androidx.compose.animation.slideOutVertically(glide) { it / 20 })
                    } else {
                        val dir = if (to > from) 1 else -1
                        (fadeIn(fadeSpec) + androidx.compose.animation.slideInHorizontally(glide) { w -> dir * w / 9 }) togetherWith
                            (fadeOut(androidx.compose.animation.core.tween(150)) + androidx.compose.animation.slideOutHorizontally(glide) { w -> -dir * w / 14 })
                    }.using(androidx.compose.animation.SizeTransform(clip = false))
                }, label = "route", modifier = Modifier.fillMaxSize()) { r ->
                  Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) { Box(Modifier.widthIn(max = 640.dp).fillMaxSize()) {
                    when (r) {
                        "you" -> YouScreen(onClose = { you = false }, onGuide = { guide = true })
                        Tab.Today.name -> TodayScreen(onCheckin = { checkin = true })
                        Tab.Goals.name -> GoalsScreen()
                        Tab.Money.name -> MoneyScreen()
                        Tab.Thoughts.name -> ThoughtsScreen()
                        else -> InsightsScreen()
                    }
                  } }
                }
            }
        }
        // soft fade where content runs under the floating bar, so text never shows through the icons
        if (!rail) Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(150.dp).background(androidx.compose.ui.graphics.Brush.verticalGradient(
            0f to P.ground.copy(alpha = 0f), 0.45f to P.ground.copy(alpha = 0.82f), 1f to P.ground)))
        // floating glass tab bar + the mic, like the web app (the mic is never inside the bar)
        val imeOpen = WindowInsets.ime.getBottom(androidx.compose.ui.platform.LocalDensity.current) > 0
        if (rail) {
            SideRail(if (you) null else tab, Modifier.align(Alignment.CenterStart).windowInsetsPadding(WindowInsets.displayCutout.union(WindowInsets.navigationBars).only(WindowInsetsSides.Start)).padding(start = 10.dp)) { you = false; tab = it }
            if (!imeOpen) Box(Modifier.align(Alignment.BottomEnd).navigationBarsPadding().padding(16.dp)) { MicFab { voice = true } }
        } else if (!imeOpen) {
            Column(Modifier.align(Alignment.BottomCenter).widthIn(max = 600.dp).fillMaxWidth().navigationBarsPadding().padding(horizontal = 10.dp, vertical = 8.dp), horizontalAlignment = Alignment.End) {
                MicFab { voice = true }
                Spacer(Modifier.height(12.dp))
                BottomBar(if (you) null else tab) { you = false; tab = it }
            }
        }
        androidx.compose.animation.AnimatedVisibility(guide, enter = androidx.compose.animation.fadeIn(), exit = androidx.compose.animation.fadeOut()) {
            BackHandler { c.app.store.setLocal("guideSeen", "1"); guide = false }
            Guide { c.app.store.setLocal("guideSeen", "1"); guide = false }
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomStart).navigationBarsPadding().padding(start = if (rail) 96.dp else 8.dp, end = 82.dp, bottom = if (rail) 16.dp else 88.dp)) {
            Snackbar(it, containerColor = P.ink, contentColor = P.ground, actionColor = P.accentLine, shape = RoundedCornerShape(999.dp))
        }
    }
    if (voice) VoiceSheet(onClose = { voice = false })
    if (checkin) CheckinSheet(onClose = { checkin = false })
}

@Composable
private fun TopBar(onYou: () -> Unit, youOpen: Boolean) {
    val c = LocalCtx.current
    val st by c.app.sync.status.collectAsStateWithLifecycle()
    Row(Modifier.fillMaxWidth().statusBarsPadding().padding(start = 18.dp, end = 14.dp, top = 6.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        BrandMark(28.dp)
        Spacer(Modifier.width(10.dp))
        Text("Steady", style = Type.h3.copy(fontSize = 23.sp), color = P.ink, modifier = Modifier.weight(1f))
        // a quiet dot only when sync needs attention (the web shows status in Settings, not the header)
        if (c.app.sync.signedIn && st.state in setOf(dev.karthikyernana.steady.sync.Sync.State.ERROR, dev.karthikyernana.steady.sync.Sync.State.SIGNED_OUT, dev.karthikyernana.steady.sync.Sync.State.OFFLINE)) {
            Box(Modifier.size(8.dp).clip(CircleShape).background(if (st.state == dev.karthikyernana.steady.sync.Sync.State.OFFLINE) P.warn else P.danger).testTag("sync-status"))
            Spacer(Modifier.width(10.dp))
        }
        val name = c.snap.profile.str("name") ?: "K"
        Box(Modifier.size(40.dp).shadow(if (P.dark) 0.dp else 6.dp, CircleShape).clip(CircleShape).background(if (youOpen) P.ink else P.surface).border(1.dp, P.line, CircleShape).clickable(onClick = onYou)
            .semantics { contentDescription = "You and settings" }.testTag("you-btn"), contentAlignment = Alignment.Center) {
            Text(name.take(1).uppercase(), style = Type.h3.copy(fontSize = 20.sp), color = if (youOpen) P.ground else P.ink)
        }
    }
}

@Composable
private fun BottomBar(tab: Tab?, onTab: (Tab) -> Unit) {
    val shape = RoundedCornerShape(28.dp)
    BoxWithConstraints(Modifier.fillMaxWidth().shadow(if (P.dark) 4.dp else 16.dp, shape, ambientColor = Color(0x331C1B18), spotColor = Color(0x551C1B18))
        .clip(shape).background(if (P.dark) P.surface.copy(alpha = 0.98f) else P.surface)
        .border(1.dp, androidx.compose.ui.graphics.Brush.linearGradient(listOf(Color.White.copy(alpha = if (P.dark) .1f else .9f), P.line.copy(alpha = .6f), Color.White.copy(alpha = if (P.dark) .1f else .9f))), shape)
        .padding(6.dp)) {
        val n = Tab.entries.size; val w = maxWidth / n
        val idx = Tab.entries.indexOf(tab).coerceAtLeast(0)
        // the highlight slides between tabs on a spring, like the web's moving indicator
        val x by androidx.compose.animation.core.animateDpAsState(w * idx, androidx.compose.animation.core.spring(dampingRatio = 0.74f, stiffness = 480f), label = "tab-x")
        val a by androidx.compose.animation.core.animateFloatAsState(if (tab == null) 0f else 1f, label = "tab-a")
        Box(Modifier.offset(x = x).width(w).height(56.dp).graphicsLayer { alpha = a }.clip(RoundedCornerShape(22.dp)).background(P.ink.copy(alpha = if (P.dark) .12f else .065f)))
        Row(Modifier.fillMaxWidth()) {
            Tab.entries.forEach { t ->
                val on = t == tab
                val tint by androidx.compose.animation.animateColorAsState(if (on) P.ink else P.muted, label = "tab-c")
                Column(Modifier.weight(1f).height(56.dp).clip(RoundedCornerShape(22.dp)).springClick(scaleTo = 0.92f) { onTab(t) }
                    .testTag("tab-${t.name.lowercase()}").semantics { contentDescription = t.label },
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                    Icon(t.icon, null, tint = tint, modifier = Modifier.size(22.dp))
                    Spacer(Modifier.height(3.dp))
                    Text(t.label, style = Type.label.copy(fontSize = 11.5.sp, fontWeight = if (on) androidx.compose.ui.text.font.FontWeight.SemiBold else androidx.compose.ui.text.font.FontWeight.Medium), color = tint, maxLines = 1)
                }
            }
        }
    }
}

/** The same five tabs, stacked on the left for landscape phones. */
@Composable
private fun SideRail(tab: Tab?, modifier: Modifier, onTab: (Tab) -> Unit) {
    val shape = RoundedCornerShape(24.dp)
    Column(modifier.width(68.dp).shadow(if (P.dark) 4.dp else 14.dp, shape, ambientColor = Color(0x331C1B18), spotColor = Color(0x551C1B18)).clip(shape)
        .background(if (P.dark) P.surface.copy(alpha = 0.98f) else P.surface).border(1.dp, P.line, shape).padding(5.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Tab.entries.forEach { t ->
            val on = t == tab
            val bg by androidx.compose.animation.animateColorAsState(if (on) P.ink.copy(alpha = if (P.dark) .12f else .065f) else Color.Transparent, label = "rail-bg")
            val tint by androidx.compose.animation.animateColorAsState(if (on) P.ink else P.muted, label = "rail-c")
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(bg).springClick(scaleTo = 0.92f) { onTab(t) }.padding(vertical = 7.dp)
                .testTag("tab-${t.name.lowercase()}").semantics { contentDescription = t.label }, horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(t.icon, null, tint = tint, modifier = Modifier.size(21.dp))
                Text(t.label, style = Type.label.copy(fontSize = 10.sp), color = tint, maxLines = 1)
            }
        }
    }
}

@Composable
private fun MicFab(onClick: () -> Unit) {
    val src = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }
    FloatingActionButton(onClick = onClick, containerColor = Color(0xFF1C1B18), contentColor = Color(0xFFFBF8F1), shape = CircleShape, interactionSource = src,
        modifier = Modifier.padding(end = 6.dp).pressScale(src, 0.9f).size(58.dp).semantics { contentDescription = "Speak to Steady" }.testTag("mic-fab")) {
        Icon(Icons.Rounded.Mic, contentDescription = null)
    }
}
