// Plain-text helpers shared by every view that shows user-written text with #tags.
// Rule: stored text is always raw (exactly what was typed or said). Escaping happens once, at render, per segment.
import { esc } from './util.js';

// A tag starts at the beginning or after a non-word character (so "C#", "a#b", "&#39;" or "site.com/#x" are not tags)
// and runs over letters, combining marks (Telugu vowel signs are \p{M}), digits, "_" and "-".
const TAG = /(?<![\p{L}\p{M}\p{N}_&#/])#([\p{L}\p{M}\p{N}_-]*[\p{L}\p{M}\p{N}_])/gu;

/** Unique, lower-cased tags in raw text (without the "#"). */
export const tagsIn = text => [...new Set([...String(text ?? '').matchAll(TAG)].map(m => m[1].toLowerCase()))];

/** Raw text → HTML with each tag wrapped in a span. Splits the raw text first, then escapes every piece once. */
export function linkTags(text, cls = 'tag') {
  const s = String(text ?? ''); let out = '', i = 0;
  for (const m of s.matchAll(TAG)) {
    out += esc(s.slice(i, m.index)) + `<span class="${cls}">#${esc(m[1])}</span>`;
    i = m.index + m[0].length;
  }
  return out + esc(s.slice(i));
}

/** Keep numeric ranges like "9–11 PM" on one line (word joiners around the dash). Works on raw or escaped text. */
export const keepRanges = s => String(s ?? '').replace(/(\d)\s?–\s?(\d)/g, '$1\u2060–\u2060$2');
