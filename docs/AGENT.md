# Chat agent (agent layer, phase 1)

A **Chat** screen where one agent answers questions about your own Steady data ("how much did I spend this week?",
"how are my goals going?", "what did I write about pricing?") with a few words plus **cards**: charts, lists and tables
drawn natively by each app. Phase 1 is **read-only**: the agent can look, never change. Writes and Accept buttons are
phase 2 (an `Actions` card), and voice replies are not planned.

```
 Web (js/ui/views/chat.js)            /api (server/routes.js → server/chat.js)                 model (free tiers)
 Android (ui/screens/Chat.kt)         ───────────────────────────────────────                  ─────────────────
   POST /api/agent/chat  ──────────▶  auth + X-Steady CSRF ─▶ daily cap (agent_usage 'chat')
     { chatId?, message, tz }         ─▶ first-question cache? ─▶ router: Groq → Gemini → Cloudflare ─▶ tool calls
                                      ◀─ ≤ 5 rounds of READ-ONLY tools, each in its own withOwner() tx (RLS)
                                      ─▶ reply tool { text, cards[] } ─▶ validateCards() (strict, repairing)
                                      ─▶ store agent_chats / agent_messages (cards = QUERY specs)
   ◀── { chatId, title, user, message: { text, cards: [resolved] } }   ◀─ resolveCards(): figures from real rows
   GET /api/agent/chats · GET /api/agent/chats/:id (cards re-resolved from today's data) · DELETE /api/agent/chats/:id
```

Files: `server/chat.js` (router, loop, storage, cap, cache) · `server/chat-tools.js` (tools) · `server/chat-cards.js`
(card kit, validator, resolver, the guide the model is taught) · `db/migrations/0009_agent_chat.sql` ·
web `js/data/chat.js`, `js/ui/views/chat.js`, `js/ui/cards.js` · Android `agent/Chat.kt`, `ui/screens/Chat.kt`,
`ui/screens/ChatCards.kt`, `ui/Ask.kt` (Ask button) · web `js/ui/press.js` (tap/hold rule) · mock `tests/mocks/ai-mock.mjs` (`chatCompletion`).

## The two safety rules

1. **Cards store a query, never numbers.** A data card names a read-only tool, its params and which field to show
   (`{ component: 'Bar', query: { tool: 'query_money', params: { from, to, group_by: 'category' } }, bind: { y: 'sum' } }`).
   The server runs that query against the user's rows when the reply is sent **and every time the chat is opened again**,
   then sends the resolved `data` to the app. Anything else the model puts in a card (a `value`, `points`, `display`,
   `data`…) is not in the schema and is dropped by `validateCard()`, so a made-up figure can never be drawn. Relative
   periods ("this_week") are frozen into real days when the reply is made, so reopening a chat shows the same period with
   that period's current data. Note and Callout cards are plain words; one that contains a figure (`₹250`, `40%`) is dropped.
2. **Nothing executable.** Cards are data from a fixed kit of 11 components. Clients render each one natively (SVG/CSS on
   web, Compose on Android) and escape every string; model HTML, markdown, code and URLs are never rendered (the server
   also strips tags and markdown marks from titles and text).

The reply **text** may quote figures, but only ones a tool returned (the system prompt requires it, and every fact must
come from a tool call). That is a prompt-level rule, not a hard guarantee; the cards are the guaranteed path.

## Tools (read-only, `server/chat-tools.js`)

Each tool call runs one statement at a time through `withOwner(ownerId)` (FORCE RLS, `app.owner_id`), so it can only
ever see this user's `records`. No tool writes. Each collection is read once per request (≤ 5000 rows) and aggregated in
JS; `search_thoughts` uses SQL (`ILIKE` + `to_tsvector('simple') @@ plainto_tsquery`). Dates are the user's calendar
days in their zone (`tz` from the client, default Asia/Kolkata); weeks start Monday.

| Tool | Params (all optional unless noted) | Result fields cards can bind |
| --- | --- | --- |
| `query_tasks` | `status` open/done/skipped/any · period · `date_field` due/done · `goal` (id or title) · `group_by` day/weekday/hour/goal/status · `limit` | scalar `count`; items `title status due time done_on goal priority`; groups `count` |
| `query_goals` | `goal` | scalars `count milestones_done milestones_total progress`; items `title target done total progress` |
| `query_money` | `kind` expense/income/any (default expense) · period (default this month) · `category` · `payee` · `group_by` day/week/month/category/payee · `limit` | scalars `total count avg_per_day` (₹); items `date kind amount category payee note`; groups `sum count` |
| `query_thoughts` | period (default last 30 days) · `tag` · `kind` · `group_by` day/tag/mood/kind · `limit` | scalar `count`; items `date text tags mood kind`; groups `count` |
| `search_thoughts` | `query` (required) · `limit` | scalar `count`; items as above |
| `get_insights_summary` | – | `streak_current streak_longest done_this_week done_last_week rate_last_7 rate_last_30 avg_done_per_day spent_this_week spent_last_week spent_month milestones_done milestones_total thoughts_month` (+ best window/day, slump, learned patterns as text) |

A **period** is `range` (`today yesterday tomorrow this_week last_week next_7_days last_7_days last_30_days last_90_days
this_month last_month this_year all`) or `from`/`to` days (`YYYY-MM-DD`, spans capped at ~2 years). Every param is
re-validated and clamped (`clean()`), because model input is untrusted. `get_insights_summary` reuses the app's own
`js/core/engine.js` + `js/core/overview.js` (timestamps shifted so the engine's local-time getters read the user's zone).

## Cards (`server/chat-cards.js`)

Stored spec: `{ id, component, title?, query?: { tool, params }, bind?, compare?, text?, tone? }`. At most 4 per reply.
Resolved card = spec + `data`:

| Component | Needs | Resolved `data` |
| --- | --- | --- |
| `Stat` | any tool; `bind.value` = a scalar (default the tool's first); optional `bind.label`; optional `compare: { params, label }` | `value display label period compare?{ value display delta deltaDisplay label }` |
| `Line` | money/tasks/thoughts, `group_by` day/week/month (repaired to day) | `points[{ key label value display }] total totalDisplay unit period empty` |
| `Bar` | money/tasks/thoughts, any `group_by` | same as Line |
| `Donut` | `group_by` category/payee/status/goal/tag/mood/kind (repaired); top 5 + Other | same as Line |
| `Heatmap` | tasks/money/thoughts; grouped by day (default last 90 days) | `days[{ date value display }] max from to unit period empty` |
| `ProgressList` | `query_goals` | `items[{ id label done total frac display }] empty` |
| `TaskList` | `query_tasks` (≤ 20) | `items[{ id title status due time goal dueDisplay }] count period empty` |
| `Timeline` | tasks/money/thoughts/search_thoughts (≤ 20) | `items[{ date time title sub dateDisplay }] period empty` |
| `Table` | any tool; `bind.rows` items/groups; `bind.columns` ≤ 4 allowed fields | `columns[{ key label }] rows[[string]] period empty` |
| `Note` | `text` (≤ 600, no figures) | `text` |
| `Callout` | `text` (≤ 300, no figures), `tone` info/good/warn | `text tone` |

Validation is strict but repairing: unknown components/tools → dropped; wrong casing → fixed; a chart without a usable
`group_by` → sensible default; bad `bind` → default field; unknown keys → removed; >4 cards → the rest dropped. Dropped
cards are listed in the message's `meta.dropped` (stored, not shown). A card whose data cannot be read resolves to
`{ empty: true }` so one bad card never hides the answer. The guide the model is taught (`CARD_GUIDE`) lives beside the
validator so the two cannot drift.

## Model router

All three providers speak OpenAI-compatible chat completions with tool calling, so there is one client (`complete()`):

1. **Groq** `openai/gpt-oss-120b` (`GROQ_API_KEY`; `reasoning_effort: low`).
2. **Gemini Flash-Lite** through Gemini's OpenAI layer `…/v1beta/openai/chat/completions` (existing `GEMINI_API_KEY`;
   model `AGENT_GEMINI_MODEL`, default `gemini-flash-lite-latest`). This key hit 429 quota earlier, which is why it is second.
3. **Cloudflare Workers AI** `…/accounts/{CF_ACCOUNT_ID}/ai/v1/chat/completions` (`CF_API_TOKEN`; model `CF_MODEL`, default
   `@cf/meta/llama-3.3-70b-instruct-fp8-fast`).

Each is used only when its env is set. A provider that fails (429, 5xx, timeout 25 s, malformed reply) hands the whole
turn to the next one, which starts the turn fresh (tool results are deterministic, so this is cheap and avoids mixing
provider-specific message fields). The loop allows **5 rounds of tool calls**; the 6th call forces the `reply` tool
(`tool_choice`). A model that answers in plain content instead is accepted as text without cards. With no provider
configured, `/api/config` reports `chat: { on: false }` and the endpoint answers 503 with a calm message; with every
provider failing it answers 502 "I could not reach a model right now" and the turn is refunded from the cap.

The model sees: a system prompt (now in the user's zone, the rules, `CARD_GUIDE`), the last 12 messages of the chat
(earlier cards described by their query, never their numbers), and the new message.

## Cap, cache, storage

- **Daily cap:** `AGENT_DAILY_CAP` turns per user per day (default 60), counted in `agent_usage` (kind `chat`, RLS) plus
  the all-users ceiling `AGENT_GLOBAL_DAILY_LIMIT` in `agent_usage_total`. Day = Asia/Kolkata. 429 when reached.
- **Short cache (safe case only):** a chat's *first* question, asked again within `AGENT_CHAT_CACHE_MS` (default 10 min)
  with the same wording (case/space-insensitive), the same day and the **same data** (cache key includes the account's
  latest record `seq`) reuses the stored reply spec. Not counted against the cap. The cards are still resolved fresh.
  Follow-ups are never cached (they depend on history).
- **Tables** (`0009_agent_chat.sql`): `agent_chats (id, owner_id, title, …)` and `agent_messages (chat_id, owner_id,
  role, text, cards jsonb = specs, meta jsonb, cache_key)`, both FORCE RLS on `app.owner_id`; a message's insert policy
  also checks the chat is the owner's. Deleting a chat deletes its messages; deleting the account deletes all chats.
  Chats are plain API data, not part of record sync.

## Apps

- **Entry:** the floating **Ask** button, bottom right (the one floating button; it replaced the mic). **Tap** opens
  Chat. **Press and hold** is the voice agent, unchanged: the capture sheet opens after `HOLD_MS` (380 ms) and records
  while the finger is down (a pause never ends a held turn); letting go more than `RELEASE_MS` (450 ms) later finishes
  the turn (transcript → drafts → Accept), letting go sooner keeps listening hands-free. One rule, shared by both apps:
  web `js/ui/press.js` (`releaseOutcome`), Android `ui/Ask.kt` (`AskPress.outcome`). A labelled pill (bubble + voice wave,
  "Ask") with a ring that closes in while you hold; a "Tap to ask · Hold to talk" note shows on the first three runs until
  the first hold (`askHintN` / `askHeld` in device-local settings). Keyboard / assistive tech: Enter/Space or a click =
  tap, `V` (web) = a hands-free voice turn, TalkBack long-press = a hands-free voice turn. K / You stays top right; the
  bottom bar stays at exactly five tabs. Desktop also keeps **Chat** above **You** in the side rail.
- **Screen (phones):** a full-height sheet that rises from the bottom over the app (top bar, tab bar and Ask step away).
  The header holds only the title (and a grab handle). Every control is in the bottom thumb zone: a row with **History**,
  **New** and **Close** just above the composer (text box, **dictation mic**, send). History opens as a bottom sheet
  (tap a chat to open it, the bin to delete). Close with Close, by dragging the header down (> 90 px or a flick), Back,
  or Esc (Esc closes an open sheet first). Close returns to the screen Chat was opened from. The composer row sits on
  the soft keyboard: web sets `--kb` from `visualViewport` (0 where the browser already resizes the page), Android pads
  by `WindowInsets.ime ∪ navigationBars`.
- **Screen (desktop web):** a messenger-style panel docked in the bottom-right corner (440 px wide, up to 80vh tall,
  resizable from its top-left corner; the size is kept in device-local `chatPanelSize`) over whatever page is open. Ask
  and the side-rail Chat item open it (the rail item toggles it); side-rail tabs keep it open while the page changes.
  The same History · New · Close row and composer sit at its bottom; History opens inside the panel. Esc closes History
  first, then the panel. Ask is hidden while it is open. `#/chat` deep-links to it (over Today).
- **Thread (all sizes):** bottom-anchored (`margin-top: auto` in its own scroller on web, `Arrangement.Bottom` on
  Android): few messages sit just above the composer, newest at the bottom. It follows new content while you are at the
  bottom (or just sent); scroll up and it leaves you be and shows a **Latest** pill (`chat-jump`). Each chat keeps its
  own scroll position and draft.
- **Several chats in flight:** each question runs for its own chat (web: a promise per conversation in `views/chat.js`;
  Android: a coroutine on the app scope per `ChatConv`), never tied to the chat on screen. History and New stay live
  while one answers; the answer lands in its chat (History: "Answering…" `chat-hist-pending`, then a dot; a toast says
  it is ready), and nothing is lost or doubled (replies are appended by message id).
- **Errors:** a calm line plus Try again; raw provider text never shows. `[ … ]` debug detail from the server is
  stripped and anything still provider/HTTP-looking becomes "Busy right now, try again in a moment." (web
  `js/core/chat-ui.js` `friendlyError`, Android `ChatErrors`); details go to the console / log.
- **History:** last activity first; rename (sends `PATCH agent/chats/:id`; until the server has that route the name is
  kept on the device, `chatTitles`), delete.
- **Dictation:** the composer mic transcribes only (nothing is planned or saved); there are no spoken replies.
- **Signed out:** "Chat needs your account". **Offline:** a calm message, the composer disabled; web keeps the last
  chat it showed (cards as they were) readable. **Not configured:** "Chat isn't set up yet".
- **Rendering:** web `js/ui/cards.js` (pure string renderers, reuses `charts.bars()`; heatmap/donut/line are small SVGs);
  Android `ui/screens/ChatCards.kt` (Compose Canvas + Text, reuses `Bars`/`SCard`). Test tags (Android: exposed as
  resource ids) `card-<kind>`, `cc-value`, `ask-fab` (web `#ask-fab`, `data-testid=ask`), `ask-hint`, `chat-sheet`
  (Android), `chat-head`, `chat-title`, `chat-dock`, `chat-hist-btn`, `chat-new`, `chat-close`, `chat-composer`,
  `chat-input`, `chat-mic`, `chat-send`, `chat-history`, `chat-hist-item` (Android), `chat-msg-user`, `chat-msg-agent`,
  `chat-panel` (web), `chat-resize` (web), `chat-hist-pane` (web desktop), `chat-hist-pending`, `chat-jump`, `chat-wait`, `chat-error`, `chat-retry`.
  The side-rail entry on desktop web keeps `chat-btn`.

## How to add a tool

1. Add an entry to `TOOLS` in `server/chat-tools.js`: `description`, JSON-schema `parameters`, `clean(params)` (validate
   and clamp; never trust the model), `run(load, params, ctx)` (read through `load(coll)` or `ctx.sql`, which are RLS-scoped;
   **never write**), and `fields` (`scalars` with a format, `items`, `ys`, `groupBys`) so cards can bind to it.
2. If cards should plot it, allow it in `CHART_TOOLS` / `TIMELINE_TOOLS` in `server/chat-cards.js` and mention it in `CARD_GUIDE`.
3. Teach the mock a keyword for it (`tests/mocks/ai-mock.mjs`) and add tests in `tests/unit/chat.test.mjs` (pure) and
   `tests/api/chat.test.mjs` (RLS: user B must not see it).

## How to add a card kind

1. Server: add it to `COMPONENTS`, a `validateCard()` branch (what it needs, how to repair), a `resolveOne()` branch
   (the `data` shape), and a line in `CARD_GUIDE`.
2. Web: a renderer in `js/ui/cards.js` (+ CSS under "chat cards" in `css/app.css`), and add it to `KINDS`.
3. Android: add it to `ChatKinds.ALL`, typed accessors on `ChatCard` if needed, and a branch in `ChatCardView`.
4. Tests: `tests/unit/chat.test.mjs` (shape), `tests/unit/cards-web.test.mjs`, `ChatCardsTest` / `ChatCardsRenderTest`
   (regenerate `android/app/src/test/resources/chat/reply-all-kinds.json` from the local stack). Older apps skip kinds
   they do not know, so a new kind never breaks an old client.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `GROQ_API_KEY` | – | Primary provider (Groq). |
| `GROQ_MODEL`, `GROQ_REASONING`, `GROQ_BASE_URL` | `openai/gpt-oss-120b`, `low`, `https://api.groq.com/openai/v1` | Model, reasoning effort, base URL (tests point it at the mock). |
| `GEMINI_API_KEY` (existing) | – | Second provider. `AGENT_CHAT_GEMINI=off` keeps Gemini for voice only. |
| `AGENT_GEMINI_MODEL`, `GEMINI_BASE_URL` | `gemini-flash-lite-latest`, Google | Chat model on Gemini's OpenAI layer. |
| `CF_ACCOUNT_ID`, `CF_API_TOKEN` | – | Third provider (both needed). |
| `CF_MODEL`, `CF_BASE_URL` | `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, `https://api.cloudflare.com/client/v4` | Workers AI model and base URL. |
| `AGENT_DAILY_CAP` | 60 | Chat turns per user per day. |
| `AGENT_CHAT_CACHE_MS` | 600000 | First-question cache window. |
| `AGENT_CHAT_TIMEOUT_MS` | 25000 | Per model call. |

## Tests

`npm test` → `tests/unit/chat.test.mjs` (tools, ranges/zones under any process TZ, card schema + repairs, the
query-not-numbers rule, resolution follows data, every component's shape, router fallback Groq → Gemini → Cloudflare,
step cap, plain-content replies) and `tests/unit/cards-web.test.mjs` (every web renderer, escaping, empty states).
`TEST_DATABASE_URL=… node --test tests/api/chat.test.mjs` → auth + CSRF, RLS (B never sees A's rows, chats or thoughts;
DB-level policy check), stored specs carry no numbers and re-resolve, history/delete, cache, router fallback end to end,
cap + refund, unconfigured 503. `tests/unit/press.test.mjs` → Ask's tap/hold rule. `python3 tests/qa/chat_e2e.py
http://localhost:8790/` → the whole web flow in Chromium: Ask tap opens Chat, Ask hold records → drafts, controls in the
thumb zone, history sheet, Close / swipe-down / Back / Esc. It also checks the desktop bottom-right panel (size, controls at its bottom, History inside, tabs keep it open, resize,
Esc, deep link), the bottom-anchored thread with auto-follow and the Latest pill, switching chats while a slow answer is
pending (the mock answers any question containing "slow" after 2.5 s per model call; `POST /__mock/state {"chatDelayMs": n}`
slows every call), calm error text (a routed 502 carrying `[groq 429: …]`) with Try again, rename, and a "show me that
as a graph" follow-up drawing a chart. `tests/unit/chat-ui.test.mjs` covers `friendlyError`, history order and de-dup;
`tests/qa/chat_ux_shots.py` takes the desktop / phone / switching screenshots. Android `ChatSwitchTest` (a fake backend
with gated answers) covers switching while pending, errors, rename. `tests/qa/audit.py` includes Chat and the history sheet
(360/412/1366/1536, light + dark).
Android: `ChatCardsTest`, `ChatCardsRenderTest`, `ChatScreenTest` (live, against the local stack; Ask tap vs hold,
thumb-zone bounds, history sheet, Close/Back, `AskPress` rule; taps inside a `ModalBottomSheet` use
`performSemanticsAction(OnClick)` under Robolectric); `ScreenshotTestChat`
(pixels, x86_64 only) and `ScreenshotTestChatLayout` (semantics layout dump) run with `STEADY_SHOTS=dir`.
