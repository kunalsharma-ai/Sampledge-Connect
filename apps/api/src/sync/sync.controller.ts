import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import type { TenantContext } from '../common/tenant-context.js';
import { AuthGuard, Ctx } from '../auth/auth.guard.js';
import { SyncService } from './sync.service.js';

@Controller('v1/sync')
@UseGuards(AuthGuard)
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post()
  @HttpCode(200)
  run(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.sync.sync(ctx, body);
  }
}
