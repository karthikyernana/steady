// Single-user auth: Google Sign-In (ID token verified against Google's JWKS) and an optional owner passphrase.
// Sessions are random 32-byte tokens in an httpOnly, Secure, SameSite=Lax cookie; only their SHA-256 is stored.
import { createHash, randomBytes, createPublicKey, createVerify, scryptSync, timingSafeEqual } from 'node:crypto';
import { query } from './db.js';

export const COOKIE = 'steady_session';
const SESSION_DAYS = 90;
const sha256 = s => createHash('sha256').update(s).digest('hex');
const allowed = () => (process.env.OWNER_EMAILS || 'karthikyernana@gmail.com').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);

export function parseCookies(req) {
  const out = {};
  for (const p of (req.headers.cookie || '').split(';')) { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }
  return out;
}

function cookieHeader(value, maxAgeSec, req) {
  const secure = (req.headers['x-forwarded-proto'] || '').includes('https') || process.env.NODE_ENV === 'production' || process.env.VERCEL;
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}

export async function currentOwner(req) {
  const tok = parseCookies(req)[COOKIE];
  if (!tok || tok.length < 40) return null;
  const { rows } = await query(
    `update sessions set last_seen_at = now(), expires_at = greatest(expires_at, now() + interval '${SESSION_DAYS} days')
       where token_hash = $1 and expires_at > now()
     returning owner_id, (select email from owners o where o.id = sessions.owner_id) as email`, [sha256(tok)]);
  return rows[0] ? { id: rows[0].owner_id, email: rows[0].email } : null;
}

export async function startSession(res, req, email, device) {
  email = email.toLowerCase();
  if (!allowed().includes(email)) throw Object.assign(new Error('This Steady is private.'), { status: 403 });
  const { rows } = await query(
    `insert into owners (email) values ($1) on conflict (email) do update set email = excluded.email returning id`, [email]);
  const tok = randomBytes(32).toString('base64url');
  await query(`insert into sessions (token_hash, owner_id, device, expires_at) values ($1, $2, $3, now() + interval '${SESSION_DAYS} days')`,
    [sha256(tok), rows[0].id, (device || '').slice(0, 80)]);
  await query(`delete from sessions where expires_at < now()`);
  res.setHeader('Set-Cookie', cookieHeader(tok, SESSION_DAYS * 86400, req));
  return { id: rows[0].id, email };
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
  const header = b64json(h), claims = b64json(p);
  if (header.alg !== 'RS256') throw Object.assign(new Error('Bad token'), { status: 401 });
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
  if (!saltB64 || !hashB64 || typeof pass !== 'string' || pass.length < 8) return false;
  const want = Buffer.from(hashB64, 'base64');
  const got = scryptSync(pass, Buffer.from(saltB64, 'base64'), want.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(want, got);
}

export async function tooManyAttempts(ip) {
  const { rows } = await query(`select count(*)::int as n from login_attempts where not ok and at > now() - interval '1 hour' and (ip = $1 or $1 is null)`, [ip]);
  const { rows: all } = await query(`select count(*)::int as n from login_attempts where not ok and at > now() - interval '1 hour'`);
  return rows[0].n >= 5 || all[0].n >= 20;
}
export const logAttempt = (ip, ok) => query('insert into login_attempts (ip, ok) values ($1, $2)', [ip, ok]);

export const hashToken = sha256;
