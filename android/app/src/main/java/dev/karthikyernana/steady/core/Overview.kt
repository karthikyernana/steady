package dev.karthikyernana.steady.core

import dev.karthikyernana.steady.agent.fmtAmount
import dev.karthikyernana.steady.data.Snapshot
import java.time.LocalDate

/**
 * Everything the Insights page shows besides task patterns, computed in ONE pass per collection (O(n) total,
 * no per-day rescans), so it stays instant with years of data. Pure: same snapshot + date → same numbers.
 */
data class Overview(
    val doneWeek: Int, val doneLastWeek: Int,
    val goals: List<GoalStat>, val msDone: Int, val msTotal: Int,
    val spentWeek: Double, val spentLastWeek: Double, val spentMonth: Double, val spentLastMonthSameDay: Double,
    val cats: List<Pair<String, Double>>,
    val thoughtsMonth: Int, val topTags: List<Pair<String, Int>>, val moodAvg: Double?,
) {
    data class GoalStat(val id: String, val title: String, val done: Int, val total: Int, val tasksWeek: Int)

    companion object {
        fun of(s: Snapshot, today: LocalDate = Dates.today()): Overview {
            val ws = Dates.weekStart(today); val wsK = ws.toString(); val lwsK = ws.minusWeeks(1).toString()
            val ms = today.withDayOfMonth(1).toString()
            val lm = today.minusMonths(1); val lmStart = lm.withDayOfMonth(1).toString()
            val lmSameDay = lm.withDayOfMonth(minOf(today.dayOfMonth, lm.lengthOfMonth())).toString()
            val todayK = today.toString(); val d30 = today.minusDays(29).toString()

            var doneWeek = 0; var doneLast = 0
            val goalWeek = HashMap<String, Int>()
            for (t in s.tasks) {
                val at = t.doneAt ?: continue; if (!t.isDone) continue
                val k = Dates.keyOf(at)
                if (k in wsK..todayK) { doneWeek++; t.goalId?.let { goalWeek[it] = (goalWeek[it] ?: 0) + 1 } }
                else if (k >= lwsK && k < wsK) doneLast++
            }
            val goals = s.goals.filter { it.raw["archived"]?.toString() != "true" }.map { g ->
                val m = g.milestones; GoalStat(g.id, g.title, m.count { it.done }, m.size, goalWeek[g.id] ?: 0)
            }
            var sw = 0.0; var slw = 0.0; var sm = 0.0; var slm = 0.0
            val cat = HashMap<String, Double>()
            for (x in s.money) {
                if (x.isIncome) continue; val d = x.date; val v = x.amount
                if (d in wsK..todayK) sw += v else if (d >= lwsK && d < wsK) slw += v
                if (d in ms..todayK) { sm += v; cat[x.category] = (cat[x.category] ?: 0.0) + v }
                else if (d in lmStart..lmSameDay) slm += v
            }
            var th = 0; var moodSum = 0; val tagN = HashMap<String, Int>()
            for (t in s.thoughts) {
                if (Dates.keyOf(t.createdAt) < d30) continue
                th++; moodSum += t.mood; for (tg in t.tags) tagN[tg] = (tagN[tg] ?: 0) + 1
            }
            return Overview(doneWeek, doneLast, goals, goals.sumOf { it.done }, goals.sumOf { it.total }, sw, slw, sm, slm,
                cat.entries.sortedByDescending { it.value }.take(4).map { it.key to it.value },
                th, tagN.entries.sortedByDescending { it.value }.take(6).map { it.key to it.value }, if (th > 0) moodSum.toDouble() / th else null)
        }

        /** "+2 vs last week" / "same as last week". */
        fun vs(diff: Int, what: String): String = when { diff > 0 -> "+$diff vs $what"; diff < 0 -> "−${-diff} vs $what"; else -> "same as $what" }
        fun vsMoney(diff: Double, what: String = "last week"): String? = when {
            Math.abs(diff) < 1 -> "same as $what"; diff > 0 -> "₹${fmtAmount(diff)} more than $what"; else -> "₹${fmtAmount(-diff)} less than $what"
        }
    }
}
