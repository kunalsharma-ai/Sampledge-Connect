import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { TenantContext } from '../common/tenant-context.js';
import { AuthGuard, Ctx } from '../auth/auth.guard.js';
import { BillingService } from './billing.service.js';

@Controller('v1/billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  @UseGuards(AuthGuard)
  overview(@Ctx() ctx: TenantContext) {
    return this.billing.overview(ctx);
  }

  /** Pricing for the public website. No sign-in needed. */
  @Get('plans')
  plans() {
    return this.billing.publicPlans();
  }

  @Post('checkout')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  checkout(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.billing.checkout(ctx, body);
  }

  @Post('portal')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  portal(@Ctx() ctx: TenantContext) {
    return this.billing.portal(ctx);
  }

  /** Stripe calls this; verified with the webhook signing secret from Integrations. */
  @Post('stripe/webhook')
  @HttpCode(200)
  webhook(@Req() req: Request & { rawBody?: Buffer }, @Headers('stripe-signature') sig?: string) {
    return this.billing.webhook(req.rawBody, sig);
  }
}

/** Platform operators (PLATFORM_ADMIN_EMAILS): the plan catalog and manual assignment. */
@Controller('v1/platform/billing')
@UseGuards(AuthGuard)
export class PlatformBillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('plans')
  plans(@Ctx() ctx: TenantContext) {
    return this.billing.listPlans(ctx);
  }

  @Post('plans')
  create(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.billing.savePlan(ctx, null, body);
  }

  @Put('plans/:planId')
  update(@Ctx() ctx: TenantContext, @Param('planId') id: string, @Body() body: unknown) {
    return this.billing.savePlan(ctx, id, body);
  }

  @Get('tenants')
  tenants(@Ctx() ctx: TenantContext) {
    return this.billing.listTenants(ctx);
  }

  @Put('tenants/:tenantId')
  assign(@Ctx() ctx: TenantContext, @Param('tenantId') id: string, @Body() body: unknown) {
    return this.billing.assign(ctx, id, body);
  }
}
