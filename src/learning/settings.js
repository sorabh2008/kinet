export const MAX_FEEDBACK_TURNS = 5;

export const DEFAULT_LEARNING = { retro: false, feedback: { enabled: false, turns: 0 } };

/** Coerce whatever is in kinet.config.json (or absent, for older installs) into a valid learning block. */
export function normalizeLearning(raw) {
  const turns = Number(raw?.feedback?.turns);
  const valid = Number.isInteger(turns) && turns >= 1 && turns <= MAX_FEEDBACK_TURNS;
  return {
    retro: raw?.retro === true,
    feedback: valid && raw?.feedback?.enabled === true
      ? { enabled: true, turns }
      : { enabled: false, turns: 0 },
  };
}

export function parseTurns(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_FEEDBACK_TURNS) {
    throw new Error(`turns must be a whole number from 1 to ${MAX_FEEDBACK_TURNS}`);
  }
  return n;
}

/** CLAUDE.md section telling the assistant how to learn; empty when the user opted out of both. */
export function learningSection(raw) {
  const { retro, feedback } = normalizeLearning(raw);
  if (!retro && !feedback.enabled) return '';

  const lines = ['## Learning Loop', '', 'The user opted in to the following. Honour it; do not extend it.', ''];
  if (retro) {
    lines.push(
      '- **Retro after each action** — after completing an action (a plan, an edit, a commit, a review), ' +
      'add a short retro: what worked, what did not, and what to do differently next time. ' +
      'Save any lasting lesson with `kinet_memory_save`.',
    );
  }
  if (feedback.enabled) {
    const n = feedback.turns;
    lines.push(
      `- **Feedback on the first ${n} turn${n === 1 ? '' : 's'} of each session** — at the end of each of your ` +
      `first ${n} replies in a session, ask the user one line: how did that go, and what should change? ` +
      'Apply the answer to the rest of the session and save lasting preferences with `kinet_memory_save`. ' +
      `After turn ${n}, stop asking.`,
    );
  }
  lines.push('', 'To change this, the user runs `kinet learning`.', '');
  return lines.join('\n');
}
