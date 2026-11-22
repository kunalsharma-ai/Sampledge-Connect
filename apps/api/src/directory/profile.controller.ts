import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Put,
  Res,
  UseGuards,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Response } from 'express';
import {
  MAX_AVATAR_BYTES,
  SetAvatarRequestSchema,
  UpdateProfileRequestSchema,
  tenantCan,
  type UserSummary,
} from '@sampledge/contracts';
import { AppError, forbidden, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { AuthGuard, Ctx } from '../auth/auth.guard.js';
import { toUserSummary } from '../auth/auth.service.js';
import { AuditService } from '../audit/audit.service.js';
import { TenantDb } from '../database/tenant-db.js';
import type { UserAvatarDoc } from '../database/documents.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';

/** Recognise the image from its bytes, not from what the client claims. */
function sniff(b: Buffer): UserAvatarDoc['mimeType'] | null {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (
    b.length > 12 &&
    b.subarray(0, 4).toString('ascii') === 'RIFF' &&
    b.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return 'image/webp';
  return null;
}

/**
 * Your own profile: name, title, department, phone, bio, time zone and photo.
 * Every change emits `directory:updated` so all members' apps (and your other devices)
 * show it at once.
 */
@Controller('v1')
@UseGuards(AuthGuard)
export class ProfileController {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly realtime: RealtimePublisher,
  ) {}

  private async summary(ctx: TenantContext, userId: string): Promise<UserSummary> {
    const t = this.db.for(ctx.tenantId);
    const [user, membership] = await Promise.all([
      t.users.findOne({ _id: userId }),
      t.memberships.findOne({ userId }),
    ]);
    if (!user || !membership) throw notFound('User');
    return toUserSummary(user, membership.role);
  }

  private changed(ctx: TenantContext, fields: string[]) {
    this.realtime.toTenant(ctx.tenantId, 'directory:updated', { userId: ctx.userId });
    void this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'profile.updated',
      target: { type: 'user', id: ctx.userId },
      metadata: { fields },
    });
  }

  /** A colleague's profile card. */
  @Get('users/:id')
  async get(@Ctx() ctx: TenantContext, @Param('id') id: string): Promise<UserSummary> {
    if (id !== ctx.userId && !tenantCan(ctx.role, 'directory.read')) throw forbidden();
    return this.summary(ctx, id);
  }

  @Patch('me/profile')
  async update(@Ctx() ctx: TenantContext, @Body() body: unknown): Promise<UserSummary> {
    const req = parse(UpdateProfileRequestSchema, body);
    const set = Object.fromEntries(Object.entries(req).filter(([, v]) => v !== undefined));
    if (Object.keys(set).length > 0) {
      await this.db.for(ctx.tenantId).users.updateOne({ _id: ctx.userId }, { $set: set });
      this.changed(ctx, Object.keys(set));
    }
    return this.summary(ctx, ctx.userId);
  }

  @Put('me/avatar')
  async setAvatar(@Ctx() ctx: TenantContext, @Body() body: unknown): Promise<UserSummary> {
    const { image } = parse(SetAvatarRequestSchema, body);
    const data = Buffer.from(image.slice(image.indexOf(',') + 1), 'base64');
    if (data.length > MAX_AVATAR_BYTES)
      throw new AppError('VALIDATION_FAILED', 'The photo must be 160 KB or smaller');
    const mimeType = sniff(data);
    if (!mimeType) throw new AppError('VALIDATION_FAILED', 'Use a PNG, JPEG or WebP image');
    const t = this.db.for(ctx.tenantId);
    const key = randomBytes(16).toString('hex');
    await t.user_avatars.insertOne({
      _id: key,
      userId: ctx.userId,
      mimeType,
      data,
      size: data.length,
      createdAt: new Date(),
    });
    const prev = await t.users.findOne({ _id: ctx.userId }, { projection: { avatarKey: 1 } });
    await t.users.updateOne({ _id: ctx.userId }, { $set: { avatarKey: key } });
    if (prev?.avatarKey) await t.user_avatars.deleteMany({ _id: prev.avatarKey });
    this.changed(ctx, ['avatar']);
    return this.summary(ctx, ctx.userId);
  }

  @Delete('me/avatar')
  async removeAvatar(@Ctx() ctx: TenantContext): Promise<UserSummary> {
    const t = this.db.for(ctx.tenantId);
    const prev = await t.users.findOne({ _id: ctx.userId }, { projection: { avatarKey: 1 } });
    if (prev?.avatarKey) {
      await t.users.updateOne({ _id: ctx.userId }, { $set: { avatarKey: null } });
      await t.user_avatars.deleteMany({ _id: prev.avatarKey });
      this.changed(ctx, ['avatar']);
    }
    return this.summary(ctx, ctx.userId);
  }
}

/**
 * Serves profile photos without a session, so plain <img> tags and push notifications can
 * load them. The key is 128 random bits and changes with every photo, like a signed URL that
 * doesn't expire; a removed photo stops resolving.
 */
@Controller('v1')
export class AvatarsController {
  constructor(private readonly db: TenantDb) {}

  @Get('avatars/:tenantId/:key')
  @HttpCode(200)
  async get(@Param('tenantId') tenantId: string, @Param('key') key: string, @Res() res: Response) {
    if (!/^[a-f0-9]{24}$/.test(tenantId) || !/^[a-f0-9]{32}$/.test(key)) throw notFound('Photo');
    const a = await this.db.for(tenantId).user_avatars.findOne({ _id: key });
    if (!a) throw notFound('Photo');
    const data = Buffer.isBuffer(a.data)
      ? a.data
      : Buffer.from((a.data as unknown as { buffer: ArrayBuffer }).buffer);
    res.setHeader('Content-Type', a.mimeType);
    res.setHeader('Content-Length', String(data.length));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.end(data);
  }
}
