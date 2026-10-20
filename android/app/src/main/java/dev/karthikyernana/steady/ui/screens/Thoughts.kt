package dev.karthikyernana.steady.ui.screens

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.foundation.background
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Search
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.sp
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import dev.karthikyernana.steady.core.Dates
import dev.karthikyernana.steady.data.*
import dev.karthikyernana.steady.ui.*
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Instant

val MOODS = listOf("Low", "Meh", "Okay", "Good", "Great")
val MOOD_COLORS = listOf(Color(0xFF9A6B5C), Color(0xFFB98F5E), Color(0xFFA9A089), Color(0xFF7FA48A), Color(0xFF3D6B52))

fun tagged(text: String, accent: Color) = buildAnnotatedString {
    var last = 0
    for (m in TAG_RX.findAll(text)) {
        val start = m.range.first + m.value.indexOf('#')
        append(text.substring(last, start))
        withStyle(SpanStyle(color = accent)) { append(text.substring(start, m.range.last + 1)) }
        last = m.range.last + 1
    }
    append(text.substring(last))
}

/** Readable, clamped thought: short notes as typed; long or pasted AI text gets plain math, bullets, rows, and Show more. */
@Composable
fun ThoughtBody(text: String, clamp: Boolean = true) {
    val fancy = remember(text) { dev.karthikyernana.steady.core.Readable.fancy(text) }
    val lines = remember(text) { if (fancy) dev.karthikyernana.steady.core.Readable.lines(text) else null }
    val accent = P.accent
    val body = remember(text, accent) {
        buildAnnotatedString {
            if (lines == null) append(tagged(text, accent))
            else lines.forEachIndexed { i, l ->
                if (i > 0) append("\n")
                val start = length
                when (l.kind) {
                    dev.karthikyernana.steady.core.Readable.Kind.BULLET -> append("•  ")
                    else -> {}
                }
                val off = length
                append(tagged(l.text, accent))
                l.bold.forEach { r -> addStyle(SpanStyle(fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold), off + r.first, off + r.last + 1) }
                if (l.kind == dev.karthikyernana.steady.core.Readable.Kind.HEADING) addStyle(SpanStyle(fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold, fontSize = 17.sp), start, length)
                if (l.kind == dev.karthikyernana.steady.core.Readable.Kind.ROW) addStyle(SpanStyle(fontSize = 14.sp), start, length)
            }
        }
    }
    val long = clamp && (body.length > 380 || body.count { it == '\n' } > 7)
    var open by rememberSaveable(text) { mutableStateOf(false) }
    Column(Modifier.animateContentSize(androidx.compose.animation.core.spring(dampingRatio = 0.9f, stiffness = 380f))) {
        Text(body, style = Type.body.copy(fontSize = 16.sp, lineHeight = 23.sp), color = P.ink,
            maxLines = if (long && !open) 7 else Int.MAX_VALUE, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
        if (long) Text(if (open) "Show less" else "Show more", style = Type.label.copy(fontSize = 13.sp), color = P.accent,
            modifier = Modifier.padding(top = 6.dp).clip(RoundedCornerShape(8.dp)).clickable { open = !open }.padding(vertical = 6.dp).testTag("th-more"))
    }
}

@OptIn(ExperimentalFoundationApi::class, ExperimentalLayoutApi::class)
@Composable
fun ThoughtsScreen() {
    val c = LocalCtx.current
    var text by rememberSaveable { mutableStateOf("") }
    var kind by rememberSaveable { mutableStateOf("note") }
    var mood by rememberSaveable { mutableStateOf(3) }
    var q by rememberSaveable { mutableStateOf("") }
    var editing by remember { mutableStateOf<Thought?>(null) }
    val list = c.snap.thoughts.filter { q.isBlank() || it.text.contains(q, ignoreCase = true) || it.tags.any { t -> t.contains(q.removePrefix("#"), true) } }

    var tag by rememberSaveable { mutableStateOf<String?>(null) }
    val tags = remember(c.snap.version) { c.snap.thoughts.flatMap { it.tags }.groupingBy { it }.eachCount().entries.sortedByDescending { it.value }.take(12) }
    val shown = list.filter { tag == null || tag in it.tags }
    LazyColumn(Modifier.fillMaxSize().testTag("thoughts"), contentPadding = PaddingValues(start = 18.dp, end = 18.dp, top = 6.dp, bottom = 170.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item(key = "head") { PageHead("THOUGHTS", "Catch it ", "before it's gone") }
        item(key = "composer") {
            SCard {
                Box(Modifier.fillMaxWidth().heightIn(min = 72.dp)) {
                    if (text.isEmpty()) Text("What's on your mind? #idea #startup", style = Type.body.copy(fontSize = 16.sp), color = P.muted)
                    BasicTextField(value = text, onValueChange = { v: String -> text = v }, textStyle = Type.body.copy(fontSize = 16.sp, color = P.ink), cursorBrush = SolidColor(P.accent),
                        modifier = Modifier.fillMaxWidth().heightIn(min = 72.dp).testTag("th-text"))
                }
                HorizontalDivider(color = P.line, modifier = Modifier.padding(vertical = 10.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Segmented(listOf("note" to "Note", "idea" to "Idea", "journal" to "Journal"), kind, { kind = it }, Modifier.weight(1f))
                    Spacer(Modifier.width(10.dp))
                    Button(onClick = {
                        val t = text.trim()
                        val rec = c.app.store.save("thoughts", buildJsonObject { put("id", uid()); put("text", t); put("tags", JsonArray(tagsIn(t).map(::JsonPrimitive))); put("mood", mood); put("kind", kind) })
                        text = ""; c.toast("Saved.") { c.app.store.remove("thoughts", rec.str("id")!!) }
                    }, enabled = text.isNotBlank(), shape = RoundedCornerShape(999.dp), colors = ButtonDefaults.buttonColors(containerColor = P.ink, contentColor = P.ground),
                        modifier = Modifier.testTag("th-save").heightIn(min = 44.dp)) { Text("Save", style = Type.bodyM) }
                }
                Spacer(Modifier.height(12.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    MOOD_COLORS.forEachIndexed { i, col ->
                        val on = mood == i + 1
                        Box(Modifier.padding(end = 8.dp).size(34.dp).clip(CircleShape).clickable { mood = i + 1 }.semantics { contentDescription = "Mood ${MOODS[i]}" }, contentAlignment = Alignment.Center) {
                            Box(Modifier.size(if (on) 26.dp else 18.dp).clip(CircleShape).background(col.copy(alpha = if (on) 1f else 0.55f)).border(if (on) 3.dp else 0.dp, P.surface, CircleShape))
                        }
                    }
                    Text(MOODS[(mood - 1).coerceIn(0, 4)], style = Type.small, color = P.ink2)
                }
            }
        }
        if (c.snap.thoughts.isNotEmpty()) item(key = "search") {
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(999.dp)).background(P.surface.copy(alpha = 0.75f)).border(1.dp, P.line, RoundedCornerShape(999.dp)).padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.Search, null, tint = P.muted, modifier = Modifier.size(20.dp)); Spacer(Modifier.width(8.dp))
                Box(Modifier.weight(1f)) {
                    if (q.isEmpty()) Text("Search thoughts", style = Type.body.copy(fontSize = 16.sp), color = P.muted)
                    BasicTextField(value = q, onValueChange = { v: String -> q = v }, singleLine = true, textStyle = Type.body.copy(fontSize = 16.sp, color = P.ink), cursorBrush = SolidColor(P.accent), modifier = Modifier.fillMaxWidth())
                }
            }
        }
        if (tags.isNotEmpty()) item(key = "tags") {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                tags.forEach { (t, n) ->
                    val on = tag == t
                    Row(Modifier.clip(RoundedCornerShape(999.dp)).background(if (on) P.ink else P.surface.copy(alpha = 0.75f)).border(1.dp, P.line, RoundedCornerShape(999.dp)).clickable { tag = if (on) null else t }.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("#$t", style = Type.label.copy(fontSize = 13.sp), color = if (on) P.ground else P.ink); Spacer(Modifier.width(6.dp)); Text("$n", style = Type.label, color = if (on) P.ground.copy(alpha = .7f) else P.muted)
                    }
                }
            }
        }
        if (shown.isEmpty()) item(key = "empty") { EmptyNote(if (q.isBlank() && tag == null) "Nothing here yet." else "No matches.", if (q.isBlank() && tag == null) "Write one line. It's enough." else "Try another word.") }
        shown.groupBy { Dates.keyOf(it.createdAt) }.forEach { (day, xs) ->
            item(key = "day-$day") { Box(Modifier.padding(start = 4.dp, top = 8.dp)) { Eyebrow(Dates.fmtDateKey(day)) } }
            items(xs, key = { it.id }) { t ->
                SCard(Modifier.animateItem().testTag("thought"), onClick = { editing = t }) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(8.dp).clip(CircleShape).background(MOOD_COLORS[(t.mood - 1).coerceIn(0, 4)])); Spacer(Modifier.width(8.dp))
                        Text(t.kind.replaceFirstChar { it.uppercase() }, style = Type.small, color = P.ink2); Spacer(Modifier.width(10.dp))
                        Text(Dates.fmtTime(Instant.ofEpochMilli(t.createdAt).atZone(Dates.zone).toLocalTime().let { "%02d:%02d".format(it.hour, it.minute) }), style = Type.small, color = P.muted)
                    }
                    Spacer(Modifier.height(8.dp))
                    ThoughtBody(t.text)
                }
            }
        }
    }
    editing?.let { t -> ThoughtSheet(t) { editing = null } }
}

@Composable
fun ThoughtSheet(t: Thought, onClose: () -> Unit) {
    val c = LocalCtx.current
    var text by remember { mutableStateOf(t.text) }
    var kind by remember { mutableStateOf(t.kind) }
    var edit by remember { mutableStateOf(false) }
    SSheet(onClose, if (edit) "Edit thought" else t.kind.replaceFirstChar { it.uppercase() }) {
        androidx.compose.animation.AnimatedContent(edit, label = "th-mode") { e ->
            Column {
                if (!e) {
                    // reading view: the note laid out cleanly (math, bullets, rows); the original text is untouched
                    ThoughtBody(t.text, clamp = false)
                    Spacer(Modifier.height(18.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        PrimaryButton("Edit", Modifier.weight(1f).testTag("th-edit")) { edit = true }
                        GhostButton("Delete", Modifier.weight(1f), color = P.danger) { val prev = t.raw; c.app.store.remove("thoughts", t.id); onClose(); c.toast("Deleted.") { c.app.store.save("thoughts", prev) } }
                    }
                } else {
                    SField(text, { text = it }, "Thought", singleLine = false, minLines = 3)
                    Spacer(Modifier.height(10.dp))
                    Segmented(listOf("note" to "Note", "idea" to "Idea", "journal" to "Journal"), kind, { kind = it }, Modifier.fillMaxWidth())
                    Spacer(Modifier.height(16.dp))
                    PrimaryButton("Save", Modifier.fillMaxWidth(), enabled = text.isNotBlank()) {
                        c.app.store.save("thoughts", t.raw.with("text" to text.trim(), "tags" to JsonArray(tagsIn(text).map(::JsonPrimitive)), "kind" to kind)); onClose()
                    }
                    Spacer(Modifier.height(8.dp))
                    GhostButton("Cancel", Modifier.fillMaxWidth()) { text = t.text; kind = t.kind; edit = false }
                }
            }
        }
    }
}
