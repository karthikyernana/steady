// Static build: copies the app into dist/ and stamps the service-worker cache version
// with a content hash so every deploy invalidates the offline cache exactly once. No bundler, no transpiling.
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
// Runtime config (Google client id, VAPID public key, DB availability) is served by GET /api/config from Vercel env vars,
// so the static files are identical in every environment and no secret is ever bundled.
import { createHash } from 'node:crypto';

const root = new URL('..', import.meta.url).pathname;
const out = process.env.STEADY_OUT || join(root, 'dist');
const KEEP = ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'fonts', 'icons', '.nojekyll'];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const k of KEEP) cpSync(join(root, k), join(out, k), { recursive: true });
rmSync(join(out, 'js/data/demo.js'), { force: true });   // demo/test data never ships
// release bundles that the GitHub import workflow mirrors into the repo (added by the deploy script; absent locally)

const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const h = createHash('sha256');
for (const f of walk(out).sort()) if (!f.endsWith('sw.js') && !relative(out, f).startsWith('source/')) h.update(relative(out, f)).update(readFileSync(f));
const version = `steady-${JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version}-${h.digest('hex').slice(0, 10)}`;
const sw = readFileSync(join(out, 'sw.js'), 'utf8').replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`);
writeFileSync(join(out, 'sw.js'), sw.replace("  './js/data/demo.js',\n", ''));
console.log(`built ${out} (${version})`);
