# Reminders: how they fire, and how to make them land on the minute

## Today (v1.2) — three paths, all keyed by a stable id per reminder (`st-<taskId>`, `st-checkin-YYYYMMDD`)

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
