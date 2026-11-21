import { Controller, Get, Header, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import type { TenantContext } from '../common/tenant-context.js';
import { AuthGuard, Ctx } from '../auth/auth.guard.js';
import { AdminService } from './admin.service.js';

@Controller('v1/admin')
@UseGuards(AuthGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  overview(@Ctx() ctx: TenantContext) {
    return this.admin.overview(ctx);
  }

  @Get('audit')
  audit(@Ctx() ctx: TenantContext, @Query() q: Record<string, unknown>) {
    return this.admin.auditPage(ctx, q);
  }

  @Get('audit/export')
  @Header('Cache-Control', 'no-store')
  async export(
    @Ctx() ctx: TenantContext,
    @Query() q: Record<string, unknown>,
    @Res() res: Response,
  ) {
    const csv = await this.admin.exportCsv(ctx, q);
    res
      .status(200)
      .type('text/csv; charset=utf-8')
      .attachment(`audit-log-${new Date().toISOString().slice(0, 10)}.csv`)
      .send('﻿' + csv);
  }
}
