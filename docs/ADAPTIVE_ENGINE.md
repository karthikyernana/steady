# Adaptive engine

Rule-based, on-device, explainable. Code: `js/core/engine.js` (pure), thresholds in `RULES`; copy in `js/core/voice.js`. Unit tests: `tests/unit/engine.test.mjs`.

Inputs are live records only. "Completion" = task with `status: done` and `doneAt`. Days are local calendar days. "Planned" for a day = tasks whose `dueDate` is that day (done, skipped or open).

## Signals
| Signal | Rule | Threshold (`RULES`) |
| --- | --- | --- |
| **Enough data** | Patterns are claimed only after N completions; before that the panel says it is still learning. | `MIN_DATA = 6` |
| **Best window** | Hour histogram of completions (last 60 days); best sliding 2-hour window. Stated only if it holds ≥ 25 % of completions. | `HOUR_LOOKBACK_DAYS = 60`, `HOUR_WINDOW = 2`, `WINDOW_MIN_SHARE = 0.25` |
| **Weekday strength** | done / planned per weekday over the last 8 weeks (today excluded), weekdays with ≥ 3 planned; needs ≥ 3 such weekdays; stated if best − worst ≥ 15 pts. | `WEEKDAY_LOOKBACK_DAYS = 56`, `WEEKDAY_MIN_PLANNED = 3`, `WEEKDAY_MIN_GAP = 0.15` |
| **Daily load** | `avgDone` = completions in last 14 days ÷ max(active days, 7). `loadCap = max(3, round(avgDone × 1.25) + 1)`. If today has more open tasks than the cap, offer to move the lowest-priority extras to tomorrow. | `LOAD_LOOKBACK_DAYS = 14`, `LOAD_FACTOR = 1.25` |
| **Slump** (first match) | *away*: last activity (completion or check-in) ≥ 2 days ago. *missed*: ≥ 2 of the last 3 days had < 34 % done. *energy*: average energy of the last 3 check-ins ≤ 2 (needs ≥ 2). | `SLUMP_AWAY_DAYS = 2`, `SLUMP_LOW_RATE = 0.34`, `SLUMP_LOW_DAYS = 2`, `SLUMP_LOW_ENERGY = 2` |
| **Minimum viable day** | On a slump, offer a small day: up to 3 open tasks of ≤ 30 min, shortest first (ties: higher priority); if none are that small, just the single smallest. Everything else folds under "can wait". With nothing planned, offer two tiny starters from goal actions. | `MVD_MAX = 3`, `MVD_TINY_MIN = 30` |
| **Reminder time suggestion** | Words ≥ 4 letters in the title are matched against completed tasks; with ≥ 3 matches, suggest the median completion time rounded to 15 min ("when you usually do this"); otherwise the best window start + 30 min ("your best hours"). | `SUGGEST_MIN_SIMILAR = 3` |
| **Streaks** | A day is active if anything was completed or a check-in was logged. Current streak counts back from today (or yesterday if today is still empty). | |
| **Energy vs output** | Check-in energy against completions that day; mean per energy level. Computed from old check-ins only; no longer stated (check-in retired in v1.4). | `ENERGY_RATIO = 1.4` |
| **Task size** | Completion rate of tasks ≤ 20 min vs > 45 min (≥ 5 and ≥ 3 samples); stated if gap ≥ 15 pts. | `SHORT_TASK_MIN`, `LONG_TASK_MIN`, `SIZE_GAP` |
| **Self-care effect** | Next-day completion rate after check-ins with vs without a self-care note. Computed from old check-ins only; no longer stated (v1.4). | `SELFCARE_MIN_N`, `SELFCARE_GAP` |
| **Evening check-in** | Retired in v1.4 (web and Android): no card, sheet, nudge or reminder. The `checkins` collection stays in the data model so old records still sync, merge, count toward streaks and the slump signal. | |

## "What I've learned" panel
Plain sentences generated from the signals above, in this order: hours, weekdays, load, size, streak. Each has a short evidence line ("60 % of completions in the last 60 days").

## Voice (Today subtitle)
`todayLine()` picks the first matching line: all done → late (within 45 min of sleep) → small day → welcome back → low energy yesterday → nothing planned → in best window / best window within 3 h → streak ≥ 3 → progress → default. Tone: calm, specific, never guilt.

## Changing a rule
Edit `RULES` or the logic, update this file and the unit test in the same commit. Rules must stay explainable in one sentence.
