import { Inject, Injectable } from '@nestjs/common';
import type { Db } from 'mongodb';
import type { Redis } from 'ioredis';
import {
  BookingSlotsQuerySchema,
  CreateBookingPageSchema,
  CreateBookingSchema,
  UpdateBookingPageSchema,
  type BookingConfirmation,
  type BookingPage,
  type BookingSlotsResponse,
  type PublicBookingPage,
} from '@sampledge/contracts';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { AppError, forbidden, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import type { BookingPageDoc } from '../database/documents.js';
import { MONGO_DB } from '../database/database.module.js';
import { TenantDb } from '../database/tenant-db.js';
import { REDIS } from '../redis/redis.module.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';
import { GuestsService } from './guests.service.js';
import { MeetingsService } from './meetings.service.js';
import { localParts } from './time.js';

const DAY = 86_400_000;

/**
 * Team booking pages. Hosts set them up; anyone with the link picks a free time, which
 * becomes an ordinary meeting with the booker as an external guest. Free times come from the
 * hosts' working hours and meetings (MeetingsService.freeSlots), so a booking also blocks that
 * time on every other page and in "find a time".
 */
@Injectable()
export class BookingService {
  constructor(
    private readonly db: TenantDb,
    @Inject(MONGO_DB) private readonly rawDb: Db,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly meetings: MeetingsService,
    private readonly guests: GuestsService,
    private readonly realtime: RealtimePublisher,
  ) {}

  /** Every host (old and new) refetches their booking pages on all of their devices. */
  private changed(tenantId: string, ...hostLists: string[][]) {
    for (const id of new Set(hostLists.flat()))
      this.realtime.toUser(tenantId, id, 'meetings:changed', { area: 'booking_pages' });
  }

  private url(slug: string) {
    const base = (
      this.cfg.PUBLIC_WEB_URL ??
      this.cfg.corsOrigins[0] ??
      'http://localhost:3000'
    ).replace(/\/+$/, '');
    return `${base}/book/${slug}`;
  }

  private toDto(p: BookingPageDoc): BookingPage {
    return {
      bookingPageId: p._id,
      slug: p.slug,
      title: p.title,
      description: p.description,
      durationMinutes: p.durationMinutes,
      hostIds: p.hostIds,
      mode: p.mode,
      bufferMinutes: p.bufferMinutes,
      minNoticeMinutes: p.minNoticeMinutes,
      horizonDays: p.horizonDays,
      media: p.media,
      enabled: p.enabled,
      createdBy: p.createdBy,
      url: this.url(p.slug),
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  private async checkHosts(tenantId: string, hostIds: string[]) {
    const n = await this.db
      .for(tenantId)
      .users.countDocuments({ _id: { $in: hostIds }, status: 'active' });
    if (n !== hostIds.length) throw new AppError('VALIDATION_FAILED', 'Unknown host');
  }

  private slugTaken(e: unknown): never {
    if ((e as { code?: number }).code === 11000)
      throw new AppError('CONFLICT', 'That link is already taken. Try another.');
    throw e;
  }

  // ---------- hosts ----------

  /** Pages I host. */
  async list(ctx: TenantContext): Promise<BookingPage[]> {
    const docs = await this.db
      .for(ctx.tenantId)
      .booking_pages.find({ hostIds: ctx.userId }, { sort: { createdAt: -1 }, limit: 100 })
      .toArray();
    return docs.map((d) => this.toDto(d));
  }

  async create(ctx: TenantContext, input: unknown): Promise<BookingPage> {
    const req = parse(CreateBookingPageSchema, input);
    const hostIds = [...new Set([ctx.userId, ...req.hostIds])];
    await this.checkHosts(ctx.tenantId, hostIds);
    const now = new Date();
    const doc = await this.db
      .for(ctx.tenantId)
      .booking_pages.insertOne({
        ...req,
        hostIds,
        createdBy: ctx.userId,
        createdAt: now,
        updatedAt: now,
      })
      .catch((e) => this.slugTaken(e));
    this.changed(ctx.tenantId, hostIds);
    return this.toDto(doc);
  }

  private async mine(ctx: TenantContext, id: string) {
    const p = await this.db.for(ctx.tenantId).booking_pages.findOne({ _id: id });
    if (!p) throw notFound('Booking page');
    if (!p.hostIds.includes(ctx.userId)) throw forbidden('Only its hosts can change this page');
    return p;
  }

  async update(ctx: TenantContext, id: string, input: unknown): Promise<BookingPage> {
    const req = parse(UpdateBookingPageSchema, input);
    const before = await this.mine(ctx, id);
    if (req.hostIds) await this.checkHosts(ctx.tenantId, [...new Set(req.hostIds)]);
    const updated = await this.db
      .for(ctx.tenantId)
      .booking_pages.findOneAndUpdate(
        { _id: id },
        {
          $set: {
            ...req,
            ...(req.hostIds ? { hostIds: [...new Set(req.hostIds)] } : {}),
            updatedAt: new Date(),
          },
        },
        { returnDocument: 'after' },
      )
      .catch((e) => this.slugTaken(e));
    this.changed(ctx.tenantId, before.hostIds, updated!.hostIds);
    return this.toDto(updated!);
  }

  async remove(ctx: TenantContext, id: string): Promise<{ deleted: true }> {
    const p = await this.mine(ctx, id);
    await this.db.for(ctx.tenantId).booking_pages.deleteMany({ _id: id });
    this.changed(ctx.tenantId, p.hostIds);
    return { deleted: true };
  }

  // ---------- public ----------

  private async page(slug: string): Promise<BookingPageDoc> {
    const p = await this.rawDb
      .collection<BookingPageDoc>('booking_pages')
      .findOne({ slug: String(slug ?? '').toLowerCase(), enabled: true });
    if (!p) throw notFound('Booking page');
    return p;
  }

  private window(p: BookingPageDoc, now = Date.now()) {
    return {
      opens: new Date(now + p.minNoticeMinutes * 60_000),
      closes: new Date(now + p.horizonDays * DAY),
    };
  }

  private step(p: BookingPageDoc) {
    return p.durationMinutes <= 15 ? 15 : 30;
  }

  async view(slug: string): Promise<PublicBookingPage> {
    const p = await this.page(slug);
    const t = this.db.for(p.tenantId);
    const [users, tenant] = await Promise.all([
      t.users
        .find({ _id: { $in: p.hostIds } }, { projection: { displayName: 1, title: 1 } })
        .toArray(),
      this.db.tenants.findOne({ _id: p.tenantId }, { projection: { name: 1 } }),
    ]);
    const byId = new Map(users.map((u) => [u._id, u]));
    const w = this.window(p);
    return {
      slug: p.slug,
      title: p.title,
      description: p.description,
      durationMinutes: p.durationMinutes,
      mode: p.mode,
      hosts: p.hostIds
        .map((id) => byId.get(id))
        .filter((u) => !!u)
        .map((u) => ({ name: u!.displayName, title: u!.title ?? null })),
      organizationName: tenant?.name ?? 'SampConnect',
      media: p.media,
      opensAt: w.opens.toISOString(),
      closesAt: w.closes.toISOString(),
    };
  }

  async slots(slug: string, query: unknown): Promise<BookingSlotsResponse> {
    const q = parse(BookingSlotsQuerySchema, query);
    const p = await this.page(slug);
    const w = this.window(p);
    const from = Math.max(Date.parse(q.from), w.opens.getTime());
    const to = Math.min(Date.parse(q.to), w.closes.getTime() + p.durationMinutes * 60_000);
    if (to <= from) return { slots: [] };
    const { slots } = await this.meetings.freeSlots(p.tenantId, p.hostIds, {
      durationMinutes: p.durationMinutes,
      from: new Date(from),
      to: new Date(to),
      stepMinutes: this.step(p),
      limit: 1000,
      mode: p.mode,
      bufferMinutes: p.bufferMinutes,
    });
    return { slots: slots.map((s) => ({ startsAt: s.startsAt, endsAt: s.endsAt })) };
  }

  /** Books a slot: checks it is still free (under a lock), then schedules the meeting. */
  async book(slug: string, input: unknown): Promise<BookingConfirmation> {
    const req = parse(CreateBookingSchema, input);
    const p = await this.page(slug);
    const start = new Date(req.startsAt);
    const end = new Date(start.getTime() + p.durationMinutes * 60_000);
    const w = this.window(p);
    if (start < w.opens || start > w.closes || start.getTime() % (this.step(p) * 60_000) !== 0)
      throw new AppError('VALIDATION_FAILED', 'That time is not available. Pick another.');

    const lock = `lock:booking:${p.tenantId}:${p.hostIds.slice().sort().join(',')}:${start.getTime()}`;
    if ((await this.redis.set(lock, '1', 'PX', 20_000, 'NX')) !== 'OK')
      throw new AppError('CONFLICT', 'Someone is booking this time right now. Pick another.');
    try {
      const { slots } = await this.meetings.freeSlots(p.tenantId, p.hostIds, {
        durationMinutes: p.durationMinutes,
        from: start,
        to: end,
        stepMinutes: 1,
        limit: 1,
        mode: p.mode,
        bufferMinutes: p.bufferMinutes,
      });
      const slot = slots[0];
      if (!slot || slot.startsAt !== start.toISOString())
        throw new AppError('CONFLICT', 'That time was just taken. Pick another.');

      const hosts = p.mode === 'all' ? p.hostIds : [await this.leastBusy(p, slot.free, start)];
      const organizerId = p.mode === 'all' && hosts.includes(p.createdBy) ? p.createdBy : hosts[0]!;
      const ctx = await this.contextFor(p.tenantId, organizerId);
      const tz =
        (await this.db.for(p.tenantId).user_settings.findOne({ userId: organizerId }))?.workingHours
          .timeZone ?? 'UTC';
      const meeting = await this.meetings.create(ctx, {
        title: `${p.title}: ${req.name}`,
        agenda: [req.notes, `Booked through ${this.url(p.slug)}`].filter(Boolean).join('\n\n'),
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        timeZone: tz,
        media: p.media,
        attendeeIds: hosts.filter((h) => h !== organizerId),
        guests: [{ email: req.email, name: req.name }],
        remindMinutes: [10],
      });
      await this.meetings.notifyBooked(p.tenantId, meeting.meetingId, organizerId);
      const guest = meeting.guests?.[0];
      const { url } = await this.meetings.guestLink(ctx, meeting.meetingId, guest!.guestId);
      const names = await this.db
        .for(p.tenantId)
        .users.find({ _id: { $in: hosts } }, { projection: { displayName: 1 } })
        .toArray();
      return {
        startsAt: meeting.startsAt,
        endsAt: meeting.endsAt,
        title: p.title,
        hostNames: names.map((u) => u.displayName),
        joinUrl: url,
        emailed: await this.guests.emailEnabled(p.tenantId),
      };
    } finally {
      await this.redis.del(lock).catch(() => undefined);
    }
  }

  /** `any` mode: the free host with the fewest meetings that day (their local day). */
  private async leastBusy(p: BookingPageDoc, free: string[], start: Date): Promise<string> {
    const t = this.db.for(p.tenantId);
    let best = free[0]!;
    let bestCount = Infinity;
    for (const id of p.hostIds.filter((h) => free.includes(h))) {
      const tz = (await t.user_settings.findOne({ userId: id }))?.workingHours.timeZone ?? 'UTC';
      const lp = localParts(start.getTime(), tz);
      const dayStart = Math.floor((start.getTime() - lp.minutes * 60_000) / 60_000) * 60_000;
      const n = await t.meetings.countDocuments({
        status: 'scheduled',
        'attendees.userId': id,
        startsAt: { $gte: new Date(dayStart), $lt: new Date(dayStart + DAY) },
      });
      if (n < bestCount) {
        best = id;
        bestCount = n;
      }
    }
    return best;
  }

  /** Acts as the host who organizes the booked meeting (their own role and workspace). */
  private async contextFor(tenantId: string, userId: string): Promise<TenantContext> {
    const m = await this.db.for(tenantId).memberships.findOne({ userId });
    if (!m) throw new AppError('UNAVAILABLE', 'This booking page has no available host');
    return {
      tenantId,
      userId,
      sessionId: 'booking-page',
      deviceId: 'booking-page',
      role: m.role,
      workspaceId: m.workspaceId,
    };
  }
}
