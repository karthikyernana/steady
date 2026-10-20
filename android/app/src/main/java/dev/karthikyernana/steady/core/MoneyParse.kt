package dev.karthikyernana.steady.core

import java.time.LocalDate

/** Quick money add, after js/core/money.js parseMoney: "250 lunch swiggy", "got 5000 stipend", "uber 180 yesterday". */
data class MoneyDraft(val kind: String, val amount: Double?, val category: String, val payee: String?, val note: String, val date: String)

object MoneyParse {
    val CATEGORIES = listOf("Food", "Groceries", "Transport", "Shopping", "Bills", "Rent", "Education", "Health", "Entertainment", "Family", "Other")
    val INCOME_CATEGORIES = listOf("Salary", "Freelance", "Stipend", "Gift", "Refund", "Other income")
    private fun ci(p: String) = Regex(p, RegexOption.IGNORE_CASE)
    private val KEYWORDS = listOf(
        "Food" to ci("\\b(swiggy|zomato|lunch|dinner|breakfast|food|tea|chai|coffee|snacks?|canteen|mess|biryani|tiffin|restaurant|cafe|pizza|burger|juice|meal|dosa|idli|kfc|domino'?s)\\b|భోజనం|టిఫిన్|టీ|కాఫీ|అన్నం"),
        "Groceries" to ci("\\b(grocer(y|ies)|vegetables?|veggies|fruits?|milk|blinkit|zepto|bigbasket|instamart|kirana|dmart)\\b|కూరగాయలు|పాలు|సరుకులు"),
        "Transport" to ci("\\b(auto|uber|ola|rapido|bus|train|metro|petrol|diesel|fuel|irctc|cab|taxi|flight|ticket|parking|toll)\\b|ఆటో|బస్|పెట్రోల్|రైలు"),
        "Shopping" to ci("\\b(amazon|flipkart|myntra|ajio|meesho|clothes|shirt|shoes|jeans|tshirt|t-shirt|bag|watch|headphones?|earbuds)\\b|బట్టలు"),
        "Bills" to ci("\\b(recharge|jio|airtel|vi|bsnl|electricity|current bill|wifi|broadband|bill|gas)\\b|రీఛార్జ్|కరెంట్"),
        "Rent" to ci("\\b(rent|hostel|pg)\\b|అద్దె"),
        "Education" to ci("\\b(books?|course|fees?|exam|udemy|coursera|college|tuition|notes|xerox|printout|stationery)\\b|పుస్తకాలు|ఫీజు"),
        "Health" to ci("\\b(medicines?|pharmacy|doctor|hospital|gym|clinic|tablets?)\\b|మందులు|డాక్టర్"),
        "Entertainment" to ci("\\b(movie|netflix|spotify|prime|hotstar|youtube premium|game|concert|outing)\\b|సినిమా"),
        "Family" to ci("\\b(home|amma|nanna|mom|dad|parents|sent home|family)\\b|అమ్మ|నాన్న|ఇంటికి"),
    )
    private val INCOME_KW = listOf("Salary" to ci("\\b(salary|paycheck)\\b|జీతం"), "Stipend" to ci("\\b(stipend|scholarship)\\b"),
        "Freelance" to ci("\\b(freelance|client|project|gig|invoice)\\b"), "Refund" to ci("\\b(refund|cashback)\\b"), "Gift" to ci("\\b(gift|birthday money)\\b"))
    private val PAYEES = listOf("Swiggy", "Zomato", "Uber", "Ola", "Rapido", "Amazon", "Flipkart", "Myntra", "Ajio", "Blinkit", "Zepto", "BigBasket", "Instamart", "DMart", "IRCTC", "Jio", "Airtel", "Netflix", "Spotify", "Hotstar", "Udemy", "Meesho", "KFC", "Dominos")
    private val INCOME_RE = ci("\\b(got|received|recieved|credited|earned|salary|stipend|income|paid me|refund|cashback)\\b|వచ్చింది|వచ్చాయి|జీతం")
    private val AMOUNT = ci("(?:₹|rs\\.?|inr)?\\s*(\\d+(?:,\\d{2,3})*(?:\\.\\d{1,2})?)\\s*(k|lakh|lakhs|lac)?\\b")

    fun category(text: String, kind: String, known: List<String> = emptyList()): String {
        // his own categories win when named ("300 gym" -> Gym)
        known.filter { it !in CATEGORIES && it !in INCOME_CATEGORIES && it.isNotBlank() }
            .firstOrNull { Regex("(?<![\\p{L}\\d])${Regex.escape(it.lowercase())}(?![\\p{L}\\d])").containsMatchIn(text.lowercase()) }?.let { return it }
        for ((c, re) in if (kind == "income") INCOME_KW else KEYWORDS) if (re.containsMatchIn(text)) return c
        return if (kind == "income") "Other income" else "Other"
    }
    fun payee(text: String): String? = PAYEES.firstOrNull { Regex("\\b${it.lowercase()}\\b").containsMatchIn(text.lowercase()) }

    // ---- amounts said in words: English, Telugu script, romanized Telugu (findAmount in money.js) ----
    private val EN = mapOf("one" to 1, "two" to 2, "three" to 3, "four" to 4, "five" to 5, "six" to 6, "seven" to 7, "eight" to 8, "nine" to 9, "ten" to 10, "eleven" to 11, "twelve" to 12,
        "thirteen" to 13, "fourteen" to 14, "fifteen" to 15, "sixteen" to 16, "seventeen" to 17, "eighteen" to 18, "nineteen" to 19, "twenty" to 20, "thirty" to 30, "forty" to 40,
        "fifty" to 50, "sixty" to 60, "seventy" to 70, "eighty" to 80, "ninety" to 90,
        "ఒకటి" to 1, "ఒక" to 1, "రెండు" to 2, "మూడు" to 3, "నాలుగు" to 4, "ఐదు" to 5, "అయిదు" to 5, "ఆరు" to 6, "ఏడు" to 7, "ఎనిమిది" to 8, "తొమ్మిది" to 9, "పది" to 10,
        "ఇరవై" to 20, "ముప్పై" to 30, "నలభై" to 40, "యాభై" to 50, "అరవై" to 60, "డెబ్బై" to 70, "ఎనభై" to 80, "తొంభై" to 90,
        "okati" to 1, "oka" to 1, "rendu" to 2, "moodu" to 3, "mudu" to 3, "nalugu" to 4, "aidu" to 5, "ayidu" to 5, "aaru" to 6, "aru" to 6, "edu" to 7, "enimidi" to 8, "tommidi" to 9, "padi" to 10,
        "iravai" to 20, "muppai" to 30, "nalabhai" to 40, "yabhai" to 50, "aravai" to 60, "debbai" to 70, "enabhai" to 80, "tombhai" to 90)
    private val MULT = mapOf("hundred" to 100, "thousand" to 1000, "lakh" to 100000, "lakhs" to 100000, "lac" to 100000,
        "వంద" to 100, "వందలు" to 100, "వందల" to 100, "నూరు" to 100, "వెయ్యి" to 1000, "వేలు" to 1000, "వేల" to 1000, "లక్ష" to 100000, "లక్షలు" to 100000, "లక్షల" to 100000,
        "vanda" to 100, "vandalu" to 100, "vandala" to 100, "veyyi" to 1000, "velu" to 1000, "vela" to 1000, "laksha" to 100000, "lakshalu" to 100000)

    /** "two thousand five hundred", "ఐదు వందలు", "rendu velu aidu vandalu" -> value and the words it used, or null. */
    fun wordsAmount(text: String): Pair<Double, String>? {
        val toks = text.split(Regex("\\s+")).filter { it.isNotEmpty() }
        for (i in toks.indices) {
            var total = 0L; var cur = 0L; var any = false; var k = i
            while (k < toks.size) {
                val t = toks[k].lowercase().trimEnd('.', ',', '!', '?')
                when {
                    t == "and" && any -> {}
                    (t == "a" || t == "an") && MULT.containsKey(toks.getOrNull(k + 1)?.lowercase()) -> { cur += 1; any = true }
                    EN[t] != null -> { cur += EN[t]!!; any = true }
                    MULT[t] != null -> { val m = MULT[t]!!; if (!any && m >= 1000) break; cur = (if (cur == 0L) 1 else cur) * m; if (m >= 1000) { total += cur; cur = 0 }; any = true }
                    else -> break
                }
                k++
            }
            if (any && total + cur > 0) return (total + cur).toDouble() to toks.subList(i, k).joinToString(" ")
        }
        return null
    }

    fun parse(input: String, today: LocalDate = Dates.today(), known: List<String> = emptyList()): MoneyDraft {
        val text = input.trim()
        var kind = if (INCOME_RE.containsMatchIn(text) && !ci("\\b(spent|paid|bought)\\b").containsMatchIn(text)) "income" else "expense"
        var rest = text; var date = today
        ci("\\b(day before yesterday|yesterday|today)\\b|నిన్న|ఈరోజు|ఇవాళ|ninna|ivala|eeroju").find(rest)?.let { m ->
            val w = m.value.lowercase()
            date = when { "day before" in w -> today.minusDays(2); w == "yesterday" || w == "నిన్న" || w == "ninna" -> today.minusDays(1); else -> today }
            rest = rest.replaceRange(m.range, " ")
        }
        var amount: Double? = null
        AMOUNT.find(rest)?.let { m ->
            val base = m.groupValues[1].replace(",", "").toDoubleOrNull()
            if (base != null) {
                amount = base * when (m.groupValues[2].lowercase()) { "k" -> 1000.0; "lakh", "lakhs", "lac" -> 100000.0; else -> 1.0 }
                rest = rest.replaceRange(m.range, " ")
            }
        }
        if (amount == null) wordsAmount(rest)?.let { (v, used) -> amount = v; rest = rest.replaceFirst(used, " ") }
        val p = payee(text)
        val cat = category(text, kind, known)
        var note = rest.replace(ci("\\b(spent|spend|paid|pay|bought|on|for|rs|inr|rupees?|got|received|credited|from|to|the|a|an|i|my|at|today|via|by|upi|cash)\\b|₹"), " ")
        if (p != null) note = note.replace(ci("\\b${Regex.escape(p)}\\b"), " ")
        note = note.replace(Regex("\\s+"), " ").trim()
        note = if (note.isNotEmpty()) note.substring(0, 1).uppercase() + note.substring(1) else (p ?: "")
        return MoneyDraft(kind, amount?.let { Math.round(it * 100) / 100.0 }, cat, p, note, date.toString())
    }
}
