# PRD: Steady v1

## Problem
Karthik (21, CS student at LPU, aspiring founder, Asia/Calcutta) starts strong and loses steam after one or two days. Generic trackers punish missed days and never learn him, so he abandons them.

## Persona
**Karthik Yernana.** Builder and marketer; juggles placements, AI side projects, LinkedIn/X presence, gym. Works best late evening. Uses an Android phone and a laptop. Comfortable with GitHub. Wants something that feels premium and personal, not another generic app, and that will still work years from now without any vendor.

## Goals
1. **Consistency over intensity:** keep a daily thread alive even on bad days (streaks, minimum viable day, carry-over without guilt).
2. **Learns him:** best hours/days, realistic load, reminder times from real behaviour, shown in plain sentences.
3. **Always there:** offline, installable, fast, no server, no account; works forever without Hark.
4. **Same data everywhere:** laptop and phone in sync through his own private repo.
5. **Premium, calm UI:** editorial look, one accent, generous space, AA contrast, 44 px targets.

## Success metrics (personal)
- Active days per week ≥ 5 for 8 consecutive weeks.
- Evening check-in on ≥ 60 % of days.
- After a 2+ day gap, back within 1 day (minimum viable day accepted).

## Scope v1
Today (quick add, priorities, times, reminders, done/skip/undo, carry-over), Goals (weekly milestones, daily actions), Thoughts (tags, mood, search), Insights (streaks, heatmap, weekday/hour, energy vs output, wins), Adaptive engine, Notifications (local + ntfy), Sync (GitHub, QR pairing), Export/Import, PWA install/offline, themes, optional Hark plugin.

## Non-goals (v1)
- Multi-user, sharing, teams.
- Any server we run; push notifications that need one.
- AI/LLM features (planned for V2 as an optional layer; see V2_AGENTS_PLAN.md).
- Calendar integration, habits with complex schedules, recurring tasks (roadmap).
- iOS-specific polish.

## Constraints
Static hosting only; no runtime CDN; ntfy.sh scheduling ≤ 3 days ahead; GitHub contents API rate limit 5,000 req/h (sync uses ~2 per sync).
