# Porting Steady to another platform

Steady's portability rests on one thing: **the data contract** (DATA_MODEL.md). Any client that reads and writes `data/state.json` with the same merge rules is a full Steady client and can sync with the web app on day one.

## What to port, in order
1. **Contract types** from `js/core/schema.js`: record types, defaults (`normalize`), `SCHEMA_VERSION`, `MIGRATIONS`, `readDoc`/`makeDoc`. Write the same unit tests (`tests/unit/schema.test.mjs`) in your language.
2. **Merge** from `js/core/merge.js`: `pick`, `merge`, `prune`. Determinism matters: compare `updatedAt`, then tombstone, then the JSON string. For an exact tie-break match, serialize with the same key order the record was read in (or treat equal-timestamp conflicts as practically impossible: timestamps are strictly increasing per record).
3. **Clock rule:** `updatedAt = max(now, previous.updatedAt + 1)` on every write.
4. **Sync loop** (`js/data/sync.js`): GET → merge → apply → PUT with sha → retry on 409/422. Use the GitHub contents API with a fine-grained token (Contents RW on the one repo).
5. **Engine and voice** (`js/core/engine.js`, `voice.js`): pure functions over arrays of records; thresholds in `RULES`. Port with their tests.
6. **Parser** (`js/core/parse.js`) with `tests/unit/parse.test.mjs`.
7. **Platform layer:** storage (Room/SQLite/MMKV), notifications (AlarmManager exact alarms on Android, or keep ntfy using the same `st-<taskId>` sequence IDs so web and native don't double-schedule), UI.

## Mapping suggestions
| Web | React Native | Flutter | Native Android |
| --- | --- | --- | --- |
| IndexedDB | expo-sqlite / MMKV | drift / sqflite | Room |
| Service worker notifications | expo-notifications | flutter_local_notifications | AlarmManager + NotificationManager |
| fetch to api.github.com | fetch | http / dio | Ktor / OkHttp |
| inline SVG charts | react-native-svg | CustomPainter | Compose Canvas |
| BarcodeDetector (QR pair) | expo-camera | mobile_scanner | ML Kit barcode |

The pairing key format is `steady1.` + base64url(JSON `{ r: "owner/repo", t: "<token>", n?: "<ntfy topic>", s?: "<ntfy server>" }`). The QR encodes `https://karthikyernana.github.io/steady/#pair=<key>`.

## Compatibility checklist
- [ ] Unknown fields round-trip untouched.
- [ ] Tombstones written as `{id, deleted, updatedAt}` only.
- [ ] Refuses to write when `schemaVersion` is newer than supported.
- [ ] Local days/times are device-local, stored as `YYYY-MM-DD` / `HH:MM`.
- [ ] Unit tests ported and green against the same fixtures.
