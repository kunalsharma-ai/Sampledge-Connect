import { describe, expect, it } from 'vitest';
import { ClientIdSchema, uuidv7 } from './ids.js';
import { backoffDelay } from './backoff.js';
import { SendMessageRequestSchema } from './messages.js';

describe('uuidv7', () => {
  it('produces valid, time-ordered UUIDs', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(ClientIdSchema.safeParse(a).success).toBe(true);
    expect(a[14]).toBe('7');
    expect(a < b).toBe(true);
  });
});

describe('backoffDelay', () => {
  it('stays within [floor, min(cap, base*2^n)]', () => {
    for (let n = 0; n < 20; n++) {
      for (const r of [0, 0.5, 0.9999]) {
        const d = backoffDelay(n, { baseMs: 500, capMs: 30_000, floorMs: 250, random: () => r });
        expect(d).toBeGreaterThanOrEqual(250);
        expect(d).toBeLessThanOrEqual(Math.min(30_000, 500 * 2 ** n));
      }
    }
  });
});

describe('SendMessageRequestSchema', () => {
  it('rejects empty text and non-UUID ids', () => {
    expect(SendMessageRequestSchema.safeParse({ conversationId: 'c', clientMessageId: 'x', content: { text: 'hi' } }).success).toBe(false);
    expect(SendMessageRequestSchema.safeParse({ conversationId: 'c', clientMessageId: uuidv7(), content: { text: '   ' } }).success).toBe(false);
    expect(SendMessageRequestSchema.safeParse({ conversationId: 'c', clientMessageId: uuidv7(), content: { text: 'hi' } }).success).toBe(true);
  });
});
