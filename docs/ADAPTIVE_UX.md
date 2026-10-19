# Adaptive UX: a Steady that rearranges itself around you (exploration, not built)

Status: proposal for discussion, 2026-10-20. Nothing here changes the current UI until Karthik picks a direction.

## The idea

Today Steady has fixed screens that wait to be opened. The direction is the one Hark uses: **one surface that composes
itself from what matters right now**, plus a voice/text line that can act on anything. The tabs stay (nothing is removed);
Today becomes a feed of a few live cards chosen by context, each with a one-tap action.

## What decides the cards (all already in the data)

| Signal | Source today | Example card |
| --- | --- | --- |
| Time of day + his wake/sleep | profile, `checkinFireAt` | 8 AM "Plan the day: 3 picks" · 10 PM "Check in, 2 minutes" |
| Next reminder / free gap | tasks with times | "Next: call amma at 6. You have 40 free minutes before it." |
| Best focus hours | insights (`analyze`) | "Your best hours start at 10. Save DSA for then." |
| Goal pace | goals + weekly milestones | "LinkedIn goal: 1 of 3 this week. Draft one now?" |
| Money pattern | money (monthly summary, budgets) | "Food is at 82% of budget with 9 days left." |
| What he just said | voice agent drafts + learned memory | "You said 'gym tomorrow'. Make it a 7 AM reminder?" |
| Missed or snoozed | reminder queue status | "Snoozed twice: move it to tomorrow?" |

Rules: at most 3 cards; each card has exactly one primary action; a card dismissed twice for the same reason stops appearing
for a week (the app learns what he ignores). Every suggestion is a draft he accepts, never a silent change, the same contract
as the voice agent.

## Phases (each shippable alone)

1. **Context cards on Today** (client only): a small ranker over the signals above; no new data. ~1 day.
2. **Proactive notifications**: morning digest and "slipping" nudges sent through the same reminder queue, with quiet hours
   and a daily cap. Reuses v1.3.1's delivery pipeline.
3. **Conversation memory**: the voice sheet becomes a thread ("Yesterday you said…"), and the agent can propose plans across
   tasks, goals and money in one reply.
4. **Native shell (optional)**: TWA/Capacitor for exact on-device alarms and a home-screen widget.

## Open questions for Karthik

- Should Today become the feed, or should the feed be its own "Now" view?
- How pushy: one digest a day, or nudges when something slips?
- Which signals matter most to you first: focus hours, money, or goals?
