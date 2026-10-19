# Changelog

All notable changes to Steady. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).
The data contract has its own version (`schemaVersion`, see docs/DATA_MODEL.md); an app release that changes it must ship a migration.

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
