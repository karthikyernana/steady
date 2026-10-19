# Testing

| Layer | Command | What it covers |
| --- | --- | --- |
| Unit | `npm test` | Pure core: quick-add parser (dates, times, durations, filler words, goal linking), adaptive engine, merge, schema migrations. |
| Static | `npm run check` | Every client module is precached by the service worker; import graph resolves; manifest icons exist. |
| API | `TEST_DATABASE_URL=… npm run test:api` | Router against a real Postgres (non-superuser role so RLS applies). |
| End-to-end | `python3 tests/qa/sync_e2e.py http://localhost:8765/` | Two browsers: onboarding, quick-add chips, account create (email → password, no silent sign-up), wrong password, login on a 2nd device, live sync both ways, tab switching, console errors. |
| Layout audit | `python3 tests/qa/audit.py http://localhost:8765/ <tag>` | Every screen at 360/412 px (touch) and 1366/1536 px (Windows), light + dark: horizontal overflow, tap targets < 44 px, clipped text; screenshots to `tests/qa/shots/`. |

Local stack: `DATABASE_URL=postgres://… npm run migrate && DATABASE_URL=postgres://… PORT=8765 npm run dev`.
Playwright: `pip install playwright==1.49.1 && python3 -m playwright install --with-deps chromium`.

CI (`.github/workflows/ci.yml`) runs unit + static on every push.
