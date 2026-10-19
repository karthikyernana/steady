// Static checks: every precached file exists, every module import resolves, manifest icons exist.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
const root = new URL('..', import.meta.url).pathname;
let bad = 0;
const fail = m => { bad++; console.error('✗', m); };
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const shell = [...sw.slice(sw.indexOf('const SHELL'), sw.indexOf('];')).matchAll(/'(\.\/[^']*)'/g)].map(m => m[1]).filter(p => p !== './');
for (const p of shell) if (!existsSync(join(root, p))) fail(`sw precache missing: ${p}`);
const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
for (const f of walk(join(root, 'js')).filter(f => /\.m?js$/.test(f))) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/(?:from|import)\s*\(?\s*'(\.[^']+)'/g)) {
    const t = normalize(join(dirname(f), m[1]));
    if (!existsSync(t)) fail(`${f.replace(root, '')}: import ${m[1]} not found`);
  }
  const rel = './' + f.replace(root, '');
  if (!rel.endsWith('demo.js') && !shell.includes(rel)) fail(`not precached for offline: ${rel}`);
}
const man = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
for (const i of man.icons) if (!existsSync(join(root, i.src))) fail(`manifest icon missing: ${i.src}`);
if (!man.icons.some(i => i.purpose === 'maskable')) fail('no maskable icon');
console.log(bad ? `${bad} problem(s)` : `ok: ${shell.length} precached files, imports resolve, manifest icons present`);
process.exit(bad ? 1 : 0);
