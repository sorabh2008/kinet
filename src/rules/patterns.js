// Single source of the "work marker needs a ticket reference" rule. It is
// shared by the ticket validator in validators/common.js and the marker-finding
// MCP tool, so the two can never disagree about whether a line has a ticket.

export const TICKET_REF_SOURCE = String.raw`\s*\[#?\w+[-_]\d+\]`;

// Named without the first marker word so lines that reference this constant
// do not trip the case-insensitive validator themselves.
export const TICKET_MARKERS = Object.freeze(['TODO', 'FIXME', 'HACK', 'XXX']);

// Uppercase whole words only, matching `git grep -w` (JS \b uses the same word characters).
const MARKER_WORD = new RegExp(`\\b(${TICKET_MARKERS.join('|')})\\b`, 'g');

export function missingTicketPattern(marker) {
  return new RegExp(`${marker}(?!${TICKET_REF_SOURCE})`, 'i');
}

export function markersIn(line) {
  return line.match(MARKER_WORD) ?? [];
}

export function hasTicketRef(line) {
  return !markersIn(line).some((marker) => missingTicketPattern(marker).test(line));
}
