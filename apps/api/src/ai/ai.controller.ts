import { Body, Controller, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard, Ctx } from '../auth/auth.guard.js';
import type { TenantContext } from '../common/tenant-context.js';
import { AiService } from './ai.service.js';

/**
 * Private AI assistant. Every route reads only what the caller can read, and none of them
 * changes anything except confirming a draft the caller asked for.
 */
@Controller('v1/ai')
@UseGuards(AuthGuard)
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('status')
  status(@Ctx() ctx: TenantContext) {
    return this.ai.status(ctx);
  }

  /** Admins: turn AI on or off for the organization. */
  @Put('settings')
  settings(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.ai.updateSettings(ctx, body);
  }

  @Post('conversations/:id/summary')
  @HttpCode(200)
  summarize(@Ctx() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.ai.summarizeConversation(ctx, id, body);
  }

  @Post('conversations/:id/replies')
  @HttpCode(200)
  replies(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.ai.suggestReplies(ctx, id);
  }

  @Post('meetings/:id/summary')
  @HttpCode(200)
  meeting(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.ai.summarizeMeeting(ctx, id);
  }

  @Post('search')
  @HttpCode(200)
  search(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.ai.search(ctx, body);
  }

  @Post('ask')
  @HttpCode(200)
  ask(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.ai.ask(ctx, body);
  }

  @Post('translate')
  @HttpCode(200)
  translate(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.ai.translate(ctx, body);
  }

  @Post('digest')
  @HttpCode(200)
  digest(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.ai.digest(ctx, body);
  }

  @Post('duplicates')
  @HttpCode(200)
  duplicates(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.ai.duplicates(ctx, body);
  }

  @Get('notifications/priority')
  priority(@Ctx() ctx: TenantContext) {
    return this.ai.prioritizeNotifications(ctx);
  }

  /** Draft a message. Nothing is sent until the caller confirms it. */
  @Post('proposals')
  propose(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.ai.createProposal(ctx, body);
  }

  @Post('proposals/:id/confirm')
  @HttpCode(200)
  confirm(@Ctx() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.ai.confirmProposal(ctx, id, body);
  }

  @Post('proposals/:id/dismiss')
  @HttpCode(200)
  dismiss(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.ai.dismissProposal(ctx, id);
  }
}
