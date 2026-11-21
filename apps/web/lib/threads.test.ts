import { describe, expect, it } from 'vitest';
import { threadCounts, threadReplies } from './threads';

const m = (id: string, parent: string | null = null, deletedAt: string | null = null) => ({
  messageId: id,
  replyToMessageId: parent,
  deletedAt,
});

describe('threads', () => {
  const msgs = [m('a'), m('b', 'a'), m('c', 'b'), m('d', 'a'), m('e'), m('f', 'a', '2026-01-01')];

  it('collects nested replies under a root, oldest first', () => {
    expect(threadReplies(msgs, 'a').map((x) => x.messageId)).toEqual(['b', 'c', 'd', 'f']);
    expect(threadReplies(msgs, 'b').map((x) => x.messageId)).toEqual(['c']);
    expect(threadReplies(msgs, 'e')).toEqual([]);
  });

  it('counts live replies for every ancestor', () => {
    const c = threadCounts(msgs);
    expect(c.get('a')).toBe(3);
    expect(c.get('b')).toBe(1);
    expect(c.has('e')).toBe(false);
  });

  it('survives reply cycles', () => {
    expect(threadCounts([m('x', 'y'), m('y', 'x')]).get('x')).toBe(1);
    expect(threadReplies([m('x', 'y'), m('y', 'x')], 'z')).toEqual([]);
  });
});
