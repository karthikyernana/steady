// Integration tests for the Vercel API router against a real local Postgres.
// Needs: TEST_DATABASE_URL (a disposable database owned by a NON-superuser role, so RLS applies), openssl on PATH.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { generateKeyPairSync, createSign, createECDH, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import webpush from 'web-push';

const DB = process.env.TEST_DATABASE_URL;
if (!DB) { test('api tests skipped (no TEST_DATABASE_URL)', () => {}); }
else {
  const OWNER = 'karthikyernana@gmail.com';
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
  const idToken = (claims, kid = 'k1', key = privateKey) => {
    const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })).toString('base64url');
    const p = Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: 'test-client', exp: Math.floor(Date.now() / 1000) + 600, email_verified: true, ...claims })).toString('base64url');
    const s = createSign('RSA-SHA256'); s.update(`${h}.${p}`);
    return `${h}.${p}.${s.sign(key).toString('base64url')}`;
  };

  let api, base, jwksSrv, pushSrv, pushHits = [], pushStatus = 201, mod;
  const listen = srv => new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

  before(async () => {
    process.env.DATABASE_URL = DB;
    // fresh schema
    const { getPool } = await import('../../server/db.js');
    const pool = getPool();
    await pool.query('drop schema public cascade; create schema public;');
    const { migrate } = await import('../../server/migrate.js');
    await migrate();

    jwksSrv = createServer((q, s) => { s.setHeader('content-type', 'application/json'); s.end(JSON.stringify({ keys: [jwk] })); });
    const jp = await listen(jwksSrv);
    const dir = mkdtempSync(join(tmpdir(), 'stdy-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
    pushSrv = createHttps({ key: readFileSync(join(dir, 'k.pem')), cert: readFileSync(join(dir, 'c.pem')) }, (q, s) => {
      const chunks = []; q.on('data', c => chunks.push(c)); q.on('end', () => { pushHits.push({ url: q.url, headers: q.headers, len: Buffer.concat(chunks).length }); s.statusCode = pushStatus; s.end(); });
    });
    const pp = await listen(pushSrv);
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    const v = webpush.generateVAPIDKeys();
    Object.assign(process.env, {
      GOOGLE_CLIENT_ID: 'test-client', GOOGLE_JWKS_URL: `http://127.0.0.1:${jp}/certs`, OWNER_EMAILS: OWNER,
      CRON_SECRET: 'cron-secret-for-tests-0123456789', SETUP_CODE: 'setup-code-0123456789', MIGRATE_SECRET: 'migrate-secret-0123456789', VAPID_PUBLIC_KEY: v.publicKey, VAPID_PRIVATE_KEY: v.privateKey, VAPID_SUBJECT: 'mailto:test@example.com',
    });
    mod = await import('../../server/auth.js');
    process.env.OWNER_PASSPHRASE_HASH = mod.hashPassphrase('correct horse battery staple');
    const { handle } = await import('../../server/routes.js');
    api = createServer(handle);
    base = `http://127.0.0.1:${await listen(api)}`;
    globalThis.PUSH_ENDPOINT = `https://127.0.0.1:${pp}/push/abc`;
  });
  after(async () => { api?.close(); jwksSrv?.close(); pushSrv?.close(); (await import('../../server/db.js')).closePool(); });

  let cookie = '';
  const call = async (method, path, body, { csrf = true, auth, jar = true } = {}) => {
    const r = await fetch(base + '/api/' + path, {
      method, headers: { 'content-type': 'application/json', ...(csrf ? { 'x-steady': '1' } : {}), ...(jar && cookie ? { cookie } : {}), ...(auth ? { authorization: auth } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = r.headers.get('set-cookie'); if (sc && jar) cookie = sc.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null), setCookie: sc };
  };

  test('config is public and reveals no secrets', async () => {
    const r = await call('GET', 'config');
    assert.equal(r.status, 200); assert.equal(r.body.googleClientId, 'test-client'); assert.equal(r.body.passphrase, true);
    assert.ok(!JSON.stringify(r.body).includes(process.env.VAPID_PRIVATE_KEY));
  });
  test('signed-out requests are refused', async () => {
    assert.equal((await call('GET', 'sync/pull')).status, 401);
    assert.equal((await call('POST', 'sync/push', { records: [] })).status, 401);
  });
  test('Google sign-in: other emails, wrong audience, bad signature and expired tokens are rejected', async () => {
    assert.equal((await call('POST', 'auth/google', { credential: idToken({ email: 'someone@gmail.com' }) }, { jar: false })).status, 403);
    assert.equal((await call('POST', 'auth/google', { credential: idToken({ email: OWNER, aud: 'evil' }) }, { jar: false })).status, 401);
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    assert.equal((await call('POST', 'auth/google', { credential: idToken({ email: OWNER }, 'k1', other) }, { jar: false })).status, 401);
    assert.equal((await call('POST', 'auth/google', { credential: idToken({ email: OWNER, exp: 1000 }) }, { jar: false })).status, 401);
    assert.equal((await call('POST', 'auth/google', { credential: idToken({ email: OWNER }) }, { csrf: false, jar: false })).status, 403, 'needs CSRF header');
  });
  test('Google sign-in for the owner sets an httpOnly session cookie', async () => {
    const r = await call('POST', 'auth/google', { credential: idToken({ email: OWNER }), device: 'test' });
    assert.equal(r.status, 200); assert.equal(r.body.email, OWNER);
    assert.match(r.setCookie, /HttpOnly/); assert.match(r.setCookie, /SameSite=Lax/);
    assert.equal((await call('GET', 'auth/me')).body.signedIn, true);
  });
  test('push / pull with last-write-wins and tombstones', async () => {
    const rec = (id, t, extra = {}) => ({ coll: 'tasks', id, updatedAt: t, data: { id, updatedAt: t, title: id, ...extra } });
    assert.equal((await call('POST', 'sync/push', { records: [rec('a', 100), rec('b', 100)] })).body.applied, 2);
    assert.equal((await call('POST', 'sync/push', { records: [rec('a', 50, { title: 'old' })] })).body.applied, 0);
    assert.equal((await call('POST', 'sync/push', { records: [{ coll: 'tasks', id: 'b', updatedAt: 100, deleted: true, data: { id: 'b', deleted: true, updatedAt: 100 } }] })).body.applied, 1);
    const p1 = (await call('GET', 'sync/pull?since=0')).body;
    assert.equal(p1.records.length, 2); assert.equal(p1.records.find(r => r.id === 'a').data.title, 'a'); assert.equal(p1.records.find(r => r.id === 'b').deleted, true);
    await call('POST', 'sync/push', { records: [rec('a', 200, { title: 'new' })] });
    const p2 = (await call('GET', `sync/pull?since=${p1.cursor}`)).body;
    assert.deepEqual(p2.records.map(r => r.id), ['a']); assert.equal(p2.records[0].data.title, 'new');
  });
  test('malformed pushes and CSRF-less writes are refused', async () => {
    assert.equal((await call('POST', 'sync/push', { records: [{ coll: 'evil', id: 'x', updatedAt: 1, data: {} }] })).status, 400);
    assert.equal((await call('POST', 'sync/push', { records: [] }, { csrf: false })).status, 403);
  });
  test('database refuses non-allowlisted owners even if the API were bypassed', async () => {
    const { query } = await import('../../server/db.js');
    await assert.rejects(query("insert into owners (email) values ('intruder@example.com')"), /private/);
  });
  test('row-level security hides data from any other owner scope', async () => {
    const { withOwner, query } = await import('../../server/db.js');
    await query("insert into allowed_emails values ('second@example.com')");
    const { rows } = await query("insert into owners (email) values ('second@example.com') returning id");
    const seen = await withOwner(rows[0].id, async c => (await c.query('select count(*)::int n from records')).rows[0].n);
    assert.equal(seen, 0);
    const unscoped = (await query('select count(*)::int n from records')).rows[0].n;
    assert.equal(unscoped, 0, 'without app.owner_id nothing is visible');
    await assert.rejects(withOwner(rows[0].id, c => c.query(`insert into records (owner_id, coll, id, updated_at, data) select id, 'tasks', 'spoof', 1, '{}' from owners where email = $1`, [OWNER])), /row-level security/);
    await query("delete from owners where email = 'second@example.com'"); await query("delete from allowed_emails where email = 'second@example.com'");
  });
  test('one-time setup code sets the owner passphrase exactly once', async () => {
    assert.equal((await call('GET', 'config')).body.setup, true);
    assert.equal((await call('POST', 'auth/setup', { code: 'wrong-code-000000', passphrase: 'my new passphrase' }, { jar: false })).status, 401);
    assert.equal((await call('POST', 'auth/setup', { code: 'setup-code-0123456789', passphrase: 'short' }, { jar: false })).status, 400);
    const ok = await call('POST', 'auth/setup', { code: 'setup-code-0123456789', passphrase: 'my new passphrase' }, { jar: false });
    assert.equal(ok.status, 200); assert.match(ok.setCookie, /HttpOnly/);
    assert.equal((await call('POST', 'auth/setup', { code: 'setup-code-0123456789', passphrase: 'another passphrase' }, { jar: false })).status, 410, 'cannot be replayed');
    assert.equal((await call('GET', 'config')).body.setup, false);
    assert.equal((await call('POST', 'auth/passphrase', { passphrase: 'my new passphrase' }, { jar: false })).status, 200, 'DB passphrase works');
  });
  test('admin migrate route is secret-protected and idempotent', async () => {
    assert.equal((await call('POST', 'admin/migrate', {}, { auth: 'Bearer nope', jar: false })).status, 401);
    const r = await call('POST', 'admin/migrate', {}, { auth: 'Bearer migrate-secret-0123456789', jar: false });
    assert.equal(r.status, 200); assert.deepEqual(r.body.applied, []);
  });
  test('passphrase sign-in works and is rate limited', async () => {
    const { query } = await import('../../server/db.js'); await query('delete from login_attempts');
    await query(`update owner_credentials set passphrase_hash = $1`, [process.env.OWNER_PASSPHRASE_HASH]);
    assert.equal((await call('POST', 'auth/passphrase', { passphrase: 'correct horse battery staple' }, { jar: false })).status, 200);
    for (let i = 0; i < 5; i++) assert.equal((await call('POST', 'auth/passphrase', { passphrase: 'wrong wrong wrong' }, { jar: false })).status, 401);
    assert.equal((await call('POST', 'auth/passphrase', { passphrase: 'correct horse battery staple' }, { jar: false })).status, 429);
  });
  test('Web Push: subscribe, schedule, cron sends once, prunes dead endpoints', async () => {
    const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
    const sub = { endpoint: globalThis.PUSH_ENDPOINT, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
    assert.equal((await call('POST', 'push/subscribe', { subscription: sub, device: 'test' })).status, 200);
    const now = Date.now();
    await call('POST', 'reminders', { upsert: [{ key: 'st-a', fireAt: now - 1000, title: 'Post on LinkedIn', body: 'due 6 PM' }, { key: 'st-later', fireAt: now + 3600e3, title: 'Later' }] });
    assert.equal((await call('POST', 'cron/reminders', {}, { auth: 'Bearer nope' })).status, 401);
    const r1 = await call('POST', 'cron/reminders', {}, { auth: `Bearer ${process.env.CRON_SECRET}`, jar: false });
    assert.equal(r1.status, 200); assert.equal(r1.body.sent, 1);
    assert.equal(pushHits.length, 1); assert.equal(pushHits[0].headers['content-encoding'], 'aes128gcm'); assert.match(pushHits[0].headers.authorization, /^vapid t=/);
    const r2 = await call('POST', 'cron/reminders', {}, { auth: `Bearer ${process.env.CRON_SECRET}`, jar: false });
    assert.equal(r2.body.sent, 0, 'not sent twice');
    await call('POST', 'reminders', { upsert: [{ key: 'st-a', fireAt: now - 500, title: 'Post on LinkedIn' }] });  // reschedule re-arms
    pushStatus = 410;
    const r3 = await call('POST', 'cron/reminders', {}, { auth: `Bearer ${process.env.CRON_SECRET}`, jar: false });
    assert.equal(r3.body.pruned, 1);
    await call('POST', 'reminders', { delete: ['st-later'] });
    assert.deepEqual((await call('GET', 'reminders')).body.reminders.map(r => r.key), ['st-a']);
  });
  test('Hark read token: export is read-only and revocable', async () => {
    const { token } = (await call('POST', 'tokens', { label: 'Hark' })).body;
    assert.match(token, /^stdy_[0-9a-f]{48}$/);
    const ex = await call('GET', 'hark/export', null, { auth: `Bearer ${token}`, jar: false });
    assert.equal(ex.status, 200); assert.equal(ex.body.readOnly, true); assert.equal(ex.body.data.tasks.a.title, 'new'); assert.equal(ex.body.data.tasks.b, undefined);
    assert.equal((await call('POST', 'sync/push', { records: [] }, { auth: `Bearer ${token}`, jar: false })).status, 401, 'token cannot write');
    const id = (await call('GET', 'tokens')).body.tokens[0].id;
    await call('POST', 'tokens/revoke', { id });
    assert.equal((await call('GET', 'hark/export', null, { auth: `Bearer ${token}`, jar: false })).status, 401);
  });
  test('logout ends the session', async () => {
    await call('POST', 'auth/logout');
    assert.equal((await call('GET', 'sync/pull')).status, 401);
  });
}
