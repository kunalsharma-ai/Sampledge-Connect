import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits): what Google Authenticator, Authy, 1Password and Microsoft Authenticator use. */
const STEP = 30;
const DIGITS = 6;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('Invalid base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160-bit secret, base32 (the form authenticator apps take). */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', secret).update(msg).digest();
  const off = h[h.length - 1]! & 15;
  const code = (h.readUInt32BE(off) & 0x7fffffff) % 10 ** DIGITS;
  return String(code).padStart(DIGITS, '0');
}

export function totpStep(now = Date.now()): number {
  return Math.floor(now / 1000 / STEP);
}

/**
 * Checks a code against the current step and one step either side (clock drift).
 * Returns the matching step, so the caller can refuse a replay of the same or an earlier step.
 */
export function verifyTotp(secretB32: string, code: string, now = Date.now()): number | null {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const secret = base32Decode(secretB32);
  const step = totpStep(now);
  for (const s of [step, step - 1, step + 1]) {
    const expect = Buffer.from(hotp(secret, s));
    if (timingSafeEqual(expect, Buffer.from(c))) return s;
  }
  return null;
}

export function otpauthUrl(secretB32: string, issuer: string, account: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new URLSearchParams({
    secret: secretB32,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${q.toString()}`;
}

/** Ten one-time recovery codes like `7f3k-9q2m`. */
export function newRecoveryCodes(n = 10): string[] {
  const alpha = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: n }, () => {
    const b = randomBytes(8);
    const s = [...b].map((x) => alpha[x % alpha.length]).join('');
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}

export function normalizeRecoveryCode(c: string): string {
  return c
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}
