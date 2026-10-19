# Operations

## Where things run

| Piece | Where | Notes |
| --- | --- | --- |
| Source of truth for code | GitHub `karthikyernana/steady` (`main`) | Tags mark releases and saved designs (`design-v1.1-liquid-glass`, `v1.2.0`). |
| App + API | Vercel project `steady` (team of karthikyernana), region `sin1` | `vercel.json`: build `node scripts/migrate.mjs && node scripts/build.mjs`, output `dist/`, `/api/*` → `api/index.js`. |
| Database | Neon Postgres store `steady-db`, created through the Vercel Marketplace Neon integration (2026-10-15), region `sin1` | Connection env vars are injected by the integration. Open it from Vercel → Storage → steady-db → Open in Neon. |
| Reminder trigger | GitHub Actions `reminders.yml`, every 5 min | Authenticates with a GitHub OIDC token (audience `steady-cron`); the API checks repo + workflow. No shared secret. |

## Environment variables (Vercel)

| Variable | Set by | Used for |
| --- | --- | --- |
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` (+ `PG*`, `POSTGRES_*`) | Neon integration | API (pooled) and migrations (direct). |
| `NEON_AUTH_BASE_URL`, `VITE_NEON_AUTH_URL`, `NEON_PROJECT_ID` | Neon integration | Not used by Steady (Neon Auth was enabled on the store by default). Harmless. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | us | Web Push. |
| `CRON_SECRET` | us | Optional alternative to OIDC for `/api/cron/reminders`. |
| `MIGRATE_SECRET` | us | `POST /api/admin/migrate` (manual migration trigger). |
| `SIGNUP_MODE` (optional) | you | `open` (default) or `owners`; with `owners`, only `OWNER_EMAILS` can sign up. |
| `GOOGLE_CLIENT_ID` (optional) | you | Enables “Continue with Google”. |
| `SARVAM_API_KEY` | you | Voice: speech-to-text (Saaras v3). Also the LLM fallback (`sarvam-105b`) when Gemini is unset or down. Without it the mic falls back to typing. |
| `GEMINI_API_KEY` | you | Voice agent's primary planner (Gemini REST, strict JSON schema). Without it Sarvam plans; without both, a rules planner does. |
| `GEMINI_MODEL` (optional) | you | Default `gemini-3.8-flash`. `GEMINI_THINKING`: `low` (default) / `minimal` / `off`. |
| `SARVAM_STT_MODEL`, `SARVAM_STT_MODE`, `SARVAM_STT_LANGUAGE` (optional) | you | Defaults `saaras:v3`, `codemix`, `unknown` (auto-detect). |
| `SARVAM_LLM_MODEL`, `SARVAM_JSON_MODE` (optional) | you | Defaults `sarvam-105b`, `object` (JSON mode + shape in prompt; measured 2-4 s). `schema` = strict json_schema (slower). `AGENT_SARVAM_LLM=off` disables the Sarvam LLM fallback. |
| `AGENT_DAILY_LIMIT` (optional) | you | Per-user daily cap for transcriptions and plans (default 200 each). |
| `AGENT_GLOBAL_DAILY_LIMIT` (optional) | you | All-users daily ceiling per kind (default 3000), so open sign-ups cannot multiply the AI bill. |
| `QSTASH_TOKEN`, `QSTASH_URL`, `PUBLIC_URL` (optional) | you | Exact-minute reminder wake-ups via Upstash QStash; needs `CRON_SECRET` too. See docs/NOTIFICATIONS.md. |
| `REMINDER_EARLY_MS` (optional) | you | How early a push may be sent (default 150000, or 20000 when QStash is on). |

Retired in v1.2 (removed): `SETUP_CODE`, `ALLOWED_EMAIL`, `OWNER_EMAILS` (no longer needed while sign-ups are open).

## Release checklist

1. `npm test && npm run check` (and the Playwright QA in `tests/` when UI changed).
2. Bump `package.json` version and `APP_VERSION` in `js/ui/views/settings.js`; add a `CHANGELOG.md` entry.
3. New client files must be listed in `sw.js` `SHELL` (`npm run check` fails otherwise).
4. Schema change → new file `db/migrations/NNNN_name.sql` (never edit an applied one). It runs on deploy.
5. Commit to `main`, tag the release, deploy to Vercel production, verify `/api/config` and the app on phone + desktop.

## Releasing 1.3 (Money + voice agent) — checklist

1. Vercel env: `SARVAM_API_KEY`, `GEMINI_API_KEY` (Production + Preview). Optional: QStash trio + `CRON_SECRET`.
2. `vercel.json` now sends `Permissions-Policy: microphone=(self)` (was `microphone=()`, which blocks the mic) and bundles `js/core/**` into the API function (the server imports the shared agent core).
3. Migration `0006_money_agent.sql` runs on deploy (records `coll` check + `agent_memory` + `agent_usage`, all RLS). `0007_agent_usage_total.sql` adds the all-users counter (no user data, no RLS).
4. Data contract moves to schemaVersion 2: open the new version on every device once; a 1.2 device shows "update this device" until it reloads.
5. Bump `package.json` + `APP_VERSION` to 1.3.0 and date the CHANGELOG entry at release time.

## Common tasks

- **Close sign-ups:** set `SIGNUP_MODE=owners` and `OWNER_EMAILS=you@example.com`, redeploy.
- **Forgotten password:** there is no email provider yet, so resets are manual: an admin sets a new scrypt hash in
  `owners.password_hash` (see `server/auth.js: hashPassphrase`). Adding email reset needs a mail provider (e.g. Resend).
- **Move to another database:** point `DATABASE_URL(_UNPOOLED)` at it and redeploy; migrations create the schema.
