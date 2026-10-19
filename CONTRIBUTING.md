# Contributing

Steady is a personal product with a public codebase. Changes should keep it calm, fast and dependable.

## Ground rules
1. **Local-first, no server.** Nothing may require a backend Steady operates. Network features (sync, ntfy, plugins) are optional and must fail gracefully offline.
2. **The data contract is sacred.** Any change to stored shapes bumps `SCHEMA_VERSION` in `js/core/schema.js`, adds `MIGRATIONS[n]`, updates `docs/DATA_MODEL.md`, and adds a migration unit test. Never drop unknown fields.
3. **Pure core.** `js/core/*` must not touch the DOM, IndexedDB or the network so it stays unit-testable and portable.
4. **Explainable adaptivity.** Every engine rule and threshold lives in `RULES` and is documented in `docs/ADAPTIVE_ENGINE.md`.
5. **Design.** Warm off-white / charcoal grounds, Instrument Serif display + Inter UI, one moss accent, soft cards, 44px minimum tap targets, WCAG AA contrast. Copy speaks to Karthik like a calm, sharp concierge: short, specific, never guilt.

## Workflow
- Branch from `main`: `feat/…`, `fix/…`, `docs/…`.
- Conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
- Before a PR: `npm test`, `npm run check`, and `bash tests/run_all.sh` (or let CI run it).
- Update `CHANGELOG.md` under *Unreleased*. Release = tag `vX.Y.Z` + bump `VERSION` in `sw.js` and `APP_VERSION` in `js/ui/views/settings.js`.
