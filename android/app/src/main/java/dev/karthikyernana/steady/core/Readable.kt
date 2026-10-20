package dev.karthikyernana.steady.core

/**
 * Turns text pasted from AI chats into something readable on a phone, without changing what is stored:
 * LaTeX math (\( N \le 10^{5} \), $O(n^2)$) becomes plain math (N ≤ 10⁵, O(n²)), markdown markers are reduced
 * to their meaning (bullets, headings, bold), and pipe tables become one readable line per row.
 * Pure function: the saved thought keeps its original text, so nothing is lost and edits stay exact.
 */
object Readable {
    enum class Kind { TEXT, HEADING, BULLET, ROW }
    data class Line(val kind: Kind, val text: String, val bold: List<IntRange> = emptyList())

    private val SYMBOLS = linkedMapOf(
        "\\leq" to "≤", "\\geq" to "≥", "\\le" to "≤", "\\ge" to "≥", "\\neq" to "≠", "\\ne" to "≠", "\\cdot" to "·", "\\times" to "×",
        "\\div" to "÷", "\\pm" to "±", "\\approx" to "≈", "\\infty" to "∞", "\\to" to "→", "\\rightarrow" to "→", "\\leftarrow" to "←",
        "\\Rightarrow" to "⇒", "\\log" to "log", "\\ln" to "ln", "\\sqrt" to "√", "\\sum" to "Σ", "\\alpha" to "α", "\\beta" to "β",
        "\\theta" to "θ", "\\lambda" to "λ", "\\mu" to "μ", "\\pi" to "π", "\\sigma" to "σ", "\\Delta" to "Δ", "\\ldots" to "…", "\\dots" to "…",
        "\\cdots" to "⋯", "\\in" to "∈", "\\lfloor" to "⌊", "\\rfloor" to "⌋", "\\lceil" to "⌈", "\\rceil" to "⌉", "\\%" to "%", "\\," to " ", "\\;" to " ", "\\!" to "",
    )
    private val SUP = mapOf('0' to '⁰', '1' to '¹', '2' to '²', '3' to '³', '4' to '⁴', '5' to '⁵', '6' to '⁶', '7' to '⁷', '8' to '⁸', '9' to '⁹',
        '+' to '⁺', '-' to '⁻', 'n' to 'ⁿ', 'i' to 'ⁱ', 'k' to 'ᵏ', 'N' to 'ᴺ', 'x' to 'ˣ', 'm' to 'ᵐ', '(' to '⁽', ')' to '⁾')
    private val SUB = mapOf('0' to '₀', '1' to '₁', '2' to '₂', '3' to '₃', '4' to '₄', '5' to '₅', '6' to '₆', '7' to '₇', '8' to '₈', '9' to '₉',
        'i' to 'ᵢ', 'j' to 'ⱼ', 'k' to 'ₖ', 'n' to 'ₙ', 'm' to 'ₘ', 'x' to 'ₓ', '+' to '₊', '-' to '₋')

    private fun script(s: String, map: Map<Char, Char>, mark: String): String =
        if (s.all { it in map }) s.map { map.getValue(it) }.joinToString("") else "$mark($s)"

    /** One piece of math, without its delimiters. */
    fun math(src: String): String {
        var s = src
        s = Regex("""\\(?:text|mathrm|mathbf|mathit|operatorname)\{([^{}]*)\}""").replace(s) { it.groupValues[1] }
        s = Regex("""\\frac\{([^{}]*)\}\{([^{}]*)\}""").replace(s) { "${it.groupValues[1]}/${it.groupValues[2]}" }
        s = Regex("""\\sqrt\{([^{}]*)\}""").replace(s) { "√(${it.groupValues[1]})" }
        for ((k, v) in SYMBOLS) s = Regex(Regex.escape(k) + "(?![A-Za-z])").replace(s, Regex.escapeReplacement(v))
        s = Regex("""\^\{([^{}]*)\}""").replace(s) { script(it.groupValues[1].trim(), SUP, "^") }
        s = Regex("""\^([0-9A-Za-z+\-])""").replace(s) { script(it.groupValues[1], SUP, "^") }
        s = Regex("""_\{([^{}]*)\}""").replace(s) { script(it.groupValues[1].trim(), SUB, "_") }
        s = Regex("""_([0-9a-z])""").replace(s) { script(it.groupValues[1], SUB, "_") }
        s = s.replace("\\{", "{").replace("\\}", "}").replace(Regex("""\\([A-Za-z]+)"""), "$1")
        return s.replace(Regex("""[ \t]{2,}"""), " ").trim()
    }

    /** Replace every math span in running text. */
    fun inline(src: String): String {
        var s = src
        s = Regex("""\\\((.+?)\\\)""", RegexOption.DOT_MATCHES_ALL).replace(s) { math(it.groupValues[1]) }
        s = Regex("""\\\[(.+?)\\\]""", RegexOption.DOT_MATCHES_ALL).replace(s) { math(it.groupValues[1]) }
        s = Regex("""\$\$(.+?)\$\$""", RegexOption.DOT_MATCHES_ALL).replace(s) { math(it.groupValues[1]) }
        // $…$ only when it clearly is math (has a backslash, ^ or _), so "₹500 and $20" stays untouched
        s = Regex("""(?<![\w$])\$([^$\n]{1,120}?)\$(?![\w$])""").replace(s) { m -> if (Regex("""[\\^_]""").containsMatchIn(m.groupValues[1])) math(m.groupValues[1]) else m.value }
        s = s.replace(Regex("""`([^`\n]+)`"""), "$1")
        return s
    }

    private fun boldSpans(src: String): Pair<String, List<IntRange>> {
        val out = StringBuilder(); val spans = mutableListOf<IntRange>(); var i = 0
        val rx = Regex("""\*\*(.+?)\*\*|__(.+?)__""")
        for (m in rx.findAll(src)) {
            out.append(src, i, m.range.first)
            val inner = m.groupValues[1].ifEmpty { m.groupValues[2] }
            val st = out.length; out.append(inner); spans += st until out.length
            i = m.range.last + 1
        }
        out.append(src.substring(i))
        // single *emphasis* → plain words
        return out.toString().replace(Regex("""(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])"""), "$1") to spans
    }

    fun lines(text: String): List<Line> {
        val out = mutableListOf<Line>()
        var blank = false
        for (raw0 in inline(text).replace("\r", "").split('\n')) {
            val raw = raw0.trimEnd()
            if (raw.isBlank()) { if (!blank && out.isNotEmpty()) out += Line(Kind.TEXT, ""); blank = true; continue }
            blank = false
            val t = raw.trim()
            if (Regex("""^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$""").matches(t)) continue        // table separator |---|---|
            if (Regex("""^(-{3,}|\*{3,}|_{3,})$""").matches(t)) continue                                   // horizontal rule
            val kind: Kind; var body: String
            when {
                raw.contains('\t') -> { kind = Kind.ROW; body = raw.split('\t').map { it.trim() }.filter { it.isNotEmpty() }.joinToString("  ·  ") }
                Regex("""^\d{1,2}[.)]\s+\S""").containsMatchIn(t) && t.length <= 80 && !t.endsWith(".") && !t.endsWith(":") -> { kind = Kind.HEADING; body = t }
                t.startsWith("|") && t.count { it == '|' } >= 2 -> { kind = Kind.ROW; body = t.trim('|').split('|').map { it.trim() }.filter { it.isNotEmpty() }.joinToString("  ·  ") }
                Regex("""^#{1,6}\s+""").containsMatchIn(t) -> { kind = Kind.HEADING; body = t.replace(Regex("""^#{1,6}\s+"""), "") }
                Regex("""^[-*+•]\s+""").containsMatchIn(t) -> { kind = Kind.BULLET; body = t.replace(Regex("""^[-*+•]\s+"""), "") }
                else -> { kind = Kind.TEXT; body = t }
            }
            val (plain, bold) = boldSpans(body)
            out += Line(kind, plain, bold)
        }
        while (out.lastOrNull()?.text == "") out.removeAt(out.lastIndex)
        return out
    }

    /** True when the text needs the reader treatment at all (cheap check, keeps short notes on the fast path). */
    fun fancy(text: String) = text.contains('\\') || text.contains("**") || text.contains('|') || text.contains("\n#") || text.startsWith("#") ||
        text.contains("\n- ") || text.contains("\n* ") || text.contains('$') || text.contains('`') || text.contains('\t') || text.length > 300
}
