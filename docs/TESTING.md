# Testing

## Layers
| Layer | Tool | Where | What |
| --- | --- | --- | --- |
| Unit | `node:test` (Node 20+) | `tests/unit/*.test.mjs` | Quick-add parser, merge/tombstones/prune, schema + migrations (incl. newer-schema refusal, idempotency, forward-compat fields), adaptive engine rules, voice lines. |
| Static | Node | `tests/check-shell.mjs` | Every module import resolves, every module is precached by the SW, manifest icons exist, maskable icon present. |
| End-to-end | Playwright (Chromium) | `tests/e2e.py` | Real browser flows at 412×915, 360×740, 1440×900 in light and dark. |
| Accessibility | axe-core in Playwright | `tests/e2e.py` | WCAG 2.1 A/AA + best-practice rules on key screens. |
| Layout audit | Playwright | `tests/e2e.py` (`ui_audit`) | Horizontal overflow, off-screen controls, tap targets < 44 px, clipped text. |
| PWA | Chrome DevTools Protocol | `tests/e2e.py` (`pwa`) | `Page.getInstallabilityErrors`, manifest errors, icons reachable. |
| Performance | Lighthouse 12 | `npx lighthouse` | Performance, accessibility, best practices scores. |

## Run
```bash
npm test                 # unit
npm run check            # static
bash tests/setup.sh      # once per machine
mkdir -p /tmp/srv && ln -sfn "$PWD" /tmp/srv/steady && (cd /tmp/srv && python3 -m http.server 8765 &)   # app at http://localhost:8765/steady/ (same sub-path as GitHub Pages)
bash tests/run_all.sh    # every E2E suite in its own process; screenshots in tests/shots/
python3 tests/e2e.py --only core-mobile-light   # one suite
python3 tests/e2e.py --only realsync --real-github owner/steady-data   # real two-device sync against GitHub
```

## E2E coverage
| Suite | Checks |
| --- | --- |
| `core-<viewport>-<theme>` ×6 | onboarding; quick-add parsing (example, tomorrow, priority, ambiguous time, rollover); complete/undo/skip; edit sheet; goals (milestones, progress, action → today); thoughts (tags, mood, search, filter); evening check-in; insights with 30 days of seeded data; slump → minimum viable day; carry-over; reminder suggestion; ntfy topic generation; theme switch; visible keyboard focus; no console errors; screenshots + layout audit + axe on every screen. |
| `screens` | Populated screens and sheets at all sizes/themes for the visual pass. |
| `export` | Export → import into a fresh device; re-import is idempotent. |
| `offline` | SW controls page, ≥ 30 files cached, offline reload, add task offline, charts and fonts offline. |
| `notif` | Permission granted flow + SW `showNotification`; gentle permission ask after the first timed task. |
| `ntfy` | Browser publish to ntfy.sh (CORS); test publish 200 on a public ntfy instance; scheduled reminder `POST /<topic>/st-<id>` with `At` (server echoes the scheduled time); completion sends `DELETE`. |
| `sync` | Mock GitHub contents API with real sha semantics: bad token error; connect; pairing via key; both devices offline edits + delete + conflicting edit → identical merged state; forced 409 → retry; Sync now + last-synced; debounced auto-sync; file shape; Hark snapshot. |
| `pairlink` | `#pair=<key>` deep link (what the QR encodes) on a fresh device. |
| `realsync` | Same two-device flow against the real private repo through the GitHub API. |
| `pwa` | Installability with zero errors, manifest + icons. |

## CI
`.github/workflows/ci.yml` runs unit + static on every push, then the E2E suites (minus internet-dependent `ntfy`/`realsync`) with Playwright.
