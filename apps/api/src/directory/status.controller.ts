import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import {
  DEFAULT_DND_SCHEDULE,
  DndScheduleSchema,
  SetStatusRequestSchema,
  dndActive,
  type PresenceInfo,
} from '@sampledge/contracts';
import { AppError, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { AuthGuard, Ctx } from '../auth/auth.guard.js';
import { statusOf } from '../auth/auth.service.js';
import { TenantDb } from '../database/tenant-db.js';
import type { UserDoc } from '../database/documents.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';

const validZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/**
 * Your availability, custom status and do-not-disturb hours. Each change emits
 * `directory:updated` to the organization, so every member's app and all your devices update.
 * Both PUTs replace the whole value, so the offline queue can retry them safely.
 */
@Controller('v1/me')
@UseGuards(AuthGuard)
export class StatusController {
  constructor(
    private readonly db: TenantDb,
    private readonly realtime: RealtimePublisher,
  ) {}

  private async info(ctx: TenantContext): Promise<PresenceInfo> {
    const u = await this.db.for(ctx.tenantId).users.findOne({ _id: ctx.userId });
    if (!u) throw notFound('User');
    const now = new Date();
    const status = statusOf(u, now) ?? {
      availability: 'auto',
      emoji: null,
      text: null,
      expiresAt: null,
    };
    const schedule = u.dndSchedule ?? { ...DEFAULT_DND_SCHEDULE, timeZone: u.timeZone ?? 'UTC' };
    return {
      status,
      dndSchedule: schedule,
      dndActive: dndActive(status, u.dndSchedule ?? null, now),
    };
  }

  @Get('status')
  get(@Ctx() ctx: TenantContext) {
    return this.info(ctx);
  }

  @Put('status')
  async setStatus(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    const s = parse(SetStatusRequestSchema, body);
    if (s.expiresAt && Date.parse(s.expiresAt) <= Date.now())
      throw new AppError('VALIDATION_FAILED', 'Pick a time in the future for the status to clear');
    const cleared = s.availability === 'auto' && !s.emoji && !s.text;
    const value: UserDoc['userStatus'] = cleared
      ? null
      : { ...s, expiresAt: s.expiresAt ? new Date(s.expiresAt) : null };
    await this.db
      .for(ctx.tenantId)
      .users.updateOne({ _id: ctx.userId }, { $set: { userStatus: value } });
    this.realtime.toTenant(ctx.tenantId, 'directory:updated', { userId: ctx.userId });
    return this.info(ctx);
  }

  @Put('dnd-schedule')
  async setSchedule(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    const s = parse(DndScheduleSchema, body);
    if (!validZone(s.timeZone)) throw new AppError('VALIDATION_FAILED', 'Unknown time zone');
    await this.db
      .for(ctx.tenantId)
      .users.updateOne(
        { _id: ctx.userId },
        { $set: { dndSchedule: { ...s, days: [...new Set(s.days)].sort() } } },
      );
    this.realtime.toTenant(ctx.tenantId, 'directory:updated', { userId: ctx.userId });
    return this.info(ctx);
  }
}
