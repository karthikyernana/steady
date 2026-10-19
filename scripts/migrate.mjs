// Applies pending migrations. Runs in the Vercel build (DATABASE_URL_UNPOOLED/DATABASE_URL injected by the Neon integration);
// skips quietly when no database is configured (e.g. local static builds). Never prints connection strings.
if (!process.env.DATABASE_URL && process.env.DATABASE_URL_UNPOOLED) process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;
if (process.env.DATABASE_URL_UNPOOLED) process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED; // DDL prefers a direct connection
if (!process.env.DATABASE_URL) { console.log('migrate: no DATABASE_URL, skipping'); process.exit(0); }
const { migrate } = await import('../server/migrate.js');
const { closePool } = await import('../server/db.js');
try {
  const applied = await migrate(m => console.log('migrate:', m));
  console.log(`migrate: ${applied.length ? applied.length + ' applied' : 'up to date'}`);
} catch (e) { console.error('migrate:', e.message); process.exitCode = 1; }
finally { await closePool(); }
