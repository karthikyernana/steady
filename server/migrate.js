// Applies db/migrations/*.sql once each, in order, in transactions. Used by the build step and POST /api/admin/migrate.
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from './db.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');

export async function migrate(log = () => {}) {
  const pool = getPool();
  await pool.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  await pool.query('select pg_advisory_lock(728163)');           // one migrator at a time
  try {
    const done = new Set((await pool.query('select name from schema_migrations')).rows.map(r => r.name));
    const applied = [];
    for (const f of readdirSync(DIR).filter(f => f.endsWith('.sql')).sort()) {
      if (done.has(f)) continue;
      const c = await pool.connect();
      try {
        await c.query('begin'); await c.query(readFileSync(join(DIR, f), 'utf8'));
        await c.query('insert into schema_migrations (name) values ($1)', [f]); await c.query('commit');
        applied.push(f); log(`applied ${f}`);
      } catch (e) { await c.query('rollback').catch(() => {}); throw new Error(`migration ${f} failed: ${e.message}`); }
      finally { c.release(); }
    }
    return applied;
  } finally { await pool.query('select pg_advisory_unlock(728163)').catch(() => {}); }
}
