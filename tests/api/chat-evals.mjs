// Chat eval set (1.6): realistic questions with the card kinds and behaviour a good answer needs, scored automatically.
// Runs against any Steady API: the local stack (mock model) or a Vercel preview (real models).
//
//   node tests/api/chat-evals.mjs http://localhost:8790                       local dev-server + mock
//   node tests/api/chat-evals.mjs https://<preview>.vercel.app --bypass=TOKEN  preview (Vercel protection bypass)
//   options: --email=qa…@example.com (default qa<timestamp>@example.com) --keep (do not delete the account) --json=out.json
//            --cases=1-5 (subset, 1-based) --no-seed (log in to an existing QA account; the seed is pushed again, which also invalidates cached answers) --pause=ms (between questions; free-tier
//            models have per-minute token limits) --delete-only (log in and delete the account)
//
// It signs up a throwaway account, seeds a small realistic data set (dates relative to today, Asia/Kolkata), asks
// every question in its own new chat, scores each answer, prints a table, and deletes the account (POST auth/delete).
// Checks per case (each 0/1, the case score is their mean):
//   ok        HTTP 200 with a message
//   kind      at least one card of an expected kind (cases that expect no card: none required)
//   data      a data card for a data question (the server guarantee), or none needed
//   series    every day-grouped Bar/Line has one point per day of its period (zero days included)
//   suggest   1–3 suggestions, each ≤ 40 chars (data questions)
//   brief     text ≤ 320 chars and ≤ 3 sentences
//   grounded  every number in the text appears in a card's resolved figures (or the seeded data) — no invented figures
//   behave    case-specific text check (e.g. refuses writes politely)
const args = Object.fromEntries(process.argv.slice(3).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const BASE = (process.argv[2] || 'http://localhost:8790').replace(/\/+$/, '') + '/api/';
const BYPASS = args.bypass || process.env.VERCEL_BYPASS || '';
const EMAIL = args.email || `qa${Date.now()}@example.com`, PASSWORD = 'correct horse 9';

export const CASES = [
  { q: 'How many tasks did I finish today?', kinds: ['Stat'], data: true, behave: m => !!m.cards.find(c => c.component === 'Stat')?.data?.compare },
  { q: 'Show me my tasks done this week as a graph', kinds: ['Bar', 'Line'], data: true },
  { q: 'How much did I spend this week?', kinds: ['Stat', 'Bar', 'Donut'], data: true },
  { q: 'Where does my money go this month?', kinds: ['Donut', 'Bar'], data: true },
  { q: "What's still open today?", kinds: ['TaskList', 'Stat'], data: true },
  { q: 'How are my goals going?', kinds: ['ProgressList'], data: true },
  { q: 'What did I write about pricing?', kinds: ['Timeline', 'Table'], data: true },
  { q: 'ee week entha kharchu chesanu?', kinds: ['Stat', 'Donut', 'Bar'], data: true },
  { q: 'aaj kitne tasks hue?', kinds: ['Stat', 'TaskList', 'Bar'], data: true },
  { q: 'Which weekday am I most productive?', kinds: ['Bar', 'Stat'], data: true },
  { q: 'Compare my spending with last week', kinds: ['Stat', 'Bar'], data: true },
  { q: 'Find the task about visa', kinds: ['Timeline', 'TaskList', 'Table'], data: true, behave: m => JSON.stringify(m.cards).toLowerCase().includes('visa') },
  { q: 'Show my spending trend for the last 30 days', kinds: ['Line', 'Bar'], data: true },
  { q: 'How am I doing overall?', kinds: ['Stat', 'Bar', 'ProgressList', 'Heatmap', 'Line', 'Donut', 'TaskList'], data: true },
  { q: 'Add a task to call amma tomorrow at 6pm', kinds: [], data: false, behave: m => /can(no|')t|only (look|read|show)|read-only|not able|unable|Ask button|hold|Today screen/i.test(m.text) },
  { q: 'hi', kinds: [], data: false, behave: m => m.text.length > 0 },
];

// ---------------------------------------------------------------- seed (relative to today in IST)
const istDay = (off = 0) => new Date(Date.now() + 5.5 * 36e5 + off * 864e5).toISOString().slice(0, 10);
const at = (off, hh) => Date.parse(`${istDay(off)}T${String(hh).padStart(2, '0')}:00:00+05:30`);
function seed() {
  const t = (id, title, off, status, doneHour, extra = {}) => ['tasks', { id, title, status, dueDate: istDay(off), ...(status === 'done' ? { doneAt: Math.min(Date.now() - 60_000, at(off, doneHour)) } : {}), createdAt: at(off - 1, 9), ...extra }];
  const m = (id, amount, category, payee, note, off) => ['money', { id, kind: 'expense', amount, category, payee, note, date: istDay(off), createdAt: at(off, 13) }];
  return [
    ['goals', { id: 'g1', title: 'Land an internship by December', milestones: [{ id: 'g1m1', title: 'Portfolio live', done: true }, { id: 'g1m2', title: 'Apply to 10 companies', done: false }, { id: 'g1m3', title: 'Mock interviews', done: false }], order: 0, createdAt: at(-30, 9) }],
    ['goals', { id: 'g2', title: 'Run 5K without stopping', milestones: [{ id: 'g2m1', title: 'Run 2K', done: true }, { id: 'g2m2', title: 'Run 3K', done: true }, { id: 'g2m3', title: 'Run 5K', done: false }], order: 1, createdAt: at(-30, 9) }],
    t('t1', 'Solve 2 DSA problems', 0, 'done', 8, { goalId: 'g1' }), t('t2', 'Morning run', 0, 'done', 7, { goalId: 'g2' }),
    t('t3', 'Post on LinkedIn about the hackathon', 0, 'open'), t('t4', 'Renew visa documents', 1, 'open', 0, { notes: 'passport photo + bank statement' }),
    t('t5', 'Apply to Razorpay internship', -1, 'done', 21, { goalId: 'g1' }), t('t6', 'Gym', -1, 'done', 18),
    t('t7', 'Read 20 pages', -2, 'done', 22), t('t8', 'Mock interview with Ravi', -3, 'done', 16, { goalId: 'g1' }),
    t('t9', 'Pay hostel fee', -4, 'done', 11), t('t10', 'Call amma', -6, 'done', 20), t('t11', 'Clean desk', -2, 'open'),
    m('m1', 250, 'Food', 'Swiggy', 'Biryani lunch', 0), m('m2', 80, 'Transport', 'Rapido', 'Ride to campus', 0), m('m3', 1200, 'Shopping', 'Amazon', 'Running shoes', -2),
    m('m4', 180, 'Food', 'Zomato', 'Dinner', -3), m('m5', 60, 'Food', 'Canteen', 'Chai and samosa', -5), m('m6', 499, 'Subscriptions', 'Spotify', 'Music', -9),
    m('m7', 320, 'Food', 'Swiggy', 'Pizza night', -8), m('m8', 150, 'Transport', 'Uber', 'Station', -10),
    ['thoughts', { id: 'h1', text: 'Pricing idea: free tier with 3 goals, ₹99/month for unlimited #steady', tags: ['steady'], kind: 'idea', mood: 4, createdAt: at(-1, 23) }],
    ['thoughts', { id: 'h2', text: 'Pricing should feel fair to students; maybe annual plan #steady', tags: ['steady'], kind: 'idea', mood: 4, createdAt: at(-6, 22) }],
    ['thoughts', { id: 'h3', text: 'Felt tired after the run but proud', tags: ['health'], kind: 'journal', mood: 4, createdAt: at(0, 8) }],
    ['thoughts', { id: 'h4', text: 'Hackathon team needs a designer', tags: ['hackathon'], kind: 'note', mood: 3, createdAt: at(-4, 19) }],
  ];
}
const SEEDED_NUMBERS = new Set(['250', '80', '1200', '180', '60', '499', '320', '150', '99', '3', '2', '20', '5', '10']);

// ---------------------------------------------------------------- client
let cookie = '';
async function call(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', 'X-Steady': '1', ...(cookie ? { cookie } : {}), ...(BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { status: r.status, body: await r.json().catch(() => null) };
}

// ---------------------------------------------------------------- scoring
const DATA_KINDS = ['Stat', 'Line', 'Bar', 'Donut', 'Heatmap', 'ProgressList', 'TaskList', 'Timeline', 'Table'];
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1;
function figuresIn(m) {
  const s = new Set();
  const add = v => { if (v == null) return; for (const n of String(v).replace(/,/g, '').match(/\d+(\.\d+)?/g) || []) { s.add(n); s.add(String(Math.round(+n))); } };
  const walk = o => { if (o && typeof o === 'object') Object.values(o).forEach(walk); else add(o); };
  walk(m.cards);
  return s;
}
export function score(c, res) {
  const m = res.body?.message;
  const ch = {};
  ch.ok = res.status === 200 && !!m;
  if (!ch.ok) return { checks: { ok: false }, score: 0 };
  const kinds = m.cards.map(x => x.component);
  ch.kind = c.kinds.length ? kinds.some(k => c.kinds.includes(k)) : true;
  ch.data = c.data ? kinds.some(k => DATA_KINDS.includes(k)) : true;
  ch.series = m.cards.filter(x => ['Bar', 'Line'].includes(x.component) && x.query?.params?.group_by === 'day' && x.query.params.from)
    .every(x => x.data.points.length === days(x.query.params.from, x.query.params.to));
  ch.suggest = c.data ? (m.suggestions?.length >= 1 && m.suggestions.length <= 3 && m.suggestions.every(s => s.length <= 40)) : (m.suggestions || []).length <= 3;
  ch.brief = m.text.length <= 320 && (m.text.match(/[.!?](\s|$)/g) || []).length <= 3;
  const figs = figuresIn(m), nums = (m.text.replace(/,/g, '').match(/\d+(\.\d+)?/g) || []).filter(n => !/^(19|20)\d\d$/.test(n));
  ch.grounded = nums.every(n => figs.has(n) || figs.has(String(Math.round(+n))) || SEEDED_NUMBERS.has(n));
  ch.behave = c.behave ? !!c.behave(m) : true;
  const vals = Object.values(ch);
  return { checks: ch, score: vals.filter(Boolean).length / vals.length, kinds, text: m.text, suggestions: m.suggestions, provider: res.body.provider, auto: m.meta?.autoCards || 0 };
}

async function main() {
  const t0 = Date.now();
  let r = args['no-seed'] || args['delete-only'] ? { status: 0 } : await call('POST', 'auth/signup', { email: EMAIL, password: PASSWORD });
  if (r.status !== 200) { r = await call('POST', 'auth/login', { email: EMAIL, password: PASSWORD }); if (r.status !== 200) throw new Error(`sign up/login failed: ${r.status} ${JSON.stringify(r.body)}`); }
  if (args['delete-only']) { const d = await call('POST', 'auth/delete', { password: PASSWORD }); console.log(`account ${EMAIL} deleted: ${d.status} ${JSON.stringify(d.body)}`); return; }
  const now = Date.now();
  const p = await call('POST', 'sync/push', { records: seed().map(([coll, data]) => ({ coll, id: data.id, updatedAt: now, schemaVersion: 2, data: { ...data, updatedAt: now } })) });
  if (p.status !== 200) throw new Error(`seed failed ${p.status}`);
  const st = await call('GET', 'agent/chat/starter?tz=Asia/Kolkata');
  console.log(`starter ${st.status}: ${JSON.stringify({ text: st.body?.text, cards: st.body?.cards?.map(c => `${c.component}:${c.data?.display ?? ''}`), suggestions: st.body?.suggestions })}`);
  const rows = [];
  const [lo, hi] = String(args.cases || `1-${CASES.length}`).split('-').map(Number);
  for (const c of CASES.slice(lo - 1, hi || lo)) {
    if (rows.length && args.pause) await new Promise(r => setTimeout(r, +args.pause));
    const t = Date.now();
    let res = await call('POST', 'agent/chat', { message: c.q, tz: 'Asia/Kolkata' });
    if (res.status === 502 || res.status === 429) { await new Promise(r => setTimeout(r, +(args.retry || 4000))); res = await call('POST', 'agent/chat', { message: c.q, tz: 'Asia/Kolkata' }); }
    const s = score(c, res);
    rows.push({ q: c.q, ms: Date.now() - t, ...s });
    const fails = Object.entries(s.checks).filter(([, v]) => !v).map(([k]) => k);
    console.log(`${(s.score * 100).toFixed(0).padStart(3)}%  ${String(Date.now() - t).padStart(5)}ms  ${(s.provider || '-').padEnd(10)} ${c.q.padEnd(44)} cards=[${(s.kinds || []).join(',')}]${s.auto ? ' (auto)' : ''} ${fails.length ? 'FAIL ' + fails.join(',') : ''}`);
    console.log(`        text: ${JSON.stringify(s.text || res.body)}  chips: ${JSON.stringify(s.suggestions || [])}`);
  }
  const mean = rows.reduce((a, x) => a + x.score, 0) / rows.length;
  const byCheck = {};
  for (const x of rows) for (const [k, v] of Object.entries(x.checks)) { byCheck[k] ??= [0, 0]; byCheck[k][0] += v ? 1 : 0; byCheck[k][1]++; }
  console.log(`\nSCORE ${(mean * 100).toFixed(1)}%  over ${rows.length} cases in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log('by check: ' + Object.entries(byCheck).map(([k, [a, b]]) => `${k} ${a}/${b}`).join('  '));
  if (args.json) (await import('node:fs')).writeFileSync(args.json, JSON.stringify({ base: BASE, at: new Date().toISOString(), cases: `${lo}-${hi || lo}`, score: mean, byCheck, rows }, null, 2));
  if (!args.keep) { const d = await call('POST', 'auth/delete', { password: PASSWORD }); console.log(`account ${EMAIL} deleted: ${d.status} ${JSON.stringify(d.body)}`); }
}
if (import.meta.url.endsWith(process.argv[1]?.split('/').pop())) main().catch(async e => { console.error(e.message); if (cookie && !args.keep) await call('POST', 'auth/delete', { password: PASSWORD }).catch(() => {}); process.exit(1); });
