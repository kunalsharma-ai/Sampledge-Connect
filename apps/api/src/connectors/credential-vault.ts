import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';

/**
 * Seals connector credentials (and cached provider tokens) for storage in MongoDB.
 * AES-256-GCM, random 96-bit IV, the tenant id bound as associated data so a sealed value
 * copied into another tenant's document will not open. Format: "v1.<iv>.<tag>.<ciphertext>".
 *
 * Uses SETTINGS_ENCRYPTION_KEY, the same master key as the shared integration-settings store.
 */
@Injectable()
export class CredentialVault {
  private readonly key: Buffer;
  constructor(@Inject(APP_CONFIG) cfg: AppConfig) {
    if (cfg.SETTINGS_ENCRYPTION_KEY) {
      this.key = Buffer.from(cfg.SETTINGS_ENCRYPTION_KEY, 'base64');
    } else {
      if (cfg.NODE_ENV !== 'test')
        new Logger('CredentialVault').warn(
          'SETTINGS_ENCRYPTION_KEY is not set: using an insecure development key for connector credentials',
        );
      this.key = createHash('sha256').update('sampledge-connect-insecure-dev-key').digest();
    }
  }

  seal(tenantId: string, value: unknown): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    c.setAAD(Buffer.from(tenantId));
    const ct = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
    return [
      'v1',
      iv.toString('base64url'),
      c.getAuthTag().toString('base64url'),
      ct.toString('base64url'),
    ].join('.');
  }

  open<T>(tenantId: string, sealed: string): T {
    const [v, iv, tag, ct] = sealed.split('.');
    if (v !== 'v1' || !iv || !tag || ct === undefined) throw new Error('Unknown credential format');
    const d = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    d.setAAD(Buffer.from(tenantId));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    const pt = Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]);
    return JSON.parse(pt.toString('utf8')) as T;
  }
}

/** "••••3f9a" for secrets; plain value (trimmed) for non-secret fields. */
export function hint(value: string, secret: boolean): string {
  if (!value) return '';
  if (!secret) return value.length > 60 ? `${value.slice(0, 57)}…` : value;
  return `••••${value.length > 8 ? value.slice(-4) : ''}`;
}
