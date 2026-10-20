package dev.karthikyernana.steady

import dev.karthikyernana.steady.agent.fmtAmount
import dev.karthikyernana.steady.core.MoneyParse
import dev.karthikyernana.steady.data.tagsIn
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate

class MoneyParseTest {
    private val today = LocalDate.of(2026, 10, 16)
    @Test fun expense() { val r = MoneyParse.parse("250 lunch swiggy", today); assertEquals(250.0, r.amount); assertEquals("Food", r.category); assertEquals("Swiggy", r.payee); assertEquals("expense", r.kind); assertEquals("Lunch", r.note) }
    @Test fun income() { val r = MoneyParse.parse("got 5000 stipend", today); assertEquals("income", r.kind); assertEquals(5000.0, r.amount); assertEquals("Stipend", r.category) }
    @Test fun yesterday() { val r = MoneyParse.parse("uber 180 yesterday", today); assertEquals("2026-10-15", r.date); assertEquals("Transport", r.category); assertEquals(180.0, r.amount) }
    @Test fun thousands() { assertEquals(2500.0, MoneyParse.parse("2.5k rent", today).amount); assertEquals(1500.0, MoneyParse.parse("₹1,500 books", today).amount) }
    @Test fun indianGrouping() { assertEquals("1,23,456", fmtAmount(123456.0)); assertEquals("999", fmtAmount(999.0)); assertEquals("12,345.50", fmtAmount(12345.5)) }
    @Test fun tags() { assertEquals(listOf("work", "ఆలోచన"), tagsIn("idea #work and #ఆలోచన but not C# or a#b")) }
    @Test fun amountsInWords() {
        assertEquals(500.0, MoneyParse.parse("five hundred for lunch", today).amount)
        assertEquals(2550.0, MoneyParse.parse("paid two thousand five hundred and fifty rent", today).amount)
        assertEquals(500.0, MoneyParse.parse("ఐదు వందలు టీ", today).amount)
        assertEquals(2500.0, MoneyParse.parse("rendu velu aidu vandalu shopping", today).amount)
        assertEquals("Lunch", MoneyParse.parse("five hundred for lunch", today).note)
        org.junit.Assert.assertNull(MoneyParse.parse("thousand thanks", today).amount)
    }
    @Test fun customCategoryWins() {
        assertEquals("Gym", MoneyParse.parse("1200 gym fees", today, known = listOf("Gym", "Food")).category)
        assertEquals("Food", MoneyParse.parse("250 lunch", today, known = listOf("Gym")).category)
    }
}
