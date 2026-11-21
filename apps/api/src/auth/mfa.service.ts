import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import QRCode from 'qrcode';
import type { Redis } from 'ioredis';
import type {
  MfaChallenge,
  MfaStatus,
  RecoveryCodes,
  TenantRole,
  TotpSetup,
} from '@sampledge/contracts';
import { AppError, notFound } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import type { UserDoc } from '../database/documents.js';
import { TenantDb } from '../database/tenant-db.js';
import { decryptSecret, encryptSecret } from '../integration-settings/cipher.js';
import { AuditService } from '../audit/audit.service.js';
import { BrandingService } from '../branding/branding.service.js';
import { REDIS, RateLimitService } from '../redis/redis.module.js';
import {
  newRecoveryCodes,
  newTotpSecret,
  normalizeRecoveryCode,
  otpauthUrl,
  verifyTotp,
} from './totp.js';

const CHALLENGE_TTL_S = 300;
const MAX_ATTEMPTS = 5;
const hash = (s: string) => createHash('sha256').update(s).digest('base64url');

export interface PendingLogin {
  tenantId: string;
  userId: string;
  role: TenantRole;
  workspaceId: string;
  device: { deviceId: string; name: string; platform: string };
  attempts: number;
}

/**
 * TOTP two-step verification. Login with a password stops at a challenge; the session is
 * issued only after a valid authenticator or recovery code. Codes are single use.
 */
@Injectable()
export class MfaService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly rateLimit: RateLimitService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  enabled(u: UserDoc): boolean {
    return !!u.mfa?.enabledAt && !!u.mfa.totpSecret;
  }

  // ---------- login ----------

  async challenge(p: Omit<PendingLogin, 'attempts'>): Promise<MfaChallenge> {
    const id = randomBytes(24).toString('base64url');
    await this.redis.set(
      `mfa:ch:${id}`,
      JSON.stringify({ ...p, attempts: 0 }),
      'EX',
      CHALLENGE_TTL_S,
    );
    return {
      mfaRequired: true,
      challengeId: id,
      methods: ['totp', 'recovery'],
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_S * 1000).toISOString(),
    };
  }

  /** Checks the code for a pending login. Returns the login to finish, or throws. */
  async verifyChallenge(challengeId: string, code: string): Promise<PendingLogin> {
    const key = `mfa:ch:${challengeId}`;
    const raw = await this.redis.get(key);
    if (!raw)
      throw new AppError('UNAUTHENTICATED', 'This sign-in expired. Enter your password again.');
    const p = JSON.parse(raw) as PendingLogin;
    await this.rateLimit.consume('mfa', `${p.tenantId}:${p.userId}`);
    const user = await this.db.for(p.tenantId).users.findOne({ _id: p.userId });
    if (!user || user.status !== 'active' || !this.enabled(user)) {
      await this.redis.del(key);
      throw new AppError('UNAUTHENTICATED', 'This sign-in expired. Enter your password again.');
    }
    const method = await this.check(p.tenantId, user, code);
    if (!method) {
      p.attempts += 1;
      if (p.attempts >= MAX_ATTEMPTS) await this.redis.del(key);
      else await this.redis.set(key, JSON.stringify(p), 'KEEPTTL');
      await this.audit.record({
        tenantId: p.tenantId,
        actorId: p.userId,
        action: 'auth.mfa_failed',
        metadata: { attempts: p.attempts },
      });
      throw new AppError(
        'UNAUTHENTICATED',
        p.attempts >= MAX_ATTEMPTS
          ? 'Too many wrong codes. Enter your password again.'
          : 'That code didn’t work. Check your authenticator app and try again.',
      );
    }
    // Single use: a second request with the same challenge finds nothing.
    if ((await this.redis.del(key)) === 0)
      throw new AppError('UNAUTHENTICATED', 'This sign-in expired. Enter your password again.');
    if (method === 'recovery')
      await this.audit.record({
        tenantId: p.tenantId,
        actorId: p.userId,
        action: 'auth.mfa_recovery_code_used',
        metadata: { left: (user.mfa?.recoveryCodeHashes.length ?? 1) - 1 },
      });
    return p;
  }

  /** A TOTP code (not replayed) or an unused recovery code. Consumes what it accepts. */
  private async check(
    tenantId: string,
    user: UserDoc,
    code: string,
  ): Promise<'totp' | 'recovery' | null> {
    const t = this.db.for(tenantId);
    const digits = code.replace(/\s/g, '');
    if (/^\d{6}$/.test(digits)) {
      const step = verifyTotp(decryptSecret(user.mfa!.totpSecret!), digits);
      if (step === null) return null;
      const r = await t.users.updateOne(
        { _id: user._id, 'mfa.lastStep': { $lt: step } },
        { $set: { 'mfa.lastStep': step } },
      );
      return r.modifiedCount === 1 ? 'totp' : null;
    }
    const h = hash(normalizeRecoveryCode(code));
    const r = await t.users.updateOne(
      { _id: user._id, 'mfa.recoveryCodeHashes': h },
      { $pull: { 'mfa.recoveryCodeHashes': h } },
    );
    return r.modifiedCount === 1 ? 'recovery' : null;
  }

  // ---------- settings (signed in) ----------

  async status(ctx: TenantContext): Promise<MfaStatus> {
    const u = await this.user(ctx);
    return {
      enabled: this.enabled(u),
      enabledAt: u.mfa?.enabledAt?.toISOString() ?? null,
      recoveryCodesLeft: this.enabled(u) ? (u.mfa?.recoveryCodeHashes.length ?? 0) : 0,
      pending: !!u.mfa?.pendingSecret,
    };
  }

  async setup(ctx: TenantContext): Promise<TotpSetup> {
    const u = await this.user(ctx);
    if (this.enabled(u))
      throw new AppError('CONFLICT', 'Two-step verification is already on. Turn it off first.');
    const secret = newTotpSecret();
    await this.db.for(ctx.tenantId).users.updateOne(
      { _id: u._id },
      {
        $set: {
          mfa: {
            totpSecret: null,
            pendingSecret: encryptSecret(secret),
            enabledAt: null,
            recoveryCodeHashes: [],
            lastStep: 0,
          },
        },
      },
    );
    const tenant = await this.db.tenants.findOne({ _id: ctx.tenantId });
    const url = otpauthUrl(
      secret,
      `${BrandingService.displayName(tenant)} (${tenant?.name ?? 'Connect'})`,
      u.email,
    );
    // Dark modules on a white quiet zone: scanners need the contrast in every theme.
    const qrSvg = await QRCode.toString(url, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 2,
      color: { dark: '#0b1220', light: '#ffffff' },
    });
    return { secret, otpauthUrl: url, qrSvg };
  }

  async enable(ctx: TenantContext, code: string): Promise<RecoveryCodes> {
    await this.rateLimit.consume('mfa', `${ctx.tenantId}:${ctx.userId}`);
    const u = await this.user(ctx);
    if (!u.mfa?.pendingSecret) throw new AppError('CONFLICT', 'Start setup first');
    const secret = decryptSecret(u.mfa.pendingSecret);
    const step = verifyTotp(secret, code);
    if (step === null)
      throw new AppError(
        'VALIDATION_FAILED',
        'That code didn’t match. Check the time on your phone and try the newest code.',
      );
    const codes = newRecoveryCodes();
    await this.db.for(ctx.tenantId).users.updateOne(
      { _id: u._id },
      {
        $set: {
          mfa: {
            totpSecret: u.mfa.pendingSecret,
            pendingSecret: null,
            enabledAt: new Date(),
            recoveryCodeHashes: codes.map((c) => hash(normalizeRecoveryCode(c))),
            lastStep: step,
          },
        },
      },
    );
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'auth.mfa_enabled',
      target: { type: 'user', id: ctx.userId },
    });
    return { recoveryCodes: codes };
  }

  async disable(ctx: TenantContext, password: string, code: string): Promise<MfaStatus> {
    await this.rateLimit.consume('mfa', `${ctx.tenantId}:${ctx.userId}`);
    const u = await this.user(ctx);
    if (!this.enabled(u)) return this.status(ctx);
    const ok = await argon2.verify(u.passwordHash, password);
    if (!ok || !(await this.check(ctx.tenantId, u, code)))
      throw new AppError('VALIDATION_FAILED', 'Your password or code is not correct');
    await this.db.for(ctx.tenantId).users.updateOne({ _id: u._id }, { $set: { mfa: null } });
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'auth.mfa_disabled',
      target: { type: 'user', id: ctx.userId },
    });
    return this.status(ctx);
  }

  async regenerateRecoveryCodes(ctx: TenantContext, code: string): Promise<RecoveryCodes> {
    await this.rateLimit.consume('mfa', `${ctx.tenantId}:${ctx.userId}`);
    const u = await this.user(ctx);
    if (!this.enabled(u)) throw new AppError('CONFLICT', 'Two-step verification is off');
    if ((await this.check(ctx.tenantId, u, code)) !== 'totp')
      throw new AppError('VALIDATION_FAILED', 'Enter a current code from your authenticator app');
    const codes = newRecoveryCodes();
    await this.db
      .for(ctx.tenantId)
      .users.updateOne(
        { _id: u._id },
        { $set: { 'mfa.recoveryCodeHashes': codes.map((c) => hash(normalizeRecoveryCode(c))) } },
      );
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'auth.mfa_recovery_codes_regenerated',
      target: { type: 'user', id: ctx.userId },
    });
    return { recoveryCodes: codes };
  }

  /** Admin reset for a person who lost their phone and codes. */
  async adminReset(ctx: TenantContext, userId: string) {
    const t = this.db.for(ctx.tenantId);
    const r = await t.users.updateOne({ _id: userId }, { $set: { mfa: null } });
    if (r.matchedCount === 0) throw notFound('User');
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'auth.mfa_reset_by_admin',
      target: { type: 'user', id: userId },
    });
  }

  private async user(ctx: TenantContext) {
    const u = await this.db.for(ctx.tenantId).users.findOne({ _id: ctx.userId });
    if (!u) throw notFound('User');
    return u;
  }
}
