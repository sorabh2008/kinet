import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from './log.js';

function fakeStream() {
  const lines = [];
  return { lines, write: (text) => { lines.push(text); } };
}

test('lines have an ISO timestamp, a level and the message', () => {
  const stream = fakeStream();
  const log = createLogger({ stream });
  log.info('start mode=stdio');
  log.tool('kinet_git_status', 41.6, true);
  assert.match(stream.lines[0], /^\d{4}-\d{2}-\d{2}T[\d:.]+Z INFO start mode=stdio\n$/);
  assert.match(stream.lines[1], / INFO tool name=kinet_git_status ms=42 result=ok\n$/);
});

test('after the cap, info and tool lines are dropped but warn and error get through', () => {
  const stream = fakeStream();
  const log = createLogger({ stream, capBytes: 200 });
  for (let i = 0; i < 20; i++) log.info(`filler line ${i}`);
  log.tool('kinet_git_diff', 5, false);
  log.error('boom');
  log.warn('shutdown reason=http');

  const capLines = stream.lines.filter((l) => l.includes('log cap reached'));
  assert.equal(capLines.length, 1);
  const afterCap = stream.lines.slice(stream.lines.indexOf(capLines[0]) + 1);
  assert.equal(afterCap.length, 2);
  assert.match(afterCap[0], / ERROR boom\n$/);
  assert.match(afterCap[1], / WARN shutdown reason=http\n$/);
  assert.equal(stream.lines.some((l) => l.includes('tool name=')), false);
});
