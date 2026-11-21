import type { Poll } from '@sampledge/contracts';

/** Closed by someone, or past its closing time. */
export function pollIsClosed(p: Poll, now = Date.now()): boolean {
  return !!p.closedAt || (!!p.closesAt && Date.parse(p.closesAt) <= now);
}

/** Checks a poll draft; returns what to fix, or null. */
export function pollDraftProblem(question: string, options: string[]): string | null {
  if (!question.trim()) return 'Write a question.';
  const filled = options.map((o) => o.trim()).filter(Boolean);
  if (filled.length < 2) return 'Add at least two options.';
  if (new Set(filled.map((o) => o.toLowerCase())).size !== filled.length)
    return 'Each option must be different.';
  return null;
}

/** Your next choice after tapping an option: one-choice polls replace (or withdraw), others toggle. */
export function nextPollChoice(poll: Pick<Poll, 'multiple'>, current: string[], tapped: string) {
  if (poll.multiple)
    return current.includes(tapped) ? current.filter((x) => x !== tapped) : [...current, tapped];
  return current[0] === tapped ? [] : [tapped];
}
