import { describe, expect, it } from 'vitest';
import type { Poll } from '@sampledge/contracts';
import { nextPollChoice, pollDraftProblem, pollIsClosed } from './polls';

const poll = (over: Partial<Poll> = {}): Poll => ({
  question: 'Lunch?',
  options: [],
  multiple: false,
  anonymous: false,
  totalVoters: 0,
  closesAt: null,
  closedAt: null,
  closedBy: null,
  ...over,
});

describe('polls', () => {
  it('knows when a poll is closed', () => {
    expect(pollIsClosed(poll())).toBe(false);
    expect(pollIsClosed(poll({ closedAt: '2026-11-21T10:00:00.000Z' }))).toBe(true);
    const at = Date.parse('2026-11-21T10:00:00.000Z');
    expect(pollIsClosed(poll({ closesAt: '2026-11-21T10:00:00.000Z' }), at - 1)).toBe(false);
    expect(pollIsClosed(poll({ closesAt: '2026-11-21T10:00:00.000Z' }), at)).toBe(true);
  });

  it('checks drafts like the server does', () => {
    expect(pollDraftProblem(' ', ['a', 'b'])).toMatch(/question/);
    expect(pollDraftProblem('Q', ['a', ' '])).toMatch(/two options/);
    expect(pollDraftProblem('Q', ['Yes', 'yes '])).toMatch(/different/);
    expect(pollDraftProblem('Q', ['Yes', 'No', ''])).toBeNull();
  });

  it('replaces a single choice and toggles multiple choices', () => {
    expect(nextPollChoice({ multiple: false }, [], 'a')).toEqual(['a']);
    expect(nextPollChoice({ multiple: false }, ['a'], 'b')).toEqual(['b']);
    expect(nextPollChoice({ multiple: false }, ['a'], 'a')).toEqual([]);
    expect(nextPollChoice({ multiple: true }, ['a'], 'b')).toEqual(['a', 'b']);
    expect(nextPollChoice({ multiple: true }, ['a', 'b'], 'a')).toEqual(['b']);
  });
});
