import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard, Ctx } from '../auth/auth.guard.js';
import type { TenantContext } from '../common/tenant-context.js';
import { NotificationsService } from './notifications.service.js';

@Controller('v1/notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** The caller's inbox, newest first. Only the caller's own notifications are ever returned. */
  @Get()
  list(@Ctx() ctx: TenantContext, @Query() query: Record<string, string>) {
    return this.notifications.list(ctx, query);
  }

  @Post('read')
  @HttpCode(200)
  markRead(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.notifications.markRead(ctx, body);
  }
}
