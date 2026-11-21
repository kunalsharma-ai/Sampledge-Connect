import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, Ctx } from '../auth/auth.guard.js';
import type { TenantContext } from '../common/tenant-context.js';
import { MeetingsService } from './meetings.service.js';

@Controller('v1')
@UseGuards(AuthGuard)
export class MeetingsController {
  constructor(private readonly meetings: MeetingsService) {}

  /** My meetings overlapping [from, to). */
  @Get('meetings')
  list(@Ctx() ctx: TenantContext, @Query() query: Record<string, string>) {
    return this.meetings.list(ctx, query);
  }

  @Post('meetings')
  create(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.meetings.create(ctx, body);
  }

  /** Free slots for the caller plus attendees, inside everyone's working hours. */
  @Post('meetings/find-times')
  @HttpCode(200)
  findTimes(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.meetings.findTimes(ctx, body);
  }

  @Get('meetings/:id')
  get(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.meetings.get(ctx, id);
  }

  @Patch('meetings/:id')
  update(@Ctx() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.meetings.update(ctx, id, body);
  }

  @Post('meetings/:id/cancel')
  @HttpCode(200)
  cancel(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.meetings.cancel(ctx, id);
  }

  @Post('meetings/:id/rsvp')
  @HttpCode(200)
  rsvp(@Ctx() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.meetings.rsvp(ctx, id, body);
  }

  /** A guest's personal join link (organizer only). */
  @Get('meetings/:id/guests/:guestId/link')
  guestLink(@Ctx() ctx: TenantContext, @Param('id') id: string, @Param('guestId') guestId: string) {
    return this.meetings.guestLink(ctx, id, guestId);
  }

  @Post('meetings/:id/guests/:guestId/resend')
  @HttpCode(200)
  resendGuest(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Param('guestId') guestId: string,
  ) {
    return this.meetings.resendGuestInvite(ctx, id, guestId);
  }

  @Get('me/working-hours')
  workingHours(@Ctx() ctx: TenantContext) {
    return this.meetings.getWorkingHours(ctx);
  }

  @Put('me/working-hours')
  setWorkingHours(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.meetings.setWorkingHours(ctx, body);
  }
}
