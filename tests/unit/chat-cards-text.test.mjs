// Card words keep the user's #tags while markdown marks are still stripped (server/chat-cards.js plain()).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCard } from '../../server/chat-cards.js';

const note = text => validateCard({ component: 'Note', text }, { today: '2026-10-20' }).card?.text;

test('a #tag in a Note keeps its #', () => {
  assert.equal(note('Pricing idea for the agency: start with a fixed audit #clients'), 'Pricing idea for the agency: start with a fixed audit #clients');
  assert.equal(note('Ideas tagged #steady and #side-project'), 'Ideas tagged #steady and #side-project');
});
test('markdown headings, quotes, emphasis and links are still stripped', () => {
  assert.equal(note('## Your ideas\n> keep it small\n**bold** and `code` [link](http://x.y)'), 'Your ideas\nkeep it small\nbold and code link');
  assert.equal(note('a lone # mark'), 'a lone mark');
  assert.equal(validateCard({ component: 'Callout', text: '# Heads up #focus', tone: 'good' }, { today: '2026-10-20' }).card?.text, 'Heads up #focus');
  assert.equal(validateCard({ component: 'Note', title: '### Notes <b>x</b>', text: 'ok' }, { today: '2026-10-20' }).card?.title, 'Notes x');
});
