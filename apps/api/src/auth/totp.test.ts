import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  hotp,
  newRecoveryCodes,
  newTotpSecret,
  otpauthUrl,
  verifyTotp,
} from './totp.js';

// RFC 6238 Appendix B test secret (ASCII "12345678901234567890"), SHA-1.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP', () => {
  it('round-trips base32', () => {
    const b = Buffer.from('any bytes ÿ\u0000', 'latin1');
    expect(base32Decode(base32Encode(b)).equals(b)).toBe(true);
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
  });

  it('matches the RFC 6238 test vectors (last 6 digits)', () => {
    const s = base32Decode(RFC_SECRET);
    expect(hotp(s, Math.floor(59 / 30))).toBe('287082');
    expect(hotp(s, Math.floor(1111111109 / 30))).toBe('081804');
    expect(hotp(s, Math.floor(1234567890 / 30))).toBe('005924');
    expect(hotp(s, Math.floor(2000000000 / 30))).toBe('279037');
  });

  it('accepts the current and adjacent steps only', () => {
    const t = 1_234_567_890_000;
    const s = base32Decode(RFC_SECRET);
    const step = Math.floor(t / 30_000);
    expect(verifyTotp(RFC_SECRET, hotp(s, step), t)).toBe(step);
    expect(verifyTotp(RFC_SECRET, hotp(s, step - 1), t)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, hotp(s, step + 1), t)).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, hotp(s, step - 3), t)).toBeNull();
    expect(verifyTotp(RFC_SECRET, '12345', t)).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef', t)).toBeNull();
  });

  it('makes secrets, URLs and recovery codes in the expected shapes', () => {
    expect(newTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
    const u = otpauthUrl('ABC', 'Northwind Research', 'aarav@northwind.example');
    expect(u).toMatch(
      /^otpauth:\/\/totp\/Northwind%20Research%3Aaarav%40northwind\.example\?secret=ABC&issuer=Northwind/,
    );
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
  });
});
