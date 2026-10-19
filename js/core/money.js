// Money: pure helpers for the Money tab and the voice agent (no DOM, unit-tested).
//   parseAmount("five hundred") → 500     parseAmount("ఐదు వందలు") → 500     parseAmount("2.5k") → 2500
//   parseMoney("250 lunch swiggy")        → { kind:'expense', amount:250, category:'Food', payee:'Swiggy', note:'Lunch' }
//   summarize(entries, '2026-10')         → totals, by category, by day, budget status
import { dateKey, addDays, fromKey, pad } from './util.js';

// ---------- formatting (Indian digit grouping: 1,23,456) ----------
export function fmtINR(n, { sign = false, decimals = 'auto' } = {}) {
  const v = Math.abs(Number(n) || 0);
  const d = decimals === 'auto' ? (Math.round(v * 100) % 100 ? 2 : 0) : decimals;
  const [int, frac] = v.toFixed(d).split('.');
  const last3 = int.slice(-3), rest = int.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  const s = (Number(n) < 0 ? '−' : sign ? '+' : '') + '₹' + grouped + (frac ? `.${frac}` : '');
  return s;
}
export const monthKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const monthAdd = (mk, n) => { const [y, m] = mk.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return monthKey(d); };
export const daysInMonth = mk => { const [y, m] = mk.split('-').map(Number); return new Date(y, m, 0).getDate(); };

// ---------- amounts from words (English, Telugu script, romanized Telugu) ----------
const EN_UNITS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  a: 1, an: 1, half: 0.5 };
const TE_UNITS = {
  'ఒకటి': 1, 'ఒక': 1, 'రెండు': 2, 'మూడు': 3, 'నాలుగు': 4, 'ఐదు': 5, 'అయిదు': 5, 'ఆరు': 6, 'ఏడు': 7, 'ఎనిమిది': 8, 'తొమ్మిది': 9, 'పది': 10,
  'ఇరవై': 20, 'ముప్పై': 30, 'నలభై': 40, 'యాభై': 50, 'అరవై': 60, 'డెబ్బై': 70, 'ఎనభై': 80, 'తొంభై': 90,
  // romanized Telugu, as Saaras "translit"/code-mixed output or typing would give it
  okati: 1, oka: 1, rendu: 2, moodu: 3, mudu: 3, nalugu: 4, aidu: 5, ayidu: 5, aaru: 6, aru: 6, edu: 7, enimidi: 8, tommidi: 9, padi: 10,
  iravai: 20, muppai: 30, nalabhai: 40, yabhai: 50, aravai: 60, debbai: 70, enabhai: 80, tombhai: 90,
};
const MULT = { hundred: 100, thousand: 1000, k: 1000, lakh: 1e5, lakhs: 1e5, lac: 1e5, crore: 1e7,
  'వంద': 100, 'వందలు': 100, 'వందల': 100, 'నూరు': 100, 'వెయ్యి': 1000, 'వేలు': 1000, 'వేల': 1000, 'లక్ష': 1e5, 'లక్షలు': 1e5, 'లక్షల': 1e5,
  vanda: 100, vandalu: 100, vandala: 100, veyyi: 1000, velu: 1000, vela: 1000, laksha: 1e5, lakshalu: 1e5 };
const CURRENCY = /^(?:rs\.?|inr|rupees?|rupay(?:a|alu)?|bucks|₹|రూపాయలు|రూపాయి|రూ\.?)$/i;

function tokenize(s) { return String(s).toLowerCase().replace(/[₹]/g, ' ₹ ').replace(/,(?=\d{2,3}\b)/g, '').split(/[\s-]+|(?<=\d)(?=[a-z])/u).filter(Boolean); }

// Finds the first amount in free text. Returns { value, start, end, text } (token indexes) or null.
export function findAmount(text) {
  const toks = tokenize(text);
  for (let i = 0; i < toks.length; i++) {
    const r = readNumber(toks, i);
    if (r && r.value > 0) {
      let end = r.end;
      while (end < toks.length && CURRENCY.test(toks[end])) end++;
      return { value: Math.round(r.value * 100) / 100, start: i, end, tokens: toks.slice(i, end) };
    }
  }
  return null;
}
export function parseAmount(text) { return findAmount(text)?.value ?? null; }

function readNumber(toks, i) {
  // digits: "500", "1,200", "2.5k", "₹ 300", "300rs"
  let j = i; if (CURRENCY.test(toks[j]) && toks[j + 1]) j++;
  const m = /^(\d+(?:\.\d+)?)(k|l|lakh|cr)?$/i.exec(toks[j] || '');
  if (m) {
    let v = parseFloat(m[1]);
    if (m[2]) v *= { k: 1e3, l: 1e5, lakh: 1e5, cr: 1e7 }[m[2].toLowerCase()];
    let end = j + 1;
    if (MULT[toks[end]] && MULT[toks[end]] >= 100 && !/k/i.test(m[2] || '')) { v *= MULT[toks[end]]; end++; }
    return { value: v, end };
  }
  // words: "two thousand five hundred", "ఐదు వందలు", "rendu velu aidu vandalu", "five hundred and fifty"
  let total = 0, cur = 0, any = false, k = j;
  for (; k < toks.length; k++) {
    const t = toks[k].replace(/[.,!?]$/, '');
    if (t === 'and' && any) continue;
    if (EN_UNITS[t] !== undefined && !(t === 'a' || t === 'an' || t === 'half') ) { cur += EN_UNITS[t]; any = true; continue; }
    if ((t === 'a' || t === 'an') && MULT[toks[k + 1]]) { cur += 1; any = true; continue; }
    if (TE_UNITS[t] !== undefined) { cur += TE_UNITS[t]; any = true; continue; }
    if (MULT[t]) {
      if (!any && MULT[t] >= 1000) break;                   // "thousand" alone is not an amount
      const mult = MULT[t]; cur = (cur || 1) * mult;
      if (mult >= 1000) { total += cur; cur = 0; }
      any = true; continue;
    }
    break;
  }
  if (!any) return null;
  return { value: total + cur, end: k };
}

// ---------- categories ----------
export const DEFAULT_CATEGORIES = ['Food', 'Groceries', 'Transport', 'Shopping', 'Bills', 'Rent', 'Education', 'Health', 'Entertainment', 'Family', 'Other'];
export const INCOME_CATEGORIES = ['Salary', 'Freelance', 'Stipend', 'Gift', 'Refund', 'Other income'];
const KEYWORDS = [
  ['Food', /\b(swiggy|zomato|lunch|dinner|breakfast|food|tea|chai|coffee|snacks?|canteen|mess|biryani|tiffin|restaurant|cafe|pizza|burger|juice|meal|dosa|idli|kfc|domino'?s)\b|భోజనం|టిఫిన్|టీ|కాఫీ|అన్నం|బిర్యానీ/i],
  ['Groceries', /\b(grocer(y|ies)|vegetables?|veggies|fruits?|milk|blinkit|zepto|bigbasket|instamart|kirana|dmart)\b|కూరగాయలు|పాలు|సరుకులు/i],
  ['Transport', /\b(auto|uber|ola|rapido|bus|train|metro|petrol|diesel|fuel|irctc|cab|taxi|flight|ticket|parking|toll)\b|ఆటో|బస్|పెట్రోల్|రైలు/i],
  ['Shopping', /\b(amazon|flipkart|myntra|ajio|meesho|clothes|shirt|shoes|jeans|tshirt|t-shirt|bag|watch|headphones?|earbuds)\b|బట్టలు/i],
  ['Bills', /\b(recharge|jio|airtel|vi|bsnl|electricity|current bill|wifi|broadband|bill|gas)\b|రీఛార్జ్|కరెంట్/i],
  ['Rent', /\b(rent|hostel|pg)\b|అద్దె/i],
  ['Education', /\b(books?|course|fees?|exam|udemy|coursera|college|tuition|notes|xerox|printout|stationery)\b|పుస్తకాలు|ఫీజు/i],
  ['Health', /\b(medicines?|pharmacy|doctor|hospital|gym|clinic|tablets?)\b|మందులు|డాక్టర్/i],
  ['Entertainment', /\b(movie|netflix|spotify|prime|hotstar|youtube premium|game|concert|outing)\b|సినిమా/i],
  ['Family', /\b(home|amma|nanna|mom|dad|parents|sent home|family)\b|అమ్మ|నాన్న|ఇంటికి/i],
];
const INCOME_KW = [
  ['Salary', /\b(salary|paycheck)\b|జీతం/i], ['Stipend', /\b(stipend|scholarship)\b/i], ['Freelance', /\b(freelance|client|project|gig|invoice)\b/i],
  ['Refund', /\b(refund|cashback)\b/i], ['Gift', /\b(gift|birthday money)\b/i],
];
const PAYEES = ['Swiggy', 'Zomato', 'Uber', 'Ola', 'Rapido', 'Amazon', 'Flipkart', 'Myntra', 'Ajio', 'Blinkit', 'Zepto', 'BigBasket', 'Instamart', 'DMart', 'IRCTC', 'Jio', 'Airtel', 'Netflix', 'Spotify', 'Hotstar', 'Udemy', 'Meesho', 'KFC', 'Dominos'];

// memory = { payees: { lower: { name, category } }, corrections: [{ w, c }] } learned on the server (see server/agent/memory.js)
export function guessCategory(text, kind = 'expense', { memory = null, known = [] } = {}) {
  const t = String(text || '');
  const lw = t.toLowerCase();
  if (memory) {
    for (const c of memory.corrections || []) if (c.w && new RegExp(`(^|[^\\p{L}])${escapeRe(c.w)}($|[^\\p{L}])`, 'iu').test(lw)) return canonicalCategory(c.c, known);
    for (const [k, p] of Object.entries(memory.payees || {})) if (p.category && lw.includes(k)) return canonicalCategory(p.category, known);
  }
  for (const [c, re] of kind === 'income' ? INCOME_KW : KEYWORDS) if (re.test(t)) return c;
  return kind === 'income' ? 'Other income' : 'Other';
}
export function guessPayee(text, memory = null) {
  const lw = String(text || '').toLowerCase();
  for (const [k, p] of Object.entries(memory?.payees || {})) if (k.length > 2 && lw.includes(k)) return p.name;
  return PAYEES.find(p => new RegExp(`\\b${p.toLowerCase()}\\b`).test(lw)) || null;
}
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const titleCase = s => s.replace(/\S+/g, w => w[0].toUpperCase() + w.slice(1));
// Use an existing category's spelling when one matches case-insensitively, else Title Case it.
export function canonicalCategory(c, known = []) {
  const v = String(c || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!v) return 'Other';
  const hit = [...known, ...DEFAULT_CATEGORIES, ...INCOME_CATEGORIES].find(k => k.toLowerCase() === v.toLowerCase());
  return hit || (/[a-z]/i.test(v) ? titleCase(v) : v);
}

const INCOME_RE = /\b(got|received|recieved|credited|earned|salary|stipend|income|paid me|refund|cashback)\b|వచ్చింది|వచ్చాయి|జీతం/i;
const EXPENSE_RE = /\b(spent|spend|paid|pay|bought|buy|cost|for|on|kharchu|karchu|petta|pettanu|kharcha)\b|ఖర్చు|కట్టాను|కొన్నాను|పెట్టాను/i;

// Quick-add for money: "250 lunch swiggy", "got 5000 stipend", "uber 180 yesterday", "ఐదు వందలు పెట్రోల్"
export function parseMoney(input, { now = new Date(), memory = null, known = [] } = {}) {
  const text = String(input || '').trim();
  const out = { kind: 'expense', amount: null, category: 'Other', payee: null, note: '', date: dateKey(now), chips: [] };
  if (!text) return out;
  if (INCOME_RE.test(text) && !/\b(spent|paid|bought)\b/i.test(text)) out.kind = 'income';
  let rest = text;
  // date words
  const dm = /\b(yesterday|today|day before yesterday)\b|నిన్న|ఈరోజు|ఇవాళ|ninna|ivala|eeroju/i.exec(rest);
  if (dm) {
    const w = dm[0].toLowerCase();
    out.date = dateKey(addDays(now, /day before/.test(w) ? -2 : /yesterday|నిన్న|ninna/.test(w) ? -1 : 0));
    rest = rest.replace(dm[0], ' ');
    if (out.date !== dateKey(now)) out.chips.push({ k: 'date', label: out.date === dateKey(addDays(now, -1)) ? 'Yesterday' : out.date });
  }
  const a = findAmount(rest);
  if (a) {
    out.amount = a.value;
    const toks = tokenize(rest); toks.splice(a.start, a.end - a.start);
    rest = toks.join(' ');
  }
  out.payee = guessPayee(text, memory);
  out.category = guessCategory(text, out.kind, { memory, known });
  const note = rest.replace(/\b(spent|spend|paid|pay|bought|on|for|rs|inr|rupees?|got|received|credited|from|to|the|a|an|i|my|at|today|via|by|upi|cash)\b|₹/gi, ' ')
    .replace(new RegExp(out.payee ? `\\b${escapeRe(out.payee)}\\b` : '$^', 'i'), ' ').replace(/(^|\s)(?:కి|కు|కోసం|ఖర్చు|ఖర్చు అయ్యింది|అయ్యింది|పెట్టాను|కట్టాను|రూపాయలు|ki|ku|kosam|kharchu|karchu|ayyindi|pettanu|petta|kattanu)(?=\s|$)/giu, ' ').replace(/\s+/g, ' ').trim();
  out.note = note ? note[0].toUpperCase() + note.slice(1) : (out.payee || '');
  if (out.amount != null) out.chips.unshift({ k: out.kind === 'income' ? 'income' : 'amount', label: fmtINR(out.amount, { sign: out.kind === 'income' }) });
  out.chips.push({ k: 'cat', label: out.category });
  if (out.payee) out.chips.push({ k: 'payee', label: out.payee });
  return out;
}

// ---------- monthly view ----------
export function inMonth(e, mk) { return typeof e.date === 'string' && e.date.startsWith(mk); }
export function summarize(entries, mk, { budgets = null, now = new Date() } = {}) {
  const xs = entries.filter(e => !e.deleted && inMonth(e, mk));
  let spent = 0, income = 0;
  const byCat = new Map(), byDay = new Array(daysInMonth(mk)).fill(0);
  for (const e of xs) {
    const amt = Number(e.amount) || 0;
    if (e.kind === 'income') { income += amt; continue; }
    spent += amt;
    byCat.set(e.category || 'Other', (byCat.get(e.category || 'Other') || 0) + amt);
    const d = +e.date.slice(8, 10); if (d >= 1 && d <= byDay.length) byDay[d - 1] += amt;
  }
  const cats = [...byCat].sort((a, b) => b[1] - a[1]).map(([category, amount]) => ({ category, amount, share: spent ? amount / spent : 0 }));
  const isCurrent = mk === monthKey(now);
  const dayN = isCurrent ? now.getDate() : daysInMonth(mk);
  const out = { month: mk, count: xs.length, spent: r2(spent), income: r2(income), net: r2(income - spent), cats, byDay, avgPerDay: dayN ? r2(spent / dayN) : 0 };
  if (budgets && (budgets.total || Object.keys(budgets.categories || {}).length)) {
    const elapsed = isCurrent ? now.getDate() / daysInMonth(mk) : 1;
    const line = (category, limit, used) => ({ category, limit, used: r2(used), left: r2(limit - used), frac: limit ? used / limit : 0, pace: limit ? used / limit - elapsed : 0 });
    out.budget = {
      total: budgets.total ? line('All spending', budgets.total, spent) : null,
      categories: Object.entries(budgets.categories || {}).filter(([, v]) => v > 0).map(([c, v]) => line(c, v, byCat.get(c) || 0)).sort((a, b) => b.frac - a.frac),
    };
  }
  return out;
}
const r2 = n => Math.round(n * 100) / 100;

// One calm sentence about the month (shown under the title). Never scolds.
export function moneyLine(sum, prev, { now = new Date() } = {}) {
  if (!sum.count) return prev?.count ? `Nothing logged for this month yet. Last month you spent ${fmtINR(prev.spent)}.` : 'Log what comes in and goes out.';
  const parts = [`${fmtINR(sum.spent)} spent`];
  if (sum.income) parts.push(`${fmtINR(sum.income)} in`);
  let tail = '';
  const b = sum.budget?.total;
  if (b) tail = b.left >= 0 ? ` ${fmtINR(b.left)} left in your budget.` : ` ${fmtINR(-b.left)} over budget. It happens; next week is a fresh start.`;
  else if (sum.cats[0] && sum.cats[0].share >= 0.35 && sum.count >= 4) tail = ` Most of it went to ${sum.cats[0].category.toLowerCase()}.`;
  else if (prev?.spent && sum.month === monthKey(now)) {
    const prevSamePoint = prev.byDay.slice(0, now.getDate()).reduce((a, b) => a + b, 0);
    if (prevSamePoint) { const d = sum.spent - prevSamePoint; tail = Math.abs(d) < prevSamePoint * 0.1 ? ' About the same as last month so far.' : d < 0 ? ` ${fmtINR(-d)} less than last month by this day.` : ` ${fmtINR(d)} more than last month by this day.`; }
  }
  return `${parts.join(', ')}.${tail}`;
}

export function monthLabel(mk) {
  const [y, m] = mk.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
}
export const fromDateKey = fromKey;
