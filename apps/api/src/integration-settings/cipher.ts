import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM for secrets at rest. The key comes from SETTINGS_ENCRYPTION_KEY
 * (32 bytes, base64). Ciphertext format: `v1:<keyId>:<iv b64>:<tag b64>:<data b64>`.
 * keyId is a short fingerprint of the key, so a rotated key is detected instead of
 * producing garbage.
 */
export interface SecretCipher {
  encrypt(plain: string): string;
  decrypt(sealed: string): string;
  readonly keyId: string;
}

const DEV_KEY = createHash('sha256').update('sampledge-connect-dev-only-settings-key').digest();

export function createCipher(base64Key: string | undefined): SecretCipher {
  const key = base64Key ? Buffer.from(base64Key, 'base64') : DEV_KEY;
  if (key.length !== 32)
    throw new Error('SETTINGS_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
  const keyId = createHash('sha256').update(key).digest('hex').slice(0, 8);
  return {
    keyId,
    encrypt(plain) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
      return [
        'v1',
        keyId,
        iv.toString('base64'),
        c.getAuthTag().toString('base64'),
        data.toString('base64'),
      ].join(':');
    },
    decrypt(sealed) {
      const [v, kid, iv, tag, data] = sealed.split(':');
      if (v !== 'v1' || !iv || !tag || data === undefined)
        throw new Error('Unrecognised secret format');
      if (kid !== keyId)
        throw new Error('Secret was encrypted with a different SETTINGS_ENCRYPTION_KEY');
      const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
      d.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
    },
  };
}

let shared: SecretCipher | null = null;
/** Process-wide cipher, set once at startup from config. Other modules use these helpers. */
export function initSharedCipher(c: SecretCipher) {
  shared = c;
}
export function encryptSecret(plain: string): string {
  if (!shared) throw new Error('Cipher not initialised');
  return shared.encrypt(plain);
}
export function decryptSecret(sealed: string): string {
  if (!shared) throw new Error('Cipher not initialised');
  return shared.decrypt(sealed);
}
