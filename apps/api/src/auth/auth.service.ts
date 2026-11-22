import { Injectable, Optional } from '@nestjs/common';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';
import argon2 from 'argon2';
import { MongoServerError } from 'mongodb';
import {
  dndActive,
  type UserStatus,
  ChangePasswordRequestSchema,
  LoginRequestSchema,
  MfaVerifyRequestSchema,
  PASSWORD_CHANGE_REQUIRED,
  ResetMemberPasswordSchema,
  tenantCan,
  RegisterTenantRequestSchema,
  type LoginResponse,
  type Session,
  type UserSummary,
} from '@sampledge/contracts';
import { AppError, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { TenantDb, newId } from '../database/tenant-db.js';
import type { UserDoc, TenantDoc } from '../database/documents.js';
import { AuditService } from '../audit/audit.service.js';
import { RateLimitService } from '../redis/redis.module.js';
import { MfaService } from './mfa.service.js';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service.js';
import { passwordLoginAllowed } from './sso-settings.js';
import { SessionService, SUSPENDED_MESSAGE } from './session.service.js';

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
    avatarUrl: u.avatarKey ? `/v1/avatars/${u.tenantId}/${u.avatarKey}` : null,
    department: u.department ?? null,
    phone: u.phone ?? null,
    bio: u.bio ?? null,
    timeZone: u.timeZone ?? null,
    ...(u.userStatus ? { userStatus: statusOf(u)! } : {}),
    ...(u.dndSchedule ? { dndSchedule: u.dndSchedule } : {}),
  };
}

/** The stored status in contract shape, or null when cleared or expired. */
export function statusOf(u: Pick<UserDoc, 'userStatus'>, at = new Date()): UserStatus | null {
  const s = u.userStatus;
  if (!s || (s.expiresAt && s.expiresAt.getTime() <= at.getTime())) return null;
  return { ...s, expiresAt: s.expiresAt?.toISOString() ?? null };
}

/** Do-not-disturb right now: no push notifications or call rings by push. */
export function isDnd(u: Pick<UserDoc, 'userStatus' | 'dndSchedule'>, at = new Date()): boolean {
  return dndActive(statusOf(u, at), u.dndSchedule ?? null, at);
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
    private readonly settings: IntegrationSettingsService,
    @Optional() private readonly realtime?: RealtimePublisher,
  ) {}

  async registerTenant(input: unknown, meta: RequestMeta): Promise<Session> {
    const req = parse(RegisterTenantRequestSchema, input);
    await this.rateLimit.consume('register_ip', meta.ip ?? 'unknown');
    const p = await this.provisionTenant({
      slug: req.tenantSlug,
      name: req.organizationName,
      ownerEmail: req.ownerEmail,
      ownerName: req.ownerName,
      password: req.password,
    });
    try {
      const issued = await this.sessions.create({
        tenantId: p.tenant._id,
        userId: p.user._id,
        role: 'owner',
        device: req.device,
      });
      await this.audit.record({
        tenantId: p.tenant._id,
        actorId: p.user._id,
        action: 'tenant.created',
        target: { type: 'tenant', id: p.tenant._id },
        ...meta,
      });
      return {
        ...issued,
        user: toUserSummary(p.user, 'owner'),
        tenant: { tenantId: p.tenant._id, slug: p.tenant.slug, name: p.tenant.name },
        workspaceId: p.workspaceId,
      };
    } catch (e) {
      await p.undo();
      throw e;
    }
  }

  /**
   * Creates an organization with its owner, default workspace and #general. Used by sign-up
   * and by super admins (docs/super-admin.md). `undo` removes it again.
   */
  async provisionTenant(input: {
    slug: string;
    name: string;
    ownerEmail: string;
    ownerName: string;
    password: string;
  }): Promise<{
    tenant: TenantDoc;
    user: UserDoc;
    workspaceId: string;
    undo: () => Promise<void>;
  }> {
    const tenantId = newId();
    const now = new Date();
    const tenant: TenantDoc = {
      _id: tenantId,
      slug: input.slug,
      name: input.name,
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
    // No multi-document transaction on standalone deployments: compensate instead.
    const undo = async () => {
      await Promise.allSettled([
        t.users.deleteMany({}),
        t.workspaces.deleteMany({}),
        t.memberships.deleteMany({}),
        t.conversations.deleteMany({}),
        t.conversation_members.deleteMany({}),
        t.devices.deleteMany({}),
        this.db.tenants.deleteOne({ _id: tenantId }),
      ]);
    };
    try {
      const passwordHash = await argon2.hash(input.password, ARGON2_OPTIONS);
      const user = await t.users.insertOne({
        email: input.ownerEmail,
        passwordHash,
        displayName: input.ownerName,
        title: null,
        status: 'active',
        createdAt: now,
      });
      const ws = await t.workspaces.insertOne({
        name: input.name,
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
      return { tenant, user, workspaceId: ws._id, undo };
    } catch (e) {
      await undo();
      throw e;
    }
  }

  async login(input: unknown, meta: RequestMeta): Promise<LoginResponse> {
    const req = parse(LoginRequestSchema, input);
    await this.rateLimit.consume('login_ip', meta.ip ?? 'unknown');
    await this.rateLimit.consume('login_account', `${req.tenantSlug}:${req.email}`);

    const invalid = new AppError('UNAUTHENTICATED', 'Incorrect workspace, email or password');
    const tenant = await this.db.tenants.findOne({ slug: req.tenantSlug });
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
    if (tenant.status !== 'active') throw new AppError('FORBIDDEN', SUSPENDED_MESSAGE);
    const t = this.db.for(tenant._id);
    const membership = await t.memberships.findOne({ userId: user._id });
    if (!membership) throw invalid;
    if (!(await passwordLoginAllowed(this.settings, tenant._id, membership.role)))
      throw new AppError(
        'FORBIDDEN',
        'This workspace uses single sign-on. Use the sign-on button instead of a password.',
      );

    if (user.mustChangePassword) {
      if (!req.newPassword) {
        await this.audit.record({
          tenantId: tenant._id,
          actorId: user._id,
          action: 'auth.password_change_required',
          ...meta,
        });
        throw new AppError(
          'FORBIDDEN',
          'Your password was reset. Choose a new password to continue.',
          { reason: PASSWORD_CHANGE_REQUIRED },
        );
      }
      if (req.newPassword === req.password)
        throw new AppError('VALIDATION_FAILED', 'Choose a password different from the old one.');
      await t.users.updateOne(
        { _id: user._id },
        {
          $set: {
            passwordHash: await argon2.hash(req.newPassword, ARGON2_OPTIONS),
            mustChangePassword: false,
            passwordChangedAt: new Date(),
          },
        },
      );
      await this.audit.record({
        tenantId: tenant._id,
        actorId: user._id,
        action: 'auth.password_changed',
        target: { type: 'user', id: user._id },
        metadata: { how: 'after_reset', device: req.device.name, platform: req.device.platform },
        ...meta,
      });
    }

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

  /** You change your own password; your other devices are signed out. */
  async changePassword(ctx: TenantContext, input: unknown, meta: RequestMeta) {
    const req = parse(ChangePasswordRequestSchema, input);
    await this.rateLimit.consume('login_account', `pw:${ctx.tenantId}:${ctx.userId}`);
    const t = this.db.for(ctx.tenantId);
    const user = await t.users.findOne({ _id: ctx.userId });
    if (!user) throw new AppError('UNAUTHENTICATED', 'Session no longer valid');
    if (!(await argon2.verify(user.passwordHash, req.currentPassword))) {
      await this.audit.record({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'auth.password_change_failed',
        target: { type: 'user', id: ctx.userId },
        ...meta,
      });
      throw new AppError('FORBIDDEN', 'Your current password is not right.');
    }
    if (req.newPassword === req.currentPassword)
      throw new AppError('VALIDATION_FAILED', 'Choose a password different from the old one.');
    await t.users.updateOne(
      { _id: ctx.userId },
      {
        $set: {
          passwordHash: await argon2.hash(req.newPassword, ARGON2_OPTIONS),
          mustChangePassword: false,
          passwordChangedAt: new Date(),
        },
      },
    );
    const signedOut = await this.signOutOthers(
      ctx.tenantId,
      ctx.userId,
      ctx.sessionId,
      'password_changed',
    );
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'auth.password_changed',
      target: { type: 'user', id: ctx.userId },
      metadata: { how: 'self', signedOutDevices: signedOut },
      ...meta,
    });
    return { signedOutDevices: signedOut };
  }

  /**
   * An owner or admin sets a temporary password for a member, who must choose their own at
   * their next sign-in. Every device of theirs is signed out. Only owners reset owners.
   */
  async resetMemberPassword(ctx: TenantContext, userId: string, input: unknown, meta: RequestMeta) {
    if (!tenantCan(ctx, 'members.manage'))
      throw new AppError('FORBIDDEN', 'You can’t reset passwords in this organization.');
    const req = parse(ResetMemberPasswordSchema, input);
    if (userId === ctx.userId)
      throw new AppError('CONFLICT', 'Change your own password in your account settings.');
    const t = this.db.for(ctx.tenantId);
    const [user, membership] = await Promise.all([
      t.users.findOne({ _id: userId }),
      t.memberships.findOne({ userId }),
    ]);
    if (!user || !membership) throw new AppError('NOT_FOUND', 'Member not found');
    if (membership.role === 'owner' && ctx.role !== 'owner')
      throw new AppError('FORBIDDEN', 'Only an owner can reset an owner’s password.');
    await t.users.updateOne(
      { _id: userId },
      {
        $set: {
          passwordHash: await argon2.hash(req.temporaryPassword, ARGON2_OPTIONS),
          mustChangePassword: true,
          passwordChangedAt: new Date(),
        },
      },
    );
    const signedOut = await this.signOutOthers(ctx.tenantId, userId, null, 'password_reset');
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'auth.password_reset_by_admin',
      target: { type: 'user', id: userId },
      metadata: { email: user.email, signedOutDevices: signedOut },
      ...meta,
    });
    return { userId, signedOutDevices: signedOut };
  }

  /**
   * SampConnect (a super admin) makes someone choose a new password: every device is signed out
   * and their next sign-in asks for a new password. Nobody ever sees a password.
   */
  async forcePasswordReset(tenantId: string, userId: string, byName: string, meta: RequestMeta) {
    const t = this.db.for(tenantId);
    const user = await t.users.findOne({ _id: userId });
    if (!user) throw new AppError('NOT_FOUND', 'Person not found');
    await t.users.updateOne({ _id: userId }, { $set: { mustChangePassword: true } });
    const signedOut = await this.signOutOthers(tenantId, userId, null, 'password_reset_forced');
    await this.audit.record({
      tenantId,
      actorId: null,
      action: 'auth.password_reset_forced',
      target: { type: 'user', id: userId },
      metadata: { by: byName, signedOutDevices: signedOut },
      ...meta,
    });
    return { user, signedOutDevices: signedOut };
  }

  private async signOutOthers(
    tenantId: string,
    userId: string,
    keep: string | null,
    reason: string,
  ) {
    const devices = await this.db
      .for(tenantId)
      .devices.find({ userId, revokedAt: null }, { projection: { _id: 1 } })
      .toArray();
    let n = 0;
    for (const d of devices) {
      if (d._id === keep) continue;
      await this.sessions.revoke(tenantId, d._id, reason);
      this.realtime?.disconnectSession(tenantId, userId, d._id);
      n++;
    }
    return n;
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
