package dev.karthikyernana.steady.ui.screens

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.animation.core.*
import androidx.compose.animation.togetherWith
import androidx.compose.ui.graphics.graphicsLayer
import dev.karthikyernana.steady.data.str
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.interaction.DragInteraction
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.foundation.gestures.draggable
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.karthikyernana.steady.agent.Agent
import dev.karthikyernana.steady.agent.ChatBackend
import dev.karthikyernana.steady.agent.ChatErrors
import dev.karthikyernana.steady.agent.ChatMessage
import dev.karthikyernana.steady.agent.ChatSummary
import dev.karthikyernana.steady.agent.Recorder
import dev.karthikyernana.steady.net.ApiError
import dev.karthikyernana.steady.ui.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Chat with your data: one agent on the server answers with read-only tools over this account's rows and replies with
 * a few words plus cards. Opened by tapping the floating Ask button (holding it is the voice agent); the bottom bar stays
 * at five tabs. Chat is a full-height sheet risen from the bottom with every control in the thumb zone: History · New ·
 * Close just above the composer, the mic inside the composer (dictation only: no drafts, nothing saved), History as a
 * bottom sheet. The header holds only the title; drag it down (or Back) to close. Phase 1 reads only.
 * State lives above the sheet (in AppRoot) so a conversation survives closing it.
 *
 * Several chats can be in flight: each question runs in its own coroutine on the app-level [scope], keyed by its
 * conversation (not by what is on screen), so you can switch chats, start a new one and type there while an answer is
 * pending; the answer lands in ITS chat (History shows it as answering, then as new).
 */
class ChatConv(val key: String, id: String? = null, title: String? = null) {
    var id by mutableStateOf(id)
    var title by mutableStateOf(title)
    val msgs = mutableStateListOf<ChatMessage>()
    var pending by mutableStateOf<String?>(null)
    var error by mutableStateOf<String?>(null)
    var retryText by mutableStateOf<String?>(null)
    var unread by mutableStateOf(false)
    var loading by mutableStateOf(false)
    var loaded = id == null
    var draft = ""
    var follow by mutableStateOf(true)          // keep the newest message in view until you scroll up yourself
    var updatedAt by mutableLongStateOf(0L)
    /** this chat's own scroll position, so switching back lands where you left it (the thread is reverse-laid: 0 = newest) */
    val list = LazyListState()
    /** the pending question's row key, kept by the real user message once the reply lands (no flicker on swap) */
    var pendingKey = ""
    val alias = mutableMapOf<String, String>()
    /** the answer that just arrived: its words reveal and its cards rise in, once */
    var reveal by mutableStateOf<String?>(null)
    /** messages already shown this session: their charts don't replay when scrolled back into view */
    val seen = HashSet<String>()
}
data class ChatHistItem(val id: String?, val key: String?, val title: String, val preview: String, val updatedAt: Long, val pending: Boolean, val unread: Boolean)

class ChatState(private val api: ChatBackend, private val agent: Agent?, private val recorder: Recorder?, private val scope: CoroutineScope,
                private val loadTitles: () -> Map<String, String> = { emptyMap() }, private val saveTitles: (Map<String, String>) -> Unit = {},
                private val toast: (String) -> Unit) {
    var chats by mutableStateOf<List<ChatSummary>?>(null)
    val convs = mutableStateListOf<ChatConv>()
    private var seq = 0
    private var pseq = 0
    /** the empty chat's opener from the server (null until loaded, or when the server has none) */
    var starter by mutableStateOf<dev.karthikyernana.steady.agent.ChatStarter?>(null); private set
    var starterLoading by mutableStateOf(false); private set
    private var starterAt by mutableLongStateOf(0L)
    /** a starter load has finished (with or without one): only then do the built-in chips stand in */
    val starterReady get() = !starterLoading && starterAt != 0L
    fun loadStarter() {
        if (starterLoading || System.currentTimeMillis() - starterAt < 10 * 60_000) return
        starterLoading = true
        scope.launch {
            try { starter = api.starter(); starterAt = System.currentTimeMillis() }
            catch (e: kotlinx.coroutines.CancellationException) { throw e }
            catch (e: Exception) { android.util.Log.w("SteadyChat", "starter failed: ${e.message}"); starterAt = System.currentTimeMillis() - 9 * 60_000 }   // retry in a minute
            finally { starterLoading = false }
        }
    }
    private fun newConv(id: String? = null, title: String? = null) = ChatConv("c${++seq}", id, title).also { convs += it }
    var cur by mutableStateOf(newConv()); private set
    private var titles by mutableStateOf(loadTitles())
    fun titleOf(c: ChatConv): String? = c.id?.let { titles[it] } ?: c.title
    // what is on screen (the current chat)
    val chatId get() = cur.id
    val title get() = titleOf(cur)
    val msgs get() = cur.msgs
    val sending get() = cur.pending
    val error get() = cur.error
    val canRetry get() = cur.retryText != null
    var hist by mutableStateOf(false)
    var off by mutableStateOf(false); private set
    var offline by mutableStateOf(false); private set
    var input by mutableStateOf("")
    var listening by mutableStateOf(false); private set
    var transcribing by mutableStateOf(false); private set
    var level by mutableFloatStateOf(0f); private set
    /** ticks when the current chat must jump to its newest message (you sent, or opened/switched to it) */
    var scrollTick by mutableIntStateOf(0); private set
    var handledMic = 0
    private var micJob: Job? = null
    private var listJob: Job? = null
    /** true while another chat has an answer pending or unread (a dot on History) */
    val othersBusy get() = convs.any { it !== cur && (it.pending != null || it.unread) }

    fun loadList() {
        if (listJob?.isActive == true) return
        listJob = scope.launch { chats = runCatching { api.list() }.onSuccess { offline = false }.getOrElse { if ((it as? ApiError)?.status == 0) offline = true; chats ?: emptyList() } }
    }
    /** History: last activity first; a chat still answering counts as active now and shows even before it has an id. */
    fun historyItems(): List<ChatHistItem> {
        val out = LinkedHashMap<String, ChatHistItem>()
        chats?.forEach { ch -> out[ch.id] = ChatHistItem(ch.id, null, titles[ch.id] ?: ch.title, ch.preview, ch.updatedAt, false, false) }
        for (c in convs) {
            if (c.id == null && c.pending == null) continue
            val prev = c.id?.let { out[it] }
            if (c.id != null && prev == null && c.pending == null && c.msgs.isEmpty()) continue
            val t = titleOf(c) ?: prev?.title ?: c.pending ?: "New chat"
            out[c.id ?: c.key] = ChatHistItem(c.id, c.key, if (prev != null && titleOf(c) == null) prev.title else t, prev?.preview ?: "", maxOf(prev?.updatedAt ?: 0L, c.updatedAt), c.pending != null, c.unread)
        }
        return out.values.sortedByDescending { it.updatedAt }
    }

    fun send(raw: String = input) {
        val text = raw.trim(); val conv = cur
        if (text.isEmpty() || conv.pending != null) return
        conv.pendingKey = "p${++pseq}"
        conv.pending = text; conv.error = null; conv.retryText = null; conv.updatedAt = System.currentTimeMillis(); conv.draft = ""; conv.follow = true
        input = ""; scrollTick++
        scope.launch {
            try {
                val r = api.send(conv.id, text)
                if (conv !in convs) return@launch                       // deleted while it was answering
                if (conv.id == null) conv.id = r.chatId
                if (r.title.isNotBlank()) conv.title = r.title
                if (r.user.id.isNotEmpty()) conv.alias[r.user.id] = conv.pendingKey
                conv.reveal = r.answer.id.ifEmpty { null }
                for (m in listOf(r.user, r.answer)) if (m.id.isEmpty() || conv.msgs.none { it.id == m.id }) conv.msgs += m
                conv.loaded = true; conv.updatedAt = System.currentTimeMillis(); offline = false
                if (conv !== cur) { conv.unread = true; toast("Answer ready in “${titleOf(conv) ?: "your other chat"}”.") }
                loadList()
            } catch (e: ApiError) {
                android.util.Log.w("SteadyChat", "send failed ${e.status}: ${e.message}")      // debug detail: the log only
                val f = ChatErrors.friendly(e.status, e.message, online = e.status != 0)
                when { e.status == 0 -> offline = true; f.off -> off = true }
                if (conv in convs) {
                    conv.error = f.msg; conv.retryText = text.takeIf { f.retry }
                    if (conv === cur) { if (input.isBlank()) input = text } else { if (conv.draft.isBlank()) conv.draft = text; conv.unread = true }
                }
            } catch (e: kotlinx.coroutines.CancellationException) { throw e
            } catch (e: Exception) {
                android.util.Log.w("SteadyChat", "send failed", e)
                if (conv in convs) { conv.error = ChatErrors.BUSY; conv.retryText = text; if (conv === cur && input.isBlank()) input = text }
            } finally { conv.pending = null }
        }
    }
    fun retry() { val t = cur.retryText ?: return; cur.error = null; if (input.trim() == t) input = ""; send(t) }

    private fun switchTo(c: ChatConv) {
        if (c === cur) return
        cur.draft = input
        cur = c; c.unread = false; input = c.draft; hist = false
    }
    fun open(id: String) {
        val c = convs.firstOrNull { it.id == id } ?: newConv(id, chats?.firstOrNull { it.id == id }?.title)
        switchTo(c); hist = false
        if (c.pending == null && !c.loading) refresh(c)
    }
    /** a pending chat that has no server id yet is opened by its local key */
    fun openKey(key: String) { convs.firstOrNull { it.key == key }?.let { switchTo(it); hist = false } }
    private fun refresh(c: ChatConv) {
        c.loading = true
        scope.launch {
            try {
                val (s, m) = api.open(c.id!!)
                if (c !in convs) return@launch
                c.title = s.title
                if (c.pending == null) { c.msgs.clear(); c.msgs += m }
                if (!c.loaded) { c.loaded = true; if (c === cur) { c.follow = true; scrollTick++ } }
                c.error = null
            } catch (e: ApiError) {
                android.util.Log.w("SteadyChat", "open failed ${e.status}: ${e.message}")
                if (e.status == 404) { toast("That chat is gone."); drop(c); loadList() }
                else if (!c.loaded) { c.error = ChatErrors.friendly(e.status, e.message, e.status != 0).msg; c.loaded = true }
            } finally { c.loading = false }
        }
    }
    private fun drop(c: ChatConv) { convs.remove(c); if (c === cur) { cur = convs.firstOrNull { it.id == null && it.pending == null && it.msgs.isEmpty() } ?: newConv(); input = cur.draft } }
    fun delete(id: String) {
        scope.launch {
            try { api.delete(id); chats = chats?.filterNot { it.id == id }; convs.firstOrNull { it.id == id }?.let(::drop); if (titles.containsKey(id)) { titles = titles - id; saveTitles(titles) }; toast("Chat deleted.") }
            catch (e: ApiError) {
                if (e.status == 404) { chats = chats?.filterNot { it.id == id }; convs.firstOrNull { it.id == id }?.let(::drop); toast("That chat was already gone.") }
                else toast("Couldn’t delete that chat. Try again in a moment.")
            }
        }
    }
    fun rename(id: String, name: String) {
        val t = name.trim().take(80); if (t.isEmpty()) return
        titles = titles + (id to t); saveTitles(titles)                   // shows at once; stays on this device if the server can't rename yet
        convs.firstOrNull { it.id == id }?.title = t
        chats = chats?.map { if (it.id == id) it.copy(title = t) else it }
        scope.launch { runCatching { api.rename(id, t) }.onSuccess { titles = titles - id; saveTitles(titles) } }
    }
    /** New: always available, even while another chat is answering. */
    fun fresh() {
        hist = false
        val c = cur
        if (c.id == null && c.pending == null && c.msgs.isEmpty() && c.error == null) return
        switchTo(convs.firstOrNull { it.id == null && it.pending == null && it.msgs.isEmpty() && it.error == null } ?: newConv())
    }

    /** The composer mic: tap to listen, tap again to stop; the words land in the text box. */
    fun toggleMic(signedIn: Boolean) {
        val rec = recorder ?: return; val ag = agent ?: return
        if (!signedIn) { toast("Sign in from You (top right) to talk. Typing works now."); return }
        if (listening) {
            listening = false; micJob?.cancel()
            val pieces = rec.stop()
            if (pieces.isEmpty()) { toast("I didn’t catch anything. Try again a little closer."); return }
            transcribing = true
            scope.launch {
                try { val t = pieces.map { ag.transcribe(it, "audio/mp4").trim() }.filter { it.isNotEmpty() }.joinToString(" ")
                    if (t.isBlank()) toast("I couldn’t make out any words. Try again, or type it.") else input = if (input.isBlank()) t else "${input.trim()} $t" }
                catch (e: ApiError) { toast(e.message ?: "Couldn’t transcribe that.") }
                finally { transcribing = false }
            }
            return
        }
        runCatching { rec.start() }.onFailure { toast("The microphone is busy right now. Type it, or try again."); return }
        listening = true
        micJob = scope.launch {
            var quiet = 0L; var heard = 0L; var last = System.currentTimeMillis()
            while (listening) {
                delay(80); val now = System.currentTimeMillis(); val dt = now - last; last = now
                level = rec.level()
                if (level > 0.06f) { heard += dt; quiet = 0 } else quiet += dt
                if (rec.turnMs > 60_000 || (heard > 450 && quiet > 3200)) { toggleMic(true); break }
                if (rec.pieceMs >= 28_000 || (rec.pieceMs >= 24_000 && quiet >= 300)) rec.rotate()
            }
        }
    }
    fun stopMic() { if (listening) { listening = false; micJob?.cancel(); recorder?.stopQuietly() } }
}

// empty state fallback (no starter from the server): chart-worthy asks; "What did I write about…" fills the box
private val SUGGEST = listOf("Spending by category this month", "How am I doing on my goals?", "What’s due this week?", "What did I write about…")

/** One row of the thread. Immutable, keyed: the LazyColumn diffs by key and never recomposes a row whose data is equal. */
@Immutable
private sealed interface Row { val key: String }
@Immutable private data class TimeRow(override val key: String, val text: String) : Row
@Immutable private data class MsgRow(override val key: String, val m: ChatMessage, val reveal: Boolean, val chips: List<String>) : Row
@Immutable private data class TypingRow(override val key: String) : Row
@Immutable private data class ErrorRow(override val key: String, val text: String, val retry: Boolean) : Row

/** "Today 9:41 PM", "Yesterday 8:02 AM", "Mon 12 Oct, 6:15 PM" */
internal fun chatTime(at: Long, now: Long = System.currentTimeMillis(), zone: java.time.ZoneId = java.time.ZoneId.systemDefault()): String {
    val t = java.time.Instant.ofEpochMilli(at).atZone(zone); val today = java.time.Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
    val clock = t.format(java.time.format.DateTimeFormatter.ofPattern("h:mm a", java.util.Locale.ENGLISH))
    return when (t.toLocalDate()) {
        today -> "Today $clock"; today.minusDays(1) -> "Yesterday $clock"
        else -> t.format(java.time.format.DateTimeFormatter.ofPattern(if (t.year == today.year) "EEE d MMM" else "d MMM yyyy", java.util.Locale.ENGLISH)) + ", $clock"
    }
}

/** The thread as rows, oldest first: a time label when the day changes or 30+ minutes pass, chips under the newest answer. */
private fun threadRows(conv: ChatConv, msgs: List<ChatMessage>, pending: String?, error: String?, canRetry: Boolean): List<Row> {
    val out = ArrayList<Row>(msgs.size + 6)
    var last = 0L
    val lastAgent = if (pending == null && error == null) msgs.lastOrNull()?.takeIf { !it.user } else null
    msgs.forEachIndexed { i, m ->
        if (m.at > 0 && (last == 0L || m.at - last > 30 * 60_000 || java.time.Instant.ofEpochMilli(m.at).atZone(java.time.ZoneId.systemDefault()).toLocalDate() != java.time.Instant.ofEpochMilli(last).atZone(java.time.ZoneId.systemDefault()).toLocalDate()))
            out += TimeRow("t-${m.id.ifEmpty { "x$i" }}", chatTime(m.at))
        if (m.at > 0) last = m.at
        val key = conv.alias[m.id]?.let { "u-$it" } ?: "m-${m.id.ifEmpty { "x$i" }}"
        out += MsgRow(key, m, !m.user && m.id == conv.reveal, if (m === lastAgent) m.suggestions else emptyList())
    }
    if (pending != null) {
        if (last == 0L || System.currentTimeMillis() - last > 30 * 60_000) out += TimeRow("t-${conv.pendingKey}", chatTime(System.currentTimeMillis()))
        out += MsgRow("u-${conv.pendingKey}", ChatMessage("pending", true, pending, emptyList(), 0), false, emptyList())
        out += TypingRow("typing")
    }
    if (error != null) out += ErrorRow("error", error, canRetry)
    return out
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ChatScreen(st: ChatState, signedIn: Boolean = LocalCtx.current.app.sync.signedIn, name: String? = runCatching { LocalCtx.current.snap.profile.str("name") }.getOrNull()) {   // the thread (inside ChatSheet)
    val conv = st.cur
    val list = conv.list                                   // each chat keeps its own scroll position
    val scope = rememberCoroutineScope()
    val reduced = reducedMotion()
    LaunchedEffect(signedIn) { if (signedIn && st.chats == null) st.loadList() }
    val blocked = when { !signedIn -> "signin"; st.off -> "off"; st.offline -> "offline"; else -> null }
    val pending = conv.pending; val error = conv.error; val canRetry = st.canRetry
    // rows rebuild only when the thread itself changes (not on every scroll or keystroke)
    val rows by remember(conv) { derivedStateOf { threadRows(conv, conv.msgs.toList(), conv.pending, conv.error, conv.retryText != null).asReversed() } }
    val empty = rows.isEmpty()
    LaunchedEffect(empty, signedIn, blocked) { if (empty && signedIn && blocked == null) st.loadStarter() }
    if (empty) { ChatEmpty(st, blocked, name); return }

    // reverse layout: index 0 is the newest row, so the thread is bottom-anchored for free and a growing answer grows upward
    val atBottom by remember(conv) { derivedStateOf { list.firstVisibleItemIndex == 0 && list.firstVisibleItemScrollOffset < 48 } }
    LaunchedEffect(conv) { list.interactionSource.interactions.collect { if (it is DragInteraction.Start) conv.follow = false } }
    LaunchedEffect(conv) { snapshotFlow { atBottom }.collect { if (it) conv.follow = true } }
    val newest = rows.firstOrNull()?.key
    LaunchedEffect(conv, newest) { if (conv.follow && list.firstVisibleItemIndex != 0) { if (reduced) list.scrollToItem(0) else list.animateScrollToItem(0) } else if (conv.follow && list.firstVisibleItemScrollOffset != 0) list.animateScrollToItem(0) }
    LaunchedEffect(conv, st.scrollTick) { if (st.scrollTick > 0) { conv.follow = true; list.scrollToItem(0) } }
    Box(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize().testTag("chat"), state = list, reverseLayout = true,
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 14.dp), verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.Bottom)) {
            if (blocked != null) item(key = "blocked", contentType = "blocked") { Blocked(blocked) }
            items(rows, key = { it.key }, contentType = { it::class.simpleName }) { r ->
                val item = Modifier.animateItem(fadeInSpec = androidx.compose.animation.core.spring(stiffness = 300f), fadeOutSpec = androidx.compose.animation.core.tween(120),
                    placementSpec = androidx.compose.animation.core.spring(dampingRatio = 0.86f, stiffness = 420f))
                when (r) {
                    is TimeRow -> Text(r.text, style = Type.label.copy(fontSize = 11.5.sp), color = P.muted, textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                        modifier = item.fillMaxWidth().padding(top = 4.dp).testTag("chat-time"))
                    is MsgRow -> {
                        val animate = remember(r.key) { conv.seen.add(r.key) }           // first time on screen this session
                        Box(item) { Message(r.m, r.reveal, animate, r.chips, onChip = { q -> if (q.endsWith("…")) st.input = q.dropLast(1) + " " else st.send(q) }, onRevealed = { if (conv.reveal == r.m.id) conv.reveal = null }) }
                    }
                    is TypingRow -> Box(item) { Typing() }
                    is ErrorRow -> Column(item.testTag("chat-error")) {
                        Text(r.text, style = Type.body, color = P.danger)
                        if (r.retry) TextButton(onClick = { st.retry() }, modifier = Modifier.testTag("chat-retry")) { Text("Try again", style = Type.bodyM, color = P.ink) }
                    }
                }
            }
        }
        // "Latest": you scrolled up and there is more below
        androidx.compose.animation.AnimatedVisibility(!atBottom && !conv.follow, Modifier.align(Alignment.BottomCenter).padding(bottom = 10.dp),
            enter = androidx.compose.animation.fadeIn(androidx.compose.animation.core.tween(160)) + androidx.compose.animation.scaleIn(androidx.compose.animation.core.spring(dampingRatio = 0.6f, stiffness = 600f), 0.8f),
            exit = androidx.compose.animation.fadeOut(androidx.compose.animation.core.tween(120)) + androidx.compose.animation.scaleOut(targetScale = 0.8f)) {
            Row(Modifier.heightIn(min = 40.dp).shadow(if (P.dark) 0.dp else 8.dp, RoundedCornerShape(999.dp)).clip(RoundedCornerShape(999.dp)).background(P.ink)
                .springClick { scope.launch { conv.follow = true; if (reduced) list.scrollToItem(0) else list.animateScrollToItem(0) } }
                .padding(horizontal = 14.dp).testTag("chat-jump").semantics { contentDescription = "Jump to the latest message" }, verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.KeyboardArrowDown, null, tint = P.ground, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(4.dp)); Text("Latest", style = Type.label, color = P.ground)
            }
        }
    }
}

/** The empty chat: a greeting, the headline insight (the starter's card, from real data) and starter chips. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ChatEmpty(st: ChatState, blocked: String?, name: String?) {
    val conv = st.cur
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp, vertical = 12.dp).testTag("chat"), verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.Bottom)) {
        if (blocked != null) { Blocked(blocked); return@Column }
        if (conv.loading) { Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.testTag("chat-loading")) { Typing(label = "Opening that chat…", tag = "chat-loading-dots") }; return@Column }
        val starter = st.starter
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.enterUp(true, 0).testTag("chat-empty")) {
            BrandMark(34.dp); Spacer(Modifier.width(12.dp))
            Column {
                Text(starter?.greeting ?: (dev.karthikyernana.steady.core.Dates.greeting() + (name?.takeIf { it.isNotBlank() }?.let { ", $it" } ?: "") + "."), style = Type.h3.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold), color = P.ink, modifier = Modifier.testTag("chat-greeting"))
                Text(starter?.headline ?: "Ask about your tasks, goals, money and thoughts.", style = Type.small, color = if (starter?.headline != null) P.ink2 else P.muted, modifier = Modifier.testTag("chat-headline"))
            }
        }
        when {
            starter != null && starter.cards.isNotEmpty() -> starter.cards.forEachIndexed { i, card ->
                Box(Modifier.enterUp(true, 90 + i * 90).testTag("chat-starter-card")) { CompositionLocalProvider(LocalCardMotion provides true) { ChatCardView(card) } }
            }
            starter == null && !st.starterReady -> StarterSkeleton()
        }
        // the server's chips once its starter is in; the built-in ones only when it has none (never a swap mid-look)
        val chips = starter?.suggestions?.takeIf { it.isNotEmpty() } ?: if (st.starterReady) SUGGEST else emptyList()
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            chips.forEachIndexed { i, q -> Chip(q, "chat-suggest-$i", Modifier.enterUp(true, 160 + i * 60, 10)) { if (q.endsWith("…")) st.input = q.dropLast(1) + " " else st.send(q) } }
        }
        Text("Chat reads, never changes. To add or edit, hold Ask and say it.", style = Type.small, color = P.muted, modifier = Modifier.enterUp(true, 400, 6))
    }
}

@Composable
private fun StarterSkeleton() {
    val t = rememberInfiniteTransition(label = "skeleton")
    val a = t.animateFloat(0.45f, 0.9f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "skeleton-a")
    SCard(Modifier.testTag("chat-starter-loading"), pad = 16.dp) {
        val c = P.surface2
        Box(Modifier.fillMaxWidth(0.4f).height(12.dp).graphicsLayer { alpha = a.value }.clip(RoundedCornerShape(6.dp)).background(c))
        Spacer(Modifier.height(12.dp))
        Box(Modifier.fillMaxWidth(0.6f).height(28.dp).graphicsLayer { alpha = a.value }.clip(RoundedCornerShape(8.dp)).background(c))
    }
}

@Composable
private fun Chip(q: String, tag: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Text(q, style = Type.small.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Medium), color = P.ink, maxLines = 2, overflow = TextOverflow.Ellipsis,
        modifier = modifier.clip(RoundedCornerShape(999.dp)).border(1.dp, P.accentLine, RoundedCornerShape(999.dp))
            .background(P.accentSoft.copy(alpha = if (P.dark) 0.7f else 0.55f)).springClick(role = androidx.compose.ui.semantics.Role.Button, onClick = onClick).padding(horizontal = 14.dp, vertical = 10.dp).testTag(tag))
}

/** "Steady is looking": the mark and three dots that rise in turn (draw phase only), with a calm line that changes as it waits. */
@Composable
private fun Typing(label: String? = null, tag: String = "chat-wait") {
    val t = rememberInfiniteTransition(label = "typing")
    val phase = t.animateFloat(0f, 1f, infiniteRepeatable(tween(1100, easing = LinearEasing)), label = "typing-phase")
    val clock = t.animateFloat(0f, 3f, infiniteRepeatable(tween(9000, easing = LinearEasing)), label = "typing-clock")
    val step by remember { derivedStateOf { clock.value.toInt() } }
    val line = label ?: listOf("Looking at your data…", "Working it out…", "Putting the numbers together…").getOrElse(step) { "Looking at your data…" }
    val density = androidx.compose.ui.platform.LocalDensity.current
    val lift = with(density) { 4.dp.toPx() }
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.testTag(tag).semantics { contentDescription = "Steady is answering" }) {
        BrandMark(22.dp); Spacer(Modifier.width(10.dp))
        Row(Modifier.clip(RoundedCornerShape(16.dp)).background(P.surface).border(1.dp, P.line, RoundedCornerShape(16.dp)).padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            val dot = P.accent
            repeat(3) { i -> Box(Modifier.size(7.dp).graphicsLayer {
                val x = ((phase.value - i * 0.16f + 1f) % 1f); val w = if (x < 0.4f) kotlin.math.sin(x / 0.4f * Math.PI).toFloat() else 0f
                translationY = -w * lift; alpha = 0.4f + 0.6f * w }.clip(CircleShape).background(dot)) }
        }
        Spacer(Modifier.width(10.dp))
        androidx.compose.animation.AnimatedContent(line, transitionSpec = { androidx.compose.animation.fadeIn(tween(220)) togetherWith androidx.compose.animation.fadeOut(tween(160)) }, label = "typing-line") {
            Text(it, style = Type.small, color = P.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/**
 * Words appear quickly, left to right, without reflow: the whole text is laid out at once and the unrevealed tail is
 * transparent, so the row has its final height from the first frame (and accessibility reads the full answer).
 */
@Composable
private fun RevealText(text: String, animate: Boolean, style: androidx.compose.ui.text.TextStyle, color: Color, modifier: Modifier = Modifier, onDone: () -> Unit) {
    val reduced = reducedMotion()
    val p = remember(text) { androidx.compose.animation.core.Animatable(if (animate && !reduced && text.length > 1) 0f else 1f) }
    LaunchedEffect(p) { if (p.value < 1f) p.animateTo(1f, tween((text.length * 9).coerceIn(220, 900), easing = LinearEasing)); onDone() }
    val n by remember(text) { derivedStateOf { (p.value * text.length).toInt().coerceIn(0, text.length) } }
    if (n >= text.length) { Text(text, style = style, color = color, modifier = modifier); return }
    val shown = remember(n, text, color) { androidx.compose.ui.text.buildAnnotatedString {
        append(text.substring(0, n)); pushStyle(androidx.compose.ui.text.SpanStyle(color = Color.Transparent)); append(text.substring(n)); pop() } }
    Text(shown, style = style, color = color, modifier = modifier)
}

@Composable
private fun HeadIcon(icon: androidx.compose.ui.graphics.vector.ImageVector, desc: String, tag: String, onClick: () -> Unit) {
    Box(Modifier.size(44.dp).clip(CircleShape).springClick(scaleTo = 0.9f, role = androidx.compose.ui.semantics.Role.Button, onClick = onClick)
        .semantics { contentDescription = desc }.testTag(tag), contentAlignment = Alignment.Center) {
        Icon(icon, null, tint = P.ink2, modifier = Modifier.size(22.dp))
    }
}

@Composable
private fun SmallAction(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, tag: String, enabled: Boolean = true, desc: String = label, onClick: () -> Unit) {
    Row(Modifier.heightIn(min = 48.dp).shadow(if (P.dark) 0.dp else 4.dp, RoundedCornerShape(999.dp)).clip(RoundedCornerShape(999.dp)).background(P.surface).border(1.dp, P.line2, RoundedCornerShape(999.dp)).springClick(enabled = enabled, onClick = onClick)
        .padding(horizontal = 14.dp).testTag(tag).semantics { contentDescription = desc }, verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = if (enabled) P.ink else P.muted, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(6.dp))
        Text(label, style = Type.label.copy(fontSize = 13.sp), color = if (enabled) P.ink else P.muted)
    }
}

/** History, as a bottom sheet over the chat (tap one to open it, the bin to delete it). */
@Composable
fun ChatHistorySheet(st: ChatState, signedIn: Boolean) {
    SSheet({ st.hist = false }, "History") { History(st, signedIn) }
}

@Composable
private fun History(st: ChatState, signedIn: Boolean) {
    val items = st.historyItems()
    var renaming by remember { mutableStateOf<ChatHistItem?>(null) }
    Column(Modifier.fillMaxWidth().testTag("chat-history")) {
        when {
            !signedIn -> Text("Your chats show up here once you sign in.", style = Type.small, color = P.muted, modifier = Modifier.padding(8.dp))
            st.chats == null && items.isEmpty() -> Text("Loading…", style = Type.small, color = P.muted, modifier = Modifier.padding(8.dp))
            items.isEmpty() -> Text("Your chats will show up here.", style = Type.small, color = P.muted, modifier = Modifier.padding(8.dp))
            else -> items.forEachIndexed { i, ch ->
                val on = if (ch.key != null) ch.key == st.cur.key else ch.id == st.chatId
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(if (on) P.surface2 else Color.Transparent), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f).springClick { if (ch.id != null) st.open(ch.id) else ch.key?.let(st::openKey) }.padding(horizontal = 8.dp, vertical = 8.dp).testTag("chat-hist-item")) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            if (ch.unread) { Box(Modifier.size(8.dp).clip(CircleShape).background(P.accent).testTag("chat-hist-unread")); Spacer(Modifier.width(6.dp)) }
                            Text(ch.title, style = Type.bodyM, color = P.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        if (ch.pending) Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.testTag("chat-hist-pending")) {
                            CircularProgressIndicator(Modifier.size(10.dp), strokeWidth = 1.5.dp, color = P.accent); Spacer(Modifier.width(6.dp)); Text("Answering…", style = Type.small, color = P.accent)
                        } else if (ch.preview.isNotBlank()) Text(ch.preview, style = Type.small, color = P.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    if (ch.id != null) {
                        IconButton(onClick = { renaming = ch }, modifier = Modifier.testTag("chat-ren-$i")) { Icon(Icons.Outlined.Edit, "Rename “${ch.title}”", tint = P.muted) }
                        IconButton(onClick = { st.delete(ch.id) }, modifier = Modifier.testTag("chat-del-$i")) { Icon(Icons.Outlined.DeleteOutline, "Delete “${ch.title}”", tint = P.muted) }
                    }
                }
            }
        }
    }
    renaming?.let { ch ->
        var name by remember(ch.id) { mutableStateOf(ch.title) }
        AlertDialog(onDismissRequest = { renaming = null }, title = { Text("Rename chat") },
            text = { OutlinedTextField(name, { name = it.take(80) }, singleLine = true, modifier = Modifier.testTag("chat-rename-input")) },
            confirmButton = { TextButton(onClick = { st.rename(ch.id!!, name); renaming = null }, modifier = Modifier.testTag("chat-rename-save")) { Text("Save") } },
            dismissButton = { TextButton(onClick = { renaming = null }) { Text("Cancel") } })
    }
}

@Composable
private fun Blocked(kind: String) {
    val (t, b) = when (kind) {
        "signin" -> "Chat needs your account" to "Chat reads your synced tasks, goals, money and thoughts, so it works once you sign in from You (top right). Everything else works without it."
        "offline" -> "You’re offline" to "Chat needs a connection to read your data. Everything else in Steady keeps working, and chat is here when you’re back online."
        else -> "Chat isn’t set up yet" to "This Steady has no chat model configured. Everything else works as usual."
    }
    SCard(Modifier.testTag("chat-blocked"), tint = P.surface2) {
        Text(t, style = Type.h3, color = P.ink); Spacer(Modifier.height(4.dp)); Text(b, style = Type.body, color = P.muted)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Message(m: ChatMessage, reveal: Boolean = false, animate: Boolean = false, chips: List<String> = emptyList(), onChip: (String) -> Unit = {}, onRevealed: () -> Unit = {}) {
    if (m.user) Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
        val shape = RoundedCornerShape(20.dp, 20.dp, 6.dp, 20.dp)
        Text(m.text, style = Type.body.copy(lineHeight = 22.sp), color = if (P.dark) P.accentInk else Color.White, modifier = Modifier.fillMaxWidth(0.82f).wrapContentWidth(Alignment.End)
            .clip(shape).background(P.accent).padding(horizontal = 15.dp, vertical = 10.dp).testTag("chat-msg-user"))
    } else Row(Modifier.fillMaxWidth().testTag("chat-msg-agent")) {
        // the mark sits beside the first line; cards use the full width under the words
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Box(Modifier.padding(top = 1.dp)) { BrandMark(22.dp) }
                Spacer(Modifier.width(10.dp))
                if (m.text.isNotBlank()) RevealText(m.text, reveal, Type.body.copy(fontSize = 16.sp, lineHeight = 23.sp), P.ink, Modifier.weight(1f), onRevealed)
                else { Spacer(Modifier.weight(1f)); LaunchedEffect(Unit) { onRevealed() } }
            }
            // a fresh answer: cards rise in one after another as the words finish; history shows them at once
            val base = if (reveal) (m.text.length * 9).coerceIn(160, 600) else 60
            CompositionLocalProvider(LocalCardMotion provides animate) {
                m.cards.forEachIndexed { i, card -> ChatCardView(card, Modifier.enterUp(reveal || animate, base + i * 110, 16)) }
            }
            if (chips.isNotEmpty()) FlowRow(Modifier.padding(start = 32.dp, top = 2.dp).testTag("chat-chips"), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                chips.forEachIndexed { i, q -> Chip(q, "chat-chip-$i", Modifier.enterUp(true, (if (reveal) base else 0) + 200 + m.cards.size * 110 + i * 70, 8)) { onChip(q) } }
            }
        }
    }
}

/** The composer: the text box, the dictation mic and send, in one row at the bottom of the sheet. */
@Composable
fun ChatComposer(st: ChatState, enabled: Boolean, onMic: () -> Unit, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(26.dp)
    Row(modifier.fillMaxWidth().heightIn(min = 58.dp).shadow(if (P.dark) 2.dp else 12.dp, shape, ambientColor = Color(0x331C1B18), spotColor = Color(0x441C1B18))
        .clip(shape).background(P.surface).border(1.dp, P.line, shape).padding(start = 16.dp, end = 6.dp, top = 6.dp, bottom = 6.dp).animateContentSize().testTag("chat-composer"),
        verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f).padding(vertical = 8.dp)) {
            when {
                st.listening -> Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.testTag("chat-listening")) {
                    Box(Modifier.size(12.dp).graphicsLayer { val k = 0.7f + st.level * 1.1f; scaleX = k; scaleY = k }.clip(CircleShape).background(P.danger)); Spacer(Modifier.width(10.dp))
                    Text("Listening… tap stop when you’re done", style = Type.body, color = P.ink2, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                st.transcribing -> Text("Writing down what you said…", style = Type.body, color = P.muted, maxLines = 1)
                else -> {
                    if (st.input.isEmpty()) Text(if (!enabled) "Chat is unavailable right now" else if (st.sending != null) "Ask a follow-up when this answer lands…" else "Ask about your data…", style = Type.body, color = P.muted, maxLines = 1)
                    // a TextFieldValue so text set from outside (a suggestion, dictation, switching chats) puts the cursor at its end
                    var tfv by remember { mutableStateOf(androidx.compose.ui.text.input.TextFieldValue(st.input, androidx.compose.ui.text.TextRange(st.input.length))) }
                    if (tfv.text != st.input) tfv = androidx.compose.ui.text.input.TextFieldValue(st.input, androidx.compose.ui.text.TextRange(st.input.length))
                    BasicTextField(tfv, { v -> val t = v.text.take(1000); tfv = if (t == v.text) v else v.copy(text = t); st.input = t }, enabled = enabled, textStyle = Type.body.copy(color = P.ink), cursorBrush = SolidColor(P.accent), maxLines = 5,
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences), modifier = Modifier.fillMaxWidth().testTag("chat-input").semantics { contentDescription = "Ask about your data" })
                }
            }
        }
        // dictation into the box (transcription only); never spoken replies
        Box(Modifier.size(44.dp).clip(CircleShape).background(if (st.listening) P.danger else Color.Transparent).springClick(enabled = !st.transcribing, scaleTo = 0.9f, onClick = onMic)
            .semantics { contentDescription = if (st.listening) "Stop listening" else "Dictate your question" }.testTag("chat-mic"), contentAlignment = Alignment.Center) {
            Icon(if (st.listening) Icons.Rounded.Stop else Icons.Rounded.Mic, null, tint = if (st.listening) P.ground else P.ink2, modifier = Modifier.size(22.dp))
        }
        Spacer(Modifier.width(4.dp))
        val can = enabled && st.input.isNotBlank() && st.sending == null && !st.listening
        val sendBg by androidx.compose.animation.animateColorAsState(if (can) P.accent else P.line2, tween(180), label = "send-bg")
        val sendScale by animateFloatAsState(if (can) 1f else 0.88f, spring(dampingRatio = 0.55f, stiffness = 600f), label = "send-scale")
        Box(Modifier.size(44.dp).graphicsLayer { scaleX = sendScale; scaleY = sendScale }.clip(CircleShape).background(sendBg).springClick(enabled = can, scaleTo = 0.9f) { st.send() }
            .semantics { contentDescription = "Send" }.testTag("chat-send"), contentAlignment = Alignment.Center) {
            Icon(Icons.Rounded.ArrowUpward, null, tint = if (can) (if (P.dark) P.accentInk else Color.White) else P.muted, modifier = Modifier.size(20.dp))
        }
    }
}

/**
 * Chat as a full-height sheet: the header (grab handle + title only; drag it down to close), the thread, and the bottom
 * dock (History · New · Close, then the composer), which rides on top of the keyboard.
 */
@Composable
fun ChatSheet(st: ChatState, enabled: Boolean, onClose: () -> Unit, onMic: () -> Unit, signedIn: Boolean = LocalCtx.current.app.sync.signedIn) {
    val density = androidx.compose.ui.platform.LocalDensity.current
    val scope = rememberCoroutineScope()
    val drag = remember { androidx.compose.animation.core.Animatable(0f) }
    // rounded top drawn by the background, NOT a clip: a clip with unequal corner radii is a path outline, and pointer
    // hit-testing against it is unreliable (Robolectric's legacy graphics drops every touch); nothing sits in the corners
    val shape = RoundedCornerShape(topStart = 26.dp, topEnd = 26.dp)
    Box(Modifier.fillMaxSize().offset { androidx.compose.ui.unit.IntOffset(0, drag.value.toInt()) }.shadow(if (P.dark) 0.dp else 18.dp, shape, clip = false).background(P.ground, shape)
        .pointerInput(Unit) { awaitPointerEventScope { while (true) awaitPointerEvent() } }      // touches never fall through to the tab underneath
        .testTag("chat-sheet")) {
        Column(Modifier.fillMaxSize().statusBarsPadding().windowInsetsPadding(WindowInsets.ime.union(WindowInsets.navigationBars).only(WindowInsetsSides.Bottom))) {
            // header (as the web): the Steady mark, "Steady" over a one-line chat title, then History · New · Close as icon
            // buttons; drag the header down (or Back) to close
            Column(Modifier.fillMaxWidth().draggable(androidx.compose.foundation.gestures.rememberDraggableState { d -> scope.launch { drag.snapTo((drag.value + d).coerceAtLeast(0f)) } },
                androidx.compose.foundation.gestures.Orientation.Vertical, onDragStopped = { v ->
                    if (drag.value > with(density) { 90.dp.toPx() } || v > 1400f) onClose() else drag.animateTo(0f, androidx.compose.animation.core.spring(dampingRatio = 0.8f))
                }).padding(start = 16.dp, end = 6.dp, top = 6.dp, bottom = 6.dp).testTag("chat-head")) {
                Box(Modifier.align(Alignment.CenterHorizontally).size(width = 36.dp, height = 4.dp).clip(RoundedCornerShape(4.dp)).background(P.line2))
                Spacer(Modifier.height(6.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    BrandMark(26.dp); Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text("Steady", style = Type.label.copy(fontSize = 12.sp), color = P.muted, maxLines = 1)
                        androidx.compose.animation.Crossfade(st.title ?: "New chat", animationSpec = tween(180), label = "chat-title") { t ->
                            Text(t, style = Type.bodyM.copy(fontSize = 16.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold), color = P.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.testTag("chat-title"))
                        }
                    }
                    Box {
                        HeadIcon(Icons.Outlined.History, if (st.othersBusy) "History, another chat has news" else "History", "chat-hist-btn") { st.hist = true; if (signedIn) st.loadList() }
                        if (st.othersBusy) Box(Modifier.align(Alignment.TopEnd).padding(top = 10.dp, end = 10.dp).size(8.dp).clip(CircleShape).background(P.accent).testTag("chat-hist-news"))
                    }
                    HeadIcon(Icons.Outlined.Add, "New chat", "chat-new") { st.fresh() }
                    HeadIcon(Icons.Outlined.KeyboardArrowDown, "Close chat", "chat-close", onClick = onClose)
                }
            }
            Box(Modifier.fillMaxWidth().height(1.dp).background(P.line))
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.TopCenter) { Box(Modifier.widthIn(max = 640.dp).fillMaxSize()) { ChatScreen(st, signedIn) } }
            // the dock: just the composer, riding on the keyboard
            Column(Modifier.align(Alignment.CenterHorizontally).widthIn(max = 640.dp).fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 6.dp, bottom = 10.dp).testTag("chat-dock")) {
                ChatComposer(st, enabled, onMic)
            }
        }
    }
    if (st.hist) ChatHistorySheet(st, signedIn)
}
