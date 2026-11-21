import { describe, expect, it } from 'vitest';
import type { Approval } from '@sampledge/contracts';
import {
  approvalProgress,
  dueChoices,
  isMyTurn,
  isOverdue,
  parseAmount,
  titleFrom,
  workMeta,
} from './work';

const approval = (over: Partial<Approval> = {}): Approval => ({
  approvalId: 'a1',
  title: 'Q1 panel budget',
  description: '',
  category: 'budget',
  amount: { amountMinor: 125_000, currency: 'USD' },
  requesterId: 'u-req',
  approverIds: ['u1', 'u2'],
  policy: 'all',
  decisions: [],
  status: 'pending',
  conversationId: 'c1',
  sourceMessageId: null,
  record: null,
  origin: 'connect',
  dueAt: null,
  createdAt: '2026-11-21T10:00:00.000Z',
  decidedAt: null,
  ...over,
});

describe('work helpers', () => {
  it('reads work cards and ignores anything else', () => {
    expect(
      workMeta({ work: { kind: 'task', id: 't1', title: 'X', status: 'open', summary: 's' } }),
    ).toMatchObject({ kind: 'task', id: 't1' });
    expect(workMeta({ work: { kind: 'poll', id: 'x' } })).toBeNull();
    expect(workMeta({})).toBeNull();
  });

  it('knows whose turn an approval is', () => {
    const a = approval();
    expect(isMyTurn(a, 'u1')).toBe(true);
    expect(isMyTurn(a, 'u-req')).toBe(false);
    const decided = approval({
      decisions: [{ userId: 'u1', decision: 'approve', comment: '', at: a.createdAt }],
    });
    expect(isMyTurn(decided, 'u1')).toBe(false);
    expect(isMyTurn(decided, 'u2')).toBe(true);
    expect(approvalProgress(decided)).toBe('1 of 2 approved');
    expect(approvalProgress(approval({ policy: 'any' }))).toBe('Any one approver decides');
    expect(isMyTurn(approval({ status: 'approved' }), 'u2')).toBe(false);
  });

  it('parses amounts into minor units', () => {
    expect(parseAmount('1,250.50')).toBe(125_050);
    expect(parseAmount('12')).toBe(1200);
    expect(parseAmount('0')).toBeNull();
    expect(parseAmount('1.234')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });

  it('flags overdue open tasks and offers due dates', () => {
    const now = Date.parse('2026-11-21T12:00:00.000Z');
    expect(isOverdue({ dueAt: '2026-11-20T17:00:00.000Z', status: 'open' }, now)).toBe(true);
    expect(isOverdue({ dueAt: '2026-11-20T17:00:00.000Z', status: 'done' }, now)).toBe(false);
    expect(isOverdue({ dueAt: null, status: 'open' }, now)).toBe(false);
    const saturday = new Date(2026, 10, 21, 10);
    const c = dueChoices(saturday);
    expect(c.map((x) => x.key)).toEqual(['none', 'today', 'tomorrow', 'friday', 'week']);
    expect(c[3]!.at).toEqual(new Date(2026, 10, 27, 17));
  });

  it('titles a task from the first non-empty line of a message', () => {
    expect(titleFrom('\n  Send the Q4 quotas to Lena  \nthanks')).toBe(
      'Send the Q4 quotas to Lena',
    );
    expect(titleFrom(undefined)).toBe('');
    expect(titleFrom('x'.repeat(300))).toHaveLength(200);
  });
});
