import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { TenantRole } from '@sampledge/contracts';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { AppError } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { REDIS } from '../redis/redis.module.js';
import { TenantDb, newId } from '../database/tenant-db.js';
import { TokenService } from './token.service.js';
import { PermissionPolicy } from '../platform/permission-policy.service.js';

const sha256 = (s: string) => createHash('sha256').update(s).digest('base64url');

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Refresh token wire format: `<tenantId>.<sessionId>.<secret>`; only sha256(secret) is stored. */
function parseRefresh(token: string): { tenantId: string; sessionId: string; secret: string } {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((p) => !p))
    throw new AppError('UNAUTHENTICATED', 'Invalid refresh token');
  return { tenantId: parts[0]!, sessionId: parts[1]!, secret: parts[2]! };
}

export const SUSPENDED_MESSAGE =
  'This organization’s access to SampConnect is suspended. Contact SampConnect support.';

interface MemberCache {
  role: TenantRole;
  status: 'active' | 'deactivated';
  workspaceId: string;
}

/**
 * Device sessions: one per (user, device). Refresh tokens rotate on every use;
 * presenting an already-rotated token revokes the session (theft detection).
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly db: TenantDb,
    private readonly tokens: TokenService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly policy: PermissionPolicy,
  ) {}

  private refreshExpiry() {
    return new Date(Date.now() + this.cfg.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  }

  async create(params: {
    tenantId: string;
    userId: string;
    role: TenantRole;
    device: { deviceId: string; name: string; platform: string };
  }) {
    const t = this.db.for(params.tenantId);
    const old = await t.devices
      .find({ userId: params.userId, deviceId: params.device.deviceId })
      .toArray();
    if (old.length) {
      await t.devices.deleteMany({ userId: params.userId, deviceId: params.device.deviceId });
      for (const o of old)
        await this.redis.set(`sess:${params.tenantId}:${o._id}`, '0', 'EX', 3600);
    }
    const sessionId = newId();
    const secret = randomBytes(32).toString('base64url');
    const now = new Date();
    await t.devices.insertOne({
      _id: sessionId,
      userId: params.userId,
      deviceId: params.device.deviceId,
      name: params.device.name,
      platform: params.device.platform,
      refreshTokenHash: sha256(secret),
      previousRefreshTokenHash: null,
      refreshExpiresAt: this.refreshExpiry(),
      createdAt: now,
      lastSeenAt: now,
      revokedAt: null,
      revokedReason: null,
    });
    return this.issue(params.tenantId, sessionId, params.userId, params.role, secret);
  }

  private async issue(
    tenantId: string,
    sessionId: string,
    userId: string,
    role: TenantRole,
    secret: string,
  ) {
    const accessToken = await this.tokens.signAccess({
      sub: userId,
      tid: tenantId,
      sid: sessionId,
      role,
    });
    return {
      accessToken,
      accessTokenExpiresIn: this.tokens.accessTtlSeconds,
      refreshToken: `${tenantId}.${sessionId}.${secret}`,
      sessionId,
    };
  }

  async rotate(refreshToken: string) {
    const { tenantId, sessionId, secret } = parseRefresh(refreshToken);
    const t = this.db.for(tenantId);
    const session = await t.devices.findOne({ _id: sessionId });
    if (!session || session.revokedAt) throw new AppError('UNAUTHENTICATED', 'Session revoked');
    const presented = sha256(secret);
    if (
      session.previousRefreshTokenHash &&
      safeEqual(presented, session.previousRefreshTokenHash)
    ) {
      await this.revoke(tenantId, sessionId, 'refresh_token_reuse');
      throw new AppError('UNAUTHENTICATED', 'Session revoked');
    }
    if (!safeEqual(presented, session.refreshTokenHash))
      throw new AppError('UNAUTHENTICATED', 'Invalid refresh token');
    if (session.refreshExpiresAt < new Date())
      throw new AppError('UNAUTHENTICATED', 'Refresh token expired');

    await this.assertTenantActive(tenantId);
    const member = await this.loadMember(tenantId, session.userId);
    if (member.status !== 'active') throw new AppError('UNAUTHENTICATED', 'Account deactivated');

    const nextSecret = randomBytes(32).toString('base64url');
    // Compare-and-swap on the current hash so two concurrent refreshes cannot both win.
    const res = await t.devices.updateOne(
      { _id: sessionId, refreshTokenHash: session.refreshTokenHash, revokedAt: null },
      {
        $set: {
          refreshTokenHash: sha256(nextSecret),
          previousRefreshTokenHash: session.refreshTokenHash,
          refreshExpiresAt: this.refreshExpiry(),
          lastSeenAt: new Date(),
        },
      },
    );
    if (res.modifiedCount !== 1)
      throw new AppError('UNAUTHENTICATED', 'Refresh token already used');
    return {
      ...(await this.issue(tenantId, sessionId, session.userId, member.role, nextSecret)),
      userId: session.userId,
      tenantId,
    };
  }

  async revoke(tenantId: string, sessionId: string, reason: string) {
    await this.db
      .for(tenantId)
      .devices.updateOne(
        { _id: sessionId },
        { $set: { revokedAt: new Date(), revokedReason: reason, push: null } },
      );
    await this.redis.set(`sess:${tenantId}:${sessionId}`, '0', 'EX', 3600);
  }

  async revokeAllForUser(tenantId: string, userId: string, reason: string) {
    const sessions = await this.db
      .for(tenantId)
      .devices.find({ userId, revokedAt: null })
      .toArray();
    for (const s of sessions) await this.revoke(tenantId, s._id, reason);
  }

  /** Resolve an access token to a full tenant context (used by REST guard and socket handshake). */
  async resolve(accessToken: string): Promise<TenantContext> {
    const claims = await this.tokens.verifyAccess(accessToken);
    const t = this.db.for(claims.tid);
    const key = `sess:${claims.tid}:${claims.sid}`;
    let cached = await this.redis.get(key);
    let deviceId = cached && cached !== '0' ? cached : null;
    if (cached === null) {
      const s = await t.devices.findOne({ _id: claims.sid });
      const active = !!s && !s.revokedAt && s.userId === claims.sub;
      deviceId = active ? s!.deviceId : null;
      cached = active ? s!.deviceId : '0';
      await this.redis.set(key, cached, 'EX', 60);
    }
    if (!deviceId) throw new AppError('UNAUTHENTICATED', 'Session revoked');
    await this.assertTenantActive(claims.tid);
    const member = await this.loadMember(claims.tid, claims.sub);
    if (member.status !== 'active') throw new AppError('UNAUTHENTICATED', 'Account deactivated');
    return {
      tenantId: claims.tid,
      userId: claims.sub,
      sessionId: claims.sid,
      deviceId,
      role: member.role,
      workspaceId: member.workspaceId,
      grants: await this.policy.grants(claims.tid, member.role),
    };
  }

  async loadMember(tenantId: string, userId: string): Promise<MemberCache> {
    const key = `member:${tenantId}:${userId}`;
    const hit = await this.redis.get(key);
    if (hit) return JSON.parse(hit) as MemberCache;
    const t = this.db.for(tenantId);
    const [user, membership] = await Promise.all([
      t.users.findOne({ _id: userId }),
      t.memberships.findOne({ userId }),
    ]);
    if (!user || !membership)
      throw new AppError('UNAUTHENTICATED', 'Not a member of this organization');
    const value: MemberCache = {
      role: membership.role,
      status: user.status,
      workspaceId: membership.workspaceId,
    };
    await this.redis.set(key, JSON.stringify(value), 'EX', 60);
    return value;
  }

  /** A super admin suspended the organization (docs/super-admin.md): nobody in it gets in. */
  async assertTenantActive(tenantId: string) {
    const key = `tenant-status:${tenantId}`;
    let status = await this.redis.get(key);
    if (status === null) {
      const t = await this.db.tenants.findOne({ _id: tenantId }, { projection: { status: 1 } });
      status = t?.status ?? 'missing';
      await this.redis.set(key, status, 'EX', 30);
    }
    if (status !== 'active') throw new AppError('UNAUTHENTICATED', SUSPENDED_MESSAGE);
  }

  invalidateTenant(tenantId: string) {
    return this.redis.del(`tenant-status:${tenantId}`);
  }

  invalidateMember(tenantId: string, userId: string) {
    return this.redis.del(`member:${tenantId}:${userId}`);
  }
}
