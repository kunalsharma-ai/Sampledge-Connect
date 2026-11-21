import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import argon2 from 'argon2';
import { MongoServerError } from 'mongodb';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { InviteMemberRequestSchema, TenantRoleSchema, tenantCan } from '@sampledge/contracts';
import { AppError, forbidden, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { AuthGuard, Ctx } from '../auth/auth.guard.js';
import { ARGON2_OPTIONS, toUserSummary } from '../auth/auth.service.js';
import { MfaService } from '../auth/mfa.service.js';
import { SessionService } from '../auth/session.service.js';
import { AuditService } from '../audit/audit.service.js';
import { TenantDb } from '../database/tenant-db.js';
import { REDIS } from '../redis/redis.module.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';
import { presenceOf } from '../realtime/realtime.gateway.js';

const UpdateMemberSchema = z.object({
  role: TenantRoleSchema.exclude(['owner']).optional(),
  status: z.enum(['active', 'deactivated']).optional(),
});

@Controller('v1')
@UseGuards(AuthGuard)
export class DirectoryController {
  constructor(
    private readonly db: TenantDb,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimePublisher,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly mfa: MfaService,
  ) {}

  @Get('me')
  async me(@Ctx() ctx: TenantContext) {
    const t = this.db.for(ctx.tenantId);
    const [user, tenant] = await Promise.all([
      t.users.findOne({ _id: ctx.userId }),
      this.db.tenants.findOne({ _id: ctx.tenantId }),
    ]);
    if (!user || !tenant) throw notFound('User');
    return {
      user: toUserSummary(user, ctx.role),
      tenant: {
        tenantId: tenant._id,
        slug: tenant.slug,
        name: tenant.name,
        plan: tenant.plan,
        branding: tenant.branding,
      },
      workspaceId: ctx.workspaceId,
      deviceId: ctx.deviceId,
    };
  }

  /** Employee directory with live presence. */
  @Get('users')
  async list(@Ctx() ctx: TenantContext) {
    if (!tenantCan(ctx.role, 'directory.read')) throw forbidden();
    const t = this.db.for(ctx.tenantId);
    const [users, memberships] = await Promise.all([
      t.users.find({}, { sort: { displayName: 1 }, limit: 5000 }).toArray(),
      t.memberships.find({}).toArray(),
    ]);
    const roles = new Map(memberships.map((m) => [m.userId, m.role]));
    const presence = await presenceOf(
      this.redis,
      ctx.tenantId,
      users.map((u) => u._id),
    );
    return users.map((u) => ({
      ...toUserSummary(u, roles.get(u._id) ?? 'member'),
      presence: presence[u._id] ?? 'offline',
    }));
  }

  @Post('users')
  async invite(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    if (!tenantCan(ctx.role, 'members.invite')) throw forbidden();
    const req = parse(InviteMemberRequestSchema, body);
    const t = this.db.for(ctx.tenantId);
    const now = new Date();
    let user;
    try {
      user = await t.users.insertOne({
        email: req.email,
        passwordHash: await argon2.hash(req.temporaryPassword, ARGON2_OPTIONS),
        displayName: req.displayName,
        title: null,
        status: 'active',
        createdAt: now,
      });
    } catch (e) {
      if (e instanceof MongoServerError && e.code === 11000)
        throw new AppError('CONFLICT', 'A member with that email already exists');
      throw e;
    }
    await t.memberships.insertOne({
      userId: user._id,
      workspaceId: ctx.workspaceId,
      role: req.role,
      createdAt: now,
    });
    // New members join #general (the default public channel) automatically.
    const general = await t.conversations.findOne({
      workspaceId: ctx.workspaceId,
      kind: 'channel_public',
      name: 'general',
    });
    if (general && req.role !== 'guest') {
      await t.conversation_members.insertOne({
        conversationId: general._id,
        userId: user._id,
        role: 'member',
        joinedAt: now,
      });
    }
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'member.invited',
      target: { type: 'user', id: user._id },
      metadata: { role: req.role },
    });
    return toUserSummary(user, req.role);
  }

  @Patch('users/:id')
  async update(@Ctx() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    if (!tenantCan(ctx.role, 'members.manage')) throw forbidden();
    const req = parse(UpdateMemberSchema, body);
    if (id === ctx.userId)
      throw new AppError('VALIDATION_FAILED', 'You cannot change your own role or status');
    const t = this.db.for(ctx.tenantId);
    const membership = await t.memberships.findOne({ userId: id });
    if (!membership) throw notFound('User');
    if (membership.role === 'owner')
      throw forbidden('The organization owner cannot be changed here');
    if (req.role) await t.memberships.updateOne({ userId: id }, { $set: { role: req.role } });
    if (req.status) {
      await t.users.updateOne({ _id: id }, { $set: { status: req.status } });
      if (req.status === 'deactivated') {
        const sessions = await t.devices.find({ userId: id, revokedAt: null }).toArray();
        await this.sessions.revokeAllForUser(ctx.tenantId, id, 'deactivated');
        for (const s of sessions) this.realtime.disconnectSession(ctx.tenantId, id, s._id);
      }
    }
    await this.sessions.invalidateMember(ctx.tenantId, id);
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'member.updated',
      target: { type: 'user', id },
      metadata: req,
    });
    const user = await t.users.findOne({ _id: id });
    return toUserSummary(user!, req.role ?? membership.role);
  }

  /** For someone who lost their authenticator and recovery codes: they set it up again. */
  @Post('users/:id/mfa/reset')
  @HttpCode(204)
  async resetMfa(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    if (!tenantCan(ctx.role, 'members.manage')) throw forbidden();
    if (id === ctx.userId)
      throw new AppError(
        'VALIDATION_FAILED',
        'Turn off your own two-step verification in Settings',
      );
    await this.mfa.adminReset(ctx, id);
  }

  /** Device management: own devices, or everyone's for admins (?all=true). */
  @Get('devices')
  async devices(@Ctx() ctx: TenantContext, @Query('all') all?: string) {
    const everyone = all === 'true';
    if (everyone && !tenantCan(ctx.role, 'devices.revoke.any')) throw forbidden();
    const rows = await this.db
      .for(ctx.tenantId)
      .devices.find(everyone ? {} : { userId: ctx.userId }, {
        sort: { lastSeenAt: -1 },
        limit: 1000,
      })
      .toArray();
    return rows.map((d) => ({
      sessionId: d._id,
      userId: d.userId,
      deviceId: d.deviceId,
      name: d.name,
      platform: d.platform,
      createdAt: d.createdAt.toISOString(),
      lastSeenAt: d.lastSeenAt.toISOString(),
      revokedAt: d.revokedAt?.toISOString() ?? null,
      current: d._id === ctx.sessionId,
    }));
  }

  @Delete('devices/:sessionId')
  @HttpCode(204)
  async revokeDevice(@Ctx() ctx: TenantContext, @Param('sessionId') sessionId: string) {
    const d = await this.db.for(ctx.tenantId).devices.findOne({ _id: sessionId });
    if (!d) throw notFound('Device');
    if (d.userId !== ctx.userId && !tenantCan(ctx.role, 'devices.revoke.any')) throw forbidden();
    await this.sessions.revoke(
      ctx.tenantId,
      sessionId,
      d.userId === ctx.userId ? 'user_revoked' : 'admin_revoked',
    );
    this.realtime.disconnectSession(ctx.tenantId, d.userId, sessionId);
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'device.revoked',
      target: { type: 'device', id: sessionId },
    });
  }

  @Get('audit-logs')
  async auditLogs(@Ctx() ctx: TenantContext, @Query('limit') limit?: string) {
    if (!tenantCan(ctx.role, 'audit.read')) throw forbidden();
    const rows = await this.audit.list(ctx.tenantId, Number(limit) || 100);
    return rows.map((r) => ({
      ...r,
      id: r._id,
      _id: undefined,
      tenantId: undefined,
      at: r.at.toISOString(),
    }));
  }
}
