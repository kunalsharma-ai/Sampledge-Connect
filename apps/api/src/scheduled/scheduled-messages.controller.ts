import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, Ctx } from '../auth/auth.guard.js';
import type { TenantContext } from '../common/tenant-context.js';
import { ScheduledMessagesService } from './scheduled-messages.service.js';

@Controller('v1')
@UseGuards(AuthGuard)
export class ScheduledMessagesController {
  constructor(private readonly scheduled: ScheduledMessagesService) {}

  /** Schedule a message (idempotent on clientMessageId). */
  @Post('conversations/:id/scheduled-messages')
  @HttpCode(200)
  create(@Ctx() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.scheduled.create(ctx, id, body);
  }

  /** The caller's own scheduled messages. Nobody else can see them before they send. */
  @Get('scheduled-messages')
  list(@Ctx() ctx: TenantContext, @Query() query: Record<string, string>) {
    return this.scheduled.list(ctx, query);
  }

  @Patch('scheduled-messages/:id')
  update(@Ctx() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.scheduled.update(ctx, id, body);
  }

  @Delete('scheduled-messages/:id')
  cancel(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.scheduled.cancel(ctx, id);
  }

  @Post('scheduled-messages/:id/send-now')
  @HttpCode(200)
  sendNow(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.scheduled.sendNow(ctx, id);
  }
}
