// Accounts: email + password (scrypt), optional Google Sign-In (ID token verified against Google's JWKS).
// Sessions are random 32-byte tokens in an httpOnly, Secure, SameSite=Lax cookie; only their SHA-256 is stored.
import { createHash, randomBytes, createPublicKey, createVerify, scryptSync, timingSafeEqual } from 'node:crypto';
import { query } from './db.js';

export const COOKIE = 'steady_session';
const SESSION_DAYS = 90;
const sha256 = s => createHash('sha256').update(s).digest('hex');
const owners = () => (process.env.OWNER_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
// SIGNUP_MODE=open (default): anyone can create an account. SIGNUP_MODE=owners: only OWNER_EMAILS can.
export const signupMode = () => (process.env.SIGNUP_MODE === 'owners' ? 'owners' : 'open');
export const mayCreate = email => signupMode() === 'open' || owners().includes(email);
export const normEmail = e => String(e || '').trim().toLowerCase();
export const validEmail = e => /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i.test(e);

export function parseCookies(req) {
  const out = {};
  for (const p of (req.headers.cookie || '').split(';')) { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }
  return out;
}

export function cookieHeader(value, maxAgeSec, req) {
  const secure = (req.headers['x-forwarded-proto'] || '').includes('https') || process.env.NODE_ENV === 'production' || process.env.VERCEL;
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}

// Where a request comes from: Vercel adds IP geo headers on every request (city is URL-encoded). Locally there are none.
export function reqMeta(req) {
  const h = req.headers || {};
  const ip = String(h['x-real-ip'] || h['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim().slice(0, 64) || null;
  const dec = v => { try { return decodeURIComponent(String(v || '')).trim(); } catch { return String(v || '').trim(); } };
  const place = [dec(h['x-vercel-ip-city']), dec(h['x-vercel-ip-country-region']), dec(h['x-vercel-ip-country'])].filter(Boolean).join(', ').slice(0, 120) || null;
  const ua = String(h['user-agent'] || '').slice(0, 200) || null;
  return { ip, place, ua };
}

export async function currentOwner(req) {
  const tok = parseCookies(req)[COOKIE];
  if (!tok || tok.length < 40) return null;
  const { rows } = await query(
    `update sessions set last_seen_at = now(), expires_at = greatest(expires_at, now() + interval '${SESSION_DAYS} days'),
            last_ip = coalesce($2, last_ip), last_place = coalesce($3, last_place)
       where token_hash = $1 and expires_at > now()
     returning owner_id, token_hash, (select email from owners o where o.id = sessions.owner_id) as email`, [sha256(tok), reqMeta(req).ip, reqMeta(req).place]);
  return rows[0] ? { id: rows[0].owner_id, email: rows[0].email, session: rows[0].token_hash } : null;
}

export async function findOwner(email) {
  const { rows } = await query('select id, email, name, password_hash from owners where lower(email) = $1', [normEmail(email)]);
  return rows[0] || null;
}
export async function createOwner(email, password, name) {
  const { rows } = await query(
    `insert into owners (email, name, password_hash, password_updated_at) values ($1, $2, $3, now()) returning id, email, name`,
    [normEmail(email), name || null, hashPassphrase(password)]);
  return rows[0];
}
export async function setPassword(ownerId, password) {
  await query('update owners set password_hash = $2, password_updated_at = now() where id = $1', [ownerId, hashPassphrase(password)]);
}

export async function startSession(res, req, email, device) {
  email = normEmail(email);
  let o = await findOwner(email);
  if (!o) {
    if (!mayCreate(email)) throw Object.assign(new Error('Sign-ups are closed on this Steady.'), { status: 403 });
    o = (await query('insert into owners (email) values ($1) returning id, email', [email])).rows[0];
  }
  const tok = randomBytes(32).toString('base64url');
  const m = reqMeta(req);
  await query(`insert into sessions (token_hash, owner_id, device, expires_at, user_agent, created_ip, created_place, last_ip, last_place)
               values ($1, $2, $3, now() + interval '${SESSION_DAYS} days', $4, $5, $6, $5, $6)`,
    [sha256(tok), o.id, (device || '').slice(0, 80), m.ua, m.ip, m.place]);
  const rows = [o];
  await query(`delete from sessions where expires_at < now() and not (expires_at = 'epoch' and last_seen_at > now() - interval '90 days')`);
  res.setHeader('Set-Cookie', cookieHeader(tok, SESSION_DAYS * 86400, req));
  return { id: rows[0].id, email };
}

// ---- devices: every signed-in session of an owner. Public id = first 16 hex chars of the token's SHA-256 (not the token).
export async function listSessions(ownerId, currentHash) {
  const { rows } = await query(
    `select token_hash, device, user_agent, created_at, last_seen_at, created_place, last_place, last_ip from sessions
      where owner_id = $1 and expires_at > now() order by last_seen_at desc`, [ownerId]);
  return rows.map(r => ({ id: r.token_hash.slice(0, 16), device: r.device || null, userAgent: r.user_agent || null,
    createdAt: new Date(r.created_at).getTime(), lastSeenAt: new Date(r.last_seen_at).getTime(),
    createdPlace: r.created_place || null, lastPlace: r.last_place || null, lastIp: r.last_ip || null, current: r.token_hash === currentHash }));
}
export async function revokeSession(ownerId, id) {
  if (!/^[0-9a-f]{16}$/.test(String(id || ''))) return 0;
  // kept as a tombstone (expires_at = epoch) so that device learns it was removed and erases its local copy
  return (await query(`update sessions set expires_at = 'epoch' where owner_id = $1 and left(token_hash, 16) = $2 and expires_at > now()`, [ownerId, id])).rowCount;
}
export async function revokeOtherSessions(ownerId, keepHash) {
  return (await query(`update sessions set expires_at = 'epoch' where owner_id = $1 and token_hash <> $2 and expires_at > now()`, [ownerId, keepHash || ''])).rowCount;
}

// true when this request's session was signed out from another device (tombstone), not merely expired or absent.
// Tombstones older than 90 days are cleaned up here, lazily.
export async function isRevoked(req) {
  const tok = parseCookies(req)[COOKIE];
  if (!tok || tok.length < 40) return false;
  const { rows } = await query(`select 1 from sessions where token_hash = $1 and expires_at = 'epoch' and last_seen_at > now() - interval '90 days'`, [sha256(tok)]);
  return rows.length > 0;
}

export async function endSession(res, req) {
  const tok = parseCookies(req)[COOKIE];
  if (tok) await query('delete from sessions where token_hash = $1', [sha256(tok)]);
  res.setHeader('Set-Cookie', cookieHeader('', 0, req));
}

// ---- Google ID token (RS256) ----
let jwksCache = { at: 0, keys: [] };
async function googleKeys() {
  if (Date.now() - jwksCache.at < 3600e3 && jwksCache.keys.length) return jwksCache.keys;
  const r = await fetch(process.env.GOOGLE_JWKS_URL || 'https://www.googleapis.com/oauth2/v3/certs');
  if (!r.ok) throw Object.assign(new Error('Could not reach Google'), { status: 502 });
  jwksCache = { at: Date.now(), keys: (await r.json()).keys };
  return jwksCache.keys;
}
const b64json = s => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

export async function verifyGoogleIdToken(idToken) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw Object.assign(new Error('Google sign-in is not configured'), { status: 501 });
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw Object.assign(new Error('Bad token'), { status: 401 });
  const [h, p, sig] = parts;
  let header, claims;
  try { header = b64json(h); claims = b64json(p); } catch { throw Object.assign(new Error('Bad token'), { status: 401 }); }
  if (header?.alg !== 'RS256') throw Object.assign(new Error('Bad token'), { status: 401 });
  const jwk = (await googleKeys()).find(k => k.kid === header.kid);
  if (!jwk) throw Object.assign(new Error('Unknown signing key'), { status: 401 });
  const v = createVerify('RSA-SHA256'); v.update(`${h}.${p}`);
  if (!v.verify(createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(sig, 'base64url'))) throw Object.assign(new Error('Bad signature'), { status: 401 });
  const now = Math.floor(Date.now() / 1000);
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) throw Object.assign(new Error('Bad issuer'), { status: 401 });
  if (claims.aud !== clientId) throw Object.assign(new Error('Wrong audience'), { status: 401 });
  if (!(claims.exp > now - 60)) throw Object.assign(new Error('Token expired'), { status: 401 });
  if (claims.email_verified !== true && claims.email_verified !== 'true') throw Object.assign(new Error('Email not verified'), { status: 401 });
  return String(claims.email).toLowerCase();
}

// ---- owner passphrase (optional; OWNER_PASSPHRASE_HASH = scrypt$<saltB64>$<hashB64>) ----
export const passphraseEnvHash = () => (/^scrypt\$/.test(process.env.OWNER_PASSPHRASE_HASH || '') ? process.env.OWNER_PASSPHRASE_HASH : null);
export async function passphraseHash() {
  const { rows } = await query('select passphrase_hash from owner_credentials limit 1');
  return rows[0]?.passphrase_hash || passphraseEnvHash();
}
export async function setupAvailable() {
  if (!process.env.SETUP_CODE || process.env.SETUP_CODE.length < 12) return false;
  const { rows } = await query('select 1 from setup_state');
  return !rows.length;
}
export function hashPassphrase(pass, salt = randomBytes(16)) {
  return `scrypt$${salt.toString('base64')}$${scryptSync(pass, salt, 64, { N: 16384, r: 8, p: 1 }).toString('base64')}`;
}
export function checkPassphrase(pass, stored) {
  const [, saltB64, hashB64] = (stored || '').split('$');
  if (!saltB64 || !hashB64 || typeof pass !== 'string' || pass.length < 1) return false;
  const want = Buffer.from(hashB64, 'base64');
  const got = scryptSync(pass, Buffer.from(saltB64, 'base64'), want.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(want, got);
}

// Failed sign-ins in the last hour: 5 from one IP, or 10 against one account (spread over many IPs), pause sign-in for
// that IP / that account only. No instance-wide cap: that would let anyone lock every user out.
export async function tooManyAttempts(ip, email = null) {
  const { rows } = await query(`select count(*) filter (where ip = $1 or $1 is null)::int as by_ip, count(*) filter (where email = $2)::int as by_email
      from login_attempts where not ok and at > now() - interval '1 hour'`, [ip, email ? normEmail(email) : null]);
  return rows[0].by_ip >= 5 || rows[0].by_email >= 10;
}
export const logAttempt = (ip, ok, email = null) => query('insert into login_attempts (ip, ok, email) values ($1, $2, $3)', [ip, ok, email ? normEmail(email).slice(0, 254) : null]);

export const hashToken = sha256;

// ---- GitHub Actions OIDC (lets the scheduled reminders workflow call the API without a stored secret) ----
const ghJwks = { at: 0, keys: [] };
export async function verifyGithubOidc(jwt) {
  const parts = String(jwt || '').split('.');
  if (parts.length !== 3) return false;
  const [h, p, sig] = parts;
  let header, claims;
  try { header = b64json(h); claims = b64json(p); } catch { return false; }
  if (header.alg !== 'RS256' || claims.iss !== 'https://token.actions.githubusercontent.com') return false;
  if (Date.now() - ghJwks.at > 3600e3 || !ghJwks.keys.find(k => k.kid === header.kid)) {
    const r = await fetch('https://token.actions.githubusercontent.com/.well-known/jwks');
    if (!r.ok) return false;
    Object.assign(ghJwks, { at: Date.now(), keys: (await r.json()).keys });
  }
  const jwk = ghJwks.keys.find(k => k.kid === header.kid); if (!jwk) return false;
  const v = createVerify('RSA-SHA256'); v.update(`${h}.${p}`);
  if (!v.verify(createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(sig, 'base64url'))) return false;
  const now = Math.floor(Date.now() / 1000);
  const repo = process.env.CRON_GITHUB_REPO || 'karthikyernana/steady';
  return claims.aud === 'steady-cron' && claims.repository === repo && claims.exp > now && claims.nbf <= now + 60
    && String(claims.workflow_ref || '').startsWith(`${repo}/.github/workflows/reminders.yml@`);
}
