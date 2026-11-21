import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { SIGNATURE_TOLERANCE_SECONDS, parseSignatureHeader } from '@sampledge/contracts';

/** `t=<unix>,v1=<hex>` where v1 = HMAC-SHA256(secret, `${t}.${body}`). */
export function signPayload(secret: string, body: string, now = Date.now()): string {
  const t = Math.floor(now / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

export type SignatureCheck = 'ok' | 'missing' | 'stale' | 'mismatch';

export function verifySignature(
  secret: string,
  body: string,
  header: string | undefined,
  now = Date.now(),
): SignatureCheck {
  const parsed = parseSignatureHeader(header);
  if (!parsed) return 'missing';
  if (Math.abs(now / 1000 - parsed.timestamp) > SIGNATURE_TOLERANCE_SECONDS) return 'stale';
  const expected = createHmac('sha256', secret).update(`${parsed.timestamp}.${body}`).digest();
  for (const sig of parsed.signatures) {
    const got = Buffer.from(sig, 'hex');
    if (got.length === expected.length && timingSafeEqual(got, expected)) return 'ok';
  }
  return 'mismatch';
}

/** Connect API keys look like `sk_samptrek_<43 chars>`; only their SHA-256 is stored. */
export function newApiKey(module: string): { key: string; prefix: string; hash: string } {
  const key = `sk_${module}_${randomBytes(32).toString('base64url')}`;
  return { key, prefix: key.slice(0, module.length + 8), hash: hashKey(key) };
}

export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

export const newSecret = (prefix = 'whsec') => `${prefix}_${randomBytes(32).toString('base64url')}`;
