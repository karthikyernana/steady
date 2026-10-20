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
  // web extras (pasted AI answers): relations, sets, logic, more Greek, spacing
  ['\\lt', '<'], ['\\gt', '>'], ['\\equiv', '≡'], ['\\sim', '∼'], ['\\propto', '∝'], ['\\mid', '|'], ['\\notin', '∉'],
  ['\\subseteq', '⊆'], ['\\supseteq', '⊇'], ['\\subset', '⊂'], ['\\supset', '⊃'], ['\\cup', '∪'], ['\\cap', '∩'], ['\\emptyset', '∅'],
  ['\\varnothing', '∅'], ['\\setminus', '∖'], ['\\forall', '∀'], ['\\exists', '∃'], ['\\neg', '¬'], ['\\lnot', '¬'], ['\\land', '∧'],
  ['\\lor', '∨'], ['\\wedge', '∧'], ['\\vee', '∨'], ['\\oplus', '⊕'], ['\\iff', '⇔'], ['\\implies', '⇒'], ['\\Leftarrow', '⇐'],
  ['\\Leftrightarrow', '⇔'], ['\\leftrightarrow', '↔'], ['\\mapsto', '↦'], ['\\uparrow', '↑'], ['\\downarrow', '↓'], ['\\prod', 'Π'], ['\\int', '∫'],
  ['\\partial', '∂'], ['\\nabla', '∇'], ['\\circ', '∘'], ['\\ast', '∗'], ['\\star', '⋆'], ['\\bullet', '•'], ['\\vdots', '⋮'], ['\\ll', '≪'], ['\\gg', '≫'],
  ['\\gamma', 'γ'], ['\\delta', 'δ'], ['\\epsilon', 'ε'], ['\\varepsilon', 'ε'], ['\\eta', 'η'], ['\\kappa', 'κ'], ['\\rho', 'ρ'], ['\\tau', 'τ'],
  ['\\phi', 'φ'], ['\\varphi', 'φ'], ['\\chi', 'χ'], ['\\psi', 'ψ'], ['\\omega', 'ω'], ['\\zeta', 'ζ'], ['\\xi', 'ξ'], ['\\nu', 'ν'],
  ['\\Gamma', 'Γ'], ['\\Theta', 'Θ'], ['\\Lambda', 'Λ'], ['\\Sigma', 'Σ'], ['\\Pi', 'Π'], ['\\Phi', 'Φ'], ['\\Omega', 'Ω'],
  ['\\quad', ' '], ['\\qquad', ' '], ['\\ ', ' '], ['\\:', ' '], ['\\#', '#'], ['\\&', '&'], ['\\_', '_'], ['\\$', '$'],
];
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SYMBOL_RX = SYMBOLS.map(([k, v]) => [new RegExp(reEsc(k) + '(?![A-Za-z])', 'g'), v]);

const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', n: 'ⁿ', i: 'ⁱ', k: 'ᵏ', N: 'ᴺ', x: 'ˣ', m: 'ᵐ', '(': '⁽', ')': '⁾' };
const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', n: 'ₙ', m: 'ₘ', x: 'ₓ', '+': '₊', '-': '₋' };
const has = (map, c) => Object.prototype.hasOwnProperty.call(map, c);
const script = (s, map, mark) => ([...s].every(c => has(map, c)) ? [...s].map(c => map[c]).join('') : `${mark}(${s})`);

/** One piece of math, without its delimiters. */
// a fraction part that is more than one token keeps its grouping: \frac{a+b}{2} → (a+b)/2, \frac{a}{b} → a/b
const part = g => (/^√?[\w.′⁰¹²³⁴⁵⁶⁷⁸⁹ⁿ₀₁₂₃₄₅₆₇₈₉ᵢⱼₖₙₘ]+$|^\(.*\)$|^√\(.*\)$/u.test(g.trim()) ? g.trim() : `(${g.trim()})`);
const ACCENT = /\\(?:hat|bar|overline|underline|vec|tilde|widehat|widetilde|dot|ddot|boldsymbol|mathcal|mathbb|mathfrak|mathsf|mathtt|textbf|textit|emph|displaystyle|textstyle)\{([^{}]*)\}/g;

/** One piece of math, without its delimiters. */
export function math(src, { bare = false } = {}) {
  let s = String(src);
  s = s.replace(/\\(?:begin|end)\{[a-z*]+\}(\{[^{}]*\})?/g, ' ').replace(/\\\\(\[[^\]]*\])?/g, '\n').replace(/(^|[^\\])&/g, '$1 ');
  s = s.replace(/\\(?:left|right|big|Big|bigg|Bigg)(?![A-Za-z])\s*(\\[{}|]|[()[\]|.])?/g, (_, d) => (d === '.' || !d ? '' : d));
  s = s.replace(/\\(?:displaystyle|textstyle|limits|nolimits)(?![A-Za-z])/g, '');
  // innermost groups first, so \frac{\sqrt{x}}{2} and \sqrt{\frac{a}{b}} resolve too
  for (let i = 0, prev = ''; i < 6 && prev !== s; i++) {
    prev = s;
    s = s.replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\{([^{}]*)\}/g, '$1');
    s = s.replace(ACCENT, '$1');
    s = s.replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, (_, a, b) => `${part(a)}/${part(b)}`);
    s = s.replace(/\\binom\{([^{}]*)\}\{([^{}]*)\}/g, 'C($1, $2)');
    s = s.replace(/\\pmod\{([^{}]*)\}/g, ' (mod $1)');
    s = s.replace(/\\sqrt\[([^\]]*)\]\{([^{}]*)\}/g, (_, n, g) => `${{ 3: '∛', 4: '∜' }[n.trim()] || `${n}√`}${/^\w+$/.test(g.trim()) ? g.trim() : `(${g})`}`);
    s = s.replace(/\\sqrt\{([^{}]*)\}/g, (_, g) => (/^\w+$/.test(g.trim()) ? `√${g.trim()}` : `√(${g})`));
  }
  s = s.replace(/\\bmod(?![A-Za-z])/g, ' mod ');
  for (const [rx, v] of SYMBOL_RX) s = s.replace(rx, () => v);
  s = s.replace(/\^\{([^{}]*)\}/g, (_, g) => script(g.trim(), SUP, '^'));
  // outside delimiters only digits count (2^5, x_1): snake_case and the like stay as typed
  s = s.replace(bare ? /\^([0-9])/g : /\^([0-9A-Za-z+-])/g, (_, g) => script(g, SUP, '^'));
  s = s.replace(/_\{([^{}]*)\}/g, (_, g) => script(g.trim(), SUB, '_'));
  s = s.replace(bare ? /(?<=[A-Za-z])_([0-9])(?![\w])/g : /_([0-9a-z])/g, (_, g) => script(g, SUB, '_'));
  s = s.split('\\{').join('{').split('\\}').join('}').replace(/\\([A-Za-z]+)/g, '$1');
  return s.replace(/[ \t]{2,}/g, ' ').replace(/ *\n */g, '\n').trim();
}

// LaTeX pasted without delimiters ("N \le 10^{5}", "\frac{a+b}{2}"): only commands Steady knows are rewritten, so a
// Windows path or a stray backslash stays exactly as typed.
const BARE_CMD = new RegExp(`\\\\(?:${[...new Set(SYMBOLS.map(([k]) => k.slice(1)).filter(k => /^[A-Za-z]{2,}$/.test(k)))].join('|')}|frac|dfrac|tfrac|sqrt|binom|text|mathrm|mathbf|mathcal|mathbb|operatorname|left|right)(?![A-Za-z])`);
function bare(line) {
  if (!BARE_CMD.test(line)) return line;
  // rewrite each run that starts at a known command and runs to the end of its math-looking stretch (no sentence words)
  return line.replace(/(?:\b[\w(]{1,40}\s?)?\\[A-Za-z]+(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}|\[[^\]]*\]|[\s\w^_{}()+\-*/=<>,.|!']|\\[A-Za-z]+)*/g,
    m => (BARE_CMD.test(m) ? math(m, { bare: true }).replace(/\n/g, ' ') + (/\s$/.test(m) ? ' ' : '') : m));
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
  return s.includes('\\') ? s.split('\n').map(bare).join('\n') : s;
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
