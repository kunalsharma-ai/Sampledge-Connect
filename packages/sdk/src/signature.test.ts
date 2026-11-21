import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signPayload, verifySignature } from './signature.js';

describe('signatures', () => {
  it('matches a plain Node HMAC (what the Connect server computes)', async () => {
    const now = Date.UTC(2026, 10, 21, 12, 0, 0);
    const header = await signPayload('s3cret', '{"a":1}', now);
    const t = Math.floor(now / 1000);
    const v1 = createHmac('sha256', 's3cret').update(`${t}.{"a":1}`).digest('hex');
    expect(header).toBe(`t=${t},v1=${v1}`);
  });

  it('verifies, and rejects tampering, wrong secrets and stale timestamps', async () => {
    const now = Date.now();
    const h = await signPayload('k', 'body', now);
    expect(await verifySignature('k', 'body', h, now)).toBe('ok');
    expect(await verifySignature('k', 'body!', h, now)).toBe('mismatch');
    expect(await verifySignature('other', 'body', h, now)).toBe('mismatch');
    expect(await verifySignature('k', 'body', h, now + 10 * 60_000)).toBe('stale');
    expect(await verifySignature('k', 'body', undefined, now)).toBe('missing');
  });
});
