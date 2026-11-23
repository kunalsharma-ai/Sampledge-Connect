import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { RateLimitService } from '../redis/redis.module.js';
import { GuestsService } from './guests.service.js';
import { readRawBody } from '../common/raw-body.js';
import { CAPTION_CLIP_MAX_BYTES } from '../calls/captions.service.js';
import { MeetingsService } from './meetings.service.js';

/**
 * The public side of guest invites, used by the /join/<token> page. No account: the link
 * token is the credential (a wrong or revoked token is a 404). Rate-limited per IP.
 */
@Controller('v1/guest')
export class GuestsController {
  constructor(
    private readonly guests: GuestsService,
    private readonly meetings: MeetingsService,
    private readonly rateLimit: RateLimitService,
  ) {}

  private async limit(req: Request) {
    await this.rateLimit.consume('guest_link', req.ip ?? 'unknown');
  }

  @Get(':token')
  async view(@Param('token') token: string, @Req() req: Request) {
    await this.limit(req);
    return this.guests.view(token);
  }

  @Post(':token/rsvp')
  @HttpCode(200)
  async rsvp(@Param('token') token: string, @Body() body: unknown, @Req() req: Request) {
    await this.limit(req);
    return this.meetings.guestRsvp(token, body);
  }

  /** The invite as a calendar file ("Add to calendar"). */
  @Get(':token/calendar.ics')
  async ics(@Param('token') token: string, @Req() req: Request, @Res() res: Response) {
    await this.limit(req);
    const { fileName, content } = await this.guests.ics(token);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8; method=REQUEST');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(content);
  }

  /** Where the guest stands (the page polls this). */
  @Get(':token/lobby')
  async state(@Param('token') token: string, @Req() req: Request) {
    await this.limit(req);
    return this.guests.lobby(token);
  }

  /** Ask to join with a display name; repeated while waiting to keep the place in the lobby. */
  @Post(':token/lobby')
  @HttpCode(200)
  async ask(@Param('token') token: string, @Body() body: unknown, @Req() req: Request) {
    await this.limit(req);
    return this.guests.lobby(token, body ?? {});
  }

  /** Meeting chat while admitted to the call (polled by the page). */
  @Get(':token/chat')
  async chat(@Param('token') token: string, @Req() req: Request) {
    await this.limit(req);
    return this.guests.chat(token);
  }

  @Post(':token/chat')
  @HttpCode(200)
  async sendChat(@Param('token') token: string, @Body() body: unknown, @Req() req: Request) {
    await this.limit(req);
    return this.guests.sendChat(token, body);
  }

  /** Live captions: a few seconds of the guest's own microphone (raw audio body). */
  @Post(':token/captions')
  @HttpCode(200)
  async caption(@Param('token') token: string, @Req() req: Request) {
    await this.limit(req);
    const audio = await readRawBody(req, CAPTION_CLIP_MAX_BYTES);
    return this.guests.captionClip(token, audio, req.headers['content-type']);
  }

  /** Jitsi calls: "still in the call" from the guest's page (every 20 s). */
  @Post(':token/presence')
  @HttpCode(200)
  async presence(@Param('token') token: string, @Req() req: Request) {
    await this.limit(req);
    return this.guests.presence(token);
  }

  @Post(':token/lobby/leave')
  @HttpCode(200)
  async leave(@Param('token') token: string, @Req() req: Request) {
    await this.limit(req);
    await this.guests.leaveLobby(token);
    return { ok: true };
  }
}
