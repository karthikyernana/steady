package dev.karthikyernana.steady

import dev.karthikyernana.steady.core.Readable
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class ReadableTest {
    @Test fun latexBecomesPlainMath() {
        assertEquals("N ≤ 10", Readable.inline("\\(N \\le 10\\)"))
        assertEquals("O(2ᴺ · N)", Readable.inline("\\(O(2^N \\cdot N)\\)"))
        assertEquals("around 10⁸ operations", Readable.inline("around \\(10^{8}\\) operations"))
        assertEquals("O(N log N) or O(N)", Readable.inline("\\(O(N \\log N)\\) or \\(O(N)\\)"))
        assertEquals("N ≤ 5,000", Readable.inline("\\(N \\le 5,000\\)"))
        assertEquals("a/b and xᵢ", Readable.inline("\\(\\frac{a}{b}\\) and \\(x_i\\)"))
        assertEquals("O(n²)", Readable.inline("\$O(n^2)\$"))
    }
    @Test fun moneyDollarsAreNotMath() {
        assertEquals("paid \$20 and \$30 today", Readable.inline("paid \$20 and \$30 today"))
        assertFalse(Readable.fancy("spent 500 on lunch #food"))
    }
    @Test fun markdownAndTables() {
        val ls = Readable.lines("## Limits\n| Input | Time |\n|---|---|\n| \\(N \\le 20\\) | \\(O(2^N)\\) |\n- **Bitmask** DP\n\nDone")
        assertEquals(Readable.Kind.HEADING, ls[0].kind); assertEquals("Limits", ls[0].text)
        assertEquals("Input  ·  Time", ls[1].text)
        assertEquals("N ≤ 20  ·  O(2ᴺ)", ls[2].text)
        assertEquals(Readable.Kind.BULLET, ls[3].kind); assertEquals("Bitmask DP", ls[3].text); assertEquals(0 until 7, ls[3].bold[0])
        assertEquals("", ls[4].text); assertEquals("Done", ls[5].text)
    }
    @Test fun tabTablesAndNumberedHeadings() {
        val ls = Readable.lines("1. The Input Constraint Trick (The Golden Rule)\n\nInput Size\tExpected\n\\(N \\le 10\\)\t\\(O(N!)\\)")
        assertEquals(Readable.Kind.HEADING, ls[0].kind)
        assertEquals("Input Size  ·  Expected", ls[2].text)
        assertEquals("N ≤ 10  ·  O(N!)", ls[3].text)
    }
}
