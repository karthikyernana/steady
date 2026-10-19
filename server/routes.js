// The whole API in one function (Vercel Hobby allows 12; one router keeps it simple). Mounted at /api/*.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { query, withOwner } from './db.js';
import { currentOwner, startSession, endSession, verifyGoogleIdToken, passphraseHash, checkPassphrase, hashPassphrase, setupAvailable, tooManyAttempts, logAttempt, hashToken } from './auth.js';
import { migrate } from './migrate.js';
import { sendDue } from './push.js';

const COLLS = new Set(['tasks', 'goals', 'thoughts', 'checkins', 'meta']);
const MAX_BODY = 2_000_000;

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (s, m) => { throw new HttpError(s, m); };

async function readBody(req) {
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};
  let size = 0; const chunks = [];
  for await (const ch of req) { size += ch.length; if (size > MAX_BODY) fail(413, 'Too large'); chunks.push(ch); }
  const s = Buffer.concat(chunks).toString('utf8');
  try { return s ? JSON.parse(s) : {}; } catch { fail(400, 'Invalid JSON'); }
}

function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

// CSRF: state-changing browser calls must carry X-Steady (cross-site pages cannot set it without a CORS preflight we never allow)
function requireCsrf(req) {
  if (req.headers['x-steady'] !== '1') fail(403, 'Missing X-Steady header');
  const origin = req.headers.origin;
  if (origin) { const host = req.headers['x-forwarded-host'] || req.headers.host; if (new URL(origin).host !== host) fail(403, 'Cross-origin request'); }
}
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
const ownerEmail = () => (process.env.OWNER_EMAILS || process.env.ALLOWED_EMAIL || 'karthikyernana@gmail.com').split(',')[0].trim().toLowerCase();
const ipOf = req => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim() || null;

async function me(req) { const o = await currentOwner(req); if (!o) fail(401, 'Sign in to sync'); return o; }

const routes = {
  'GET config': async () => ({
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
    passphrase: process.env.DATABASE_URL ? !!(await passphraseHash().catch(() => null)) : false,
    setup: process.env.DATABASE_URL ? await setupAvailable().catch(() => false) : false,
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY || null,
    db: !!process.env.DATABASE_URL,
  }),

  'GET auth/me': async req => { const o = await currentOwner(req); return o ? { signedIn: true, email: o.email } : { signedIn: false }; },

  'POST auth/google': async (req, res, body) => {
    requireCsrf(req);
    const email = await verifyGoogleIdToken(body.credential);
    const o = await startSession(res, req, email, body.device);
    return { signedIn: true, email: o.email };
  },

  // one-time owner setup: the SETUP_CODE env var + a new passphrase; works exactly once, ever
  'POST auth/setup': async (req, res, body) => {
    requireCsrf(req);
    const ip = ipOf(req);
    if (await tooManyAttempts(ip)) fail(429, 'Too many attempts. Try again in an hour.');
    if (!(await setupAvailable())) fail(410, 'Setup is already done. Sign in with your passphrase.');
    const okCode = typeof body.code === 'string' && safeEq(body.code.trim(), process.env.SETUP_CODE);
    await logAttempt(ip, okCode);
    if (!okCode) fail(401, 'That setup code is not right.');
    if (typeof body.passphrase !== 'string' || body.passphrase.length < 10) fail(400, 'Choose a passphrase of at least 10 characters.');
    const { rowCount } = await query('insert into setup_state (id) values (true) on conflict do nothing');
    if (!rowCount) fail(410, 'Setup is already done.');
    const o = await startSession(res, req, ownerEmail(), body.device);
    await query(`insert into owner_credentials (owner_id, passphrase_hash) values ($1, $2)
                 on conflict (owner_id) do update set passphrase_hash = excluded.passphrase_hash, updated_at = now()`, [o.id, hashPassphrase(body.passphrase)]);
    return { signedIn: true, email: o.email };
  },

  'POST auth/change-passphrase': async (req, res, body) => {
    requireCsrf(req);
    const o = await me(req);
    if (typeof body.passphrase !== 'string' || body.passphrase.length < 10) fail(400, 'Choose a passphrase of at least 10 characters.');
    await query(`insert into owner_credentials (owner_id, passphrase_hash) values ($1, $2)
                 on conflict (owner_id) do update set passphrase_hash = excluded.passphrase_hash, updated_at = now()`, [o.id, hashPassphrase(body.passphrase)]);
    return { ok: true };
  },

  'POST auth/passphrase': async (req, res, body) => {
    requireCsrf(req);
    const stored = await passphraseHash();
    if (!stored) fail(501, 'Passphrase sign-in is not set up yet');
    const ip = ipOf(req);
    if (await tooManyAttempts(ip)) fail(429, 'Too many attempts. Try again in an hour.');
    const ok = checkPassphrase(body.passphrase, stored);
    await logAttempt(ip, ok);
    if (!ok) fail(401, 'That passphrase is not right.');
    const o = await startSession(res, req, ownerEmail(), body.device);
    return { signedIn: true, email: o.email };
  },

  'POST auth/logout': async (req, res) => { requireCsrf(req); await endSession(res, req); return { signedIn: false }; },

  // ---- sync ----
  'POST sync/push': async (req, res, body) => {
    requireCsrf(req);
    const o = await me(req);
    const recs = Array.isArray(body.records) ? body.records : fail(400, 'records must be an array');
    if (recs.length > 1000) fail(413, 'Push at most 1000 records at a time');
    for (const r of recs) {
      if (!COLLS.has(r.coll) || typeof r.id !== 'string' || !r.id || r.id.length > 128 || !Number.isSafeInteger(r.updatedAt) || typeof r.data !== 'object' || r.data === null) fail(400, 'Malformed record');
    }
    const applied = await withOwner(o.id, async c => (await c.query('select steady_push($1::jsonb) as n', [JSON.stringify(recs)])).rows[0].n);
    return { applied };
  },

  'GET sync/pull': async req => {
    const o = await me(req);
    const u = new URL(req.url, 'http://x');
    const since = Math.max(0, Number(u.searchParams.get('since')) || 0);
    const limit = Math.min(1000, Math.max(1, Number(u.searchParams.get('limit')) || 1000));
    const rows = await withOwner(o.id, async c => (await c.query(
      `select coll, id, updated_at, deleted, data, schema_version, seq from records where owner_id = app_owner() and seq > $1 order by seq limit $2`, [since, limit])).rows);
    return {
      records: rows.map(r => ({ coll: r.coll, id: r.id, updatedAt: Number(r.updated_at), deleted: r.deleted, data: r.data, schemaVersion: r.schema_version, seq: Number(r.seq) })),
      cursor: rows.length ? Number(rows[rows.length - 1].seq) : since,
      more: rows.length === limit,
    };
  },

  // ---- web push ----
  'POST push/subscribe': async (req, res, body) => {
    requireCsrf(req);
    const o = await me(req);
    const s = body.subscription || {};
    if (!/^https:\/\//.test(s.endpoint || '') || !s.keys?.p256dh || !s.keys?.auth) fail(400, 'Bad subscription');
    await withOwner(o.id, c => c.query(
      `insert into push_subscriptions (owner_id, endpoint, p256dh, auth, device) values ($1, $2, $3, $4, $5)
       on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device, last_error = null
       where push_subscriptions.owner_id = excluded.owner_id`,
      [o.id, s.endpoint, s.keys.p256dh, s.keys.auth, String(body.device || '').slice(0, 80)]));
    return { ok: true };
  },
  'POST push/unsubscribe': async (req, res, body) => {
    requireCsrf(req);
    const o = await me(req);
    await withOwner(o.id, c => c.query('delete from push_subscriptions where owner_id = app_owner() and endpoint = $1', [String(body.endpoint || '')]));
    return { ok: true };
  },

  // reminder queue: { upsert: [{key, fireAt, title, body, url, tag}], delete: [key] }
  'POST reminders': async (req, res, body) => {
    requireCsrf(req);
    const o = await me(req);
    const up = Array.isArray(body.upsert) ? body.upsert.slice(0, 500) : [];
    const del = Array.isArray(body.delete) ? body.delete.slice(0, 500).map(String) : [];
    await withOwner(o.id, async c => {
      for (const r of up) {
        if (typeof r.key !== 'string' || !r.key || !Number.isFinite(r.fireAt) || typeof r.title !== 'string') fail(400, 'Malformed reminder');
        await c.query(
          `insert into scheduled_notifications (owner_id, key, fire_at, title, body, url, tag) values ($1, $2, to_timestamp($3 / 1000.0), $4, $5, $6, $7)
           on conflict (owner_id, key) do update set fire_at = excluded.fire_at, title = excluded.title, body = excluded.body, url = excluded.url, tag = excluded.tag`,
          [o.id, r.key.slice(0, 160), r.fireAt, r.title.slice(0, 200), String(r.body || '').slice(0, 500), r.url || null, r.tag || null]);
      }
      if (del.length) await c.query('delete from scheduled_notifications where owner_id = app_owner() and key = any($1)', [del]);
    });
    return { upserted: up.length, deleted: del.length };
  },
  'GET reminders': async req => {
    const o = await me(req);
    const rows = await withOwner(o.id, async c => (await c.query(`select key, extract(epoch from fire_at) * 1000 as fire_at, title, sent_at from scheduled_notifications where owner_id = app_owner() order by fire_at`)).rows);
    return { reminders: rows.map(r => ({ key: r.key, fireAt: Number(r.fire_at), title: r.title, sent: !!r.sent_at })) };
  },

  // ---- Hark plugin: read-only tokens ----
  'POST tokens': async (req, res, body) => {
    requireCsrf(req);
    const o = await me(req);
    const tok = 'stdy_' + randomBytes(24).toString('hex');
    await query('insert into api_tokens (owner_id, label, token_hash) values ($1, $2, $3)', [o.id, String(body.label || 'Hark').slice(0, 60), hashToken(tok)]);
    return { token: tok };
  },
  'GET tokens': async req => {
    const o = await me(req);
    const { rows } = await query('select id, label, created_at, last_used_at from api_tokens where owner_id = $1 and revoked_at is null order by created_at desc', [o.id]);
    return { tokens: rows };
  },
  'POST tokens/revoke': async (req, res, body) => {
    requireCsrf(req);
    const o = await me(req);
    await query('update api_tokens set revoked_at = now() where owner_id = $1 and id = $2', [o.id, String(body.id || '')]);
    return { ok: true };
  },
  'GET hark/export': async req => {
    const tok = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!/^stdy_[0-9a-f]{48}$/.test(tok)) fail(401, 'Read token required');
    const { rows: t } = await query('update api_tokens set last_used_at = now() where token_hash = $1 and revoked_at is null returning owner_id', [hashToken(tok)]);
    if (!t[0]) fail(401, 'Read token required');
    const since = Math.max(0, Number(new URL(req.url, 'http://x').searchParams.get('since_seq')) || 0);
    const rows = await withOwner(t[0].owner_id, async c => (await c.query(
      'select coll, id, data, deleted, schema_version, seq from records where owner_id = app_owner() and seq > $1 order by seq', [since])).rows);
    const data = { tasks: {}, goals: {}, thoughts: {}, checkins: {}, meta: {} };
    for (const r of rows) if (!r.deleted) data[r.coll][r.id] = r.data;
    return { app: 'steady', schemaVersion: Math.max(1, ...rows.map(r => r.schema_version)), writtenAt: new Date().toISOString(), readOnly: true, cursor: rows.length ? Number(rows[rows.length - 1].seq) : since, data };
  },

  // ---- ops ----
  'POST admin/migrate': async req => {
    const want = process.env.MIGRATE_SECRET;
    const got = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!want || want.length < 16 || !safeEq(got, want)) fail(401, 'unauthorized');
    return { applied: await migrate() };
  },

  // ---- cron (GitHub Actions, every 5 minutes) ----
  'POST cron/reminders': async req => {
    const want = process.env.CRON_SECRET;
    const got = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!want || want.length < 16 || !safeEq(got, want)) fail(401, 'unauthorized');
    return sendDue();
  },
};

export async function handle(req, res) {
  try {
    const u = new URL(req.url, 'http://x');
    const path = u.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
    const fn = routes[`${req.method} ${path}`];
    if (!fn) return send(res, routes[`GET ${path}`] || routes[`POST ${path}`] ? 405 : 404, { error: 'Not found' });
    const body = req.method === 'POST' ? await readBody(req) : {};
    const out = await fn(req, res, body);
    return send(res, 200, out);
  } catch (e) {
    const status = e.status || (e.code === '42501' ? 403 : 500);
    if (status >= 500) console.error('[steady api]', e);
    return send(res, status, { error: status >= 500 ? 'Server error' : e.message });
  }
}
