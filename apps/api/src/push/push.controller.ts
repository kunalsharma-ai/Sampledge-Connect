import { Body, Controller, Delete, Get, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import { RegisterPushTokenRequestSchema, type PushStatus } from '@sampledge/contracts';
import { AuthGuard, Ctx } from '../auth/auth.guard.js';
import { parse } from '../common/errors.js';
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

  @Get('status')
  async status(@Ctx() ctx: TenantContext): Promise<PushStatus> {
    const d = await this.db.for(ctx.tenantId).devices.findOne({ _id: ctx.sessionId });
    const provider = await this.pushProviders.forTenant(ctx.tenantId);
    return {
      enabled: provider.name !== null,
      provider: provider.name,
      tokenRegistered: !!d?.push?.token,
    };
  }
}
