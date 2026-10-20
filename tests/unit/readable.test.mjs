import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inline, lines, fancy, plainBody, KIND } from '../../js/core/readable.js';

// Same inputs and outputs as android app/src/test/.../ReadableTest.kt
test('LaTeX becomes plain math', () => {
  assert.equal(inline('\\(N \\le 10\\)'), 'N ≤ 10');
  assert.equal(inline('\\(O(2^N \\cdot N)\\)'), 'O(2ᴺ · N)');
  assert.equal(inline('around \\(10^{8}\\) operations'), 'around 10⁸ operations');
  assert.equal(inline('\\(O(N \\log N)\\) or \\(O(N)\\)'), 'O(N log N) or O(N)');
  assert.equal(inline('\\(N \\le 5,000\\)'), 'N ≤ 5,000');
  assert.equal(inline('\\(\\frac{a}{b}\\) and \\(x_i\\)'), 'a/b and xᵢ');
  assert.equal(inline('$O(n^2)$'), 'O(n²)');
});

test('money dollars are not math', () => {
  assert.equal(inline('paid $20 and $30 today'), 'paid $20 and $30 today');
  assert.equal(fancy('spent 500 on lunch #food'), false);
});

test('markdown and pipe tables', () => {
  const ls = lines('## Limits\n| Input | Time |\n|---|---|\n| \\(N \\le 20\\) | \\(O(2^N)\\) |\n- **Bitmask** DP\n\nDone');
  assert.equal(ls[0].kind, KIND.HEADING); assert.equal(ls[0].text, 'Limits');
  assert.equal(ls[1].text, 'Input  ·  Time');
  assert.equal(ls[2].text, 'N ≤ 20  ·  O(2ᴺ)');
  assert.equal(ls[3].kind, KIND.BULLET); assert.equal(ls[3].text, 'Bitmask DP'); assert.deepEqual(ls[3].bold[0], [0, 7]);
  assert.equal(ls[4].text, ''); assert.equal(ls[5].text, 'Done');
});

test('TAB tables and numbered headings', () => {
  const ls = lines('1. The Input Constraint Trick (The Golden Rule)\n\nInput Size\tExpected\n\\(N \\le 10\\)\t\\(O(N!)\\)');
  assert.equal(ls[0].kind, KIND.HEADING);
  assert.equal(ls[2].text, 'Input Size  ·  Expected');
  assert.equal(ls[3].text, 'N ≤ 10  ·  O(N!)');
});

test('reader body keeps short notes exactly as typed', () => {
  assert.equal(plainBody('call amma #family'), 'call amma #family');
  assert.equal(plainBody('a\n- b'), 'a\n•  b');
});
