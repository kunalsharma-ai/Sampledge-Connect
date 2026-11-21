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
  CreateMeetingRequestSchema,
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
  type WorkingHours,
} from '@sampledge/contracts';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { AppError, forbidden, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import type { MeetingDoc } from '../database/documents.js';
import { MONGO_DB } from '../database/database.module.js';
import { TenantDb } from '../database/tenant-db.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { MessagesService } from '../messages/messages.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';
import { REDIS } from '../redis/redis.module.js';
import { hhmmToMinutes, localParts } from './time.js';

const REMINDER_SWEEP_MS = 30_000;

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
  ) {}

  onModuleInit() {
    if (this.cfg.NODE_ENV === 'test') return; // tests call sendDueReminders() directly
    this.timer = setInterval(
      () => void this.sendDueReminders().catch(() => undefined),
      REMINDER_SWEEP_MS,
    );
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
      if (invited.length === 0)
        throw new AppError('VALIDATION_FAILED', 'Invite at least one person');
      const conv = await this.conversations.create(
        ctx,
        invited.length === 1
          ? { kind: 'dm', memberIds: invited }
          : { kind: 'group', name: req.title.slice(0, 80), memberIds: invited },
      );
      conversationId = conv.conversationId;
      attendeeIds = [ctx.userId, ...invited];
    }

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
      attendees: [ctx.userId, ...attendeeIds.filter((id) => id !== ctx.userId)].map((userId) => ({
        userId,
        response: userId === ctx.userId ? ('accepted' as const) : ('pending' as const),
        optional: optional.has(userId),
      })),
      media: req.media,
      remindMinutes: [...new Set(req.remindMinutes)].sort((a, b) => b - a),
      remindersSent: [],
      status: 'scheduled',
      messageId: null,
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
    if (m.status === 'cancelled') throw new AppError('CONFLICT', 'This meeting was cancelled');
    const startsAt = req.startsAt ? new Date(req.startsAt) : m.startsAt;
    const endsAt = req.endsAt ? new Date(req.endsAt) : m.endsAt;
    if (endsAt <= startsAt || endsAt.getTime() - startsAt.getTime() > 12 * 3_600_000)
      throw new AppError('VALIDATION_FAILED', 'endsAt must be after startsAt (max 12 hours)');
    const moved =
      startsAt.getTime() !== m.startsAt.getTime() || endsAt.getTime() !== m.endsAt.getTime();

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
          updatedAt: new Date(),
        },
      },
      { returnDocument: 'after' },
    );
    if (!updated) throw new AppError('CONFLICT', 'This meeting was cancelled');
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
    return toMeeting(updated);
  }

  async cancel(ctx: TenantContext, meetingId: string): Promise<Meeting> {
    const m = await this.load(ctx, meetingId);
    if (m.organizerId !== ctx.userId) throw forbidden('Only the organizer can cancel this meeting');
    if (m.status === 'cancelled') return toMeeting(m);
    const updated = await this.db
      .for(ctx.tenantId)
      .meetings.findOneAndUpdate(
        { _id: m._id },
        { $set: { status: 'cancelled', updatedAt: new Date() } },
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
    return toMeeting(updated!);
  }

  async rsvp(ctx: TenantContext, meetingId: string, input: unknown): Promise<Meeting> {
    const { response } = parse(RsvpRequestSchema, input);
    const m = await this.load(ctx, meetingId);
    if (!m.attendees.some((a) => a.userId === ctx.userId))
      throw forbidden('You are not invited to this meeting');
    if (m.status === 'cancelled') throw new AppError('CONFLICT', 'This meeting was cancelled');
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
    const t = this.db.for(ctx.tenantId);
    const people = [...new Set([ctx.userId, ...req.attendeeIds])];
    const found = await t.users.countDocuments({ _id: { $in: people }, status: 'active' });
    if (found !== people.length) throw new AppError('VALIDATION_FAILED', 'Unknown attendee');
    const from = Date.parse(req.from);
    const to = Date.parse(req.to);

    const [settings, meetings] = await Promise.all([
      t.user_settings.find({ userId: { $in: people } }).toArray(),
      t.meetings
        .find({
          status: 'scheduled',
          'attendees.userId': { $in: people },
          startsAt: { $lt: new Date(to) },
          endsAt: { $gt: new Date(from) },
          ...(req.ignoreMeetingId ? { _id: { $ne: req.ignoreMeetingId } } : {}),
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

    const step = req.stepMinutes * 60_000;
    const dur = req.durationMinutes * 60_000;
    const earliest = Math.max(from, Date.now());
    const slots: { startsAt: string; endsAt: string }[] = [];
    for (let s = Math.ceil(earliest / step) * step; s + dur <= to; s += step) {
      const e = s + dur;
      const ok = people.every(
        (p) => inHours(p, s, e) && !busy.get(p)!.some((b) => b.s < e && b.e > s),
      );
      if (ok) {
        slots.push({ startsAt: new Date(s).toISOString(), endsAt: new Date(e).toISOString() });
        if (slots.length >= req.limit) break;
      }
    }
    return {
      slots,
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
  ): MeetingSystemMetadata {
    return {
      meetingId: m._id,
      title: m.title,
      startsAt: m.startsAt.toISOString(),
      endsAt: m.endsAt.toISOString(),
      organizerId: m.organizerId,
      status,
    };
  }

  private async refreshCard(
    tenantId: string,
    m: MeetingDoc,
    status: MeetingSystemMetadata['status'],
  ) {
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
