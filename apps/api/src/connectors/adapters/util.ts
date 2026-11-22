import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign,
  timingSafeEqual,
  verify,
  type KeyObject,
} from 'node:crypto';
import { ProviderError, WebhookRejected, type HttpResponse } from './types.js';

export const randomSecret = (bytes = 24) => randomBytes(bytes).toString('base64url');

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const hmacHex = (key: string | Buffer, data: string | Buffer) =>
  createHmac('sha256', key).update(data).digest('hex');
export const hmacBase64 = (key: string | Buffer, data: string | Buffer) =>
  createHmac('sha256', key).update(data).digest('base64');
export const sha1Hex = (data: string) => createHash('sha1').update(data).digest('hex');

export function parseJson<T = Record<string, unknown>>(raw: Buffer): T {
  try {
    return JSON.parse(raw.toString('utf8')) as T;
  } catch {
    throw new WebhookRejected('Body is not valid JSON');
  }
}

export function requireHeader(headers: Record<string, string>, name: string): string {
  const v = headers[name];
  if (!v) throw new WebhookRejected(`Missing ${name} header`);
  return v;
}

/** Rejects timestamps (seconds) further than `toleranceSec` from now: replay protection. */
export function checkFreshness(tsSeconds: string | number, toleranceSec = 300) {
  const ts = Number(tsSeconds);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > toleranceSec)
    throw new WebhookRejected('Request timestamp is too old or invalid');
}

// --- Ed25519 (Discord, QQ) ---
const ED_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const ED_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export const ed25519PublicFromHex = (hex: string): KeyObject =>
  createPublicKey({
    key: Buffer.concat([ED_SPKI_PREFIX, Buffer.from(hex, 'hex')]),
    format: 'der',
    type: 'spki',
  });
export const ed25519PrivateFromSeed = (seed: Buffer): KeyObject =>
  createPrivateKey({ key: Buffer.concat([ED_PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
export const ed25519PublicHex = (priv: KeyObject): string =>
  createPublicKey(priv)
    .export({ format: 'der', type: 'spki' })
    .subarray(ED_SPKI_PREFIX.length)
    .toString('hex');

export function ed25519Verify(pub: KeyObject, message: Buffer, signatureHex: string): boolean {
  if (!/^[0-9a-f]{128}$/i.test(signatureHex)) return false;
  return verify(null, message, pub, Buffer.from(signatureHex, 'hex'));
}
export const ed25519Sign = (priv: KeyObject, message: Buffer) =>
  sign(null, message, priv).toString('hex');

/** Maps an HTTP response onto the retry policy. Returns the JSON body on success. */
export function expectOk(res: HttpResponse, what: string): Record<string, unknown> {
  const body = (res.json ?? {}) as Record<string, unknown>;
  if (res.status >= 200 && res.status < 300) return body;
  const detail =
    (typeof body.description === 'string' && body.description) ||
    (typeof body.message === 'string' && body.message) ||
    (typeof body.error === 'string' && body.error) ||
    (typeof body.errmsg === 'string' && body.errmsg) ||
    `HTTP ${res.status}`;
  const msg = `${what}: ${detail}`;
  if (res.status === 429) {
    const ra = Number(res.headers['retry-after']);
    throw new ProviderError(msg, 'retry', Number.isFinite(ra) ? ra * 1000 : undefined);
  }
  if (res.status === 401 || res.status === 403) throw new ProviderError(msg, 'auth');
  if (res.status >= 500 || res.status === 408) throw new ProviderError(msg, 'retry');
  throw new ProviderError(msg, 'fatal');
}

export const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
