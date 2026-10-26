import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingTicketPattern, hasTicketRef, markersIn, TICKET_MARKERS } from './patterns.js';
import { commonValidators } from './validators/common.js';
import { MARKER } from '../test-support/helpers.js';

// The literal regex the validator used before the shared pattern existed.
const LEGACY_SOURCE = MARKER + String.raw`(?!\s*\[#?\w+[-_]\d+\])`;
const ticketValidator = commonValidators.find((v) => v.id.endsWith('-without-ticket'));

function flaggedLines(content) {
  return ticketValidator.check(content, 'fixture.js').map((v) => v.line);
}

test('shared pattern is character-for-character the legacy validator regex', () => {
  const re = missingTicketPattern(MARKER);
  assert.equal(re.source, LEGACY_SOURCE);
  assert.equal(re.flags, 'i');
});

test('validator and hasTicketRef agree on every line', () => {
  const lines = [
    `${MARKER} [PROJ-123] tidy`,
    `${MARKER} fix this`,
    `${MARKER} [#ABC_12]`,
    `x ${MARKER}[P-1] and later ${MARKER}`,
  ];
  for (const line of lines) {
    const flagged = flaggedLines(line).length > 0;
    assert.equal(hasTicketRef(line), !flagged, line);
  }
});

test('validator flags the same lines as the legacy regex on a fixture', () => {
  const legacy = new RegExp(LEGACY_SOURCE, 'i');
  const content = [
    'const a = 1;',
    `// ${MARKER} [PROJ-1] ok`,
    `// ${MARKER} no ticket`,
    `// ${MARKER.toLowerCase()} lower case`,
    `// FIXME [ABC-2]`,
    `// ${MARKER}[X_9]`,
  ].join('\n');
  const expected = content.split('\n').flatMap((l, i) => (legacy.test(l) ? [i + 1] : []));
  assert.deepEqual(flaggedLines(content), expected);
  assert.deepEqual(expected, [3, 4]);
});

test('markersIn finds uppercase whole words only', () => {
  assert.deepEqual(markersIn(`a ${MARKER} b HACK: c XXX`), [MARKER, 'HACK', 'XXX']);
  assert.deepEqual(markersIn(`my${MARKER}s and ${MARKER.toLowerCase()}`), []);
  assert.equal(TICKET_MARKERS.length, 4);
});

test('hasTicketRef checks every marker on the line', () => {
  assert.equal(hasTicketRef('FIXME [ABC-1] then HACK [ABC-2]'), true);
  assert.equal(hasTicketRef('FIXME [ABC-1] then HACK later'), false);
});
