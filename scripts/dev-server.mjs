// Local server: static app at /<base>/ plus the same /api router Vercel runs. Usage: PORT=8765 BASE=/ node scripts/dev-server.mjs
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { handle } from '../server/routes.js';

const ROOT = process.env.STATIC_DIR || new URL('..', import.meta.url).pathname;
const PORT = +(process.env.PORT || 8765);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    if (process.env.LOG_REQUESTS) res.on('finish', () => console.log(req.method, u.pathname, res.statusCode));
    return handle(req, res);
  }
  let p = normalize(decodeURIComponent(u.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (p.endsWith('/')) p += 'index.html';
  const file = join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
  try {
    const s = await stat(file); if (!s.isFile()) throw 0;
    res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
    if (file.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end('not found'); }
}).listen(PORT, () => console.log(`steady dev server on http://localhost:${PORT}/  (db: ${process.env.DATABASE_URL ? 'on' : 'off'})`));
