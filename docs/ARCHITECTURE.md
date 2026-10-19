# Architecture

Steady is a local-first PWA with a small server. The device is always the source of truth for what you see; the server
(Vercel function + Neon Postgres) is the account, the backup, and the bridge between your devices.

```
 Device (PWA)                                    Vercel · sin1                      Neon Postgres · sin1
 ┌─────────────────────────────┐   HTTPS         ┌───────────────────────────┐      ┌───────────────────────┐
 │ js/ui      views, motion    │  cookie session │ api/index.js              │ TLS  │ owners  (email, scrypt│
 │ js/core    pure logic       │ ──────────────▶ │  → server/routes.js       │ ───▶ │          password)    │
 │ js/data    IndexedDB, sync  │                 │    auth · sync · push ·   │      │ sessions (sha256 only)│
 │ js/platform notifications   │ ◀── long-poll ─ │    reminders · tokens     │ ◀─── │ records  (RLS/owner)  │
 │ sw.js      offline + push   │                 └───────────────────────────┘      │ push_subscriptions,   │
 └─────────────────────────────┘                          ▲                         │ scheduled_notifications│
                                                          │ every 5 min, GitHub OIDC └───────────────────────┘
                                                  .github/workflows/reminders.yml
```

## Layers (client)

| Module | Responsibility | May depend on |
| --- | --- | --- |
| `js/core/*` | Data contract + migrations (`schema`), per-record merge (`merge`), adaptive rules (`engine`), copy (`voice`), quick-add language (`parse`), plain text with #tags (`text`: split raw text, then escape each piece once), helpers. Pure functions, unit-tested, no DOM. | `core/*` |
| `js/data/store.js` | IndexedDB persistence, in-memory cache, change events. | `core/schema` |
| `js/data/sync.js` | Account calls, dirty queue, push/pull by server cursor, live long-poll loop. | `store`, `core/*` |
| `js/core/money.js`, `js/core/agent.js` | Money parsing/summaries; the voice agent's shared core (context, refs, prompt, response schema, validation, rules planner, learning). Imported by the browser **and** the server. | `core/*` |
| `js/data/agent.js` | Calls `/api/agent/*`, falls back to the on-device planner, applies accepted drafts with undo. | `store`, `sync`, `core/*` |
| `js/data/backup.js` | Export/import through the same merge rules. | `store`, `core` |
| `js/platform/notify.js` | Permission, local notifications, Web Push subscription, server reminder queue, ntfy backup. | `store`, `sync` |
| `js/ui/*` | `app.js` (shell, router, render loop), `voice.js` (the mic, recorder, draft cards), `views/*` (incl. `money.js`), `ui.js` (sheets, toasts, segmented); shell: five tabs + **You** behind the header avatar, the mic as a separate floating button, `motion.js` (springs, FLIP, view transitions, indicators), `charts.js`, `icons.js`. | everything above |

## Render loop

Every data change emits an event → `scheduleRender()` (one per frame) → the current view's `render()` returns HTML →
`motion.flip()` animates what moved, entered or left (keys: `data-id` / `data-k`). Route changes swap the view and run one
composited slide of the page content (no View Transitions, so fixed bars are never snapshotted). A micro-interaction may `motion.hold(ms)` the next
render so it can finish (e.g. the check burst before a done task leaves the list).

## Sync protocol

1. Local write → record gets `updatedAt` → queued as dirty → pushed after 600 ms (`POST /api/sync/push`, batches ≤ 500).
2. Server upserts last-write-wins per `(owner, coll, id)` and bumps a global `seq`.
3. Each open device holds `GET /api/sync/wait?since=<cursor>` (≤ 20 s). The moment another device writes, it returns
   `changed` and the device pulls `GET /api/sync/pull?since=<cursor>` and merges (newer `updatedAt` wins; ties keep the server copy).
4. Offline: writes keep queueing; on reconnect the device pushes, then pulls. Deletes are tombstones.

Postgres enforces isolation with forced row-level security: every query runs inside `withOwner()`, which sets
`app.owner_id` for the transaction.

## Voice agent

`/api/agent/transcribe` (Sarvam Saaras v3) → `/api/agent/plan` (Gemini, falling back to Sarvam `sarvam-105b`, then a rules
planner) → validated **drafts** → the browser applies only what the user accepts, through the normal store + sync.
Per-user profile memory lives in `agent_memory` (RLS). Keys never leave the server. Full detail: [VOICE_AGENT.md](VOICE_AGENT.md).

## Auth

Email + password (scrypt N=16384, per-user salt). Sessions are random 32-byte tokens in an httpOnly, Secure, SameSite=Lax
cookie; only their SHA-256 is stored. State-changing calls require the `X-Steady: 1` header and a same-origin `Origin`
(CSRF). Failed logins are rate-limited per IP (5/hour) and globally (20/hour). Sign-up policy: `SIGNUP_MODE=open`
(default) or `owners` (only `OWNER_EMAILS`). Google Sign-In is supported when `GOOGLE_CLIENT_ID` is set.

## Offline + updates

`sw.js` precaches the shell; requests are network-first with a 2.5 s timeout and fall back to cache, so a new deploy is
live on the next open while offline still works. When a new worker takes over, the page reloads once.

## Design system

`css/app.css` is token-driven. A *style* is only a set of token overrides on `html[data-style=…]` (`liquid`, `paper`),
so a new look is added without touching components. `css/styles.css` (loaded after it) adds three more, each with a light
and a dark token set plus a few scoped flourishes: `grid` (Swiss editorial: Schibsted Grotesk + IBM Plex Mono, ultramarine),
`papercut` (tactile layered paper: Young Serif + Figtree, apricot/teal) and `midnight` (dark-first navy with brass and sage,
no red; light counterpart "dawn": Newsreader + Hanken Grotesk). Fonts are self-hosted woff2 in `fonts/` and precached.
`python3 tests/qa/contrast.py` checks WCAG AA for every style × theme; `tests/qa/style_shots.py <base>` screenshots and
audits each style at 360/390/412/1366. Motion uses real spring physics compiled to CSS `linear()` easings
(`motion.installCssSprings`). Everything respects `prefers-reduced-motion` and `prefers-reduced-transparency`.
