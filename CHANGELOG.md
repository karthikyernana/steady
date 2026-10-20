# Changelog

All notable changes to Steady. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).
The data contract has its own version (`schemaVersion`, see docs/DATA_MODEL.md); an app release that changes it must ship a migration.

## [1.4.2] - 2026-10-20

### Fixed
- Removing a device (You > Devices, or changing the password) now erases that device's local copy the next time it reaches the server, on web and Android, with a notice saying why. Revoked sessions are kept as tombstones for 90 days so the device can tell "removed" from "expired"; a plain expiry still keeps local data. Tests: tests/qa/revoke_e2e.py (9/9), API sessions test, Android DevicesTest.

## [1.4.1] - 2026-10-20

### Added
- Custom money categories: type your own on web (the list offers defaults, ones you've used and budgeted ones); Android has "+ New".

### Fixed
- Android: device pill no longer wraps letter by letter; offline banner clears once the connection is back; short titles stay on one line.
- CI: Android end-to-end test on a real emulator (Maestro) with a local server.

## [1.4.0] - 2026-10-20

Web and the native Android app (also 1.4.0) now match screen for screen.

### Added
- Devices: see every signed-in device and sign out one or all others (You > Devices); changing the password signs out the rest.
- Insights redesigned: four stat tiles with week-over-week change, "What I've learned", a full-width consistency calendar,
  weekday and time-of-day charts, then goals, money and thoughts cards when they have data.
- Readable thoughts: AI-pasted notes with LaTeX, Markdown, tables and numbered headings are shown cleanly (the saved text is
  never changed); long notes clamp to 7 lines with Show more, and a tap opens a read view with Edit and Delete.
- Today: a day strip under the add box (next timed task with a live countdown and the day as a timeline).
- A six-page first-run guide, re-openable from You > How Steady works.
- Android: small-day offers after heavy days, lighten-today, goal shortcut chips, per-category budgets and a day-by-day
  spending chart, amounts in words (English and Telugu), suggested times, a row-by-row milestone editor, JSON export/import,
  editable voice drafts with an offline fallback, and a side rail in landscape.

### Removed
- The evening check-in (card, sheet, nudge and its reminders). Existing check-in records are kept and still count toward streaks;
  the server drops any check-in reminder still queued.

### Changed
- The bottom bar is near-opaque with a soft fade behind it, so text never shows through the icons.

## [1.3.1] - 2026-10-20

### Fixed
- Reminders never reached phones: the server had never delivered a push (GitHub's schedule barely ran and hit the old,
  redirecting domain). Due reminders now send immediately; reminders within 4.5 min are sent by a near-term timer
  (Vercel waitUntil); QStash remains the optional exact trigger; the GitHub cron is a loud-failing backstop every 20 min.
- Devices no longer delete just-due reminders from the server queue; a rescheduled reminder re-arms (`sent_at` cleared).
- The queue updates as soon as a reminder changes, not only after the next sync; full re-mirror every 6 h self-heals.
- Foreground reminders show a system notification too, not just a toast.
- Voice: every async step is bound to its session, so rapid taps can't leak a stale recording/transcript into the next turn;
  the mic is re-acquired only after the previous one is released (with retry); Sarvam busy/5xx gets one quiet retry.
- Voice cut-offs: adaptive noise floor, 3.2 s pause (after real speech) before auto-finish, "Finishing…" hint, never while
  holding; long speech is recorded in ~25 s segments at natural pauses and transcribed in parallel (up to 2 min).

### Added
- Notification actions: Done and Snooze 10 min. `POST /api/reminders/snooze`, `POST /api/reminders/test`,
  `GET /api/reminders/status`; You → Reminders shows delivery health and "Test with app closed".
- docs/ADAPTIVE_UX.md (exploration), research on comparable apps in docs/NOTIFICATIONS.md, tests/qa/voice_stress_e2e.py.

## 1.3.0 — Money, voice agent, UI pass, new styles (2026-10-19)
- **Money tab:** income and expenses in ₹ with quick-add (“250 lunch swiggy”, “got 5000 stipend”, “ఐదు వందలు పెట్రోల్”), categories that keep your spelling and learn payees, a monthly view (spent, came in, net, per day, by category, day by day), month switcher, optional monthly budgets (total and per category) with a calm "left this month" line. Synced like everything else (local-first, LWW, RLS).
- **One mic, app-wide** (floating button; **V** on a keyboard): tap to talk, or hold and release; auto-stops on a pause; live waveform. Typing works in the same sheet.
- **Voice agent:** Sarvam Saaras v3 speech-to-text (English, Telugu, code-mix) → Gemini (strict JSON schema) with Sarvam `sarvam-105b` and a rules planner as fallbacks. Understands tasks, reminders, money, thoughts, new goals, and "today I did…" (completes the matching task or logs progress on the matching goal/milestone). Several actions per utterance. Uses compact context (open tasks, goals + milestones, recent money and categories, recent thoughts, now in Asia/Kolkata) with short refs so the model cannot touch the wrong record. Server-side validation; **editable draft cards**, Accept per card or all, Discard, one Undo. Learns from your edits (categories, payees, word → category) in a per-user profile you can view and reset.
- **Reminders:** the on-device scheduler now fires on the exact minute; optional exact server wake-ups per reminder via Upstash QStash (free tier); GitHub cron kept as backstop; push notifications carry their intended time. See docs/NOTIFICATIONS.md.
- **Data:** schemaVersion 2 (adds `money`), IndexedDB v2, migration `0006_money_agent.sql` (money collection, `agent_memory`, `agent_usage`).
- **Fixes:** `Permissions-Policy` allowed no microphone; now `microphone=(self)`.
- **Tests:** money + agent + provider unit tests (mocked Sarvam/Gemini), agent API tests, voice E2E with a fake microphone, preview screenshot script.
- **Styles:** three new looks in You → Appearance next to Liquid glass (still the default) and Paper: **Grid** (Swiss editorial, ultramarine signal), **Papercut** (layered cut paper, teal accent) and **Midnight** (dark-first navy and brass; light "dawn" counterpart). Bundled fonts, offline like the rest; tuned for the five-tab bar, the header avatar, Money and the voice sheet.
- **Navigation:** the tab bar holds five tabs (Today, Goals, Money, Thoughts, Insights). **You** moved to an initial/avatar button at the top right, next to the sync pill (desktop: a "You" row above the sync chip in the sidebar). The tab indicator fades out while You is open.
- **Mic:** still a separate floating button, now with a fixed 16 px gap above the tab bar, safe-area aware, tucks as soon as you read down (60 px instead of 160 px), and every page ends above it. Toasts sit in the space left of the mic instead of under it. Bars and mic step aside while the soft keyboard is up.
- **Fix: Thoughts showed `&#39;` and a green "#39" tag** after an apostrophe. Rendering escaped the text first and then ran the #tag regex over the HTML, which matched the `#39` inside `&#39;`. New `js/core/text.js` splits the raw text into tag / non-tag pieces first and escapes each piece once; tags now need a word boundary (no "C#", "a#b", "site.com/#x") and keep Telugu vowel signs (`#ఆలోచన` no longer cuts to `#ఆ`). Stored text was always raw; no data repair needed.
- **Copy:** trimmed helper paragraphs across Today, Goals, Money, Thoughts, Insights, You, onboarding and the voice sheet.
- **Polish:** clearer voice errors ("No connection right now…" instead of "Failed to fetch"), a "still working…" line after 7 s, opaque voice action bar, `--faint` contrast ≥ 4.5:1 on every light surface, numeric ranges ("9–11 PM") never break, longer goal names on wide screens, landscape safe-area padding, `content-visibility` on long lists.
- **Tests:** `tests/unit/text.test.mjs` (escaping, entities, Telugu tags), `tests/qa/ui_pass_shots.py` (before/after screenshots + layout contract: 5 tabs, You from the header, mic clear of the bar and of the page end).
- **Hardening (release review):** an all-users daily ceiling for the paid AI calls (`AGENT_GLOBAL_DAILY_LIMIT`, default 3000 per kind; migration `0007_agent_usage_total.sql`) on top of the per-user cap, because sign-ups are open; `/api/agent/transcribe` answers 501 "not set up" without spending quota when `SARVAM_API_KEY` is missing and refuses oversize uploads before reading them; agent learning ignores `__proto__`/`constructor` keys; model output can no longer resolve inherited properties as refs or priorities; the Money list and entry sheet escape every stored field (a crafted import could inject markup through `kind`, `id` or `date`).
- **Tests:** the five API tests written for the retired v1.1 passphrase/allow-list sign-in now cover v1.2 accounts (closed sign-ups, sign-up validation, password login rate limit); new API tests for the global ceiling, voice-off and learning keys.

## 1.2.1 — Rock-still tab bar (2026-10-19)
- Route changes no longer use View Transitions (Android snapshotted the fixed tab bar, so it dipped and popped back). The page content now does one composited slide; the top bar and tab bar never move.
- Removed the active-tab icon bounce and the vertical squash of the tab indicator; softer press state on tabs.

## 1.2.0 — Accounts, live sync, speed (2026-10-19)
- **Accounts:** real email + password accounts (email first, then sign in or an explicit "Create account" step; nothing is created silently). Change password, delete account. Retired the one-time setup code and owner passphrase.
- **Live sync:** changes push within ~0.6 s; other open devices get them within ~1–2 s through a long-poll (`/api/sync/wait`). Status shows "Live".
- **Speed + flicker:** route changes use one composited View Transition (fixes the tab-switch flicker); removed animated full-screen layers, scroll-driven reveals, blurred sheet backdrop and the page-recede effect; blur kept only on the top bar, tab bar and sheets.
- **Always current:** service worker is network-first with offline fallback and reloads once when a new version takes over (no more stale app after a deploy).
- **Installed app:** manifest `id`/`start_url`/`scope` at `/`, screenshots for the richer install sheet, `launch_handler`, standalone-only touch polish.
- **Smarter quick-add:** filler words ("remind me to", "I need to"), month dates ("25 oct", "jan 5", "30/10", "the 1st"), "next week", "weekend", "in 2 hours", "eod", "after lunch", "1h30", "half an hour", "asap", and automatic goal linking.
- **Styles:** Liquid glass (default) or Paper (flat, opaque, lightest), switchable in You → Appearance; honors reduced transparency.
- **Windows polish:** thin themed scrollbars, pointer cursors, keyboard focus rings kept.
- **Reminders:** GitHub Actions trigger now authenticates with OIDC (no stored secret).
- **Docs:** README, ARCHITECTURE, OPERATIONS, TESTING rewritten for the current system.

## 1.1.0 — Motion & liquid glass (2026-10-19)
- New `js/ui/motion.js`: real spring physics compiled to CSS `linear()` easings, FLIP choreography across re-renders (enter, exit ghosts, reorder), directional route transitions, sheet springs with drag-to-dismiss, liquid tab/sidebar/segmented indicators, task-complete burst + strike, animated rings, bars and charts, circular theme reveal.
- Liquid-glass surfaces: floating glass tab bar, glass top bar that fades in on scroll, glass composer, sheets, toast and sync chip; translucent layered cards over a slow ambient world. Pointer light on desktop cards.
- Scroll-linked large-title recede and view-timeline reveals (progressive enhancement). Everything respects prefers-reduced-motion. Colours, fonts, layout and features unchanged.

## [1.0.0] - 2026-10-16

### Added
- Today: natural-language quick add, priorities, due times, reminders, done/skip/undo, carry-over prompt, evening check-in.
- Goals with weekly milestones, daily actions and progress.
- Thoughts with tags, mood, kinds, search and tag filters.
- Insights: streaks, heatmap, weekday and hour charts, energy vs output, wins, goal progress (inline SVG).
- Adaptive engine (rule-based, on-device): best window, weekday strength, load cap, slump detection, minimum viable day, reminder-time suggestions, plain-language "What I've learned" panel, state-aware copy.
- Reminders: service-worker notifications and ntfy scheduled delivery with per-task sequence IDs (reschedule replaces, completion cancels).
- Cross-device sync via the user's private GitHub repo: per-record last-write-wins, tombstones, sha-based optimistic concurrency with retry, Sync now, auto-sync, QR/link pairing.
- Data contract `schemaVersion: 1` with migration framework; JSON export/import that merges.
- Optional Hark plugin (off by default): daily `data/snapshot.json`.
- PWA: manifest, maskable icons, offline service worker, install prompt, light/dark themes.
- Unit tests (parser, merge, schema/migrations, engine, voice), Playwright E2E across 3 viewports × 2 themes, axe-core checks, CI workflow.
