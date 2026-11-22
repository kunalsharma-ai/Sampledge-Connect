import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard, Ctx } from '../auth/auth.guard.js';
import type { TenantContext } from '../common/tenant-context.js';
import { SupportService } from './support.service.js';

/** Help center queries (docs/help-center.md). */
@Controller('v1')
@UseGuards(AuthGuard)
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Get('support/queries')
  mine(@Ctx() ctx: TenantContext, @Query() q: unknown) {
    return this.support.listMine(ctx, q);
  }

  @Post('support/queries')
  create(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.support.create(ctx, body);
  }

  /** Owners and admins: every query in the organization. */
  @Get('support/admin/queries')
  org(@Ctx() ctx: TenantContext, @Query() q: unknown) {
    return this.support.listOrg(ctx, q);
  }

  @Get('support/queries/:id')
  get(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.support.get(ctx, id);
  }

  @Post('support/queries/:id/replies')
  reply(@Ctx() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.support.reply(ctx, id, body);
  }

  @Patch('support/queries/:id')
  update(@Ctx() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.support.update(ctx, id, body);
  }

  // SampConnect support (super admin console, `support.view`).
  @Get('platform/support/queries')
  platform(@Ctx() ctx: TenantContext, @Query() q: unknown) {
    return this.support.listPlatform(ctx, q);
  }

  @Post('platform/support/queries/:tenantId/:id/replies')
  platformReply(
    @Ctx() ctx: TenantContext,
    @Param('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.support.platformReply(ctx, tenantId, id, body);
  }

  @Patch('platform/support/queries/:tenantId/:id')
  platformUpdate(
    @Ctx() ctx: TenantContext,
    @Param('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.support.platformUpdate(ctx, tenantId, id, body);
  }
}
