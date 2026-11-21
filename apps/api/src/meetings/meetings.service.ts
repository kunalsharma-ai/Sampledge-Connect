import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { Db } from 'mongodb';
import type { Redis } from 'ioredis';
import {
  CancelMeetingRequestSchema,
  CreateMeetingRequestSchema,
  describeRecurrence,
  SERIES_HORIZON_DAYS,
  DEFAULT_WORKING_HOURS,
  FindTimesRequestSchema,
  ListMeetingsQuerySchema,
  RsvpRequestSchema,
  UpdateMeetingRequestSchema,
  WorkingHoursSchema,
  type FindTimesResponse,
  type Meeting,
  type MeetingPushData,
  type MeetingSystemMetadata,
  type Recurrence,
  type WorkingHours,
} from '@sampledge/contracts';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { AppError, forbidden, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import type { MeetingDoc, MeetingGuestDoc, MeetingSeriesDoc } from '../database/documents.js';
import { MONGO_DB } from '../database/database.module.js';
import { TenantDb, newId } from '../database/tenant-db.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { MessagesService } from '../messages/messages.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';
import { REDIS } from '../redis/redis.module.js';
import { CallsService } from '../calls/calls.service.js';
import { GuestsService } from './guests.service.js';
import { expand, validateRule, type SeriesAnchor } from './recurrence.js';
import { hhmmToMinutes, localParts, zonedToUtc } from './time.js';

const REMINDER_SWEEP_MS = 30_000;
const DAY_MS = 86_400_000;
/** Series changes are pushed to clients for meetings in this window (calendars refetch the rest). */
const BROADCAST_DAYS = 62;
type Scope = 'occurrence' | 'series';

export const toMeeting = (m: MeetingDoc): Meeting => ({
  meetingId: m._id,
  conversationId: m.conversationId,
  title: m.title,
  agenda: m.agenda,
  startsAt: m.startsAt.toISOString(),
  endsAt: m.endsAt.toISOString(),
  timeZone: m.timeZone,
  organizerId: m.organizerId,
  attendees: m.attendees.map((a) => ({
    userId: a.userId,
    response: a.response,
    optional: !!a.optional,
  })),
  media: m.media,
  remindMinutes: m.remindMinutes,
  status: m.status,
  guests: (m.guests ?? []).map((g) => ({
    guestId: g.guestId,
    email: g.email,
    name: g.name,
    response: g.response,
    invite: {
      status: g.invite.status,
      at: g.invite.at?.toISOString() ?? null,
      error: g.invite.error,
    },
  })),
  series: m.series
    ? {
        seriesId: m.series.seriesId,
        recurrence: m.series.recurrence,
        summary: m.series.summary,
        detached: m.series.detached,
      }
    : null,
  createdAt: m.createdAt.toISOString(),
  updatedAt: m.updatedAt.toISOString(),
});

type Interval = { s: number; e: number };

/**
 * Scheduled meetings, working hours and "find a time". A meeting always lives in a
 * conversation, and joining it joins that conversation's call (CallsService), so the
 * meeting chat, call and history stay in one place.
 */
@Injectable()
export class MeetingsService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger(MeetingsService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: TenantDb,
    @Inject(MONGO_DB) private readonly rawDb: Db,
    private readonly conversations: ConversationsService,
    private readonly messages: MessagesService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimePublisher,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly guests: GuestsService,
    private readonly calls: CallsService,
  ) {}

  onModuleInit() {
    if (this.cfg.NODE_ENV === 'test') return; // tests call sendDueReminders() directly
    this.timer = setInterval(() => {
      void this.sendDueReminders().catch(() => undefined);
      void this.extendSeries().catch((e) => this.log.warn(`series sweep failed: ${String(e)}`));
    }, REMINDER_SWEEP_MS);
    this.timer.unref();
  }
  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------- meetings ----------

  async create(ctx: TenantContext, input: unknown): Promise<Meeting> {
    const req = parse(CreateMeetingRequestSchema, input);
    const startsAt = new Date(req.startsAt);
    const endsAt = new Date(req.endsAt);
    if (endsAt.getTime() < Date.now())
      throw new AppError('VALIDATION_FAILED', 'This meeting would already be over');
    const optional = new Set(req.optionalAttendeeIds.filter((id) => id !== ctx.userId));
    const invited = [...new Set([...req.attendeeIds, ...optional])].filter(
      (id) => id !== ctx.userId,
    );

    const guests = await this.guests.prepare(ctx, req.guests);
    let conversationId: string;
    let attendeeIds: string[];
    if (req.conversationId) {
      await this.conversations.authorize(ctx, req.conversationId, 'message.send');
      const members = await this.conversations.memberIds(ctx.tenantId, req.conversationId);
      const missing = invited.filter((id) => !members.includes(id));
      if (missing.length)
        await this.conversations.addMembers(ctx, req.conversationId, { userIds: missing });
      conversationId = req.conversationId;
      attendeeIds = [...new Set([...members, ...invited])];
    } else {
      if (invited.length === 0 && guests.length === 0)
        throw new AppError('VALIDATION_FAILED', 'Invite at least one person');
      const conv = await this.conversations.createMeetingChat(ctx, req.title, invited);
      conversationId = conv.conversationId;
      attendeeIds = [ctx.userId, ...invited];
    }

    const attendees = [ctx.userId, ...attendeeIds.filter((id) => id !== ctx.userId)].map(
      (userId) => ({
        userId,
        response: userId === ctx.userId ? ('accepted' as const) : ('pending' as const),
        optional: optional.has(userId),
      }),
    );
    if (req.recurrence)
      return this.createSeries(ctx, req, req.recurrence, conversationId, attendees, guests);

    const now = new Date();
    const t = this.db.for(ctx.tenantId);
    const doc = await t.meetings.insertOne({
      conversationId,
      title: req.title,
      agenda: req.agenda,
      startsAt,
      endsAt,
      timeZone: req.timeZone,
      organizerId: ctx.userId,
      attendees,
      media: req.media,
      remindMinutes: [...new Set(req.remindMinutes)].sort((a, b) => b - a),
      remindersSent: [],
      status: 'scheduled',
      messageId: null,
      guests,
      sequence: 0,
      createdAt: now,
      updatedAt: now,
    });
    try {
      const msg = await this.messages.postSystem(
        ctx.tenantId,
        conversationId,
        ctx.userId,
        `Scheduled a meeting: ${req.title}`,
        { meeting: this.cardMetadata(doc, 'scheduled') },
      );
      await t.meetings.updateOne({ _id: doc._id }, { $set: { messageId: msg.messageId } });
      doc.messageId = msg.messageId;
    } catch (e) {
      this.log.warn(`meeting card for ${doc._id} not posted: ${String(e)}`);
    }
    this.broadcast(ctx.tenantId, doc);
    this.push(
      ctx.tenantId,
      doc,
      'invite',
      attendeeIds.filter((id) => id !== ctx.userId),
    );
    this.emailGuests(ctx.tenantId, doc, guests, 'invite');
    return toMeeting(doc);
  }

  async list(ctx: TenantContext, query: unknown): Promise<Meeting[]> {
    const q = parse(ListMeetingsQuerySchema, query);
    const docs = await this.db
      .for(ctx.tenantId)
      .meetings.find(
        {
          'attendees.userId': ctx.userId,
          startsAt: { $lt: new Date(q.to) },
          endsAt: { $gt: new Date(q.from) },
          ...(q.includeCancelled ? {} : { status: 'scheduled' as const }),
        },
        { sort: { startsAt: 1 }, limit: 500 },
      )
      .toArray();
    return docs.map(toMeeting);
  }

  async get(ctx: TenantContext, meetingId: string): Promise<Meeting> {
    return toMeeting(await this.load(ctx, meetingId));
  }

  async update(ctx: TenantContext, meetingId: string, input: unknown): Promise<Meeting> {
    const req = parse(UpdateMeetingRequestSchema, input);
    const m = await this.load(ctx, meetingId);
    if (m.organizerId !== ctx.userId) throw forbidden('Only the organizer can change this meeting');
    if (m.series && req.scope === 'series') return this.updateSeries(ctx, m, req);
    if (m.status === 'cancelled') throw new AppError('CONFLICT', 'This meeting was cancelled');
    if (req.recurrence)
      throw new AppError(
        'VALIDATION_FAILED',
        m.series
          ? 'Change the repeat rule for the whole series'
          : "A one-off meeting can't be made recurring. Schedule a new recurring meeting instead.",
      );
    if (m.series && (req.addGuests.length || req.removeGuestIds.length))
      throw new AppError('VALIDATION_FAILED', 'Change guests for the whole series');
    const startsAt = req.startsAt ? new Date(req.startsAt) : m.startsAt;
    const endsAt = req.endsAt ? new Date(req.endsAt) : m.endsAt;
    if (endsAt <= startsAt || endsAt.getTime() - startsAt.getTime() > 12 * 3_600_000)
      throw new AppError('VALIDATION_FAILED', 'endsAt must be after startsAt (max 12 hours)');
    const moved =
      startsAt.getTime() !== m.startsAt.getTime() || endsAt.getTime() !== m.endsAt.getTime();

    const removeIds = new Set(req.removeGuestIds);
    const removed = (m.guests ?? []).filter((g) => removeIds.has(g.guestId));
    const kept = (m.guests ?? []).filter((g) => !removeIds.has(g.guestId));
    const newGuests = await this.guests.prepare(ctx, req.addGuests, kept);
    const changed =
      moved ||
      (req.title !== undefined && req.title !== m.title) ||
      (req.agenda !== undefined && req.agenda !== m.agenda);
    const sequence = (m.sequence ?? 0) + (changed || removed.length ? 1 : 0);
    const guests: MeetingGuestDoc[] = [
      ...kept.map((g) => ({
        ...g,
        response: moved ? ('pending' as const) : g.response,
        ...(changed ? { invite: { ...g.invite, status: this.sendingStatus() } } : {}),
      })),
      ...newGuests,
    ];

    const add = req.addAttendeeIds.filter(
      (id) => id !== ctx.userId && !m.attendees.some((a) => a.userId === id),
    );
    if (add.length) {
      const members = await this.conversations.memberIds(ctx.tenantId, m.conversationId);
      const missing = add.filter((id) => !members.includes(id));
      if (missing.length)
        await this.conversations.addMembers(ctx, m.conversationId, { userIds: missing });
    }
    const attendees = [
      ...m.attendees.map((a) => ({
        ...a,
        response: moved && a.userId !== m.organizerId ? ('pending' as const) : a.response,
      })),
      ...add.map((userId) => ({ userId, response: 'pending' as const, optional: false })),
    ];
    const updated = await this.db.for(ctx.tenantId).meetings.findOneAndUpdate(
      { _id: m._id, status: 'scheduled' },
      {
        $set: {
          title: req.title ?? m.title,
          agenda: req.agenda ?? m.agenda,
          startsAt,
          endsAt,
          timeZone: req.timeZone ?? m.timeZone,
          media: req.media ?? m.media,
          remindMinutes: req.remindMinutes
            ? [...new Set(req.remindMinutes)].sort((a, b) => b - a)
            : m.remindMinutes,
          ...(moved ? { remindersSent: [] } : {}),
          attendees,
          guests,
          sequence,
          ...(m.series && changed ? { 'series.detached': true } : {}),
          updatedAt: new Date(),
        },
      },
      { returnDocument: 'after' },
    );
    if (!updated) throw new AppError('CONFLICT', 'This meeting was cancelled');
    const scope: Scope = updated.series ? 'occurrence' : 'series';
    await this.refreshCard(ctx.tenantId, updated, 'updated');
    this.broadcast(ctx.tenantId, updated);
    const others = updated.attendees.map((a) => a.userId).filter((id) => id !== ctx.userId);
    this.push(
      ctx.tenantId,
      updated,
      'updated',
      others.filter((id) => !add.includes(id)),
    );
    this.push(ctx.tenantId, updated, 'invite', add);
    if (changed)
      this.emailGuests(
        ctx.tenantId,
        updated,
        (updated.guests ?? []).filter((g) => !newGuests.some((n) => n.guestId === g.guestId)),
        'updated',
        scope,
      );
    this.emailGuests(ctx.tenantId, updated, newGuests, 'invite');
    if (removed.length) {
      this.emailGuests(ctx.tenantId, updated, removed, 'cancelled-for-you');
      for (const g of removed)
        await this.calls
          .removeGuest(ctx.tenantId, updated.conversationId, g.guestId)
          .catch(() => undefined);
    }
    return toMeeting(updated);
  }

  async cancel(ctx: TenantContext, meetingId: string, input?: unknown): Promise<Meeting> {
    const { scope } = parse(CancelMeetingRequestSchema, input ?? undefined);
    const m = await this.load(ctx, meetingId);
    if (m.organizerId !== ctx.userId) throw forbidden('Only the organizer can cancel this meeting');
    if (m.series && scope === 'series') return this.cancelSeries(ctx, m);
    if (m.status === 'cancelled') return toMeeting(m);
    const updated = await this.db.for(ctx.tenantId).meetings.findOneAndUpdate(
      { _id: m._id },
      {
        $set: { status: 'cancelled', updatedAt: new Date() },
        $inc: { sequence: 1 },
      },
      { returnDocument: 'after' },
    );
    await this.refreshCard(ctx.tenantId, updated!, 'cancelled');
    this.broadcast(ctx.tenantId, updated!);
    this.push(
      ctx.tenantId,
      updated!,
      'cancelled',
      updated!.attendees.map((a) => a.userId).filter((id) => id !== ctx.userId),
    );
    this.emailGuests(
      ctx.tenantId,
      updated!,
      updated!.guests ?? [],
      'cancelled',
      updated!.series ? 'occurrence' : 'series',
    );
    return toMeeting(updated!);
  }

  /** Tells the organizer (on every device) that someone booked time with them. */
  async notifyBooked(tenantId: string, meetingId: string, organizerId: string) {
    const m = await this.db.for(tenantId).meetings.findOne({ _id: meetingId });
    if (m) this.push(tenantId, m, 'invite', [organizerId]);
  }

  // ---------- external guests ----------

  /** The organizer's copy of a guest's personal join link. */
  async guestLink(ctx: TenantContext, meetingId: string, guestId: string) {
    return this.guests.link(ctx, await this.load(ctx, meetingId), guestId);
  }

  /** Sends a guest their invite again (after fixing SMTP, or if they lost it). */
  async resendGuestInvite(ctx: TenantContext, meetingId: string, guestId: string) {
    const m = await this.load(ctx, meetingId);
    if (m.organizerId !== ctx.userId)
      throw forbidden('Only the organizer can resend guest invites');
    if (m.status === 'cancelled') throw new AppError('CONFLICT', 'This meeting was cancelled');
    const g = m.guests?.find((x) => x.guestId === guestId);
    if (!g) throw notFound('Guest');
    if (!this.guests.emailEnabled)
      throw new AppError(
        'UNAVAILABLE',
        "Email isn't set up on this server yet. Copy the guest's link and send it yourself.",
      );
    const updated = await this.db
      .for(ctx.tenantId)
      .meetings.findOneAndUpdate(
        { _id: m._id, 'guests.guestId': guestId },
        { $set: { 'guests.$.invite': { status: 'sending', at: new Date(), error: null } } },
        { returnDocument: 'after' },
      );
    this.broadcast(ctx.tenantId, updated!);
    this.emailGuests(ctx.tenantId, updated!, [g], 'invite');
    return toMeeting(updated!);
  }

  /** The guest page's RSVP, broadcast to attendees like any other change. */
  guestRsvp(token: string, input: unknown) {
    return this.guests.rsvp(token, input, toMeeting);
  }

  private sendingStatus(): MeetingGuestDoc['invite']['status'] {
    return this.guests.emailEnabled ? 'sending' : 'not_configured';
  }

  private emailGuests(
    tenantId: string,
    m: MeetingDoc,
    guests: MeetingGuestDoc[],
    kind: Parameters<GuestsService['email']>[3],
    scope: Scope = 'series',
  ) {
    if (!guests.length) return;
    this.guests.email(
      tenantId,
      m,
      guests,
      kind,
      () => {
        // Show the delivery outcome (sent / failed) in everyone's meeting details.
        void this.db
          .for(tenantId)
          .meetings.findOne({ _id: m._id })
          .then((fresh) => fresh && this.broadcast(tenantId, fresh))
          .catch(() => undefined);
      },
      scope,
    );
  }

  async rsvp(ctx: TenantContext, meetingId: string, input: unknown): Promise<Meeting> {
    const { response, scope } = parse(RsvpRequestSchema, input);
    const m = await this.load(ctx, meetingId);
    if (!m.attendees.some((a) => a.userId === ctx.userId))
      throw forbidden('You are not invited to this meeting');
    if (m.status === 'cancelled') throw new AppError('CONFLICT', 'This meeting was cancelled');
    if (m.series && scope === 'series') {
      const t = this.db.for(ctx.tenantId);
      const set = { $set: { 'attendees.$.response': response, updatedAt: new Date() } };
      const filter = {
        'series.seriesId': m.series.seriesId,
        'attendees.userId': ctx.userId,
        status: 'scheduled' as const,
        endsAt: { $gt: new Date() },
      };
      await t.meetings.updateMany(filter, set);
      await t.meeting_series.updateOne(
        { _id: m.series.seriesId, 'attendees.userId': ctx.userId },
        { $set: { 'attendees.$.response': response } },
      );
      await this.broadcastSeries(ctx.tenantId, m.series.seriesId);
      return toMeeting((await t.meetings.findOne({ _id: m._id }))!);
    }
    const updated = await this.db
      .for(ctx.tenantId)
      .meetings.findOneAndUpdate(
        { _id: m._id, 'attendees.userId': ctx.userId },
        { $set: { 'attendees.$.response': response, updatedAt: new Date() } },
        { returnDocument: 'after' },
      );
    this.broadcast(ctx.tenantId, updated!);
    return toMeeting(updated!);
  }

  // ---------- availability ----------

  async getWorkingHours(ctx: TenantContext, userId = ctx.userId): Promise<WorkingHours> {
    const s = await this.db.for(ctx.tenantId).user_settings.findOne({ userId });
    return s?.workingHours ?? DEFAULT_WORKING_HOURS;
  }

  async setWorkingHours(ctx: TenantContext, input: unknown): Promise<WorkingHours> {
    const wh = parse(WorkingHoursSchema, input);
    await this.db
      .for(ctx.tenantId)
      .user_settings.updateOne(
        { userId: ctx.userId },
        { $set: { workingHours: wh, updatedAt: new Date() } },
        { upsert: true },
      );
    return wh;
  }

  /**
   * Free slots where the caller and every required attendee are inside their own working
   * hours (each in their own time zone) and not in another meeting they haven't declined.
   * Busy blocks are returned without titles, so nobody learns what others are doing.
   */
  async findTimes(ctx: TenantContext, input: unknown): Promise<FindTimesResponse> {
    const req = parse(FindTimesRequestSchema, input);
    const people = [...new Set([ctx.userId, ...req.attendeeIds])];
    const { slots, busy } = await this.freeSlots(ctx.tenantId, people, {
      durationMinutes: req.durationMinutes,
      from: new Date(req.from),
      to: new Date(req.to),
      stepMinutes: req.stepMinutes,
      limit: req.limit,
      mode: 'all',
      ignoreMeetingId: req.ignoreMeetingId,
    });
    return {
      slots: slots.map((x) => ({ startsAt: x.startsAt, endsAt: x.endsAt })),
      busy: Object.fromEntries(
        [...busy].map(([who, list]) => [
          who,
          list
            .sort((x, y) => x.s - y.s)
            .map((b) => ({
              startsAt: new Date(b.s).toISOString(),
              endsAt: new Date(b.e).toISOString(),
            })),
        ]),
      ),
    };
  }

  /**
   * Slots inside each person's working hours (in their own time zone) where they aren't in
   * another meeting they haven't declined. `all`: everyone must be free; `any`: at least one
   * (`free` lists who). `bufferMinutes` keeps that much time clear around other meetings.
   */
  async freeSlots(
    tenantId: string,
    people: string[],
    o: {
      durationMinutes: number;
      from: Date;
      to: Date;
      stepMinutes: number;
      limit: number;
      mode: 'all' | 'any';
      bufferMinutes?: number;
      ignoreMeetingId?: string;
    },
  ) {
    const t = this.db.for(tenantId);
    const found = await t.users.countDocuments({ _id: { $in: people }, status: 'active' });
    if (found !== people.length) throw new AppError('VALIDATION_FAILED', 'Unknown attendee');
    const from = o.from.getTime();
    const to = o.to.getTime();
    const pad = (o.bufferMinutes ?? 0) * 60_000;

    const [settings, meetings] = await Promise.all([
      t.user_settings.find({ userId: { $in: people } }).toArray(),
      t.meetings
        .find({
          status: 'scheduled',
          'attendees.userId': { $in: people },
          startsAt: { $lt: new Date(to + pad) },
          endsAt: { $gt: new Date(from - pad) },
          ...(o.ignoreMeetingId ? { _id: { $ne: o.ignoreMeetingId } } : {}),
        })
        .toArray(),
    ]);
    const hours = new Map(people.map((p) => [p, DEFAULT_WORKING_HOURS as WorkingHours]));
    for (const s of settings) hours.set(s.userId, s.workingHours);
    const busy = new Map<string, Interval[]>(people.map((p) => [p, []]));
    for (const m of meetings)
      for (const a of m.attendees)
        if (busy.has(a.userId) && a.response !== 'declined')
          busy.get(a.userId)!.push({ s: m.startsAt.getTime(), e: m.endsAt.getTime() });

    const inHours = (who: string, s: number, e: number) => {
      const wh = hours.get(who)!;
      const a = localParts(s, wh.timeZone);
      const b = localParts(e - 1, wh.timeZone);
      if (a.year !== b.year || a.month !== b.month || a.day !== b.day) return false;
      const endMin = b.minutes + 1;
      return wh.days.some(
        (d) =>
          d.day === a.weekday &&
          hhmmToMinutes(d.start) <= a.minutes &&
          endMin <= hhmmToMinutes(d.end),
      );
    };
    const freeAt = (p: string, s: number, e: number) =>
      inHours(p, s, e) && !busy.get(p)!.some((b) => b.s < e + pad && b.e > s - pad);

    const step = o.stepMinutes * 60_000;
    const dur = o.durationMinutes * 60_000;
    const earliest = Math.max(from, Date.now());
    const slots: { startsAt: string; endsAt: string; free: string[] }[] = [];
    for (let s = Math.ceil(earliest / step) * step; s + dur <= to; s += step) {
      const e = s + dur;
      const free = people.filter((p) => freeAt(p, s, e));
      if (o.mode === 'all' ? free.length === people.length : free.length > 0) {
        slots.push({
          startsAt: new Date(s).toISOString(),
          endsAt: new Date(e).toISOString(),
          free,
        });
        if (slots.length >= o.limit) break;
      }
    }
    return { slots, busy };
  }

  // ---------- reminders ----------

  /** Sends reminders that have come due. Runs every 30 s; one replica at a time. */
  async sendDueReminders(now = new Date()): Promise<number> {
    if (this.cfg.NODE_ENV !== 'test') {
      const ok = await this.redis.set(
        'lock:meetings:reminders',
        '1',
        'PX',
        REMINDER_SWEEP_MS - 1000,
        'NX',
      );
      if (ok !== 'OK') return 0;
    }
    const col = this.rawDb.collection<MeetingDoc>('meetings');
    const due = await col
      .find({
        status: 'scheduled',
        startsAt: {
          $gt: new Date(now.getTime() - 60_000),
          $lte: new Date(now.getTime() + 1440 * 60_000),
        },
      })
      .limit(1000)
      .toArray();
    let sent = 0;
    for (const m of due) {
      for (const minutes of m.remindMinutes) {
        if (m.remindersSent.includes(minutes)) continue;
        if (m.startsAt.getTime() - minutes * 60_000 > now.getTime()) continue;
        // Claim it so a retry or another replica can't send it twice.
        const claimed = await col.updateOne(
          {
            _id: m._id,
            tenantId: m.tenantId,
            remindersSent: { $ne: minutes },
            startsAt: m.startsAt,
          },
          { $addToSet: { remindersSent: minutes } },
        );
        if (!claimed.modifiedCount) continue;
        sent++;
        const targets = m.attendees.filter((a) => a.response !== 'declined').map((a) => a.userId);
        const meeting = toMeeting(m);
        for (const userId of targets)
          this.realtime.toUser(m.tenantId, userId, 'meeting:reminder', {
            meeting,
            minutesBefore: minutes,
          });
        this.push(m.tenantId, m, 'reminder', targets, minutes);
      }
    }
    return sent;
  }

  // ---------- recurring meetings ----------

  private horizon(from = Date.now()) {
    return new Date(Math.max(from, Date.now()) + SERIES_HORIZON_DAYS * DAY_MS);
  }

  private occurrenceDoc(
    s: MeetingSeriesDoc,
    startsAt: Date,
    now = new Date(),
  ): Omit<MeetingDoc, '_id' | 'tenantId'> {
    return {
      conversationId: s.conversationId,
      title: s.title,
      agenda: s.agenda,
      startsAt,
      endsAt: new Date(startsAt.getTime() + s.durationMinutes * 60_000),
      timeZone: s.timeZone,
      organizerId: s.organizerId,
      attendees: s.attendees.map((a) => ({ ...a })),
      media: s.media,
      remindMinutes: s.remindMinutes,
      remindersSent: [],
      status: 'scheduled',
      messageId: null,
      guests: s.guests.map((g) => ({ ...g, invite: { ...g.invite } })),
      sequence: s.sequence,
      series: {
        seriesId: s._id,
        originalStartsAt: startsAt,
        detached: false,
        recurrence: s.recurrence,
        summary: this.summary(s),
      },
      createdAt: now,
      updatedAt: now,
    };
  }

  private summary(s: Pick<MeetingSeriesDoc, 'recurrence' | 'anchorStartsAt' | 'timeZone'>) {
    return describeRecurrence(s.recurrence, s.anchorStartsAt.toISOString(), s.timeZone);
  }

  /** Expands a rule from an anchor, or explains why it has no meetings. */
  private plan(rule: Recurrence, anchor: SeriesAnchor, after: Date | null = null) {
    const bad = validateRule(rule, anchor);
    if (bad) throw new AppError('VALIDATION_FAILED', bad);
    const out = expand(rule, anchor, this.horizon(anchor.startsAt.getTime()), after);
    if (!out.starts.length)
      throw new AppError('VALIDATION_FAILED', 'This repeat rule has no upcoming meetings');
    return out;
  }

  private async createSeries(
    ctx: TenantContext,
    req: {
      title: string;
      agenda: string;
      startsAt: string;
      endsAt: string;
      timeZone: string;
      media: 'audio' | 'video';
      remindMinutes: number[];
    },
    rule: Recurrence,
    conversationId: string,
    attendees: MeetingDoc['attendees'],
    guests: MeetingGuestDoc[],
  ): Promise<Meeting> {
    const requested = new Date(req.startsAt);
    const durationMinutes = (Date.parse(req.endsAt) - requested.getTime()) / 60_000;
    const { starts, complete } = this.plan(rule, { startsAt: requested, timeZone: req.timeZone });
    const now = new Date();
    const t = this.db.for(ctx.tenantId);
    const series = await t.meeting_series.insertOne({
      _id: newId(),
      conversationId,
      organizerId: ctx.userId,
      title: req.title,
      agenda: req.agenda,
      timeZone: req.timeZone,
      media: req.media,
      remindMinutes: [...new Set(req.remindMinutes)].sort((a, b) => b - a),
      recurrence: rule,
      anchorStartsAt: starts[0]!,
      durationMinutes,
      attendees,
      guests,
      status: 'active',
      lastStartsAt: starts.at(-1)!,
      complete,
      messageId: null,
      sequence: 0,
      createdAt: now,
      updatedAt: now,
    });
    const docs = await t.meetings.insertMany(
      starts.map((st) => this.occurrenceDoc(series, st, now)),
    );
    const first = docs[0]!;
    try {
      const msg = await this.messages.postSystem(
        ctx.tenantId,
        conversationId,
        ctx.userId,
        `Scheduled a recurring meeting: ${req.title} (${this.summary(series)})`,
        { meeting: this.cardMetadata(first, 'scheduled', series) },
      );
      await t.meeting_series.updateOne({ _id: series._id }, { $set: { messageId: msg.messageId } });
    } catch (e) {
      this.log.warn(`series card for ${series._id} not posted: ${String(e)}`);
    }
    await this.broadcastSeries(ctx.tenantId, series._id);
    this.push(
      ctx.tenantId,
      first,
      'invite',
      attendees.map((a) => a.userId).filter((id) => id !== ctx.userId),
    );
    this.emailGuests(ctx.tenantId, first, guests, 'invite', 'series');
    return toMeeting(first);
  }

  private async loadSeries(tenantId: string, seriesId: string) {
    const s = await this.db.for(tenantId).meeting_series.findOne({ _id: seriesId });
    if (!s) throw notFound('Meeting series');
    return s;
  }

  /** Upcoming meetings of a series (not started yet). */
  private upcoming(tenantId: string, seriesId: string, now = new Date()) {
    return this.db
      .for(tenantId)
      .meetings.find(
        { 'series.seriesId': seriesId, startsAt: { $gt: now } },
        { sort: { startsAt: 1 } },
      )
      .toArray();
  }

  /**
   * Changes every meeting of the series that hasn't started. Moving the time (or changing the
   * rule) recreates the upcoming meetings from the new rule, so their answers reset and
   * one-off changes to them are replaced. Other changes keep each meeting's answers.
   */
  private async updateSeries(
    ctx: TenantContext,
    m: MeetingDoc,
    req: ReturnType<typeof UpdateMeetingRequestSchema.parse>,
  ): Promise<Meeting> {
    const t = this.db.for(ctx.tenantId);
    const s = await this.loadSeries(ctx.tenantId, m.series!.seriesId);
    if (s.status === 'cancelled')
      throw new AppError('CONFLICT', 'This meeting series was cancelled');
    const now = new Date();
    const newStart = req.startsAt ? new Date(req.startsAt) : m.startsAt;
    const newEnd = req.endsAt ? new Date(req.endsAt) : m.endsAt;
    if (newEnd <= newStart || newEnd.getTime() - newStart.getTime() > 12 * 3_600_000)
      throw new AppError('VALIDATION_FAILED', 'endsAt must be after startsAt (max 12 hours)');
    const timeZone = req.timeZone ?? s.timeZone;
    const durationMinutes = (newEnd.getTime() - newStart.getTime()) / 60_000;
    const retime =
      newStart.getTime() !== m.startsAt.getTime() ||
      durationMinutes !== s.durationMinutes ||
      !!req.recurrence ||
      timeZone !== s.timeZone;

    const removeIds = new Set(req.removeGuestIds);
    const removed = s.guests.filter((g) => removeIds.has(g.guestId));
    const kept = s.guests.filter((g) => !removeIds.has(g.guestId));
    const newGuests = await this.guests.prepare(ctx, req.addGuests, kept);
    const contentChanged =
      retime ||
      (req.title !== undefined && req.title !== s.title) ||
      (req.agenda !== undefined && req.agenda !== s.agenda);

    const add = req.addAttendeeIds.filter(
      (id) => id !== ctx.userId && !s.attendees.some((a) => a.userId === id),
    );
    if (add.length) {
      const members = await this.conversations.memberIds(ctx.tenantId, s.conversationId);
      const missing = add.filter((id) => !members.includes(id));
      if (missing.length)
        await this.conversations.addMembers(ctx, s.conversationId, { userIds: missing });
    }
    const reset = <T extends { response: string }>(x: T, keep: boolean) =>
      retime && !keep ? { ...x, response: 'pending' as const } : x;
    const attendees = [
      ...s.attendees.map((a) => reset(a, a.userId === s.organizerId)),
      ...add.map((userId) => ({ userId, response: 'pending' as const, optional: false })),
    ];
    const invite = (g: MeetingGuestDoc): MeetingGuestDoc =>
      contentChanged
        ? {
            ...g,
            invite: {
              ...g.invite,
              status: this.guests.emailEnabled ? 'sending' : 'not_configured',
            },
          }
        : g;
    const guests = [...kept.map((g) => invite(reset(g, false))), ...newGuests];

    let template: Partial<MeetingSeriesDoc> = {
      title: req.title ?? s.title,
      agenda: req.agenda ?? s.agenda,
      media: req.media ?? s.media,
      remindMinutes: req.remindMinutes
        ? [...new Set(req.remindMinutes)].sort((a, b) => b - a)
        : s.remindMinutes,
      attendees,
      guests,
      sequence: s.sequence + (contentChanged || removed.length ? 1 : 0),
      updatedAt: now,
    };
    const before = await this.upcoming(ctx.tenantId, s._id, now);
    let result: MeetingDoc | null = null;

    if (retime) {
      // Same shift on the local calendar: days moved, and the new local start time.
      const dayOf = (d: Date, tz: string) => {
        const p = localParts(d.getTime(), tz);
        return Date.UTC(p.year, p.month - 1, p.day) / DAY_MS;
      };
      const dayDelta = dayOf(newStart, timeZone) - dayOf(m.startsAt, s.timeZone);
      const minutes = localParts(newStart.getTime(), timeZone).minutes;
      let rule = req.recurrence ?? s.recurrence;
      if (
        !req.recurrence &&
        rule.frequency === 'weekly' &&
        dayDelta % 7 !== 0 &&
        rule.weekdays?.length
      )
        rule = { ...rule, weekdays: rule.weekdays.map((d) => (((d + dayDelta) % 7) + 7) % 7) };
      // A new rule starts from the next meeting; the same rule keeps its first meeting.
      const base = req.recurrence ? (before[0]?.startsAt ?? m.startsAt) : s.anchorStartsAt;
      const day = new Date((dayOf(base, s.timeZone) + dayDelta) * DAY_MS);
      const anchorGuess = new Date(
        zonedToUtc(
          day.getUTCFullYear(),
          day.getUTCMonth() + 1,
          day.getUTCDate(),
          minutes,
          timeZone,
        ),
      );
      const all = this.plan(rule, { startsAt: anchorGuess, timeZone });
      const future = all.starts.filter((d) => d.getTime() > now.getTime());
      if (!future.length)
        throw new AppError(
          'VALIDATION_FAILED',
          'This change leaves the series with no upcoming meetings',
        );
      template = {
        ...template,
        recurrence: rule,
        timeZone,
        durationMinutes,
        anchorStartsAt: all.starts[0]!,
        lastStartsAt: all.starts.at(-1)!,
        complete: all.complete,
      };
      const next = { ...s, ...template } as MeetingSeriesDoc;
      await t.meeting_series.updateOne({ _id: s._id }, { $set: template });
      await t.meetings.deleteMany({ 'series.seriesId': s._id, startsAt: { $gt: now } });
      for (const old of before)
        this.broadcastDto(ctx.tenantId, old, { ...toMeeting(old), status: 'cancelled' });
      const docs = await t.meetings.insertMany(future.map((d) => this.occurrenceDoc(next, d, now)));
      // Hand back the meeting that took the edited one's place (same position in the series).
      const pos = before.findIndex((o) => o._id === m._id);
      result = docs[Math.max(0, Math.min(pos, docs.length - 1))]!;
    } else {
      await t.meeting_series.updateOne({ _id: s._id }, { $set: template });
      for (const o of before) {
        const answers = new Map(o.attendees.map((a) => [a.userId, a.response]));
        const guestAnswers = new Map((o.guests ?? []).map((g) => [g.guestId, g.response]));
        await t.meetings.updateOne(
          { _id: o._id },
          {
            $set: {
              title: template.title!,
              agenda: template.agenda!,
              media: template.media!,
              remindMinutes: template.remindMinutes!,
              attendees: attendees.map((a) => ({
                ...a,
                response: answers.get(a.userId) ?? a.response,
              })),
              guests: guests.map((g) => ({
                ...g,
                response: guestAnswers.get(g.guestId) ?? g.response,
              })),
              sequence: template.sequence!,
              updatedAt: now,
            },
          },
        );
      }
      result = await t.meetings.findOne({ _id: m._id });
    }

    const fresh = { ...s, ...template } as MeetingSeriesDoc;
    const first = (await this.upcoming(ctx.tenantId, s._id, now))[0] ?? result!;
    await this.refreshSeriesCard(ctx.tenantId, fresh, first, 'updated');
    await this.broadcastSeries(ctx.tenantId, s._id);
    const others = attendees.map((a) => a.userId).filter((id) => id !== ctx.userId);
    this.push(
      ctx.tenantId,
      first,
      'updated',
      others.filter((id) => !add.includes(id)),
    );
    this.push(ctx.tenantId, first, 'invite', add);
    if (contentChanged)
      this.emailGuests(
        ctx.tenantId,
        first,
        guests.filter((g) => !newGuests.includes(g)),
        'updated',
      );
    this.emailGuests(ctx.tenantId, first, newGuests, 'invite');
    if (removed.length) {
      this.emailGuests(ctx.tenantId, first, removed, 'cancelled-for-you');
      for (const g of removed)
        await this.calls
          .removeGuest(ctx.tenantId, s.conversationId, g.guestId)
          .catch(() => undefined);
    }
    return toMeeting(result!);
  }

  /** Cancels every meeting of the series that hasn't started (past ones stay as history). */
  private async cancelSeries(ctx: TenantContext, m: MeetingDoc): Promise<Meeting> {
    const t = this.db.for(ctx.tenantId);
    const s = await this.loadSeries(ctx.tenantId, m.series!.seriesId);
    if (s.status === 'cancelled') return toMeeting(m);
    const now = new Date();
    await t.meeting_series.updateOne(
      { _id: s._id },
      { $set: { status: 'cancelled', updatedAt: now }, $inc: { sequence: 1 } },
    );
    await t.meetings.updateMany(
      { 'series.seriesId': s._id, startsAt: { $gt: now }, status: 'scheduled' },
      { $set: { status: 'cancelled', updatedAt: now }, $inc: { sequence: 1 } },
    );
    const fresh = (await t.meeting_series.findOne({ _id: s._id }))!;
    const self = (await t.meetings.findOne({ _id: m._id }))!;
    await this.refreshSeriesCard(ctx.tenantId, fresh, self, 'cancelled');
    await this.broadcastSeries(ctx.tenantId, s._id, true);
    this.push(
      ctx.tenantId,
      self,
      'cancelled',
      s.attendees.map((a) => a.userId).filter((id) => id !== ctx.userId),
    );
    this.emailGuests(ctx.tenantId, self, fresh.guests, 'cancelled', 'series');
    return toMeeting(self);
  }

  /**
   * Creates more meetings for open-ended series as time passes, so there are always about
   * SERIES_HORIZON_DAYS of them ahead. Runs with the reminder sweep; one replica at a time.
   */
  async extendSeries(now = new Date()): Promise<number> {
    if (this.cfg.NODE_ENV !== 'test') {
      const ok = await this.redis.set('lock:meetings:series', '1', 'PX', 5 * 60_000, 'NX');
      if (ok !== 'OK') return 0;
    }
    const col = this.rawDb.collection<MeetingSeriesDoc>('meeting_series');
    const due = await col
      .find({
        status: 'active',
        complete: false,
        lastStartsAt: { $lt: new Date(now.getTime() + (SERIES_HORIZON_DAYS - 1) * DAY_MS) },
      })
      .limit(100)
      .toArray();
    let created = 0;
    for (const s of due) {
      const out = expand(
        s.recurrence,
        { startsAt: s.anchorStartsAt, timeZone: s.timeZone },
        new Date(now.getTime() + SERIES_HORIZON_DAYS * DAY_MS),
        s.lastStartsAt,
      );
      const claimed = await col.updateOne(
        { _id: s._id, lastStartsAt: s.lastStartsAt },
        {
          $set: {
            lastStartsAt: out.starts.at(-1) ?? s.lastStartsAt,
            complete: out.complete,
          },
        },
      );
      if (!claimed.modifiedCount || !out.starts.length) continue;
      await this.db
        .for(s.tenantId)
        .meetings.insertMany(out.starts.map((d) => this.occurrenceDoc(s, d, now)));
      created += out.starts.length;
    }
    if (this.cfg.NODE_ENV !== 'test') await this.redis.del('lock:meetings:series');
    return created;
  }

  /** Sends the series' meetings in the next BROADCAST_DAYS to everyone invited. */
  private async broadcastSeries(tenantId: string, seriesId: string, includeCancelled = false) {
    const now = Date.now();
    const docs = await this.db
      .for(tenantId)
      .meetings.find(
        {
          'series.seriesId': seriesId,
          endsAt: { $gt: new Date(now - DAY_MS) },
          startsAt: { $lt: new Date(now + BROADCAST_DAYS * DAY_MS) },
          ...(includeCancelled ? {} : { status: 'scheduled' as const }),
        },
        { sort: { startsAt: 1 }, limit: 100 },
      )
      .toArray();
    for (const d of docs) this.broadcast(tenantId, d);
  }

  private broadcastDto(tenantId: string, m: MeetingDoc, dto: Meeting) {
    for (const a of m.attendees) this.realtime.toUser(tenantId, a.userId, 'meeting:upsert', dto);
  }

  private async refreshSeriesCard(
    tenantId: string,
    s: MeetingSeriesDoc,
    next: MeetingDoc,
    status: MeetingSystemMetadata['status'],
  ) {
    if (!s.messageId) return;
    const text =
      status === 'cancelled'
        ? `Cancelled the recurring meeting: ${s.title}`
        : `Updated the recurring meeting: ${s.title} (${this.summary(s)})`;
    await this.messages
      .updateSystem(tenantId, s.messageId, text, { meeting: this.cardMetadata(next, status, s) })
      .catch((e) => this.log.warn(`series card update failed: ${String(e)}`));
  }

  // ---------- internals ----------

  private async load(ctx: TenantContext, meetingId: string): Promise<MeetingDoc> {
    const m = await this.db.for(ctx.tenantId).meetings.findOne({ _id: meetingId });
    if (!m) throw notFound('Meeting');
    if (m.attendees.some((a) => a.userId === ctx.userId)) return m;
    // Otherwise visible only to people who can read its conversation.
    await this.conversations.authorize(ctx, m.conversationId, 'conversation.read').catch(() => {
      throw notFound('Meeting');
    });
    return m;
  }

  private broadcast(tenantId: string, m: MeetingDoc) {
    const dto = toMeeting(m);
    for (const a of m.attendees) this.realtime.toUser(tenantId, a.userId, 'meeting:upsert', dto);
  }

  private cardMetadata(
    m: MeetingDoc,
    status: MeetingSystemMetadata['status'],
    series?: MeetingSeriesDoc,
  ): MeetingSystemMetadata {
    return {
      meetingId: m._id,
      title: m.title,
      startsAt: m.startsAt.toISOString(),
      endsAt: m.endsAt.toISOString(),
      organizerId: m.organizerId,
      status,
      ...(series ? { seriesId: series._id, recurrence: this.summary(series) } : {}),
    };
  }

  private async refreshCard(
    tenantId: string,
    m: MeetingDoc,
    status: MeetingSystemMetadata['status'],
  ) {
    if (!m.messageId && m.series) {
      // One meeting of a series changed on its own: say so in the chat, with its own card.
      const when = m.startsAt.toLocaleString('en-GB', {
        timeZone: m.timeZone,
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      });
      try {
        const msg = await this.messages.postSystem(
          tenantId,
          m.conversationId,
          m.organizerId,
          `${status === 'cancelled' ? 'Cancelled' : 'Changed'} one meeting of ${m.title}: ${when}`,
          { meeting: this.cardMetadata(m, status) },
        );
        await this.db
          .for(tenantId)
          .meetings.updateOne({ _id: m._id }, { $set: { messageId: msg.messageId } });
      } catch (e) {
        this.log.warn(`occurrence card for ${m._id} not posted: ${String(e)}`);
      }
      return;
    }
    if (!m.messageId) return;
    const text =
      status === 'cancelled'
        ? `Cancelled the meeting: ${m.title}`
        : `Updated the meeting: ${m.title}`;
    await this.messages
      .updateSystem(tenantId, m.messageId, text, { meeting: this.cardMetadata(m, status) })
      .catch((e) => this.log.warn(`meeting card update failed: ${String(e)}`));
  }

  private push(
    tenantId: string,
    m: MeetingDoc,
    event: MeetingPushData['event'],
    userIds: string[],
    minutes?: number,
  ) {
    if (!userIds.length) return;
    const when = m.startsAt.toLocaleString('en-GB', {
      timeZone: m.timeZone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
    const body =
      event === 'reminder'
        ? minutes === 0
          ? 'Starting now'
          : `Starts in ${minutes} min`
        : event === 'invite'
          ? `You're invited · ${when}`
          : event === 'cancelled'
            ? 'Meeting cancelled'
            : `Meeting changed · ${when}`;
    const data: MeetingPushData = {
      type: 'meeting',
      event,
      meetingId: m._id,
      conversationId: m.conversationId,
      startsAt: m.startsAt.toISOString(),
    };
    void this.notifications
      .pushToUsers(tenantId, userIds, m.title, body, { ...data })
      .catch((e) => this.log.warn(`meeting push failed for ${m._id}: ${String(e)}`));
  }
}
