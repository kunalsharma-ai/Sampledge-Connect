import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { TenantSlugSchema } from '@sampledge/contracts';
import { parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { AuthGuard, Ctx } from '../auth/auth.guard.js';
import { BrandingService } from './branding.service.js';

@Controller('v1/branding')
export class BrandingController {
  constructor(private readonly branding: BrandingService) {}

  @Get()
  @UseGuards(AuthGuard)
  get(@Ctx() ctx: TenantContext) {
    return this.branding.get(ctx);
  }

  @Put()
  @UseGuards(AuthGuard)
  save(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.branding.save(ctx, body);
  }

  /** Sign-in page: logo, name and colors once the workspace is typed. */
  @Get('public/:slug')
  publicFor(@Param('slug') slug: string) {
    return this.branding.publicFor(parse(TenantSlugSchema, slug));
  }
}
