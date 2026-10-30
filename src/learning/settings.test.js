import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLearning, parseTurns, learningSection } from './settings.js';

test('normalizeLearning defaults to everything off for older configs', () => {
  assert.deepEqual(normalizeLearning(undefined), { retro: false, feedback: { enabled: false, turns: 0 } });
});

test('normalizeLearning drops feedback with an out-of-range turn count', () => {
  assert.equal(normalizeLearning({ feedback: { enabled: true, turns: 9 } }).feedback.enabled, false);
  assert.equal(normalizeLearning({ feedback: { enabled: true, turns: 5 } }).feedback.turns, 5);
});

test('parseTurns accepts 1-5 only', () => {
  assert.equal(parseTurns('1'), 1);
  assert.equal(parseTurns('5'), 5);
  for (const bad of ['0', '6', '2.5', 'x']) assert.throws(() => parseTurns(bad));
});

test('learningSection is empty when opted out, and reflects each choice when opted in', () => {
  assert.equal(learningSection(undefined), '');
  assert.match(learningSection({ retro: true }), /Retro after each action/);
  assert.doesNotMatch(learningSection({ retro: true }), /Feedback/);
  assert.match(learningSection({ feedback: { enabled: true, turns: 1 } }), /first 1 turn of each session/);
  assert.match(learningSection({ feedback: { enabled: true, turns: 4 } }), /first 4 turns of each session/);
});
