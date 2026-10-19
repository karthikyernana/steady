# Data model and sync contract (schemaVersion 1)

This is the contract every Steady client (web today, native later, Hark plugin) reads and writes. Source of truth in code: `js/core/schema.js`.

> **v1.2 note:** records are now synced through Steady's own API into Neon Postgres (`records` table, one row per record,
> last-write-wins by `updatedAt`, global `seq` cursor). See ARCHITECTURE.md → Sync protocol. The record shapes below are
> unchanged; the GitHub-file sections are kept for history (v1.0) and the export format, which still uses this document shape.

## Records
Every record in every collection has:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Unique within its collection. Generated as base36 time + random. Check-ins use `ci-YYYY-MM-DD`. |
| `updatedAt` | number (ms epoch) | Stamped on every write; strictly increases per record (`max(now, prev+1)`). |
| `createdAt` | number (ms epoch) | Set once. |
| `deleted` | `true`, optional | Tombstone. A tombstone is exactly `{ id, deleted: true, updatedAt }`. |

Unknown fields must be preserved by every client (forward compatibility).

### tasks
| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `title` | string | `''` | |
| `priority` | 1 \| 2 \| 3 | 2 | low / normal / high |
| `dueDate` | `YYYY-MM-DD` \| null | null | Local calendar day |
| `dueTime` | `HH:MM` \| null | null | Local 24h time |
| `durationMin` | number \| null | null | Estimated minutes |
| `reminder` | boolean | false | Notify at `dueTime − settings.reminderLead` |
| `status` | `open` \| `done` \| `skipped` | `open` | |
| `doneAt` | number \| null | null | When marked done (drives learning) |
| `goalId` | string \| null | null | Link to `goals.id` |
| `carried` | boolean, optional | | Brought forward from an earlier day |
| `letGo` | boolean, optional | | Skipped via carry-over "let go" |
| `mvd` | boolean, optional | | Created as a minimum-viable-day tiny task |

### goals
| Field | Type | Notes |
| --- | --- | --- |
| `title`, `why` | string | |
| `target` | `YYYY-MM-DD` \| null | Target date |
| `order` | number, optional | Display order |
| `milestones` | array of `{ id, title, week: 'YYYY-MM-DD' (Monday), done: boolean, doneAt?: number }` | Weekly milestones |
| `actions` | array of `{ id, title, durationMin? }` | Daily small actions |

Milestones and actions live inside the goal record, so they merge with the goal (whole-record LWW).

### thoughts
`text` (string, may contain `#tags`), `tags` (string[] lower-case, derived from text), `mood` (1–5), `kind` (`note` \| `idea` \| `journal`).

### checkins
`date` (`YYYY-MM-DD`), `energy` (1–5), `win` (string), `selfCare` (string). One per day (`id = ci-<date>`).

### meta (synced key/value records)
| id | Fields |
| --- | --- |
| `profile` | `name`, `wake` (`HH:MM`), `sleep` (`HH:MM`, may be after midnight), `onboarded`, `onboardedAt` |
| `settings` | `reminderLead` (min), `checkinNudge` (bool), `defaultReminder` (bool), `ntfyEnabled` (bool), `ntfyTopic` (string), `ntfyServer` (URL) |

### Device-only (never synced; IndexedDB store `local`)
`syncRepo`, `syncToken`, `syncSha`, `lastSyncedAt`, `theme`, `schemaVersion`, `ntfySched` (seq → {at, topic, sig}), `firedLocal`, `mvdDay`, `harkPlugin`, `harkSnapshotDay`, dismissal flags.

## Repo layout (sync)
```
<owner>/steady-data (private)
└── data/
    ├── state.json      # the synced document (always)
    └── snapshot.json   # daily read-only snapshot for Hark (only if the plugin is on)
```

### `data/state.json`
```json
{
  "app": "steady",
  "schemaVersion": 1,
  "writtenAt": "2026-10-16T16:00:00.000Z",
  "device": "Android",
  "data": {
    "tasks":    { "<id>": { "id": "<id>", "updatedAt": 1792152000000, "title": "Post on LinkedIn", "status": "open", "...": "..." } },
    "goals":    { },
    "thoughts": { },
    "checkins": { "ci-2026-10-16": { "id": "ci-2026-10-16", "date": "2026-10-16", "energy": 4, "win": "...", "selfCare": "...", "updatedAt": 1792160000000 } },
    "meta":     { "profile": { "id": "profile", "name": "Karthik", "...": "..." }, "settings": { } }
  }
}
```
Collections are objects keyed by id (arrays are accepted on import). Exports (`steady-YYYY-MM-DD.json`) use the identical envelope plus `exportedAt`.

### `data/snapshot.json` (Hark plugin)
`{ app, kind: "daily-snapshot", generatedAt, tasks[], goals[], thoughts[], checkins[], insights: { remember[], streak, last7, last30, bestWindowStart, bestDay, avgDonePerDay, slump } }`, live records only.

## Merge rules
For each collection, for each id present on either side:
1. Higher `updatedAt` wins (whole record).
2. Equal `updatedAt`: a tombstone wins.
3. Still equal: the record whose `JSON.stringify` sorts higher wins (deterministic on every device).

Tombstones older than 90 days are pruned when writing. A device offline longer than that could resurrect a deleted record; acceptable for a single user.

## Write protocol (GitHub contents API)
1. `GET /repos/{repo}/contents/data/state.json` → `sha`, base64 content (blob API if > 1 MB). 404 ⇒ no file yet (repo existence is then checked separately).
2. Parse with `readDoc()` (migrates older versions; refuses newer ones).
3. Merge with local, apply winners locally.
4. If the remote differs: `PUT` with `{ message, content(base64), sha }`. 409/422 ⇒ someone wrote in between → back off and repeat from 1 (max 4 attempts).

## Versioning and migrations
- `schemaVersion` is an integer, independent of the app's SemVer.
- `MIGRATIONS[n]` upgrades collections from `n−1` to `n`; must be pure and idempotent; covered by unit tests.
- Clients migrate local IndexedDB on start and remote docs on read.
- A client that sees a **newer** `schemaVersion` must not write; Steady shows "Update this device to keep syncing".
- v0 → v1: legacy `schema` key renamed; tasks without `status` get `done`/`open` from `doneAt`.
