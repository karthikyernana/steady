package dev.karthikyernana.steady.ui.screens

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.karthikyernana.steady.agent.fmtAmount
import dev.karthikyernana.steady.core.Dates
import dev.karthikyernana.steady.core.MoneyParse
import dev.karthikyernana.steady.data.*
import dev.karthikyernana.steady.ui.*
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.YearMonth
import java.time.format.TextStyle
import java.util.Locale

fun inr(v: Double, sign: Boolean = false) = (if (sign && v > 0) "+" else "") + (if (v < 0) "−₹" else "₹") + fmtAmount(Math.abs(v))

/** One calm sentence about the month, exactly as moneyLine() in js/core/money.js. Never scolds. */
fun moneyLine(all: List<Money>, mk: String, budget: Double?): String {
    val ym = YearMonth.parse(mk); val prevMk = ym.minusMonths(1).toString()
    val xs = all.filter { it.date.startsWith(mk) }; val prev = all.filter { it.date.startsWith(prevMk) }
    val spent = xs.filter { !it.isIncome }.sumOf { it.amount }; val income = xs.filter { it.isIncome }.sumOf { it.amount }
    if (xs.isEmpty()) return if (prev.isNotEmpty()) "Nothing logged for this month yet. Last month you spent ${inr(prev.filter { !it.isIncome }.sumOf { it.amount })}." else "Log what comes in and goes out."
    val parts = mutableListOf("${inr(spent)} spent"); if (income > 0) parts += "${inr(income)} in"
    val cats = xs.filter { !it.isIncome }.groupBy { it.category }.mapValues { (_, v) -> v.sumOf { it.amount } }.entries.sortedByDescending { it.value }
    val today = Dates.today()
    var tail = ""
    if (budget != null && budget > 0) { val left = budget - spent; tail = if (left >= 0) " ${inr(left)} left in your budget." else " ${inr(-left)} over budget. It happens; next week is a fresh start." }
    else if (cats.isNotEmpty() && spent > 0 && cats[0].value / spent >= 0.35 && xs.size >= 4) tail = " Most of it went to ${cats[0].key.lowercase()}."
    else if (mk == YearMonth.from(today).toString()) {
        val prevSame = prev.filter { !it.isIncome && (it.date.takeLast(2).toIntOrNull() ?: 99) <= today.dayOfMonth }.sumOf { it.amount }
        if (prevSame > 0) { val d = spent - prevSame; tail = if (Math.abs(d) < prevSame * 0.1) " About the same as last month so far." else if (d < 0) " ${inr(-d)} less than last month by this day." else " ${inr(d)} more than last month by this day." }
    }
    return parts.joinToString(", ") + "." + tail
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun MoneyScreen() {
    val c = LocalCtx.current
    var month by rememberSaveable { mutableStateOf(YearMonth.now(Dates.zone).toString()) }
    var editing by remember { mutableStateOf<Money?>(null) }
    var budgetOpen by remember { mutableStateOf(false) }
    var quick by rememberSaveable { mutableStateOf("") }
    val mk = month
    val ym = YearMonth.parse(mk)
    val isNow = ym >= YearMonth.now(Dates.zone)
    val entries = c.snap.money.filter { it.date.startsWith(mk) }
    val spent = entries.filter { !it.isIncome }.sumOf { it.amount }
    val income = entries.filter { it.isIncome }.sumOf { it.amount }
    val dayN = if (isNow) Dates.today().dayOfMonth else ym.lengthOfMonth()
    val byCat = entries.filter { !it.isIncome }.groupBy { it.category }.mapValues { (_, v) -> v.sumOf { it.amount } }.entries.sortedByDescending { it.value }
    val budget = c.snap.meta("budgets").num("total")
    val draft = remember(quick) { if (quick.isBlank()) null else MoneyParse.parse(quick) }

    LazyColumn(Modifier.fillMaxSize().testTag("money"), contentPadding = PaddingValues(start = 18.dp, end = 18.dp, top = 6.dp, bottom = 170.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item(key = "head") { PageHead("MONEY", "Where it ", "goes", ".", moneyLine(c.snap.money, mk, budget), subTag = "money-sub") }
        item(key = "composer") {
            SCard(pad = 0.dp, shape = RoundedCornerShape(22.dp)) {
                Row(Modifier.padding(start = 14.dp, end = 6.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Rounded.Add, null, tint = P.muted); Spacer(Modifier.width(8.dp))
                    Box(Modifier.weight(1f).padding(vertical = 12.dp)) {
                        if (quick.isEmpty()) Text("Add… e.g. 250 lunch swiggy", style = Type.body.copy(fontSize = 16.sp), color = P.muted, maxLines = 1)
                        androidx.compose.foundation.text.BasicTextField(value = quick, onValueChange = { v: String -> quick = v }, textStyle = Type.body.copy(fontSize = 16.sp, color = P.ink), singleLine = true,
                            cursorBrush = androidx.compose.ui.graphics.SolidColor(P.accent), modifier = Modifier.fillMaxWidth().testTag("money-quick-inline"),
                            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Done),
                            keyboardActions = androidx.compose.foundation.text.KeyboardActions(onDone = { if (draft?.amount != null) { saveDraft(c, draft); quick = "" } }))
                    }
                    Button(onClick = { if (draft?.amount != null) { saveDraft(c, draft); quick = "" } }, enabled = draft?.amount != null, shape = RoundedCornerShape(999.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = P.ink, contentColor = P.ground), modifier = Modifier.testTag("money-add")) { Text("Add", style = Type.bodyM) }
                }
                if (draft != null) Row(Modifier.padding(start = 14.dp, end = 14.dp, bottom = 12.dp).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (draft.amount != null) Pill(inr(draft.amount, sign = draft.kind == "income"), color = P.accent, bg = P.accentSoft) else Pill("Add an amount", color = P.warn, bg = P.surface2)
                    Pill(draft.category, color = P.accent, bg = P.accentSoft)
                    draft.payee?.let { Pill(it, color = P.accent, bg = P.accentSoft) }
                    if (draft.date != Dates.todayKey()) Pill(Dates.fmtDateKey(draft.date), color = P.accent, bg = P.accentSoft)
                }
            }
        }
        item(key = "month-nav") {
            Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { month = ym.minusMonths(1).toString() }) { Icon(Icons.AutoMirrored.Rounded.KeyboardArrowLeft, "Previous month", tint = P.ink2) }
                Text("${ym.month.getDisplayName(TextStyle.FULL, Locale.ENGLISH)} ${ym.year}", style = Type.h2, color = P.ink, modifier = Modifier.weight(1f).testTag("money-month"), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                IconButton(onClick = { month = ym.plusMonths(1).toString() }, enabled = !isNow) { Icon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, "Next month", tint = if (!isNow) P.ink2 else P.line2) }
            }
        }
        item(key = "stats") {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Stat(inr(spent), "spent", Modifier.weight(1f), tag = "money-spent"); Stat(inr(income), "came in", Modifier.weight(1f), accent = true)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Stat(inr(income - spent), "net", Modifier.weight(1f)); Stat(inr(Math.round(if (dayN > 0) spent / dayN else 0.0).toDouble()), "a day on average", Modifier.weight(1f))
                }
            }
        }
        item(key = "cats") {
            SCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("By category", style = Type.bodyM.copy(fontSize = 16.sp), color = P.ink, modifier = Modifier.weight(1f))
                    TextButton(onClick = { budgetOpen = true }, contentPadding = PaddingValues(horizontal = 6.dp)) { Text(if (budget != null && budget > 0) "Budget ${inr(budget)}" else "Set a budget", style = Type.label.copy(textDecoration = androidx.compose.ui.text.style.TextDecoration.Underline), color = P.accent) }
                }
                if (byCat.isEmpty()) Text("Nothing spent this month.", style = Type.small, color = P.muted)
                byCat.take(10).forEach { (cat, v) ->
                    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(cat, style = Type.body.copy(fontSize = 16.sp), color = P.ink, modifier = Modifier.weight(1f))
                            Text(inr(v), style = Type.bodyM, color = P.ink); Spacer(Modifier.width(6.dp))
                            Text("${Math.round(v / spent * 100)}%", style = Type.small, color = P.muted, modifier = Modifier.widthIn(min = 34.dp), textAlign = androidx.compose.ui.text.style.TextAlign.End)
                        }
                        Spacer(Modifier.height(6.dp))
                        Box(Modifier.fillMaxWidth().height(4.dp).clip(RoundedCornerShape(2.dp)).background(P.line)) {
                            Box(Modifier.fillMaxWidth((v / byCat.first().value).toFloat().coerceIn(0.02f, 1f)).fillMaxHeight().clip(RoundedCornerShape(2.dp)).background(P.accent))
                        }
                    }
                }
            }
        }
        if (entries.isEmpty()) item(key = "empty") { EmptyNote("Nothing logged this month.", "Type \"250 lunch swiggy\" above, or just say it to the mic.") }
        entries.groupBy { it.date }.toSortedMap(compareByDescending { it }).forEach { (day, xs) ->
            item(key = "d-$day") { Row(Modifier.padding(start = 4.dp, end = 4.dp, top = 10.dp)) { Eyebrow(Dates.fmtDateKey(day)); Spacer(Modifier.weight(1f)); Text(inr(xs.filter { !it.isIncome }.sumOf { it.amount }), style = Type.small, color = P.muted) } }
            items(xs, key = { it.id }) { m ->
                SCard(Modifier.animateItem().testTag("money-row"), pad = 14.dp, shape = RoundedCornerShape(16.dp), onClick = { editing = m }) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(m.note.ifBlank { m.payee ?: m.category }, style = Type.bodyM.copy(fontSize = 16.sp), color = P.ink)
                            Text(listOfNotNull(m.category, m.payee?.takeIf { it != m.note }).joinToString(" · "), style = Type.small, color = P.muted)
                        }
                        Text(if (m.isIncome) inr(m.amount, sign = true) else inr(m.amount), style = Type.h3, color = if (m.isIncome) P.accent else P.ink)
                    }
                }
            }
        }
    }
    editing?.let { MoneySheet(it) { editing = null } }
    if (budgetOpen) BudgetSheet(budget) { budgetOpen = false }
}

private fun saveDraft(c: Ctx, d: dev.karthikyernana.steady.core.MoneyDraft) {
    val rec = c.app.store.save("money", buildJsonObject {
        put("id", uid()); put("kind", d.kind); put("amount", d.amount ?: 0.0); put("category", d.category); put("payee", d.payee); put("note", d.note); put("date", d.date); put("source", "manual")
    })
    c.toast("${if (d.kind == "income") "Income" else "Expense"} logged · ${inr(d.amount ?: 0.0)}") { c.app.store.remove("money", rec.str("id")!!) }
}

@Composable
private fun Stat(value: String, label: String, modifier: Modifier = Modifier, accent: Boolean = false, tag: String? = null) {
    SCard(modifier, pad = 16.dp) {
        Text(value, style = Type.h2.copy(fontSize = 24.sp), color = if (accent) P.accent else P.ink, maxLines = 1, modifier = if (tag != null) Modifier.testTag(tag) else Modifier)
        Text(label, style = Type.small, color = P.muted)
    }
}

@Composable
private fun BudgetSheet(current: Double?, onClose: () -> Unit) {
    val c = LocalCtx.current
    var v by remember { mutableStateOf(current?.let { fmtAmount(it).replace(",", "") } ?: "") }
    SSheet(onClose, "Monthly budget") {
        Text("One number for all spending in a month. Steady tells you what's left, never scolds.", style = Type.small, color = P.muted)
        Spacer(Modifier.height(10.dp))
        SField(v, { x -> v = x.filter { it.isDigit() }.take(9) }, "Budget (₹)", keyboard = KeyboardType.Number)
        Spacer(Modifier.height(14.dp))
        PrimaryButton("Save", Modifier.fillMaxWidth()) { c.app.store.setMeta("budgets", "total" to (v.toDoubleOrNull()?.takeIf { it > 0 })); onClose() }
        if (current != null) { Spacer(Modifier.height(8.dp)); GhostButton("Remove budget", Modifier.fillMaxWidth()) { c.app.store.setMeta("budgets", "total" to null); onClose() } }
    }
}

@Composable
fun MoneySheet(m: Money?, onClose: () -> Unit) {
    val c = LocalCtx.current
    var quick by remember { mutableStateOf("") }
    var kind by remember { mutableStateOf(m?.kind ?: "expense") }
    var amount by remember { mutableStateOf(m?.amount?.let { fmtAmount(it).replace(",", "") } ?: "") }
    var category by remember { mutableStateOf(m?.category ?: "Other") }
    var payee by remember { mutableStateOf(m?.payee ?: "") }
    var note by remember { mutableStateOf(m?.note ?: "") }
    var date by remember { mutableStateOf(m?.date ?: Dates.todayKey()) }
    SSheet(onClose, if (m == null) "Add money" else "Edit") {
        if (m == null) {
            SField(quick, { v ->
                quick = v
                val d = MoneyParse.parse(v)
                kind = d.kind; d.amount?.let { amount = fmtAmount(it).replace(",", "") }; category = d.category; payee = d.payee ?: ""; note = d.note; date = d.date
            }, "Type it: 250 lunch swiggy", testTag = "money-quick")
            Spacer(Modifier.height(12.dp))
        }
        Segmented(listOf("expense" to "Spent", "income" to "Income"), kind, { kind = it; if (it == "income" && category !in MoneyParse.INCOME_CATEGORIES) category = "Other income"; if (it == "expense" && category in MoneyParse.INCOME_CATEGORIES) category = "Other" }, Modifier.fillMaxWidth())
        Spacer(Modifier.height(10.dp))
        SField(amount, { v -> amount = v.filter { it.isDigit() || it == '.' }.take(10) }, "Amount (₹)", keyboard = KeyboardType.Decimal, testTag = "money-amount")
        Spacer(Modifier.height(10.dp))
        val known = (if (kind == "income") MoneyParse.INCOME_CATEGORIES else MoneyParse.CATEGORIES) + c.snap.money.map { it.category }
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            known.distinct().forEach { k ->
                val on = k == category
                Text(k, style = Type.label, color = if (on) P.accentInk else P.ink2, modifier = Modifier.clip(RoundedCornerShape(999.dp)).background(if (on) P.accent else P.surface2).clickable { category = k }.padding(horizontal = 12.dp, vertical = 8.dp))
            }
        }
        Spacer(Modifier.height(10.dp))
        SField(note, { note = it }, "Note")
        Spacer(Modifier.height(8.dp))
        SField(payee, { payee = it }, "Paid to / from (optional)")
        DateField("Date", date, { if (it != null) date = it })
        Spacer(Modifier.height(16.dp))
        val amt = amount.toDoubleOrNull()
        PrimaryButton("Save", Modifier.fillMaxWidth().testTag("money-save"), enabled = amt != null && amt > 0) {
            val base = m?.raw ?: buildJsonObject { put("id", uid()); put("source", "manual") }
            c.app.store.save("money", base.with("kind" to kind, "amount" to Math.round(amt!! * 100) / 100.0, "category" to category, "payee" to payee.trim().ifBlank { null }, "note" to note.trim(), "date" to date))
            onClose(); c.toast(if (kind == "income") "Income logged." else "Expense logged.", null)
        }
        if (m != null) { Spacer(Modifier.height(8.dp)); GhostButton("Delete", Modifier.fillMaxWidth(), color = P.danger) { val prev = m.raw; c.app.store.remove("money", m.id); onClose(); c.toast("Deleted.") { c.app.store.save("money", prev) } } }
    }
}
