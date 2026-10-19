// Postgres access (Neon in production, any Postgres locally). Server-side only.
import pg from 'pg';

let pool;
export function getPool() {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw Object.assign(new Error('DATABASE_URL is not set'), { status: 503 });
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || url.startsWith('postgres:///');
  pool = new pg.Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10_000, ssl: local ? false : { rejectUnauthorized: true } });
  return pool;
}

export const query = (text, params) => getPool().query(text, params);

// Runs fn(client) in a transaction with app.owner_id set, so row-level security scopes every statement to this owner.
export async function withOwner(ownerId, fn) {
  if (!ownerId) throw Object.assign(new Error('no owner'), { status: 401 });
  const c = await getPool().connect();
  try {
    await c.query('begin');
    await c.query("select set_config('app.owner_id', $1, true)", [ownerId]);
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally { c.release(); }
}

export async function closePool() { if (pool) { await pool.end(); pool = null; } }
