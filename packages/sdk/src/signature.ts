import { SIGNATURE_TOLERANCE_SECONDS, parseSignatureHeader } from '@sampledge/contracts';

const enc = new TextEncoder();

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(data)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}

function equalHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The `Sampledge-Signature` header value for `body`: `t=<unix seconds>,v1=<hex HMAC-SHA256>`
 * over `${t}.${body}`. Uses Web Crypto, so it runs in Node 18+, Deno, Bun and edge runtimes.
 */
export async function signPayload(secret: string, body: string, now = Date.now()): Promise<string> {
  const t = Math.floor(now / 1000);
  return `t=${t},v1=${await hmacHex(secret, `${t}.${body}`)}`;
}

export type SignatureCheck = 'ok' | 'missing' | 'stale' | 'mismatch';

/**
 * Verify a request Connect sent you (a webhook, or an outbound module action). Pass the raw
 * request body exactly as received, before JSON parsing.
 */
export async function verifySignature(
  secret: string,
  rawBody: string,
  header: string | null | undefined,
  now = Date.now(),
): Promise<SignatureCheck> {
  const parsed = parseSignatureHeader(header);
  if (!parsed) return 'missing';
  if (Math.abs(now / 1000 - parsed.timestamp) > SIGNATURE_TOLERANCE_SECONDS) return 'stale';
  const expected = await hmacHex(secret, `${parsed.timestamp}.${rawBody}`);
  return parsed.signatures.some((s) => equalHex(s, expected)) ? 'ok' : 'mismatch';
}
