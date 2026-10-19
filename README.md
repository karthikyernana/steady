# Steady

**A calm, adaptive personal tracker that learns how you work, and keeps you consistent on the days motivation doesn't show up.**

Built for one person (Karthik) first. Local-first, offline, installable on Android, no server, no account. Your data lives on your devices and, if you choose, in a private GitHub repo that only you own.

**Live app:** https://karthikyernana.github.io/steady/

---

## Why it exists

Motivation lasts a day or two. Generic to-do apps assume it lasts forever, so they pile up guilt. Steady does the opposite: it watches what you actually finish, learns your best hours and days, and when you've been missing it shrinks the day to a *minimum viable day* of one to three tiny things. Small days count.

## Features

| Area | What it does |
| --- | --- |
| **Today** | Quick-add in plain language (`linkedin 20 min at 6pm`, `call mom tomorrow 7:30pm !`), priorities, due time, reminders, done / skip / undo, gentle carry-over of unfinished tasks, an evening check-in card. |
| **Goals** | Long goals broken into weekly milestones and small daily actions; one tap sends an action to Today; progress bars. |
| **Thoughts** | Quick capture for ideas, notes and journal lines with `#tags` and mood; search and tag filters. |
| **Insights** | Streaks, a contribution-style heatmap, completion by weekday and hour, energy vs output, recent wins. Inline SVG charts, no CDN. |
| **Adaptive engine** | Learns best hours/days, suggests reminder times, caps daily load, detects slumps and offers a minimum viable day, and explains every pattern in plain sentences ("You finish most of your tasks between 9–11 PM"). Rule-based and on-device. See [docs/ADAPTIVE_ENGINE.md](docs/ADAPTIVE_ENGINE.md). |
| **Reminders** | Local notifications via the service worker, plus reliable Android reminders through [ntfy](https://ntfy.sh) scheduled delivery, no server of ours. |
| **Sync** | Laptop and phone stay in step through your own private GitHub repo (`data/state.json`), merged per record with tombstones. Sync now button, auto-sync on open/focus/change, QR pairing. |
| **Data** | Export/Import JSON (merging, never clobbering), versioned schema with migrations. |
| **Hark plugin** | Optional and off by default. Hark can read the same private repo; Steady never depends on Hark. |

## Install on Android

1. Open **https://karthikyernana.github.io/steady/** in Chrome on your phone.
2. Tap **⋮ → Add to Home screen → Install** (or the *Install* card inside Steady).
3. Open Steady from the home screen. It works offline from then on.

## Set up phone reminders (ntfy), 2 minutes

1. In Steady: **You → Phone reminders that always arrive →** switch on. A long random private topic is generated for you.
2. Install **ntfy** from [Google Play](https://play.google.com/store/apps/details?id=io.heckel.ntfy) or [F-Droid](https://f-droid.org/packages/io.heckel.ntfy/).
3. In ntfy tap **+**, paste the topic, keep the server `ntfy.sh`, subscribe.
4. Back in Steady tap **Send test notification**.

Reminders up to 3 days ahead are scheduled on ntfy immediately (`At:` header, ntfy's limit); later ones are queued automatically the next time you open Steady. Finishing or deleting a task cancels its reminder. The topic is like a password: anyone who knows it can read your reminders. A different ntfy server can be set under *Advanced*.

## Set up sync between devices, 3 minutes, once

1. Create a **private** GitHub repo, e.g. `steady-data`.
2. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new): *Only select repositories →* `steady-data`; *Permissions → Contents: Read and write*.
3. In Steady: **You → Sync across devices →** paste `username/steady-data` and the token → **Connect**.
4. On the second device: **You → Pair another device** shows a QR code. Scan it with the phone camera (opens Steady and pairs), or paste the sync key under *I have a sync key*.

The token never leaves the device except to talk to `api.github.com`. It's stored only in that device's IndexedDB.

## Run locally

```bash
python3 -m http.server 8765        # then open http://localhost:8765/
npm test                           # unit tests (Node 20+)
bash tests/setup.sh                # one-time: Playwright, axe-core, Lighthouse
bash tests/run_all.sh              # full end-to-end suite
```

No build step. Plain ES modules, HTML and CSS. See [docs/TESTING.md](docs/TESTING.md).

## Docs

- [PRD](docs/PRD.md) · [Architecture](docs/ARCHITECTURE.md) · [Data model](docs/DATA_MODEL.md) · [Adaptive engine](docs/ADAPTIVE_ENGINE.md)
- [Testing](docs/TESTING.md) · [Roadmap](docs/ROADMAP.md) · [Porting](docs/PORTING.md) · [V2 agents plan](docs/V2_AGENTS_PLAN.md)
- [Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md) · [License (MIT)](LICENSE)
