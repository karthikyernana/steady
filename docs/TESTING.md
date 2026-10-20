# Testing

| Layer | Command | What it covers |
| --- | --- | --- |
| Unit | `npm test` | Pure core: quick-add parser, adaptive engine, merge, schema migrations (v1 → v2), **money** (amount words in English/Telugu, quick-add, summaries, budgets), **voice agent** (context bounds, refs, schema, validation, rules planner in English/Telugu/code-mix, learning), and **providers** against a local mock of Sarvam + Gemini (`tests/mocks/ai-mock.mjs`: request shape, fallback chain, stream run-on cut-off, STT multipart). |
| Static | `npm run check` | Every client module is precached by the service worker; import graph resolves; manifest icons exist. |
| API | `TEST_DATABASE_URL=… npm run test:api` | Router against a real Postgres (non-superuser role so RLS applies). |
| API (agent) | `TEST_DATABASE_URL=… node --test tests/api/agent.test.mjs` | `/api/agent/*` with the AI mock: auth + CSRF, raw-audio transcribe, plan writes nothing, learning per user (RLS) and fed back into the prompt, money sync + RLS, daily cap. |
| Chat (agent) | `npm test` (tests/unit/chat.test.mjs, cards-web.test.mjs) · `TEST_DATABASE_URL=… node --test tests/api/chat.test.mjs` | Read-only tools, card schema + repair, query-not-numbers, resolution, router fallback Groq → Gemini → Cloudflare, step cap; API: RLS between users, stored specs carry no numbers, history, cache, cap. See docs/AGENT.md. |
| Chat E2E | `python3 tests/qa/chat_e2e.py http://localhost:8790/` | Entry beside You (5 tabs), signed out, all 11 card kinds with real figures, history, mic dictation, offline, desktop layout. Needs the stack with `GROQ_API_KEY=x GROQ_BASE_URL=http://127.0.0.1:8791/openai/v1`. |
| Voice E2E | `python3 tests/qa/agent_e2e.py http://localhost:8790/` | Fake microphone (fixture WAV) → transcript → 3 drafts from one utterance → edit → Accept → data changes → live sync to a 2nd device; typing fallback signed out; learning; undo; money quick-add. Needs the stack started with the AI mock (see the file header). |
| Preview shots | `python3 tests/qa/money_shots.py http://localhost:8790/` | Money tab, voice listening, draft cards (and scrolled to the end, asserting the last card clears the action bar), editing, accepted, typing, settings — 390 px + 1366 px, light + dark → `qa-shots/money/`. |
| End-to-end | `python3 tests/qa/sync_e2e.py http://localhost:8765/` | Two browsers: onboarding, quick-add chips, account create (email → password, no silent sign-up), wrong password, login on a 2nd device, live sync both ways, tab switching, console errors. |
| Layout audit | `python3 tests/qa/audit.py http://localhost:8765/ <tag>` | Every screen at 360/412 px (touch) and 1366/1536 px (Windows), light + dark: horizontal overflow, tap targets < 44 px, clipped text; screenshots to `tests/qa/shots/`. |

Local stack: `DATABASE_URL=postgres://… npm run migrate && DATABASE_URL=postgres://… PORT=8765 npm run dev`.
With the AI mock (no keys): `node tests/mocks/ai-mock.mjs 8791 &` and start the dev server with `SARVAM_API_KEY=mock GEMINI_API_KEY=mock SARVAM_BASE_URL=http://127.0.0.1:8791 GEMINI_BASE_URL=http://127.0.0.1:8791`.
Against real Sarvam from a proxied sandbox, Node's `fetch` needs `NODE_USE_ENV_PROXY=1 node --use-system-ca …`.
Playwright: `pip install playwright==1.49.1 && python3 -m playwright install --with-deps chromium`.

CI (`.github/workflows/ci.yml`) runs unit + static on every push.
