# Changelog

All notable changes to Steady. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).
The data contract has its own version (`schemaVersion`, see docs/DATA_MODEL.md); an app release that changes it must ship a migration.

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
