// Turns text pasted from AI chats into something readable on a phone, without changing what is stored:
// LaTeX math (\( N \le 10^{5} \), $O(n^2)$) becomes plain math (N ≤ 10⁵, O(n²)), markdown markers are reduced to their
// meaning (bullets, headings, bold), and pipe/TAB tables become one readable line per row.
// Pure: the saved thought keeps its original text, so nothing is lost and edits stay exact.
// Mirrors android core/Readable.kt; tests in tests/unit/readable.test.mjs (same cases as ReadableTest.kt).

export const KIND = Object.freeze({ TEXT: 'text', HEADING: 'heading', BULLET: 'bullet', ROW: 'row' });

const SYMBOLS = [
  ['\\leq', '≤'], ['\\geq', '≥'], ['\\le', '≤'], ['\\ge', '≥'], ['\\neq', '≠'], ['\\ne', '≠'], ['\\cdot', '·'], ['\\times', '×'],
  ['\\div', '÷'], ['\\pm', '±'], ['\\approx', '≈'], ['\\infty', '∞'], ['\\to', '→'], ['\\rightarrow', '→'], ['\\leftarrow', '←'],
  ['\\Rightarrow', '⇒'], ['\\log', 'log'], ['\\ln', 'ln'], ['\\sqrt', '√'], ['\\sum', 'Σ'], ['\\alpha', 'α'], ['\\beta', 'β'],
  ['\\theta', 'θ'], ['\\lambda', 'λ'], ['\\mu', 'μ'], ['\\pi', 'π'], ['\\sigma', 'σ'], ['\\Delta', 'Δ'], ['\\ldots', '…'], ['\\dots', '…'],
  ['\\cdots', '⋯'], ['\\in', '∈'], ['\\lfloor', '⌊'], ['\\rfloor', '⌋'], ['\\lceil', '⌈'], ['\\rceil', '⌉'], ['\\%', '%'], ['\\,', ' '], ['\\;', ' '], ['\\!', ''],
];
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SYMBOL_RX = SYMBOLS.map(([k, v]) => [new RegExp(reEsc(k) + '(?![A-Za-z])', 'g'), v]);

const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', n: 'ⁿ', i: 'ⁱ', k: 'ᵏ', N: 'ᴺ', x: 'ˣ', m: 'ᵐ', '(': '⁽', ')': '⁾' };
const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', n: 'ₙ', m: 'ₘ', x: 'ₓ', '+': '₊', '-': '₋' };
const has = (map, c) => Object.prototype.hasOwnProperty.call(map, c);
const script = (s, map, mark) => ([...s].every(c => has(map, c)) ? [...s].map(c => map[c]).join('') : `${mark}(${s})`);

/** One piece of math, without its delimiters. */
export function math(src) {
  let s = String(src);
  s = s.replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\{([^{}]*)\}/g, '$1');
  s = s.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '$1/$2');
  s = s.replace(/\\sqrt\{([^{}]*)\}/g, '√($1)');
  for (const [rx, v] of SYMBOL_RX) s = s.replace(rx, () => v);
  s = s.replace(/\^\{([^{}]*)\}/g, (_, g) => script(g.trim(), SUP, '^'));
  s = s.replace(/\^([0-9A-Za-z+-])/g, (_, g) => script(g, SUP, '^'));
  s = s.replace(/_\{([^{}]*)\}/g, (_, g) => script(g.trim(), SUB, '_'));
  s = s.replace(/_([0-9a-z])/g, (_, g) => script(g, SUB, '_'));
  s = s.split('\\{').join('{').split('\\}').join('}').replace(/\\([A-Za-z]+)/g, '$1');
  return s.replace(/[ \t]{2,}/g, ' ').trim();
}

/** Replace every math span in running text. */
export function inline(src) {
  let s = String(src ?? '');
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_, g) => math(g));
  s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_, g) => math(g));
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, g) => math(g));
  // $…$ only when it clearly is math (has a backslash, ^ or _), so "₹500 and $20" stays untouched
  s = s.replace(/(?<![\w$])\$([^$\n]{1,120}?)\$(?![\w$])/g, (m, g) => (/[\\^_]/.test(g) ? math(g) : m));
  s = s.replace(/`([^`\n]+)`/g, '$1');
  return s;
}

function boldSpans(src) {
  let out = '', i = 0; const spans = [];
  for (const m of src.matchAll(/\*\*(.+?)\*\*|__(.+?)__/g)) {
    out += src.slice(i, m.index);
    const inner = m[1] || m[2] || '';
    const st = out.length; out += inner; spans.push([st, out.length]);
    i = m.index + m[0].length;
  }
  out += src.slice(i);
  // single *emphasis* → plain words
  return { text: out.replace(/(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/g, '$1'), bold: spans };
}

const TABLE_SEP = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/;
const RULE = /^(-{3,}|\*{3,}|_{3,})$/;
const cells = (parts) => parts.map(x => x.trim()).filter(Boolean).join('  ·  ');

/** Text → [{ kind, text, bold: [[start, end), …] }]. */
export function lines(text) {
  const out = []; let blank = false;
  for (const raw0 of inline(text).replace(/\r/g, '').split('\n')) {
    const raw = raw0.trimEnd();
    if (!raw.trim()) { if (!blank && out.length) out.push({ kind: KIND.TEXT, text: '', bold: [] }); blank = true; continue; }
    blank = false;
    const t = raw.trim();
    if (TABLE_SEP.test(t)) continue;  // table separator |---|---|
    if (RULE.test(t)) continue;       // horizontal rule
    let kind, body;
    if (raw.includes('\t')) { kind = KIND.ROW; body = cells(raw.split('\t')); }
    else if (/^\d{1,2}[.)]\s+\S/.test(t) && t.length <= 80 && !t.endsWith('.') && !t.endsWith(':')) { kind = KIND.HEADING; body = t; }
    else if (t.startsWith('|') && (t.match(/\|/g) || []).length >= 2) { kind = KIND.ROW; body = cells(t.replace(/^\|+|\|+$/g, '').split('|')); }
    else if (/^#{1,6}\s+/.test(t)) { kind = KIND.HEADING; body = t.replace(/^#{1,6}\s+/, ''); }
    else if (/^[-*+•]\s+/.test(t)) { kind = KIND.BULLET; body = t.replace(/^[-*+•]\s+/, ''); }
    else { kind = KIND.TEXT; body = t; }
    const b = boldSpans(body);
    out.push({ kind, text: b.text, bold: b.bold });
  }
  while (out.length && out[out.length - 1].text === '') out.pop();
  return out;
}

/** True when the text needs the reader treatment at all (cheap check, keeps short notes on the fast path). */
export const fancy = text => {
  const s = String(text ?? '');
  return s.includes('\\') || s.includes('**') || s.includes('|') || s.includes('\n#') || s.startsWith('#') ||
    s.includes('\n- ') || s.includes('\n* ') || s.includes('$') || s.includes('`') || s.includes('\t') || s.length > 300;
};

/** The plain text a reader sees (what Android lays out): used for the "long note" check. */
export const plainBody = text => (fancy(text) ? lines(text).map(l => (l.kind === KIND.BULLET ? '•  ' : '') + l.text).join('\n') : String(text ?? ''));
