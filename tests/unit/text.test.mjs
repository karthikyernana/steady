import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tagsIn, linkTags } from '../../js/core/text.js';
import { esc } from '../../js/core/util.js';

// what the browser shows for an HTML string: tags dropped, entities decoded (enough for these assertions)
const shown = html => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

const NASTY = 'Hi, it\'s done — 50% & <b>ok</b>, "quoted" #idea';

test('linkTags: escapes once and never tags inside an entity (the "&#39;" → #39 bug)', () => {
  const html = linkTags(NASTY);
  assert.equal(shown(html), NASTY);
  assert.ok(!html.includes('&amp;#39;') && !html.includes('&amp;amp;'), 'no double escaping');
  assert.ok(!/<b>/.test(html), 'markup in user text is not rendered');
  assert.deepEqual([...html.matchAll(/<span class="tag">#([^<]*)<\/span>/g)].map(m => m[1]), ['idea']);
  assert.ok(html.includes('it&#39;s'), 'apostrophe escaped exactly once');
});

test('linkTags: apostrophes and entities next to tags', () => {
  for (const s of ["I don't know what's happening", "don't #39 lol", "Tom's #plan's", '&#39; literally typed', 'a & b &amp; c']) {
    assert.equal(shown(linkTags(s)), s, s);
  }
  assert.deepEqual(tagsIn("don't #39 lol"), ['39']);
  assert.deepEqual(tagsIn('&#39; literally typed'), []);
});

test('tagsIn: raw text only, word-boundary aware', () => {
  assert.deepEqual(tagsIn(NASTY), ['idea']);
  assert.deepEqual(tagsIn('#Idea #idea, #startup. C# and a#b and site.com/#anchor #x-y_z'), ['idea', 'startup', 'x-y_z']);
  assert.deepEqual(tagsIn('trailing #tag-'), ['tag']);
  assert.deepEqual(tagsIn(''), []);
  assert.deepEqual(tagsIn(null), []);
});

test('Telugu: whole words survive (vowel signs are combining marks) and render unchanged', () => {
  const te = 'ఈరోజు బాగుంది, అమ్మ\'కి ఫోన్ చేశాను #ఆలోచన #పని';
  assert.deepEqual(tagsIn(te), ['ఆలోచన', 'పని']);
  const html = linkTags(te);
  assert.equal(shown(html), te);
  assert.ok(html.includes('<span class="tag">#ఆలోచన</span>'));
});

test('esc: escaping raw text once round-trips for display', () => {
  assert.equal(shown(esc(NASTY)), NASTY);
});
