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
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, Ctx } from '../auth/auth.guard.js';
import type { TenantContext } from '../common/tenant-context.js';
import { AiService } from './ai.service.js';
import { TranscriptsService } from './transcripts.service.js';

/**
 * Private AI assistant. Every route reads only what the caller can read, and none of them
 * changes anything except confirming a draft the caller asked for.
 */
@Controller('v1/ai')
@UseGuards(AuthGuard)
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly transcripts: TranscriptsService,
  ) {}

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

  /** Suggested tasks the caller dismissed, on any of their devices. */
  @Get('suggestions/dismissed')
  dismissedSuggestions(@Ctx() ctx: TenantContext) {
    return this.ai.dismissedSuggestions(ctx);
  }

  @Put('suggestions/:id/dismissed')
  dismissSuggestion(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.ai.setSuggestionDismissed(ctx, id, true);
  }

  @Delete('suggestions/:id/dismissed')
  restoreSuggestion(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.ai.setSuggestionDismissed(ctx, id, false);
  }

  @Post('proposals/:id/dismiss')
  @HttpCode(200)
  dismiss(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.ai.dismissProposal(ctx, id);
  }

  /** A recording's transcript (same access as playing the recording). */
  @Get('transcripts/:attachmentId')
  transcript(@Ctx() ctx: TenantContext, @Param('attachmentId') id: string) {
    return this.transcripts.get(ctx, id);
  }

  /** Queue a transcript on the organization's own speech-to-text server (or retry). */
  @Post('transcripts/:attachmentId')
  @HttpCode(202)
  requestTranscript(@Ctx() ctx: TenantContext, @Param('attachmentId') id: string) {
    return this.transcripts.request(ctx, id);
  }

  /** Correct lines (original or a translation) or mark it checked. Per-line merge. */
  @Patch('transcripts/:attachmentId')
  correctTranscript(
    @Ctx() ctx: TenantContext,
    @Param('attachmentId') id: string,
    @Body() body: unknown,
  ) {
    return this.transcripts.update(ctx, id, body);
  }

  /** Translate a finished transcript into another language (or again). */
  @Post('transcripts/:attachmentId/translations')
  @HttpCode(202)
  translateTranscript(
    @Ctx() ctx: TenantContext,
    @Param('attachmentId') id: string,
    @Body() body: unknown,
  ) {
    return this.transcripts.translate(ctx, id, body);
  }
}
