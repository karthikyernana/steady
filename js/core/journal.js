// Journal intelligence, shared by the browser and the server (pure functions, no I/O).
// An "entry" is any thoughts record. Understanding lives on the record as `jx` (forward-compatible extra field):
//   jx = { v: 1, title, areas: [areaId], facts: [{ area, label, value, unit }], mood: 1-5 | null, people: [name], by, at }
// Today renders a dynamic page from entries + tasks + money + check-ins: the AI picks which views matter and writes the
// words; every number in a chart is computed here from real records, never by the model.

export const AREAS = [
  { id: 'career', label: 'Career', hint: 'jobs, placements, interviews, applications, internships, resume' },
  { id: 'learning', label: 'Learning', hint: 'DSA, courses, reading, studying, classes, exams, new skills' },
  { id: 'building', label: 'Building', hint: 'his projects, startup, coding side projects, shipping, hackathons, content he creates' },
  { id: 'health', label: 'Health', hint: 'gym, sleep, food, walking, sickness, energy' },
  { id: 'mind', label: 'Mind', hint: 'feelings, stress, focus, motivation, self-reflection' },
  { id: 'people', label: 'People', hint: 'family, friends, calls, relationships, networking' },
  { id: 'fun', label: 'Entertainment', hint: 'movies, series, music, games, cricket, scrolling, outings' },
  { id: 'money', label: 'Money', hint: 'spending, earning, saving, investing' },
  { id: 'life', label: 'Life', hint: 'errands, travel, chores, anything else' },
];
export const AREA_IDS = AREAS.map(a => a.id);
export const areaLabel = id => AREAS.find(a => a.id === id)?.label || 'Life';
export const CARD_KINDS = ['balance', 'metric', 'streak', 'mood', 'theme', 'echo', 'money'];
export const MAX_ENTRY = 1500;

const clampStr = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const dayOf = ts => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const addKey = (k, n) => { const [y, m, d] = k.split('-').map(Number); const x = new Date(y, m - 1, d + n); return dayOf(x.getTime()); };
export const normLabel = s => clampStr(s, 40).toLowerCase().replace(/[^\p{L}\p{N}+#. ]/gu, '').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- tagging: schema, prompt, validation
export const TAG_SCHEMA = {
  type: 'object',
  properties: {
    entries: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' },
      title: { type: 'string', description: 'A 2-6 word English title for the entry' },
      areas: { type: 'array', items: { type: 'string', enum: AREA_IDS } },
      facts: { type: 'array', items: { type: 'object', properties: {
        area: { type: 'string', enum: AREA_IDS },
        label: { type: 'string', description: 'Short, stable English name of the thing measured or done, e.g. "DSA problems", "gym", "Panchayat", "sleep"' },
        value: { type: ['number', 'null'] }, unit: { type: ['string', 'null'], description: 'problems, hours, min, km, episodes, pages, ₹ …' },
      }, required: ['area', 'label', 'value', 'unit'] } },
      mood: { type: ['integer', 'null'], description: '1 very low … 5 great, only if the text shows it' },
      people: { type: 'array', items: { type: 'string' } },
    }, required: ['id', 'title', 'areas', 'facts', 'mood', 'people'] } },
  },
  required: ['entries'],
};

export const TAG_SYSTEM = `You read entries from Karthik's personal journal (a 21-year-old student-founder in India; he writes in English, Telugu, or Telugu-English code-mix) and file each one so his journal can show him patterns about himself.
For every entry return:
- title: 2-6 English words.
- areas: 1-3 of: ${AREAS.map(a => `${a.id} (${a.hint})`).join('; ')}.
- facts: only things that can be counted or tracked over days (problems solved, minutes of gym, pages read, episodes of a named show, applications sent). Never a fact for a one-off event, a feeling, or a note. Each fact has a SHORT STABLE label reused across days (always "DSA problems", not "leetcode questions" one day and "DSA" another; a show or game by its name), a number when the text gives one, and a unit. No fact for vague feelings. Prefer the labels listed under "labels he already uses" when they fit.
- mood: 1-5 only when the entry shows how he felt; otherwise null.
- people: first names or relations mentioned (amma, nanna, a friend's name). Never invent.
Return JSON only.`;

export function buildTagPrompt(entries, knownLabels = []) {
  return `Labels he already uses: ${knownLabels.slice(0, 40).join(', ') || 'none yet'}\n\nEntries:\n${entries.map(e => `[${e.id}] ${clampStr(e.text, MAX_ENTRY)}`).join('\n')}`;
}

export function validateTags(raw, ids, by = 'model') {
  const want = new Set(ids); const out = {};
  for (const e of (raw && Array.isArray(raw.entries) ? raw.entries : [])) {
    if (!e || !want.has(String(e.id))) continue;
    const areas = [...new Set((e.areas || []).filter(a => AREA_IDS.includes(a)))].slice(0, 3);
    const facts = (Array.isArray(e.facts) ? e.facts : []).slice(0, 8).map(f => ({
      area: AREA_IDS.includes(f?.area) ? f.area : areas[0] || 'life',
      label: normLabel(f?.label), value: Number.isFinite(+f?.value) && f?.value !== null && f?.value !== '' ? Math.round(+f.value * 100) / 100 : null,
      unit: f?.unit ? clampStr(f.unit, 16).toLowerCase() : null,
    })).map(tidyFact).filter(f => f && f.label);
    const mood = Number.isInteger(+e.mood) && +e.mood >= 1 && +e.mood <= 5 ? +e.mood : null;
    out[e.id] = { v: 1, title: clampStr(e.title, 60), areas: areas.length ? areas : [facts[0]?.area || 'life'], facts, mood,
      people: [...new Set((e.people || []).map(p => clampStr(p, 24)).filter(Boolean))].slice(0, 6), by };
  }
  return out;
}

// Keep facts that can become a line on a chart: a measurable unit, or a named thing (a show, a game, the gym).
const MEASURE = /^(problems|questions|min|minutes|hours|km|pages|chapters|episodes|reps|sets|steps|videos|posts|applications|calls|kg|l|₹|rs|rupees|times|sessions|words|lines|commits)$/;
function tidyFact(f) {
  let { label, unit } = f;
  if (unit && /s$/.test(unit) === false && MEASURE.test(`${unit}s`)) unit = `${unit}s`;
  if (unit && label.endsWith(` ${unit}`)) { const rest = label.slice(0, -unit.length - 1); if (rest.length >= 5) label = rest; }
  if (f.value === 1 && unit && !MEASURE.test(unit) && f.area !== 'fun') return null;   // "1 fix", "1 note": not a measure
  return { ...f, label, unit };
}
const clip = (s, n) => { const t = clampStr(s, n + 1); if (t.length <= n) return t; const cut = t.slice(0, n).replace(/\s+\S*$/, ''); return `${cut}…`; };

// Deterministic fallback (offline / no model). Keyword areas + "<number> <unit>" facts.
const KW = {
  career: /\b(placement|interview|resume|cv|apply|applied|application|job|intern|internship|recruit|hr round|offer letter|capgemini|cognizant|tcs|infosys|wipro|accenture|career|linkedin)\b/i,
  learning: /\b(dsa|leetcode|course|study|studied|learn|learned|learnt|read|reading|book|chapter|lecture|class|exam|revision|practice|problems?|tutorial)\b/i,
  building: /\b(built|build|building|ship|shipped|deploy|deployed|commit|startup|project|app|feature|hackathon|launch|code|coded|coding|post(ed)? on|thread|steady)\b/i,
  health: /\b(gym|workout|run|ran|walk|walked|sleep|slept|ate|diet|protein|yoga|sick|fever|headache|tired|water)\b/i,
  mind: /\b(feel|felt|stress|stressed|anxious|happy|sad|angry|calm|focus|focused|motivated|lazy|overwhelmed|grateful|proud|lonely|bored)\b/i,
  people: /\b(amma|nanna|mom|dad|mother|father|brother|sister|anna|akka|friend|friends|called|call|met|meet|family|roommate)\b/i,
  fun: /\b(movie|film|series|episode|netflix|prime|hotstar|youtube|reels|instagram|game|gaming|played|cricket|match|music|song|anime)\b/i,
  money: /(₹|\brs\.?\b|\brupees?\b|\bspent\b|\bpaid\b|\bearned\b|\bsalary\b|\binvest)/i,
};
const UNIT_RX = /(\d+(?:\.\d+)?)\s*((?:[a-z]+\s+){0,2}?)(problems?|questions?|hours?|hrs?|h|minutes?|mins?|min|km|episodes?|eps?|pages?|chapters?|reps?|sets?|steps|videos?|posts?)\b/gi;
const STOP = new Set(['and', 'then', 'with', 'to', 'for', 'the', 'a', 'an', 'in', 'on', 'at', 'today', 'of', 'but', 'so', 'felt', 'before', 'after']);
const ACTIVITY = /^(gym|workout|walk|walked|run|ran|running|yoga|read|reading|study|studied|cycling|swim|meditation|meditated|sleep|slept|coding|coded)$/i;
const UNIT_NORM = u => { u = u.toLowerCase(); if (/^(hrs?|h|hours?)$/.test(u)) return 'hours'; if (/^(mins?|minutes?)$/.test(u)) return 'min'; if (/^eps?$|^episodes?$/.test(u)) return 'episodes'; if (u === 'km') return 'km'; return u.endsWith('s') ? u : `${u}s`; };
export function ruleTag(text) {
  const t = String(text || '');
  const areas = AREA_IDS.filter(a => KW[a]?.test(t)).slice(0, 3);
  const facts = [];
  for (const m of t.matchAll(UNIT_RX)) {
    const unit = UNIT_NORM(m[3]), mid = m[2].trim().toLowerCase();
    const before = t.slice(0, m.index).trim().split(/[\s,.;]+/).filter(Boolean).pop() || '';
    const afterWords = t.slice(m.index + m[0].length).split(/[,.;!?\n]/)[0].trim().split(/\s+/).filter(Boolean);
    let label;
    if (/dsa|leetcode/i.test(`${mid} ${t}`) && /problem|question/.test(unit)) label = 'dsa problems';
    else if (mid) label = `${mid} ${unit}`;
    else if (afterWords[0]?.toLowerCase() === 'of') { const ws = []; for (const w of afterWords.slice(1)) { if (/^(and|then|with|but|so|went|before|after|today|\d.*)$/i.test(w) || ws.length >= 4) break; ws.push(w); } label = ws.join(' '); }
    else if (ACTIVITY.test(before)) label = before;
    else if (afterWords[0] && !STOP.has(afterWords[0].toLowerCase())) label = afterWords[0];
    else label = unit;
    label = normLabel(label.replace(/^(walked|ran|studied|meditated|slept|coded)$/i, w => ({ walked: 'walk', ran: 'run', studied: 'study', meditated: 'meditation', slept: 'sleep', coded: 'coding' })[w.toLowerCase()]));
    const area = /dsa|problem|page|chapter|study|read/i.test(label + unit) ? 'learning' : /gym|walk|run|yoga|sleep|workout|km|steps|reps|sets/i.test(label + unit) ? 'health' : /episode/.test(unit) ? 'fun' : areas[0] || 'life';
    facts.push({ area, label, value: +m[1], unit });
  }
  if (!facts.length && /\bgym\b/i.test(t)) facts.push({ area: 'health', label: 'gym', value: null, unit: null });
  const pos = /\b(happy|great|proud|good|excited|grateful|productive)\b/i.test(t), neg = /\b(sad|tired|stressed|anxious|bad|low|lazy|overwhelmed|angry)\b/i.test(t);
  return { v: 1, title: clampStr(t.split(/[.!?\n]/)[0], 48), areas: areas.length ? areas : ['life'], facts: facts.slice(0, 6), mood: pos && !neg ? 4 : neg && !pos ? 2 : null, people: [], by: 'rules' };
}

// ---------------------------------------------------------------- stats (all numbers come from here)
export function journalStats({ thoughts = [], tasks = [], money = [], checkins = [] }, today, { days = 14 } = {}) {
  const keys = Array.from({ length: days }, (_, i) => addKey(today, i - days + 1));
  const inWin = new Set(keys);
  const entries = thoughts.filter(t => !t.deleted && t.createdAt).map(t => ({ ...t, day: dayOf(t.createdAt) }));
  const tagged = entries.filter(e => e.jx);
  const byDayArea = Object.fromEntries(keys.map(k => [k, Object.fromEntries(AREA_IDS.map(a => [a, 0]))]));
  for (const e of tagged) if (inWin.has(e.day)) for (const a of e.jx.areas || []) byDayArea[e.day][a] += 1;
  // tasks done and money count toward areas too (a task linked to a goal → building; money → money)
  for (const t of tasks) if (t.status === 'done' && t.doneAt) { const k = dayOf(t.doneAt); if (inWin.has(k)) byDayArea[k][guessTaskArea(t.title)] += 1; }
  for (const m of money) if (inWin.has(m.date)) byDayArea[m.date].money += 1;
  const areaTotals = Object.fromEntries(AREA_IDS.map(a => [a, keys.reduce((s, k) => s + byDayArea[k][a], 0)]));
  // metrics: same label (+unit) summed per day
  const metrics = new Map();
  for (const e of tagged) for (const f of e.jx.facts || []) {
    const id = `${f.label}|${f.unit || ''}`;
    if (!metrics.has(id)) metrics.set(id, { id, label: f.label, unit: f.unit, area: f.area, perDay: Object.fromEntries(keys.map(k => [k, 0])), count: 0, total: 0, allTime: 0, lastDay: null });
    const m = metrics.get(id); m.allTime += f.value ?? 1;
    if (!m.lastDay || e.day > m.lastDay) m.lastDay = e.day;
    if (inWin.has(e.day)) { m.perDay[e.day] += f.value ?? 1; m.count += 1; m.total += f.value ?? 1; }
  }
  // area streaks: consecutive days up to today (or yesterday) with something in that area
  const activeDays = a => new Set(entries.filter(e => e.jx?.areas?.includes(a)).map(e => e.day));
  const streaks = Object.fromEntries(AREA_IDS.map(a => {
    const s = activeDays(a); let n = 0, k = s.has(today) ? today : addKey(today, -1);
    while (s.has(k)) { n++; k = addKey(k, -1); }
    return [a, n];
  }));
  // mood: entry moods averaged per day, check-in energy as a second line
  const mood = keys.map(k => { const ms = tagged.filter(e => e.day === k && e.jx.mood).map(e => e.jx.mood); return ms.length ? ms.reduce((x, y) => x + y, 0) / ms.length : null; });
  const energy = keys.map(k => checkins.find(c => c.date === k)?.energy ?? null);
  const people = new Map();
  for (const e of tagged) if (inWin.has(e.day)) for (const p of e.jx.people || []) people.set(p.toLowerCase(), { name: p, n: (people.get(p.toLowerCase())?.n || 0) + 1 });
  const spend = {};
  for (const m of money) if (inWin.has(m.date) && m.kind !== 'income') spend[m.category || 'Other'] = (spend[m.category || 'Other'] || 0) + m.amount;
  const todayEntries = entries.filter(e => e.day === today);
  return {
    today, keys, byDayArea, areaTotals, streaks, mood, energy, spend,
    metrics: [...metrics.values()].sort((a, b) => b.count - a.count || b.total - a.total),
    people: [...people.values()].sort((a, b) => b.n - a.n),
    entryCount: entries.filter(e => inWin.has(e.day)).length, taggedCount: tagged.length, allEntries: entries.length,
    todayEntries: todayEntries.length, daysWritten: new Set(entries.filter(e => inWin.has(e.day)).map(e => e.day)).size,
  };
}
export function guessTaskArea(title) {
  const t = String(title || '');
  for (const a of ['career', 'learning', 'building', 'health', 'people', 'fun', 'money']) if (KW[a].test(t)) return a;
  return 'life';
}

// An entry from the past worth resurfacing ("a month ago you wrote…"): same weekday-ish distance, prefer tagged + longer.
export function echoEntry(thoughts, today) {
  const targets = [7, 30, 90, 365].map(n => addKey(today, -n));
  for (const k of targets) {
    const c = thoughts.filter(t => !t.deleted && t.createdAt && dayOf(t.createdAt) === k && String(t.text || '').length > 40).sort((a, b) => b.text.length - a.text.length)[0];
    if (c) return { entry: c, day: k };
  }
  return null;
}

// ---------------------------------------------------------------- reflection: the model picks views and writes words
export const REFLECT_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'One sentence about him today or lately, specific, warm, under 120 characters' },
    prompt: { type: ['string', 'null'], description: 'One short, specific question that invites him to write about something in his own entries; null if nothing fits' },
    cards: { type: 'array', items: { type: 'object', properties: {
      kind: { type: 'string', enum: CARD_KINDS },
      area: { type: ['string', 'null'], enum: [...AREA_IDS, null] },
      metric: { type: ['string', 'null'], description: 'For kind=metric: the metric id exactly as listed' },
      title: { type: 'string', description: '2-6 words' },
      text: { type: 'string', description: 'One or two sentences of insight grounded in the numbers given. Under 180 characters.' },
    }, required: ['kind', 'area', 'metric', 'title', 'text'] } },
  },
  required: ['headline', 'prompt', 'cards'],
};

export const REFLECT_SYSTEM = `You are the intelligence inside Karthik's journal app. He is a 21-year-old student-founder in India. The journal's job is to help him understand himself: his career, learning, building, health, mind, people, entertainment and money. You are given a compact digest of the last 14 days (counts per area, metrics he tracks, streaks, mood, spending, a few recent entries).
Choose the 2-4 views that would teach him the most about himself RIGHT NOW and write their words. Views:
- balance: where his days went across areas (always useful when 3+ days have entries)
- metric: one tracked metric over time (give its exact metric id)
- streak: a run of days in one area (give the area)
- mood: how he has felt (needs 3+ mood points)
- theme: a recurring person, topic or pattern visible in the entries
- echo: resurface the old entry provided, and connect it to now
- money: spending pattern vs his life (needs spending data)
Rules: be specific and honest, use his own words and numbers, notice connections (e.g. mood is higher on gym days; learning dropped while placements rose). Never give generic productivity advice, never tell him to plan his day, no nagging, no emojis. If there is little data, say what the journal will show once he writes more. Return JSON only.`;

export function buildReflectDigest(stats, thoughts, { echo = null, name = '' } = {}) {
  const recent = thoughts.filter(t => !t.deleted && t.createdAt && stats.keys.includes(dayOf(t.createdAt)))
    .sort((a, b) => b.createdAt - a.createdAt).slice(0, 12)
    .map(t => `${dayOf(t.createdAt)} ${t.jx?.areas?.join('/') || '?'}: ${clampStr(t.text, 220)}`);
  return [
    `Today: ${stats.today}${name ? `. Name: ${name}` : ''}. Entries in 14 days: ${stats.entryCount} on ${stats.daysWritten} days; today: ${stats.todayEntries}.`,
    `Area totals (entries + done tasks + money logs): ${AREA_IDS.map(a => `${a} ${stats.areaTotals[a]}`).join(', ')}.`,
    `Area per day (oldest→today): ${AREA_IDS.filter(a => stats.areaTotals[a]).map(a => `${a} [${stats.keys.map(k => stats.byDayArea[k][a]).join(',')}]`).join('; ') || 'none'}.`,
    `Metrics (id: per-day oldest→today, total, unit): ${stats.metrics.slice(0, 10).map(m => `${m.id}: [${stats.keys.map(k => m.perDay[k]).join(',')}] total ${m.total}${m.unit ? ` ${m.unit}` : ''}`).join('; ') || 'none'}.`,
    `Current streaks (days): ${AREA_IDS.filter(a => stats.streaks[a]).map(a => `${a} ${stats.streaks[a]}`).join(', ') || 'none'}.`,
    `Mood 1-5 per day: [${stats.mood.map(v => (v == null ? '-' : v.toFixed(1))).join(',')}]. Check-in energy: [${stats.energy.map(v => v ?? '-').join(',')}].`,
    `Spending ₹ by category (14 days): ${Object.entries(stats.spend).map(([c, v]) => `${c} ${Math.round(v)}`).join(', ') || 'none'}.`,
    `People mentioned: ${stats.people.slice(0, 6).map(p => `${p.name} ×${p.n}`).join(', ') || 'none'}.`,
    echo ? `Old entry to maybe resurface (${echo.day}): "${clampStr(echo.entry.text, 260)}"` : 'No old entry to resurface.',
    `Recent entries:\n${recent.join('\n') || '(none)'}`,
  ].join('\n');
}

export function validateReflect(raw, stats, { hasEcho = false } = {}) {
  const metricIds = new Set(stats.metrics.map(m => m.id));
  const cards = [];
  for (const c of (raw && Array.isArray(raw.cards) ? raw.cards : [])) {
    if (!c || !CARD_KINDS.includes(c.kind)) continue;
    const card = { kind: c.kind, area: AREA_IDS.includes(c.area) ? c.area : null, metric: c.metric && metricIds.has(c.metric) ? c.metric : null,
      title: clip(c.title, 48), text: clip(c.text, 240) };
    if (card.kind === 'metric' && !card.metric) continue;
    if (card.kind === 'streak' && !card.area) continue;
    if (card.kind === 'echo' && !hasEcho) continue;
    if (card.kind === 'money' && !Object.keys(stats.spend).length) continue;
    if (card.kind === 'mood' && stats.mood.filter(v => v != null).length + stats.energy.filter(v => v != null).length < 3) continue;
    if (cards.some(x => x.kind === card.kind && x.metric === card.metric && x.area === card.area)) continue;
    cards.push(card);
  }
  return { headline: clip(raw?.headline, 160), prompt: raw?.prompt ? clip(raw.prompt, 140) : null, cards: cards.slice(0, 4) };
}

// No model: pick views by simple rules and write plain, factual words.
export function localReflect(stats, { echo = null } = {}) {
  const cards = [];
  const top = AREA_IDS.filter(a => stats.areaTotals[a]).sort((a, b) => stats.areaTotals[b] - stats.areaTotals[a]);
  if (stats.daysWritten >= 2 && top.length >= 2) cards.push({ kind: 'balance', area: null, metric: null, title: 'Where your days went', text: `Mostly ${areaLabel(top[0]).toLowerCase()} and ${areaLabel(top[1]).toLowerCase()} over the last two weeks.` });
  const m = stats.metrics.find(x => x.count >= 2);
  if (m) cards.push({ kind: 'metric', area: m.area, metric: m.id, title: cap(m.label), text: `${fmtNum(m.total)}${m.unit ? ` ${m.unit}` : ' times'} in 14 days, logged on ${Object.values(m.perDay).filter(Boolean).length} days.` });
  const st = AREA_IDS.filter(a => stats.streaks[a] >= 2).sort((a, b) => stats.streaks[b] - stats.streaks[a])[0];
  if (st) cards.push({ kind: 'streak', area: st, metric: null, title: `${areaLabel(st)} streak`, text: `${stats.streaks[st]} days in a row with ${areaLabel(st).toLowerCase()} in your journal.` });
  if (stats.mood.filter(v => v != null).length >= 3) cards.push({ kind: 'mood', area: null, metric: null, title: 'How you felt', text: 'Your mood across the last two weeks, from what you wrote.' });
  if (echo && cards.length < 4) cards.push({ kind: 'echo', area: null, metric: null, title: 'From your journal', text: `You wrote this ${Math.round((Date.parse(stats.today) - Date.parse(echo.day)) / 864e5)} days ago.` });
  const headline = stats.allEntries === 0 ? 'Write anything. I’ll start seeing patterns after a few entries.'
    : stats.todayEntries ? `${stats.todayEntries} ${stats.todayEntries === 1 ? 'entry' : 'entries'} today. ${top[0] ? `${areaLabel(top[0])} leads this fortnight.` : ''}`.trim()
      : `Nothing written today yet. ${stats.daysWritten} of the last 14 days have entries.`;
  return { headline, prompt: null, cards: cards.slice(0, 4), by: 'device' };
}
const cap = s => String(s || '').replace(/^\p{L}/u, c => c.toUpperCase());
export const fmtNum = v => (Math.round(v * 10) / 10).toLocaleString('en-IN');
