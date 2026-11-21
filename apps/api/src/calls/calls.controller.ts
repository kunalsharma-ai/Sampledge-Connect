import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard, Ctx } from '../auth/auth.guard.js';
import { AppError } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { CallsService } from './calls.service.js';

@Controller('v1')
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  /** Whether calls are available on this deployment. Clients hide call buttons when disabled. */
  @Get('calls/config')
  @UseGuards(AuthGuard)
  config(@Ctx() ctx: TenantContext) {
    return this.calls.config(ctx);
  }

  /** Live calls in the caller's conversations. */
  @Get('calls/active')
  @UseGuards(AuthGuard)
  listActive(@Ctx() ctx: TenantContext) {
    return this.calls.listActive(ctx);
  }

  /** Start a call (or join the one already live) in a conversation. */
  @Post('conversations/:id/calls')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  start(@Ctx() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.calls.start(ctx, id, body);
  }

  @Get('conversations/:id/calls/active')
  @UseGuards(AuthGuard)
  active(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.calls.active(ctx, id).then((call) => ({ call }));
  }

  @Get('calls/:callId')
  @UseGuards(AuthGuard)
  get(@Ctx() ctx: TenantContext, @Param('callId') callId: string) {
    return this.calls.get(ctx, callId);
  }

  @Post('calls/:callId/join')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  join(@Ctx() ctx: TenantContext, @Param('callId') callId: string) {
    return this.calls.join(ctx, callId);
  }

  @Post('calls/:callId/leave')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  leave(@Ctx() ctx: TenantContext, @Param('callId') callId: string) {
    return this.calls.leave(ctx, callId);
  }

  @Post('calls/:callId/decline')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  decline(@Ctx() ctx: TenantContext, @Param('callId') callId: string) {
    return this.calls.decline(ctx, callId);
  }

  /** End the call for everyone (caller or moderators). */
  @Post('calls/:callId/end')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  end(@Ctx() ctx: TenantContext, @Param('callId') callId: string) {
    return this.calls.end(ctx, callId);
  }

  /** Start recording the call (anyone in it). Everyone sees the recording indicator. */
  @Post('calls/:callId/recording/start')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  startRecording(@Ctx() ctx: TenantContext, @Param('callId') callId: string) {
    return this.calls.startRecording(ctx, callId);
  }

  @Post('calls/:callId/recording/stop')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  stopRecording(@Ctx() ctx: TenantContext, @Param('callId') callId: string) {
    return this.calls.stopRecording(ctx, callId);
  }

  /**
   * LiveKit webhook receiver (configure it in livekit.yaml). Authenticated by the signed JWT
   * LiveKit sends, not by a user token. The body arrives raw so its hash can be checked.
   */
  @Post('calls/livekit/webhook')
  @HttpCode(200)
  async webhook(@Req() req: Request, @Headers('authorization') auth: string | undefined) {
    const raw = req.body;
    if (!Buffer.isBuffer(raw))
      throw new AppError('VALIDATION_FAILED', 'Expected a LiveKit webhook');
    await this.calls.handleWebhook(raw, auth);
    return { ok: true };
  }
}
