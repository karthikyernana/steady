# Voice agent (v1.3)

One mic, everywhere in the app (floating button above the tab bar, or press **V** on a keyboard). Karthik says what happened or what he needs,
in English, Telugu or both; Steady turns it into **draft cards** that show exactly what will change. Nothing is written until
he taps **Accept** (per card, or **Accept all**); **Discard** drops them. After accepting, one toast offers **Undo** for the
whole batch. Typing works the same way (the sheet's **Type instead**, or automatically when voice is unavailable).

```
 browser                                   /api (Vercel, sin1)                         providers
 ───────                                   ───────────────────                         ─────────
 MediaRecorder (opus/webm, mp4 on iOS)
   │ raw bytes, ≤30 s, auto-stop on a pause
   ▼
 POST /api/agent/transcribe  ───────────▶  Sarvam Saaras v3 (mode=codemix,  ───────▶  api.sarvam.ai/speech-to-text
   ◀── transcript (editable)                 language_code=unknown)
   │ + compact context (js/core/agent.js buildContext)
   ▼
 POST /api/agent/plan  ─────────────────▶  compactContext → refs (t1, g1, g1m2…)
                                           + profile memory (learned)
                                           buildPrompt → Gemini (strict JSON schema)  ─▶ generativelanguage.googleapis.com
                                                       ↳ Sarvam sarvam-105b (fallback)  ─▶ api.sarvam.ai/v1/chat/completions
                                                       ↳ rules planner (no key / both down)
                                           validatePlan → drafts with real ids
   ◀── drafts
 cards: edit → Accept → js/data/agent.js applyDraft → IndexedDB → normal sync (push ≤0.6 s, other devices ~1-2 s)
   │ accepted (before, after) pairs
   ▼
 POST /api/agent/learn  ────────────────▶  learn() → agent_memory (RLS, one row per user)
```

Keys (`SARVAM_API_KEY`, `GEMINI_API_KEY`) exist only as Vercel env vars; the browser only ever talks to `/api/agent/*` with
its session cookie and the `X-Steady` CSRF header.

## What it understands

| Intent | Example (any language mix) | Draft | On Accept |
| --- | --- | --- | --- |
| `task` | "gym tomorrow 6am 45 min" | New task, day/time/duration, linked goal | task created (reminder if it has a time and *default reminders* is on) |
| `reminder` | "remind me to call amma at 7", "రేపు 6 కి గుర్తు చేయి" | Reminder, **time required** | task with `reminder: true` (local + Web Push + ntfy paths) |
| `complete` | "finished the DSA problems", "DSA chesanu" | Matched existing open task (or "log as a new done item") | task marked done |
| `progress` | "sent 3 cold DMs today" | Goal + what was done, optional "also complete milestone X" | done task linked to the goal (+ milestone ticked if chosen) |
| `goal` | "my goal is an internship by Dec 15, first ship the portfolio…" | Title, target, weekly milestones, why | goal with milestones on consecutive weeks |
| `money` | "lunch 250 swiggy", "ఐదు వందలు పెట్రోల్", "got 2000 from a client" | Expense/income, ₹ amount, category, payee, note, date | `money` record |
| `thought` | "idea: weekly money summary on Sunday" | Note / idea / journal | thought (tags from `#words`) |

One utterance may produce several drafts (max 8). Amount words ("five hundred", "ఐదు వందలు", "aidu vandalu", "2.5k",
"1.5 lakh") and relative dates ("tomorrow evening", "next week", "same as yesterday") are resolved against the context.

## The prompt and its context

`buildContext()` (browser) collects a **bounded** snapshot from the local store, so the agent knows what Karthik knows *right now*,
even before sync: up to 40 open tasks (due within 14 days), 10 recently done, 12 goals with their undone milestones (≤6) and
daily actions (≤6), the 15 latest money entries and his categories by use, the 5 latest thoughts, name/wake/sleep, and his
default-reminder setting. The server treats this as untrusted input (`compactContext()` re-validates and clips everything).

`compactContext()` then:

- replaces every id with a short **ref** (`t1`, `g2`, `g2m1`, `g2a3`) and keeps the ref → id index server-side. The model never
  sees real ids; a ref it invents fails to resolve, so it cannot touch a record by accident;
- adds **now** in the user's zone (Asia/Kolkata by default): date, time, weekday, Monday of this week, and a 9-day calendar
  (yesterday … +7) so "Friday" or "tomorrow" resolve without arithmetic;
- adds the **profile memory**: learned payee → category and word → category corrections, plus his most-used categories.

`SYSTEM_PROMPT` (js/core/agent.js) describes the seven intents, the language handling (Telugu script, romanized Telugu,
code-mix), the date/amount rules, "prefer matching existing items", "never invent refs", and asks for `confidence` and the
exact `evidence` words per action. The user message is `CONTEXT_JSON` + the utterance. Typical prompt: ~1.2k tokens.

## Structured output and validation

- **Gemini** (`GEMINI_MODEL`, default `gemini-3.8-flash`): `generateContent` with `responseMimeType: application/json` +
  `responseJsonSchema` (the shared `RESPONSE_SCHEMA`, minus `null` inside enums, which Gemini rejects) and
  `thinkingConfig.thinkingLevel: low` (retried without it if a model rejects thinking levels).
- **Sarvam** (`sarvam-105b`, chat completions): `json_object` mode with the exact shape spelled out in the prompt, streamed,
  hidden reasoning off. Measured in this sandbox with the real key (Telugu-English mix, 3 intents): **2.2-3.9 s**, all intents
  right. Strict `json_schema` mode (`SARVAM_JSON_MODE=schema`) was slower (8-20 s) and sometimes ran on with whitespace;
  the client stops a stream early when the JSON is complete or stalls, and salvages every complete action.
- **rules** (no key, or both providers failing): `rulesPlan()` — clause splitting + Steady's quick-add parsers — returns the
  same raw shape. The browser uses the same planner on-device when signed out or offline ("understood by this device").

`validatePlan()` is the only path from model output to a draft: unknown types dropped; refs resolved (a bad ref falls back to a
confident title match, else the card asks him to pick); a milestone must belong to its goal; dates must be real and within
−400/+730 days; times `HH:MM`; amounts > 0 and ≤ ₹10 crore, rounded to paise; categories reuse his spelling; strings clipped;
duplicates removed; at most 8. Missing essentials are **flagged, never invented** (`needs: ['amount']`, `['time']`), and the
card stays open until he fills them. `missing()` re-checks after his edits, right before Accept.

## Adaptive memory (per user, server-side)

Table `agent_memory` (RLS, one JSON row per owner). `learn()` runs on every Accept with the draft as proposed and as accepted:

- category use counts (his vocabulary, offered first next time),
- payee → category (e.g. *Rapido → Transport*),
- **corrections**: when he changes a category before accepting, the most specific word of that line (payee or note) is
  remembered (`rapido → Commute`); newest wins, capped at 60,
- accepted / edited counters (how often the agent was right first time).

The memory is fed back into the next prompt (and into the rules planner). **You → Voice agent → What it has learned** shows it
and can forget it all (`POST /api/agent/memory/reset`). Data records are never part of the memory.

## Limits and failure modes

- Usage cap per user per day (`AGENT_DAILY_LIMIT`, default 200 each for STT and planning) → 429 with a friendly message.
  Plus an all-users ceiling (`AGENT_GLOBAL_DAILY_LIMIT`, default 3000 per kind, table `agent_usage_total`) since sign-ups are open.
- No `SARVAM_API_KEY`: `/api/config` reports `voice: false`, the mic opens the typing sheet ("Voice isn't on for this Steady yet"), and `/api/agent/transcribe` answers 501 without counting. No LLM key at all: the rules planner answers ("understood by basic rules").
- STT errors / timeouts (20 s) → the sheet keeps the recording state honest and offers **Type it**.
- LLM errors fall down the chain; the reply says which provider answered ("understood by Gemini").
- Audio is never stored. Transcripts are not stored server-side (only what he accepts becomes data, through normal sync).

## Latency budget (phone on 4G, sin1)

| Step | Typical |
| --- | --- |
| Pause detection after he stops talking | 2.2 s (or tap **Done** / release the held mic) |
| Upload ~8 s opus @32 kbps (~30 KB) | < 0.3 s |
| Saaras v3 transcription (measured, 8 s clip) | ~2.1 s |
| Plan: Gemini Flash, thinking low | ~1-3 s (estimate; not callable from this sandbox) |
| Plan: sarvam-105b, JSON mode (measured) | 2.2-3.9 s |

The transcript shows as soon as STT returns, while planning runs, so the wait feels shorter.

## Files

`js/core/agent.js` (context, refs, prompt, schema, validation, rules planner, learning) · `js/core/money.js` (amount words,
categories, monthly summary) · `server/agent.js` (providers, usage cap, memory) · `server/routes.js` (`/api/agent/*`) ·
`js/data/agent.js` (API calls, apply + undo) · `js/ui/voice.js` (mic, recorder, waveform, sheet, cards) ·
`db/migrations/0006_money_agent.sql` · tests: `tests/unit/agent.test.mjs`, `tests/unit/providers.test.mjs`,
`tests/api/agent.test.mjs`, `tests/qa/agent_e2e.py`, mock: `tests/mocks/ai-mock.mjs`.
