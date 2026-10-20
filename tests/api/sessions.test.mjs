// Devices: list every signed-in session with its device + place, sign one out, sign out all others; owners are isolated.
// Needs TEST_DATABASE_URL (this file wipes that database's public schema). Run: node --test tests/api/sessions.test.mjs
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const DB = process.env.TEST_DATABASE_URL;
if (!DB) test('sessions api tests skipped (no TEST_DATABASE_URL)', () => {});
else {
  let base, srv;
  before(async () => {
    process.env.DATABASE_URL = DB;
    const { getPool } = await import('../../server/db.js');
    await getPool().query('drop schema public cascade; create schema public;');
    await (await import('../../server/migrate.js')).migrate();
    const { handle } = await import('../../server/routes.js');
    srv = createServer(handle);
    base = await new Promise(r => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));
  });
  after(async () => { srv?.close(); await (await import('../../server/db.js')).closePool(); });

  const jar = {};
  const call = async (who, method, path, body, headers = {}) => {
    const r = await fetch(`${base}/api/${path}`, { method, headers: { 'x-steady': '1', 'content-type': 'application/json', ...(jar[who] ? { cookie: jar[who] } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) jar[who] = sc.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const pw = 'password-123-abc';

  test('lists devices with name, app and place; marks this one', async () => {
    await call('laptop', 'POST', 'auth/signup', { email: 'k@example.com', password: pw, device: 'Desktop' }, { 'user-agent': 'Mozilla/5.0 Chrome/130', 'x-vercel-ip-city': 'Phagwara', 'x-vercel-ip-country-region': 'PB', 'x-vercel-ip-country': 'IN' });
    await call('phone', 'POST', 'auth/login', { email: 'k@example.com', password: pw, device: 'Android · Pixel 8' }, { 'user-agent': 'okhttp/4.12', 'x-vercel-ip-city': 'S%C3%A3o%20Paulo', 'x-vercel-ip-country': 'BR' });
    await call('other', 'POST', 'auth/signup', { email: 'x@example.com', password: pw });
    const r = await call('laptop', 'GET', 'auth/sessions');
    assert.equal(r.status, 200);
    assert.equal(r.body.sessions.length, 2, 'only my own sessions');
    const me = r.body.sessions.find(s => s.current), ph = r.body.sessions.find(s => !s.current);
    assert.equal(me.device, 'Desktop'); assert.equal(me.lastPlace, 'Phagwara, PB, IN');
    assert.equal(ph.device, 'Android · Pixel 8'); assert.equal(ph.createdPlace, 'São Paulo, BR'); assert.equal(ph.userAgent, 'okhttp/4.12');
    assert.match(ph.id, /^[0-9a-f]{16}$/);
    assert.ok(!JSON.stringify(r.body).includes(jar.laptop.split('=')[1]), 'never exposes a token');
  });

  test('sign out one device; it loses access immediately; others untouched', async () => {
    const ph = (await call('laptop', 'GET', 'auth/sessions')).body.sessions.find(s => !s.current);
    assert.equal((await call('laptop', 'POST', 'auth/sessions/revoke', { id: ph.id })).body.revoked, 1);
    const meP = (await call('phone', 'GET', 'auth/me')).body;
    assert.equal(meP.signedIn, false); assert.equal(meP.revoked, true, 'the removed device learns it was removed (so it erases its local copy)');
    const pull = await call('phone', 'GET', 'sync/pull?since=0');
    assert.equal(pull.status, 401); assert.equal(pull.body.revoked, true);
    assert.equal((await call('anon', 'GET', 'sync/pull?since=0')).body.revoked, undefined, 'never signed in is not "revoked"');
    assert.equal((await call('laptop', 'GET', 'auth/me')).body.signedIn, true);
    assert.equal((await call('laptop', 'POST', 'auth/sessions/revoke', { id: ph.id })).status, 404);
  });

  test("can't touch another owner's sessions; needs CSRF header", async () => {
    const theirs = (await call('other', 'GET', 'auth/sessions')).body.sessions[0];
    assert.equal((await call('laptop', 'POST', 'auth/sessions/revoke', { id: theirs.id })).status, 404);
    assert.equal((await call('other', 'GET', 'auth/me')).body.signedIn, true);
    const r = await fetch(`${base}/api/auth/sessions/revoke-others`, { method: 'POST', headers: { cookie: jar.laptop, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 403);
    assert.equal((await call('anon', 'GET', 'auth/sessions')).status, 401);
  });

  test('sign out all other devices keeps this one', async () => {
    await call('tab2', 'POST', 'auth/login', { email: 'k@example.com', password: pw });
    await call('tab3', 'POST', 'auth/login', { email: 'k@example.com', password: pw });
    assert.equal((await call('laptop', 'POST', 'auth/sessions/revoke-others')).body.revoked, 2);
    assert.equal((await call('tab2', 'GET', 'auth/me')).body.signedIn, false);
    assert.equal((await call('tab2', 'GET', 'auth/me')).body.revoked, true);
    assert.equal((await call('laptop', 'GET', 'auth/sessions')).body.sessions.length, 1);
  });

  test('changing the password signs out every other device', async () => {
    await call('tab4', 'POST', 'auth/login', { email: 'k@example.com', password: pw });
    const r = await call('laptop', 'POST', 'auth/password', { current: pw, password: 'new-password-456' });
    assert.equal(r.body.signedOutOthers, 1);
    assert.equal((await call('tab4', 'GET', 'auth/me')).body.signedIn, false);
    assert.equal((await call('laptop', 'GET', 'auth/me')).body.signedIn, true);
  });

  test('signing out this device from the list clears its cookie', async () => {
    const mine = (await call('laptop', 'GET', 'auth/sessions')).body.sessions[0];
    const r = await fetch(`${base}/api/auth/sessions/revoke`, { method: 'POST', headers: { 'x-steady': '1', cookie: jar.laptop, 'content-type': 'application/json' }, body: JSON.stringify({ id: mine.id }) });
    assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
  });
}
