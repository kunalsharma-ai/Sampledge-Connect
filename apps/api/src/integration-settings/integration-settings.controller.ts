import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { TestIntegrationRequestSchema, tenantCan } from '@sampledge/contracts';
import { AuthGuard, Ctx } from '../auth/auth.guard.js';
import { forbidden, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { TenantDb } from '../database/tenant-db.js';
import { IntegrationSettingsService } from './integration-settings.service.js';

/** Tenant-level integrations: owners and admins (`integrations.manage`). */
@Controller('v1/admin/integrations')
@UseGuards(AuthGuard)
export class TenantIntegrationsController {
  constructor(private readonly settings: IntegrationSettingsService) {}

  private guard(ctx: TenantContext) {
    if (!tenantCan(ctx.role, 'integrations.manage')) throw forbidden();
    return { tenantId: ctx.tenantId };
  }

  @Get()
  list(@Ctx() ctx: TenantContext) {
    return this.settings.list(this.guard(ctx));
  }

  @Put(':providerId')
  save(@Ctx() ctx: TenantContext, @Param('providerId') id: string, @Body() body: unknown) {
    return this.settings.save(this.guard(ctx), id, body, ctx.userId);
  }

  @Post(':providerId/test')
  @HttpCode(200)
  test(@Ctx() ctx: TenantContext, @Param('providerId') id: string, @Body() body: unknown) {
    const { values } = parse(TestIntegrationRequestSchema, body ?? {});
    return this.settings.test(this.guard(ctx), id, values, ctx.userId);
  }

  @Delete(':providerId')
  reset(@Ctx() ctx: TenantContext, @Param('providerId') id: string) {
    return this.settings.reset(this.guard(ctx), id, ctx.userId);
  }
}

/** Platform-wide defaults: operators listed in PLATFORM_ADMIN_EMAILS (a bootstrap value). */
@Controller('v1/platform/integrations')
@UseGuards(AuthGuard)
export class PlatformIntegrationsController {
  private readonly admins: Set<string>;
  constructor(
    private readonly settings: IntegrationSettingsService,
    private readonly db: TenantDb,
    @Inject(APP_CONFIG) cfg: AppConfig,
  ) {
    this.admins = new Set(
      cfg.PLATFORM_ADMIN_EMAILS.split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    );
  }

  private async guard(ctx: TenantContext) {
    const u = await this.db
      .for(ctx.tenantId)
      .users.findOne({ _id: ctx.userId }, { projection: { email: 1 } });
    if (!u || !this.admins.has(u.email.toLowerCase())) throw forbidden();
    return { tenantId: null };
  }

  @Get()
  async list(@Ctx() ctx: TenantContext) {
    return this.settings.list(await this.guard(ctx));
  }

  @Put(':providerId')
  async save(@Ctx() ctx: TenantContext, @Param('providerId') id: string, @Body() body: unknown) {
    return this.settings.save(await this.guard(ctx), id, body, ctx.userId);
  }

  @Post(':providerId/test')
  @HttpCode(200)
  async test(@Ctx() ctx: TenantContext, @Param('providerId') id: string, @Body() body: unknown) {
    const { values } = parse(TestIntegrationRequestSchema, body ?? {});
    return this.settings.test(await this.guard(ctx), id, values, ctx.userId);
  }

  @Delete(':providerId')
  async reset(@Ctx() ctx: TenantContext, @Param('providerId') id: string) {
    return this.settings.reset(await this.guard(ctx), id, ctx.userId);
  }
}
