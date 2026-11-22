import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { TenantContext } from '../common/tenant-context.js';
import { AuthGuard, Ctx } from '../auth/auth.guard.js';
import { BillingService } from '../billing/billing.service.js';
import { PlatformAdmins } from './platform-admins.js';
import { PlatformAdminsService } from './platform-admins.service.js';
import { PlatformAudit } from './platform-audit.service.js';
import { PlatformService } from './platform.service.js';

const ip = (req: Request) => req.ip ?? null;

/**
 * The super admin console API (docs/super-admin.md). Every route checks the caller's
 * platform role; Network moderation, the plan catalog and platform integrations keep their
 * existing routes under /v1/platform/network, /v1/platform/billing and /v1/platform/integrations.
 */
@Controller('v1/platform')
@UseGuards(AuthGuard)
export class PlatformController {
  constructor(
    private readonly platform: PlatformService,
    private readonly admins: PlatformAdminsService,
    private readonly operators: PlatformAdmins,
    private readonly audit: PlatformAudit,
    private readonly billing: BillingService,
  ) {}

  @Get('me')
  me(@Ctx() ctx: TenantContext) {
    return this.admins.me(ctx);
  }

  @Get('overview')
  overview(@Ctx() ctx: TenantContext) {
    return this.platform.overview(ctx);
  }

  @Get('orgs')
  orgs(@Ctx() ctx: TenantContext, @Query() q: unknown) {
    return this.platform.list(ctx, q);
  }

  @Post('orgs')
  create(@Ctx() ctx: TenantContext, @Body() body: unknown, @Req() req: Request) {
    return this.platform.create(ctx, body, ip(req));
  }

  @Get('orgs/:tenantId')
  org(@Ctx() ctx: TenantContext, @Param('tenantId') id: string) {
    return this.platform.detail(ctx, id);
  }

  @Patch('orgs/:tenantId')
  rename(
    @Ctx() ctx: TenantContext,
    @Param('tenantId') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.platform.rename(ctx, id, body, ip(req));
  }

  @Get('orgs/:tenantId/support')
  support(@Ctx() ctx: TenantContext, @Param('tenantId') id: string, @Req() req: Request) {
    return this.platform.support(ctx, id, ip(req));
  }

  @Post('orgs/:tenantId/suspend')
  @HttpCode(200)
  suspend(
    @Ctx() ctx: TenantContext,
    @Param('tenantId') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.platform.suspend(ctx, id, body, ip(req));
  }

  @Post('orgs/:tenantId/reactivate')
  @HttpCode(200)
  reactivate(@Ctx() ctx: TenantContext, @Param('tenantId') id: string, @Req() req: Request) {
    return this.platform.reactivate(ctx, id, ip(req));
  }

  @Post('orgs/:tenantId/deletion')
  @HttpCode(200)
  scheduleDeletion(
    @Ctx() ctx: TenantContext,
    @Param('tenantId') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.platform.scheduleDeletion(ctx, id, body, ip(req));
  }

  @Delete('orgs/:tenantId/deletion')
  cancelDeletion(@Ctx() ctx: TenantContext, @Param('tenantId') id: string, @Req() req: Request) {
    return this.platform.cancelDeletion(ctx, id, ip(req));
  }

  /** Same as PUT /v1/platform/billing/tenants/:tenantId, under the console's paths. */
  @Put('orgs/:tenantId/plan')
  plan(@Ctx() ctx: TenantContext, @Param('tenantId') id: string, @Body() body: unknown) {
    return this.billing.assign(ctx, id, body);
  }

  @Get('admins')
  list(@Ctx() ctx: TenantContext) {
    return this.admins.list(ctx);
  }

  @Get('accounts')
  accounts(@Ctx() ctx: TenantContext, @Query('q') q: string) {
    return this.admins.accounts(ctx, q);
  }

  @Post('admins')
  add(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.admins.add(ctx, body);
  }

  @Patch('admins/:adminId')
  setRole(@Ctx() ctx: TenantContext, @Param('adminId') id: string, @Body() body: unknown) {
    return this.admins.setRole(ctx, id, body);
  }

  @Delete('admins/:adminId')
  async remove(@Ctx() ctx: TenantContext, @Param('adminId') id: string) {
    await this.admins.remove(ctx, id);
    return { removed: true };
  }

  @Get('audit')
  async auditLog(@Ctx() ctx: TenantContext, @Query() q: unknown) {
    await this.operators.assert(ctx, 'audit.view');
    return this.audit.page(q);
  }

  @Get('health')
  async health(@Ctx() ctx: TenantContext) {
    await this.operators.assert(ctx, 'overview.view');
    return this.platform.health();
  }
}
