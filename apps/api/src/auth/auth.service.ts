import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { MongoServerError } from 'mongodb';
import {
  LoginRequestSchema,
  MfaVerifyRequestSchema,
  RegisterTenantRequestSchema,
  type LoginResponse,
  type Session,
  type UserSummary,
} from '@sampledge/contracts';
import { AppError, parse } from '../common/errors.js';
import { TenantDb, newId } from '../database/tenant-db.js';
import type { UserDoc, TenantDoc } from '../database/documents.js';
import { AuditService } from '../audit/audit.service.js';
import { RateLimitService } from '../redis/redis.module.js';
import { MfaService } from './mfa.service.js';
import { SessionService } from './session.service.js';

/** OWASP-recommended argon2id parameters (m=19 MiB, t=2, p=1). */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export function toUserSummary(u: UserDoc, role: UserSummary['role']): UserSummary {
  return {
    userId: u._id,
    displayName: u.displayName,
    email: u.email,
    role,
    title: u.title,
    status: u.status,
  };
}

@Injectable()
export class AuthService {
  /** Used to equalize timing when the account does not exist. */
  private dummyHash: Promise<string> = argon2.hash(
    'timing-equalizer-not-a-password',
    ARGON2_OPTIONS,
  );

  constructor(
    private readonly db: TenantDb,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly rateLimit: RateLimitService,
    private readonly mfa: MfaService,
  ) {}

  async registerTenant(input: unknown, meta: RequestMeta): Promise<Session> {
    const req = parse(RegisterTenantRequestSchema, input);
    await this.rateLimit.consume('register_ip', meta.ip ?? 'unknown');
    const tenantId = newId();
    const now = new Date();
    const tenant: TenantDoc = {
      _id: tenantId,
      slug: req.tenantSlug,
      name: req.organizationName,
      status: 'active',
      plan: 'trial',
      branding: null,
      dataPlacement: 'shared',
      createdAt: now,
    };
    try {
      await this.db.tenants.insertOne(tenant);
    } catch (e) {
      if (e instanceof MongoServerError && e.code === 11000) {
        throw new AppError('CONFLICT', 'That workspace URL is already taken');
      }
      throw e;
    }

    const t = this.db.for(tenantId);
    try {
      const passwordHash = await argon2.hash(req.password, ARGON2_OPTIONS);
      const user = await t.users.insertOne({
        email: req.ownerEmail,
        passwordHash,
        displayName: req.ownerName,
        title: null,
        status: 'active',
        createdAt: now,
      });
      const ws = await t.workspaces.insertOne({
        name: req.organizationName,
        slug: 'main',
        isDefault: true,
        createdAt: now,
      });
      await t.memberships.insertOne({
        userId: user._id,
        workspaceId: ws._id,
        role: 'owner',
        createdAt: now,
      });
      const general = await t.conversations.insertOne({
        workspaceId: ws._id,
        kind: 'channel_public',
        name: 'general',
        topic: 'Company-wide announcements and conversation',
        createdBy: user._id,
        createdAt: now,
        archivedAt: null,
        lastChangeSequence: 0,
        lastMessageAt: null,
      });
      await t.conversation_members.insertOne({
        conversationId: general._id,
        userId: user._id,
        role: 'owner',
        joinedAt: now,
      });

      const issued = await this.sessions.create({
        tenantId,
        userId: user._id,
        role: 'owner',
        device: req.device,
      });
      await this.audit.record({
        tenantId,
        actorId: user._id,
        action: 'tenant.created',
        target: { type: 'tenant', id: tenantId },
        ...meta,
      });
      return {
        ...issued,
        user: toUserSummary(user, 'owner'),
        tenant: { tenantId, slug: tenant.slug, name: tenant.name },
        workspaceId: ws._id,
      };
    } catch (e) {
      // No multi-document transaction on standalone deployments: compensate instead.
      await Promise.allSettled([
        t.users.deleteMany({}),
        t.workspaces.deleteMany({}),
        t.memberships.deleteMany({}),
        t.conversations.deleteMany({}),
        t.conversation_members.deleteMany({}),
        t.devices.deleteMany({}),
        this.db.tenants.deleteOne({ _id: tenantId }),
      ]);
      throw e;
    }
  }

  async login(input: unknown, meta: RequestMeta): Promise<LoginResponse> {
    const req = parse(LoginRequestSchema, input);
    await this.rateLimit.consume('login_ip', meta.ip ?? 'unknown');
    await this.rateLimit.consume('login_account', `${req.tenantSlug}:${req.email}`);

    const invalid = new AppError('UNAUTHENTICATED', 'Incorrect workspace, email or password');
    const tenant = await this.db.tenants.findOne({ slug: req.tenantSlug, status: 'active' });
    const user = tenant ? await this.db.for(tenant._id).users.findOne({ email: req.email }) : null;
    const ok = await argon2.verify(user?.passwordHash ?? (await this.dummyHash), req.password);
    if (!tenant || !user || !ok) {
      if (tenant) {
        await this.audit.record({
          tenantId: tenant._id,
          actorId: user?._id ?? null,
          action: 'auth.login_failed',
          metadata: { email: req.email },
          ...meta,
        });
      }
      throw invalid;
    }
    if (user.status !== 'active') throw invalid;
    const t = this.db.for(tenant._id);
    const membership = await t.memberships.findOne({ userId: user._id });
    if (!membership) throw invalid;

    if (this.mfa.enabled(user)) {
      await this.audit.record({
        tenantId: tenant._id,
        actorId: user._id,
        action: 'auth.mfa_challenge',
        ...meta,
      });
      return this.mfa.challenge({
        tenantId: tenant._id,
        userId: user._id,
        role: membership.role,
        workspaceId: membership.workspaceId,
        device: req.device,
      });
    }
    return this.finishLogin(tenant._id, user._id, req.device, meta, 'password');
  }

  /** Second step of a login with two-step verification. */
  async verifyMfa(input: unknown, meta: RequestMeta): Promise<Session> {
    const req = parse(MfaVerifyRequestSchema, input);
    await this.rateLimit.consume('login_ip', meta.ip ?? 'unknown');
    const p = await this.mfa.verifyChallenge(req.challengeId, req.code);
    return this.finishLogin(p.tenantId, p.userId, p.device, meta, 'password+totp');
  }

  /** Issues the device session once every required factor has been checked. */
  async finishLogin(
    tenantId: string,
    userId: string,
    device: { deviceId: string; name: string; platform: string },
    meta: RequestMeta,
    method: string,
  ): Promise<Session> {
    const t = this.db.for(tenantId);
    const [tenant, user, membership] = await Promise.all([
      this.db.tenants.findOne({ _id: tenantId, status: 'active' }),
      t.users.findOne({ _id: userId }),
      t.memberships.findOne({ userId }),
    ]);
    if (!tenant || !user || user.status !== 'active' || !membership)
      throw new AppError('UNAUTHENTICATED', 'Incorrect workspace, email or password');
    const issued = await this.sessions.create({
      tenantId,
      userId,
      role: membership.role,
      device,
    });
    await this.audit.record({
      tenantId,
      actorId: userId,
      action: 'auth.login',
      target: { type: 'device', id: issued.sessionId },
      metadata: { method },
      ...meta,
    });
    return {
      ...issued,
      user: toUserSummary(user, membership.role),
      tenant: { tenantId, slug: tenant.slug, name: tenant.name },
      workspaceId: membership.workspaceId,
    };
  }

  async refresh(refreshToken: string): Promise<Session> {
    const r = await this.sessions.rotate(refreshToken);
    const t = this.db.for(r.tenantId);
    const [user, membership, tenant] = await Promise.all([
      t.users.findOne({ _id: r.userId }),
      t.memberships.findOne({ userId: r.userId }),
      this.db.tenants.findOne({ _id: r.tenantId }),
    ]);
    if (!user || !membership || !tenant)
      throw new AppError('UNAUTHENTICATED', 'Session no longer valid');
    return {
      accessToken: r.accessToken,
      accessTokenExpiresIn: r.accessTokenExpiresIn,
      refreshToken: r.refreshToken,
      user: toUserSummary(user, membership.role),
      tenant: { tenantId: tenant._id, slug: tenant.slug, name: tenant.name },
      workspaceId: membership.workspaceId,
    };
  }
}
