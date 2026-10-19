# Roadmap

## v1.x (polish, no new dependencies)
- Recurring tasks and simple habits (daily / weekdays / N× per week) feeding the same engine.
- Weekly review screen (Sunday evening): wins, misses, next week's one milestone.
- Drag to reorder; swipe actions on mobile.
- Focus timer that logs actual minutes (improves size and time-of-day learning).
- Encrypted sync option (passphrase, AES-GCM via WebCrypto) so the repo holds ciphertext.
- Calendar export (.ics) for timed tasks.

## Shipped in 1.3
- Money tab, and the voice capture agent (see VOICE_AGENT.md) — the first piece of the v2 AI layer, server-side with explicit Accept.

## v2: AI layer, optional plugin (see V2_AGENTS_PLAN.md)
- Planner, coach, reflection and insight agents behind one orchestrator, reading the same data contract.
- On-device first (Chrome Prompt API / Gemini Nano on Android), cloud LLM by explicit opt-in.
- Natural-language weekly planning, gentle check-in conversations, deeper pattern explanations.

## v3: native and ambient
- Native Android app (Kotlin/Compose or React Native) using the same `state.json` contract and ported core rules.
- Home-screen widgets: today's three, streak, quick add.
- Wear OS tile for check-ins; exact alarms via AlarmManager instead of ntfy.
- Optional Supabase/Postgres backend as an alternative sync target (same merge rules).
