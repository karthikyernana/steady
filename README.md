# Steady

**A calm, adaptive personal tracker that learns how you work, and keeps you consistent on the days motivation doesn't show up.**

Tasks, goals with weekly milestones, money, thoughts, and insights that learn your patterns. One mic understands what you say in English, Telugu or both, and drafts the changes for you to accept. Installable on Android, Windows, macOS and iOS as an app. Works fully offline, and syncs live across your devices through your own Steady account.

**Live app:** https://karthikytodo.vercel.app · **Source:** https://github.com/karthikyernana/steady

---

## Why it exists

Motivation lasts a day or two. Generic to-do apps assume it lasts forever, so they pile up guilt. Steady watches what you actually finish, learns your best hours and days, and when you've been missing it shrinks the day to a *minimum viable day* of one to three tiny things. Small days count.

## Features

| Area | What it does |
| --- | --- |
| **Today** | Quick-add in plain language (see below), priorities, due time, reminders, done / skip / undo, gentle carry-over, an evening check-in. |
| **Goals** | Long goals broken into weekly milestones and small daily actions; one tap sends an action to Today; progress bars. |
| **Money** | Income and expenses in ₹: quick-add (“250 lunch swiggy”), categories that learn your spelling, a calm monthly view (spent / in / net / per day, by category, day by day), optional monthly budgets. |
| **Voice agent** | One mic everywhere (or press V). Speak or type in English, Telugu or code-mix; it understands tasks, reminders, money, thoughts, goals, and “today I did…” progress, using your own tasks, goals and spending as context. Shows editable draft cards; nothing changes until you tap Accept; one Undo for the batch. Learns from your corrections. See [docs/VOICE_AGENT.md](docs/VOICE_AGENT.md). |
| **Thoughts** | Capture ideas, notes and journal lines with `#tags` and mood; search and tag filters. |
| **Insights** | Streaks, a contribution-style heatmap, completion by weekday and hour, energy vs output, recent wins. Inline SVG charts. |
| **Adaptive engine** | Learns best hours/days, suggests reminder times, caps daily load, detects slumps and offers a minimum viable day, and explains every pattern in plain sentences. On-device. See [docs/ADAPTIVE_ENGINE.md](docs/ADAPTIVE_ENGINE.md). |
| **Accounts + live sync** | Email + password account. Every change is pushed within ~0.6 s and other open devices receive it within ~1–2 s (long-poll). Offline edits queue and merge per record, newest wins. |
| **Reminders** | Local notifications while open (timer armed for the exact minute); Web Push when closed (server queue + a 5-minute GitHub Actions trigger, plus optional per-reminder exact wake-ups via QStash); optional ntfy backup channel. See [docs/NOTIFICATIONS.md](docs/NOTIFICATIONS.md). |
| **Data** | Export/Import JSON (merging, never clobbering), versioned schema with migrations, delete-account. |
| **Design** | Two styles: *Liquid glass* (spring-physics motion, translucent surfaces) and *Paper* (flat, opaque, lightest on older phones). Light/dark/system. Honors reduced motion and reduced transparency. |
| **Hark plugin** | Optional read-only API key so Hark can coach from your data. Steady never depends on Hark. |

### Quick-add understands how you type

```
linkedin 20 min at 6pm            → "Linkedin", today 6 PM, 20 min, reminder
remind me to pay rent on the 1st   → "Pay rent", 1st of next month, reminder on
dentist 25 oct at 4                → 25 Oct, 4 PM (AM/PM picked from your waking hours)
submit report by eod asap          → today 6 PM, high priority
stretch in 2 hours                 → a time two hours from now
deep work 1h30 this afternoon      → 90 min at 3 PM
post on linkedin                   → linked to the goal whose daily actions include it
```

Every guess is shown as a chip before you press Enter, so nothing is silently misread.

## Install it as an app

- **Android (Chrome):** open the live app → menu **⋮ → Install app** (or **You → Install app** inside Steady). It opens full-screen with no browser bar. If you see a URL bar, it was added as a *shortcut*: remove it and use **Install app** instead.
- **Windows / macOS (Chrome or Edge):** the install icon in the address bar, or **⋯ → Apps → Install Steady**.
- **iPhone (Safari):** Share → **Add to Home Screen**.

Updates install themselves: a new version is picked up the next time you open the app.

## Architecture in one picture

```
 Phone / laptop (PWA)                         Vercel (sin1, Singapore)                 Neon Postgres (sin1)
 ┌───────────────────────────┐   HTTPS       ┌─────────────────────────────┐   TLS    ┌──────────────────────┐
 │ UI (vanilla ES modules)   │ ────────────▶ │ /api/* — one Node function  │ ───────▶ │ owners, sessions     │
 │ IndexedDB (source of truth│  cookie auth  │  auth · sync push/pull/wait │          │ records (RLS per     │
 │  on the device)           │ ◀──────────── │  reminders · push · tokens  │ ◀─────── │  owner) · reminders  │
 │ Service worker (offline,  │  long-poll    └─────────────────────────────┘          └──────────────────────┘
 │  push, notifications)     │                         ▲
 └───────────────────────────┘                         │ every 5 min (OIDC, no stored secret)
                                               GitHub Actions: reminders.yml
```

Full detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · data contract: [docs/DATA_MODEL.md](docs/DATA_MODEL.md) · running it: [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Develop

```bash
npm install                      # pg + web-push (server only); the app itself has no dependencies
npm test                         # unit tests (core logic, parser, merge, schema)
npm run check                    # service-worker precache + import graph sanity
DATABASE_URL=postgres://… npm run migrate
DATABASE_URL=postgres://… PORT=8765 npm run dev    # app + API on http://localhost:8765
```

No bundler, no framework, no transpiler: what's in `js/` is what ships. `npm run build` copies the app into `dist/` and stamps the service-worker cache version with a content hash.

## Project layout

```
index.html, manifest.webmanifest, sw.js   app shell, install metadata, offline + push worker
css/app.css                               design tokens (styles live as token overrides) + components
js/core/        pure logic (parser, adaptive engine, merge, schema, money, voice-agent core) — unit-tested, no DOM
js/data/        IndexedDB store, sync + live loop, backup, insights binding
js/platform/    notifications (local, Web Push, ntfy)
js/ui/          app shell, views, motion system, charts, icons
api/index.js    Vercel entry → server/routes.js (the whole API)
server/         auth, db (RLS helper), migrations runner, push sender, voice agent (STT + LLM providers), QStash trigger
db/migrations/  ordered SQL migrations, applied on every deploy
.github/        CI (tests) + reminders trigger
docs/           architecture, data model, operations, testing, roadmap
```

## License

MIT © Karthik Yernana
