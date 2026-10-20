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

    fun category(text: String, kind: String): String {
        for ((c, re) in if (kind == "income") INCOME_KW else KEYWORDS) if (re.containsMatchIn(text)) return c
        return if (kind == "income") "Other income" else "Other"
    }
    fun payee(text: String): String? = PAYEES.firstOrNull { Regex("\\b${it.lowercase()}\\b").containsMatchIn(text.lowercase()) }

    fun parse(input: String, today: LocalDate = Dates.today()): MoneyDraft {
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
        val p = payee(text)
        val cat = category(text, kind)
        var note = rest.replace(ci("\\b(spent|spend|paid|pay|bought|on|for|rs|inr|rupees?|got|received|credited|from|to|the|a|an|i|my|at|today|via|by|upi|cash)\\b|₹"), " ")
        if (p != null) note = note.replace(ci("\\b${Regex.escape(p)}\\b"), " ")
        note = note.replace(Regex("\\s+"), " ").trim()
        note = if (note.isNotEmpty()) note.substring(0, 1).uppercase() + note.substring(1) else (p ?: "")
        return MoneyDraft(kind, amount?.let { Math.round(it * 100) / 100.0 }, cat, p, note, date.toString())
    }
}
