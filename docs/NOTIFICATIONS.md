# Reminders: how they fire, and how to make them land on the minute

## v1.3.1 incident: reminders never reached phones (fixed 2026-10-20)

What production showed (Neon, 2026-10-20 00:30 IST): 3 push subscriptions (1 Android, 2 desktop), **`last_ok_at` empty on all three**:
the server had never delivered a single push. Causes, in order of impact:

1. **Nothing woke the sender.** GitHub ran the `*/5` schedule once in ~7.5 hours (new-repo schedules are best-effort), and that
   one run POSTed to the old domain, got a 307 and, with `curl -f` not following redirects, "succeeded" without sending.
2. **Devices deleted reminders the moment they came due.** `wantedReminders()` only covered the future, so the next reconcile
   removed a just-due row from the queue before any sender could pick it up (the 22:25 "Set alarm" test disappeared this way).
3. **A rescheduled reminder never fired again.** The queue upsert kept `sent_at`, so a task whose reminder had fired once was
   skipped forever after its time changed.
4. **The queue only updated after a full sync round**, not when the reminder was created.
5. **In the foreground, only a toast** (no system notification), easy to miss on a phone.
6. **Hidden cost trap:** a 5-minute cron that wakes Neon keeps the free compute (100 CU-hours/month, 5-minute scale-to-zero)
   awake around the clock: about 180 CU-hours. Had the cron worked as designed it would have suspended the database mid-month.

Fixes: see "Delivery pipeline" below. Tests: `tests/api/api.test.mjs` (due-now send, no double send, reschedule re-arms,
snooze, status, pruning), `tests/qa/voice_stress_e2e.py`.

## Delivery pipeline (v1.3.1)

Every path calls the same idempotent `sendDue()` (row-level `sent_at`, `for update skip locked`), so overlapping triggers never
double-send.

| Layer | What wakes it | Precision | Cost |
| --- | --- | --- | --- |
| **Due now** | `POST /api/reminders` / snooze / test with something already due | immediate | one request |
| **Near-term timer** | the same request stays alive (Vercel `waitUntil`, `maxDuration` 300) until a reminder due within 4.5 min | on the second | memory-seconds only while waiting |
| **QStash (optional)** | one delayed call per fire minute (`server/qstash.js`) | on the minute, any distance | free: 1,000 messages/day; DB wakes only at fire times |
| **GitHub cron backstop** | `7,27,47 * * * *`, fails loudly on non-200 | 0-20+ min | ~3 wakes/hour |
| **On device** | Steady open or alive in the background: one-shot timer + 20 s sweep, now also a system notification in the foreground | exact | none |

Delivery health: `GET /api/reminders/status` (devices, last successful delivery, queued count, trigger mode), shown under
You → Reminders. "Test with app closed" queues a real reminder 30 s out through the whole pipeline.

Notification actions: **Done** (marks the task done, with Undo) and **Snooze 10 min** (server row `<key>~snooze`, so a device
re-mirroring the original can never undo or duplicate the snooze; falls back to moving the reminder on-device when signed out).

## What comparable apps do (research, 2026-10-20)

- **Todoist, Google Tasks, Microsoft To Do**: reminders are owned by the server and delivered by FCM/APNs to every device; the
  native apps also register the next alarms locally so they fire offline. Web clients get Web Push.
- **TickTick, Things, Due**: on-device exact alarms (Android `AlarmManager.setExactAndAllowWhileIdle`, iOS
  `UNNotificationRequest`), plus "nag until done" (Due, TickTick constant reminder), snooze presets in the notification, and a
  daily summary at a chosen time.
- **Common to the best ones**: one id per reminder across devices (no duplicates), actions in the notification (Done / Snooze),
  quiet hours, a morning digest, and reminders relative to context (location, "when I'm free").

A PWA cannot schedule exact local notifications (the Notification Triggers origin trial ended without shipping), so the web
equivalent is **server-timed Web Push** plus the on-device timer while alive, which is what v1.3.1 does. The step that matches
TickTick/Due exactly is a thin native shell (TWA or Capacitor) that adds on-device exact alarms; see ROADMAP v3.

## Before v1.3.1 (kept for reference)


## Today (v1.2) — three paths, all keyed by a stable id per reminder (`st-<taskId>`; the old `st-checkin-YYYYMMDD` evening nudge is retired in v1.4 and the server drops any still queued)

| Path | When it works | Precision | Notes |
| --- | --- | --- | --- |
| **Local scheduler** (`js/platform/notify.js`) | Steady is open or alive in the background | 20 s sweep | In-app toast when visible, system notification via the service worker otherwise. |
| **Web Push** (`server/push.js`) | Signed in, app closed | **5 min nominal, often worse** | Devices mirror upcoming reminders into `scheduled_notifications`; GitHub Actions (`reminders.yml`, `*/5`) calls `POST /api/cron/reminders`; anything due within the next 2.5 min is sent. |
| **ntfy** (optional) | ntfy app installed and subscribed | ~1 min | ntfy.sh holds scheduled messages (`At:` header) for up to 3 days; precise and free, but a second app. |

GitHub's scheduled workflows are best-effort: runs are commonly delayed by several minutes and are sometimes skipped at busy
times (top of the hour especially). So with the app closed, a 6:00 PM reminder could arrive at 5:57:30 or 6:15.

## What changed in v1.3

1. **On-device precision while Steady is alive.** Besides the 20 s sweep, the scheduler arms a one-shot timer for the very next
   reminder (re-armed after every sweep and on every data change), so it fires on the minute instead of up to 20 s late.
2. **Precise external trigger, per reminder (optional, free): Upstash QStash.** When the server queues a reminder
   (`POST /api/reminders`) and QStash is configured, it publishes one delayed message per distinct fire minute with
   `Upstash-Not-Before = fire time`. QStash calls `POST /api/cron/reminders` at that minute, forwarding our `CRON_SECRET` as the
   `Authorization` header (the endpoint already accepted it), so there is no new auth scheme. Several reminders in the same
   minute share one wake-up (dedup id `steady-<minute>`). A reschedule just leaves an extra wake-up that finds nothing due:
   harmless, because sending is idempotent (`sent_at`). With QStash on, the early-send window drops from 150 s to 20 s
   (`REMINDER_EARLY_MS` overrides it).
3. **The GitHub cron stays** as the backstop (unchanged path, nothing removed).
4. Web Push payloads carry the intended fire time; the service worker shows it as the notification's timestamp.

## Options compared (all free)

| Option | Precision | Cost / limits | Trade-offs |
| --- | --- | --- | --- |
| GitHub Actions cron (current) | 5-20 min | free | No setup; unreliable timing. Keep as backstop. |
| **QStash per reminder (implemented, off until configured)** | ~seconds | free tier 1,000 messages/day (Steady uses ~1 per reminder minute) | Needs an Upstash account and 3 env vars. Database wakes only at reminder times. |
| cron-job.org every minute → `/api/cron/reminders` with `CRON_SECRET` | ≤ 1 min | free, unlimited jobs, 1/min max | Zero code. But it wakes the function and Neon **every minute, around the clock**, which keeps the database compute from suspending and can use up Neon's free compute allowance. |
| Vercel Cron | daily on Hobby | free | Too coarse on the Hobby plan. |
| ntfy (exists) | ~1 min | free | Precise, but notifications come from the ntfy app, not Steady. Good fallback without an account. |
| Notification Triggers API (scheduled local notifications) | exact | — | Not available: the Chrome origin trial ended without shipping. Periodic Background Sync fires at most every ~12 h. A truly on-device alarm needs the native app (AlarmManager), see ROADMAP v3. |

**Recommendation:** turn on QStash (5 minutes of setup, below). Keep GitHub cron as the backstop. Skip the per-minute
cron-job.org ping unless QStash is unavailable, because of the always-on database cost.

## Turning on QStash

1. Create a free Upstash account → QStash → copy the token (and note the region URL it shows).
2. Vercel → steady → Settings → Environment Variables (Production):
   `QSTASH_TOKEN=<token>`, `QSTASH_URL=<region url, e.g. https://qstash.upstash.io>`, `PUBLIC_URL=https://karthikytodo.vercel.app`,
   `CRON_SECRET=<random, ≥16 chars>` (already used by the cron endpoint if set).
3. Redeploy. Open Steady signed in, add a task with a time 3 minutes out, close the app. The QStash console shows the delayed
   message; the push should arrive within seconds of the minute. `POST /api/reminders` responses include `exact: <n>` (wake-ups
   scheduled).
