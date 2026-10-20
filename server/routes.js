// The whole API in one function (Vercel Hobby allows 12; one router keeps it simple). Mounted at /api/*.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { query, withOwner } from './db.js';
import { cookieHeader, currentOwner, startSession, endSession, listSessions, revokeSession, revokeOtherSessions, isRevoked, verifyGoogleIdToken, checkPassphrase, tooManyAttempts, logAttempt, hashToken, findOwner, createOwner, setPassword, signupMode, mayCreate, normEmail, validEmail, verifyGithubOidc } from './auth.js';
import { migrate } from './migrate.js';
import { sendDue, vapidReady } from './push.js';
import { triggerFor, triggerMode } from './trigger.js';
import { AgentError, agentConfig, countUse, transcribe, plan, learnFrom, getMemory, memorySummary, resetMemory } from './agent.js';
import { chat, chatConfig, listChats, getChat, deleteChat, renameChat, starter } from './chat.js';

const COLLS = new Set(['tasks', 'goals', 'thoughts', 'checkins', 'meta', 'money']);
const MAX_BODY = 2_000_000;

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (s, m) => { throw new HttpError(s, m); };

// raw bodies (audio): Vercel hands application/octet-stream over as a Buffer; locally we read the stream
async function readRaw(req, max = 4_000_000) {
  if (+req.headers['content-length'] > max) fail(413, 'That recording is too long. Keep it under 30 seconds.');
  if (Buffer.isBuffer(req.body)) { if (req.body.length > max) fail(413, 'Too large'); return req.body; }
  let size = 0; const chunks = [];
  for await (const ch of req) { size += ch.length; if (size > max) fail(413, 'Too large'); chunks.push(ch); }
  return Buffer.concat(chunks);
}
const RAW = new Set(['agent/transcribe']);

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
const ipOf = req => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim() || null;

// An owner row without a password that has already been used (it signed in with Google, so it has sessions or data)
// must never be claimable by "creating" a password for its email: that would hand its data to whoever typed the email.
// A pre-provisioned, never-used row (old allow-list instances) can still get its first password through sign-up.
const GOOGLE_ONLY = 'This email signs in with Google. Continue with Google, then add a password in You.';
async function claimed(o) {
  if (!o || o.password_hash) return false;
  if ((await query('select 1 from sessions where owner_id = $1 limit 1', [o.id])).rows.length) return true;
  return withOwner(o.id, async c => (await c.query('select 1 from records where owner_id = app_owner() limit 1')).rows.length > 0);
}

const REVOKED = 'This device was signed out from another device.';
async function me(req) {
  const o = await currentOwner(req);
  if (!o) { if (await isRevoked(req)) { const e = new HttpError(401, REVOKED); e.revoked = true; throw e; } fail(401, 'Sign in to sync'); }
  return o;
}

const routes = {
  'GET config': async () => ({
    db: !!process.env.DATABASE_URL,
    accounts: !!process.env.DATABASE_URL,
    signup: signupMode(),
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY || null,
    agent: agentConfig(),
    chat: chatConfig(),
  }),

  'GET auth/me': async req => { const o = await currentOwner(req); return o ? { signedIn: true, email: o.email } : { signedIn: false, revoked: await isRevoked(req) }; },

  // step 1 of the sign-in sheet: does this email already have an account?
  'POST auth/check': async (req, res, body) => {
    requireCsrf(req);
    const email = normEmail(body.email);
    if (!validEmail(email)) fail(400, 'Enter a valid email address.');
    if (await tooManyAttempts(ipOf(req))) fail(429, 'Too many attempts. Try again in an hour.');
    const o = await findOwner(email);
    if (await claimed(o)) return { exists: false, canCreate: false, google: true };
    return { exists: !!o?.password_hash, canCreate: !o?.password_hash && mayCreate(email) };
  },

  'POST auth/signup': async (req, res, body) => {
    requireCsrf(req);
    const ip = ipOf(req);
    if (await tooManyAttempts(ip)) fail(429, 'Too many attempts. Try again in an hour.');
    const email = normEmail(body.email), password = body.password, name = String(body.name || '').trim().slice(0, 60);
    if (!validEmail(email)) fail(400, 'Enter a valid email address.');
    if (typeof password !== 'string' || password.length < 8) fail(400, 'Use at least 8 characters for your password.');
    if (password.length > 200) fail(400, 'That password is too long.');
    const existing = await findOwner(email);
    if (existing?.password_hash) fail(409, 'There is already an account with this email. Sign in instead.');
    if (await claimed(existing)) fail(409, GOOGLE_ONLY);
    if (!mayCreate(email)) fail(403, 'Sign-ups are closed on this Steady.');
    if (existing) { await setPassword(existing.id, password); if (name) await query('update owners set name = $2 where id = $1', [existing.id, name]); }
    else await createOwner(email, password, name);
    const o = await startSession(res, req, email, body.device);
    return { signedIn: true, email: o.email, created: true };
  },

  'POST auth/login': async (req, res, body) => {
    requireCsrf(req);
    const ip = ipOf(req);
    if (await tooManyAttempts(ip, body.email)) fail(429, 'Too many attempts. Try again in an hour.');
    const o = await findOwner(body.email);
    const ok = !!o?.password_hash && checkPassphrase(String(body.password || ''), o.password_hash);
    await logAttempt(ip, ok, body.email);
    if (!ok) fail(401, 'That email and password do not match.');
    const s = await startSession(res, req, o.email, body.device);
    return { signedIn: true, email: s.email };
  },

  'POST auth/password': async (req, res, body) => {
    requireCsrf(req);
    const me_ = await me(req);
    const o = await findOwner(me_.email);
    if (o.password_hash && !checkPassphrase(String(body.current || ''), o.password_hash)) fail(401, 'Your current password is not right.');
    if (typeof body.password !== 'string' || body.password.length < 8) fail(400, 'Use at least 8 characters for your password.');
    await setPassword(o.id, body.password);
    const signedOutOthers = await revokeOtherSessions(o.id, me_.session);   // a new password ends every other device's session
    return { ok: true, signedOutOthers };
  },

  'POST auth/google': async (req, res, body) => {
    requireCsrf(req);
    const email = await verifyGoogleIdToken(body.credential);
    const o = await startSession(res, req, email, body.device);
    return { signedIn: true, email: o.email };
  },

  // deletes the account and every synced record on the server; the device keeps its local copy
  'POST auth/delete': async (req, res, body) => {
    requireCsrf(req);
    const me_ = await me(req);
    const o = await findOwner(me_.email);
    if (o.password_hash && !checkPassphrase(String(body.password || ''), o.password_hash)) fail(401, 'Your password is not right.');
    await query('delete from owners where id = $1', [o.id]);
    await endSession(res, req);
    return { deleted: true };
  },

  'POST auth/logout': async (req, res) => { requireCsrf(req); await endSession(res, req); return { signedIn: false }; },

  // ---- devices: see every signed-in device and sign any of them out (this one too) ----
  'GET auth/sessions': async req => { const o = await me(req); return { sessions: await listSessions(o.id, o.session) }; },
  'POST auth/sessions/revoke': async (req, res, body) => {
    requireCsrf(req); const o = await me(req);
    const id = String(body.id || '');
    const n = await revokeSession(o.id, id);
    if (!n) fail(404, 'That device is already signed out.');
    if (o.session?.startsWith(id)) res.setHeader('Set-Cookie', cookieHeader('', 0, req));
    return { revoked: n };
  },
  'POST auth/sessions/revoke-others': async req => { requireCsrf(req); const o = await me(req); return { revoked: await revokeOtherSessions(o.id, o.session) }; },

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

  // live sync: holds the request open (up to ~20 s) until this account has records newer than `since`
  'GET sync/wait': async req => {
    const o = await me(req);
    const since = Math.max(0, Number(new URL(req.url, 'http://x').searchParams.get('since')) || 0);
    const until = Date.now() + Math.min(20_000, Number(process.env.SYNC_WAIT_MS) || 20_000);
    for (;;) {
      const top = await withOwner(o.id, async c => Number((await c.query('select coalesce(max(seq), 0) as s from records where owner_id = app_owner()')).rows[0].s));
      if (top > since) return { changed: true, cursor: top };
      if (Date.now() > until) return { changed: false, cursor: since };
      await new Promise(r => setTimeout(r, 1500));
    }
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
        if (typeof r.key === 'string' && r.key.startsWith('st-checkin-')) continue;
        if (typeof r.key !== 'string' || !r.key || !Number.isFinite(r.fireAt) || typeof r.title !== 'string') fail(400, 'Malformed reminder');
        // moved to another time: an old snooze of it would ring at the old time + N min, so it goes
        if (!r.key.endsWith('~snooze')) await c.query(`delete from scheduled_notifications where owner_id = app_owner() and key = $1 || '~snooze'
            and exists (select 1 from scheduled_notifications b where b.owner_id = app_owner() and b.key = $1 and b.fire_at is distinct from to_timestamp($2 / 1000.0))`, [r.key.slice(0, 152), r.fireAt]);
        await c.query(
          `insert into scheduled_notifications (owner_id, key, fire_at, title, body, url, tag) values ($1, $2, to_timestamp($3 / 1000.0), $4, $5, $6, $7)
           on conflict (owner_id, key) do update set fire_at = excluded.fire_at, title = excluded.title, body = excluded.body, url = excluded.url, tag = excluded.tag,
             sent_at = case when scheduled_notifications.fire_at is distinct from excluded.fire_at then null else scheduled_notifications.sent_at end`,
          [o.id, r.key.slice(0, 160), r.fireAt, r.title.slice(0, 200), String(r.body || '').slice(0, 500), r.url || null, r.tag || null]);
      }
      // a reminder that goes (task done, deleted, reminder off) takes its pending snooze with it, or the snooze still fires
      if (del.length) await c.query("delete from scheduled_notifications where owner_id = app_owner() and (key = any($1) or (key like '%~snooze' and left(key, -7) = any($1)))", [del]);
      // the evening check-in nudge is retired (v1.4): drop any still-queued ones, whichever client queued them
      await c.query("delete from scheduled_notifications where owner_id = app_owner() and key like 'st-checkin-%' and sent_at is null");
    });
    const trig = await triggerFor(up.map(r => r.fireAt));
    return { upserted: up.length, deleted: del.length, exact: trig.exact, trigger: trig.mode };
  },
  // A notification's "Snooze" action (from the service worker): fire the same reminder again in N minutes.
  'POST reminders/snooze': async (req, res, body) => {
    requireCsrf(req);
    const o = await me(req);
    const key = String(body.key || '').slice(0, 160), min = Math.min(240, Math.max(1, Math.round(+body.minutes || 10)));
    if (!key) fail(400, 'Missing key');
    const at = Date.now() + min * 60e3;
    // A separate row (<key>~snooze), so a device re-mirroring the original reminder never undoes or duplicates the snooze.
    const base = key.replace(/~snooze$/, '');
    const n = await withOwner(o.id, async c => (await c.query(
      `insert into scheduled_notifications (owner_id, key, fire_at, title, body, url, tag)
         select owner_id, $3, to_timestamp($2 / 1000.0), title, body, url, tag from scheduled_notifications where owner_id = app_owner() and key = $1
       on conflict (owner_id, key) do update set fire_at = excluded.fire_at, sent_at = null`, [base, at, base + '~snooze'])).rowCount);
    if (!n) fail(404, 'That reminder is gone');
    const trig = await triggerFor([at]);
    return { ok: true, fireAt: at, trigger: trig.mode };
  },
  // Real end-to-end test of the closed-app path: queue a reminder in `seconds` and let the normal trigger deliver it.
  'POST reminders/test': async (req, res, body) => {
    requireCsrf(req);
    const o = await me(req);
    const sec = Math.min(600, Math.max(5, Math.round(+body.seconds || 60)));
    const at = Date.now() + sec * 1000;
    await withOwner(o.id, c => c.query(
      `insert into scheduled_notifications (owner_id, key, fire_at, title, body, url, tag) values ($1, 'st-test', to_timestamp($2 / 1000.0), $3, $4, '/#/today', 'test')
       on conflict (owner_id, key) do update set fire_at = excluded.fire_at, title = excluded.title, body = excluded.body, sent_at = null`,
      [o.id, at, 'Steady test reminder', 'If you can read this with Steady closed, reminders reach this device.']));
    const trig = await triggerFor([at]);
    return { ok: true, fireAt: at, trigger: trig.mode };
  },
  // What the delivery pipeline looks like for this account: devices, last delivery, what is queued, what wakes the sender.
  'GET reminders/status': async req => {
    const o = await me(req);
    return withOwner(o.id, async c => {
      const subs = (await c.query('select device, created_at, last_ok_at, last_error from push_subscriptions where owner_id = app_owner() order by created_at desc')).rows;
      const q = (await c.query(`select count(*)::int as pending, min(extract(epoch from fire_at) * 1000) as next from scheduled_notifications
                                 where owner_id = app_owner() and sent_at is null and fire_at > now() - interval '30 minutes'`)).rows[0];
      const last = (await c.query('select max(extract(epoch from last_ok_at) * 1000) as t from push_subscriptions where owner_id = app_owner()')).rows[0].t;
      return { devices: subs.map(s => ({ device: s.device, since: s.created_at, lastOk: s.last_ok_at, lastError: s.last_error })),
        pending: q.pending, next: q.next ? Number(q.next) : null, lastSent: last ? Number(last) : null, trigger: triggerMode(), vapid: vapidReady() };
    });
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
    const data = { tasks: {}, goals: {}, thoughts: {}, checkins: {}, meta: {}, money: {} };
    for (const r of rows) if (!r.deleted) data[r.coll][r.id] = r.data;
    return { app: 'steady', schemaVersion: Math.max(1, ...rows.map(r => r.schema_version)), writtenAt: new Date().toISOString(), readOnly: true, cursor: rows.length ? Number(rows[rows.length - 1].seq) : since, data };
  },

  // ---- voice agent (see server/agent.js). Drafts only: the browser applies what the user accepts. ----
  'POST agent/transcribe': async (req, res, body) => {
    requireCsrf(req);
    const o = await me(req);
    if (!agentConfig().voice) throw new AgentError(501, 'Voice is not set up on this Steady yet (SARVAM_API_KEY). You can still type.');
    if (!body?.length) fail(400, 'No audio received.');
    await countUse(o.id, 'stt');   // counted only when a real, configured transcription is about to run
    return transcribe(body, String(req.headers['x-audio-type'] || ''));
  },
  'POST agent/plan': async (req, res, body) => {
    requireCsrf(req);
    const o = await me(req);
    await countUse(o.id, 'plan');
    return plan(o.id, { text: body.text, context: body.context, tz: body.tz });
  },
  'POST agent/learn': async (req, res, body) => {
    requireCsrf(req);
    const o = await me(req);
    return { ok: true, memory: await learnFrom(o.id, body.pairs) };
  },
  'GET agent/memory': async req => { const o = await me(req); return { memory: memorySummary(await getMemory(o.id)) }; },
  'POST agent/memory/reset': async req => { requireCsrf(req); const o = await me(req); await resetMemory(o.id); return { ok: true }; },

  // ---- chat agent (server/chat.js): read-only tools over the user's own rows, replies with text + cards ----
  'POST agent/chat': async (req, res, body) => {
    requireCsrf(req);
    const o = await me(req);
    return chat(o.id, { chatId: body.chatId || null, message: body.message, tz: body.tz });
  },
  'GET agent/chats': async req => { const o = await me(req); return listChats(o.id); },
  'GET agent/chat/starter': async req => { const o = await me(req); return starter(o.id, { tz: new URL(req.url, 'http://x').searchParams.get('tz') }); },
  'GET agent/chats/:id': async req => { const o = await me(req); return getChat(o.id, req.params.id, new URL(req.url, 'http://x').searchParams.get('tz')); },
  'PATCH agent/chats/:id': async (req, res, body) => { requireCsrf(req); const o = await me(req); return renameChat(o.id, req.params.id, body && body.title); },
  'DELETE agent/chats/:id': async req => { requireCsrf(req); const o = await me(req); return deleteChat(o.id, req.params.id); },

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
    const ok = (want && want.length >= 16 && safeEq(got, want)) || (got.split('.').length === 3 && await verifyGithubOidc(got));
    if (!ok) fail(401, 'unauthorized');
    return sendDue();
  },
};

export async function handle(req, res) {
  try {
    const u = new URL(req.url, 'http://x');
    const path = u.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
    let key = path;
    const pm = /^(agent\/chats)\/([^/]+)$/.exec(path);          // the one parameterised route family
    if (pm) { key = `${pm[1]}/:id`; req.params = { id: decodeURIComponent(pm[2]) }; }
    const fn = routes[`${req.method} ${key}`];
    if (!fn) return send(res, ['GET', 'POST', 'PATCH', 'DELETE'].some(m => routes[`${m} ${key}`]) ? 405 : 404, { error: 'Not found' });
    const body = (req.method === 'POST' || req.method === 'PATCH') ? (RAW.has(path) ? await readRaw(req) : await readBody(req)) : {};
    const out = await fn(req, res, body);
    return send(res, 200, out);
  } catch (e) {
    const status = e.status || (e.code === '42501' ? 403 : 500);
    if (status >= 500) console.error('[steady api]', e);
    return send(res, status, { error: status >= 500 && !e.public ? 'Server error' : e.message, ...(e.revoked ? { revoked: true } : {}), ...(Array.isArray(e.reasons) ? { reasons: e.reasons.slice(0, 10) } : {}) });
  }
}
