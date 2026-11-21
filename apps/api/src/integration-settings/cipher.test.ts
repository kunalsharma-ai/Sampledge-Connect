import { describe, expect, it } from 'vitest';
import { createCipher } from './cipher.js';

const key = (n: number) => Buffer.alloc(32, n).toString('base64');

describe('secret cipher', () => {
  it('round-trips and never repeats ciphertext', () => {
    const c = createCipher(key(1));
    const a = c.encrypt('s3cret');
    const b = c.encrypt('s3cret');
    expect(a).not.toBe(b);
    expect(a).not.toContain('s3cret');
    expect(a.startsWith(`v1:${c.keyId}:`)).toBe(true);
    expect(c.decrypt(a)).toBe('s3cret');
  });

  it('detects a different master key and tampering', () => {
    const sealed = createCipher(key(1)).encrypt('s3cret');
    expect(() => createCipher(key(2)).decrypt(sealed)).toThrow(/different/);
    const parts = sealed.split(':');
    parts[4] = Buffer.from('tampered').toString('base64');
    expect(() => createCipher(key(1)).decrypt(parts.join(':'))).toThrow();
  });

  it('rejects keys that are not 32 bytes', () => {
    expect(() => createCipher(Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/);
  });
});
