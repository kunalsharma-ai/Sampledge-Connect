import { describe, expect, it } from 'vitest';
import { deriveConfirmedStatus } from './receipts.js';

const members = ['a', 'b', 'c'];
describe('deriveConfirmedStatus', () => {
  it('is sent until every recipient delivered', () => {
    expect(
      deriveConfirmedStatus({
        serverSequence: 5, senderId: 'a', memberIds: members,
        receipts: [{ userId: 'b', deliveredUpTo: 5, readUpTo: 0 }],
      }),
    ).toBe('sent');
  });
  it('is delivered when all recipients delivered, read when all read', () => {
    const r = [
      { userId: 'b', deliveredUpTo: 9, readUpTo: 9 },
      { userId: 'c', deliveredUpTo: 5, readUpTo: 0 },
    ];
    expect(deriveConfirmedStatus({ serverSequence: 5, senderId: 'a', memberIds: members, receipts: r })).toBe('delivered');
    r[1]!.readUpTo = 6;
    expect(deriveConfirmedStatus({ serverSequence: 5, senderId: 'a', memberIds: members, receipts: r })).toBe('read');
  });
  it('treats read as implying delivered', () => {
    expect(
      deriveConfirmedStatus({
        serverSequence: 2, senderId: 'a', memberIds: ['a', 'b'],
        receipts: [{ userId: 'b', deliveredUpTo: 0, readUpTo: 3 }],
      }),
    ).toBe('read');
  });
  it('does not track large conversations', () => {
    const many = Array.from({ length: 40 }, (_, i) => `u${i}`);
    expect(deriveConfirmedStatus({ serverSequence: 1, senderId: 'u0', memberIds: many, receipts: [] })).toBe('sent');
  });
});
