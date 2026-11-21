import { Body, Controller, Delete, Get, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import {
  RegisterPushTokenRequestSchema,
  type PushStatus,
  type WebPushConfig,
} from '@sampledge/contracts';
import { AuthGuard, Ctx } from '../auth/auth.guard.js';
import { AppError, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { TenantDb } from '../database/tenant-db.js';
import { PushProviders } from './push-provider.js';

/** Push tokens belong to one device session; revoke and sign-out clear them. */
@Controller('v1/push')
@UseGuards(AuthGuard)
export class PushController {
  constructor(
    private readonly db: TenantDb,
    private readonly pushProviders: PushProviders,
  ) {}

  @Post('token')
  @HttpCode(200)
  async register(@Ctx() ctx: TenantContext, @Body() body: unknown): Promise<PushStatus> {
    const req = parse(RegisterPushTokenRequestSchema, body);
    if (req.provider === 'webpush') {
      let sub: unknown;
      try {
        sub = JSON.parse(req.token);
      } catch {
        sub = null;
      }
      if (!WebSubscriptionSchema.safeParse(sub).success)
        throw new AppError('VALIDATION_FAILED', 'Not a valid browser push subscription');
      if (!(await this.pushProviders.webVapid(ctx.tenantId)))
        throw new AppError(
          'CONFLICT',
          'Browser notifications are not turned on for this organization',
        );
    }
    const t = this.db.for(ctx.tenantId);
    // A token identifies a physical install: move it off any other session that had it.
    await t.devices.updateMany(
      { 'push.token': req.token, _id: { $ne: ctx.sessionId } },
      { $set: { push: null } },
    );
    await t.devices.updateOne(
      { _id: ctx.sessionId },
      { $set: { push: { ...req, updatedAt: new Date() } } },
    );
    return this.status(ctx);
  }

  @Delete('token')
  @HttpCode(200)
  async clear(@Ctx() ctx: TenantContext): Promise<PushStatus> {
    await this.db
      .for(ctx.tenantId)
      .devices.updateOne({ _id: ctx.sessionId }, { $set: { push: null } });
    return this.status(ctx);
  }

  /** Browser push: whether it is on, and the key a browser subscribes with. */
  @Get('web')
  async web(@Ctx() ctx: TenantContext): Promise<WebPushConfig> {
    const v = await this.pushProviders.webVapid(ctx.tenantId);
    const d = await this.db.for(ctx.tenantId).devices.findOne({ _id: ctx.sessionId });
    return {
      enabled: !!v,
      publicKey: v?.publicKey ?? null,
      subscribed: d?.push?.provider === 'webpush',
    };
  }

  @Get('status')
  async status(@Ctx() ctx: TenantContext): Promise<PushStatus> {
    const d = await this.db.for(ctx.tenantId).devices.findOne({ _id: ctx.sessionId });
    const provider = await this.pushProviders.forTenant(ctx.tenantId);
    const kind = d?.push?.provider === 'webpush' ? 'webpush' : 'expo';
    const enabled = provider.accepts(kind);
    return {
      enabled,
      provider: enabled ? kind : null,
      tokenRegistered: !!d?.push?.token,
    };
  }
}

const WebSubscriptionSchema = z.object({
  endpoint: z.string().url().startsWith('https://'),
  keys: z.object({ p256dh: z.string().min(20), auth: z.string().min(8) }),
});
