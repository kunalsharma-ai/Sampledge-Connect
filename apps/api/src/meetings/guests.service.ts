import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Db } from 'mongodb';
import {
  GuestChatSendSchema,
  guestIdentity,
  type GuestChatResponse,
  GUEST_EARLY_JOIN_MINUTES,
  GUEST_LATE_JOIN_MINUTES,
  GuestLobbyRequestSchema,
  GuestRsvpRequestSchema,
  type GuestInput,
  type GuestJoinState,
  type GuestMeetingView,
  type Meeting,
} from '@sampledge/contracts';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { AppError, forbidden, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import type { CallDoc, MeetingDoc, MeetingGuestDoc } from '../database/documents.js';
import { MONGO_DB } from '../database/database.module.js';
import { TenantDb, newId } from '../database/tenant-db.js';
import { CallsService } from '../calls/calls.service.js';
import { MailerService } from '../mail/mailer.service.js';
import { MessagesService } from '../messages/messages.service.js';
import { RateLimitService } from '../redis/redis.module.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';
import { buildIcs } from './ics.js';
import { guestEmail, type GuestEmailKind } from './guest-email.js';

/** What a meeting:upsert broadcast needs (MeetingsService owns the mapping). */
type ToMeeting = (m: MeetingDoc) => Meeting;

/**
 * External guests: invites by email (with an .ics calendar invite), personal join links,
 * the public guest page, and the lobby. A link is `<web>/join/<guestId>.<signature>`; the
 * signature is an HMAC over the tenant, meeting, guest and a per-guest nonce, so links can't
 * be guessed or moved to another meeting, and removing a guest kills their link.
 */
@Injectable()
export class GuestsService {
  private readonly log = new Logger(GuestsService.name);
  private readonly secret: Buffer;
  /** Emails in flight (tests await them with `flush()`). */
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly db: TenantDb,
    @Inject(MONGO_DB) private readonly rawDb: Db,
    private readonly calls: CallsService,
    private readonly mailer: MailerService,
    private readonly messages: MessagesService,
    private readonly rateLimit: RateLimitService,
    private readonly realtime: RealtimePublisher,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {
    // Same secret as signed file links (required in production). Dev without it: links
    // work until the API restarts.
    this.secret = cfg.FILES_URL_SECRET
      ? createHmac('sha256', cfg.FILES_URL_SECRET).update('guest-links').digest()
      : randomBytes(32);
  }

  get emailEnabled() {
    return this.mailer.enabled;
  }

  // ---------- links ----------

  private signature(tenantId: string, meetingId: string, g: MeetingGuestDoc): string {
    return createHmac('sha256', this.secret)
      .update(`${tenantId}|${meetingId}|${g.guestId}|${g.linkNonce}`)
      .digest('base64url')
      .slice(0, 32);
  }

  token(tenantId: string, meetingId: string, g: MeetingGuestDoc): string {
    return `${g.guestId}.${this.signature(tenantId, meetingId, g)}`;
  }

  joinUrl(tenantId: string, meetingId: string, g: MeetingGuestDoc): string {
    const base = (
      this.cfg.PUBLIC_WEB_URL ??
      this.cfg.corsOrigins[0] ??
      'http://localhost:3000'
    ).replace(/\/+$/, '');
    return `${base}/join/${this.token(tenantId, meetingId, g)}`;
  }

  /** Finds the meeting and guest a link belongs to. Any mismatch is a plain 404. */
  async resolve(token: string): Promise<{ meeting: MeetingDoc; guest: MeetingGuestDoc }> {
    const m = /^([0-9a-f]{24})\.([A-Za-z0-9_-]{32})$/.exec(token ?? '');
    if (!m) throw notFound('Invitation');
    const [, guestId, sig] = m as unknown as [string, string, string];
    const meeting = await this.rawDb
      .collection<MeetingDoc>('meetings')
      .findOne({ 'guests.guestId': guestId });
    const guest = meeting?.guests?.find((g) => g.guestId === guestId);
    if (!meeting || !guest) throw notFound('Invitation');
    const want = Buffer.from(this.signature(meeting.tenantId, meeting._id, guest));
    const got = Buffer.from(sig);
    if (want.length !== got.length || !timingSafeEqual(want, got)) throw notFound('Invitation');
    return { meeting, guest };
  }

  // ---------- organizer side ----------

  /**
   * New guest records for a meeting, skipping emails already invited. People who have an
   * account in this organization must be added as attendees instead (they get the meeting
   * in their calendar, chat and reminders).
   */
  async prepare(
    ctx: TenantContext,
    inputs: GuestInput[],
    existing: MeetingGuestDoc[] = [],
  ): Promise<MeetingGuestDoc[]> {
    if (!inputs.length) return [];
    const seen = new Set(existing.map((g) => g.email));
    const fresh: { email: string; name: string }[] = [];
    for (const i of inputs) {
      const email = i.email.trim().toLowerCase();
      if (seen.has(email)) continue;
      seen.add(email);
      fresh.push({ email, name: i.name?.trim() || email.split('@')[0]! });
    }
    if (!fresh.length) return [];
    const members = await this.db
      .for(ctx.tenantId)
      .users.find(
        { email: { $in: fresh.map((f) => f.email) }, status: 'active' },
        { projection: { email: 1 } },
      )
      .toArray();
    if (members.length)
      throw new AppError(
        'VALIDATION_FAILED',
        `${members.map((u) => u.email).join(', ')} ${members.length === 1 ? 'is' : 'are'} in your organization. Add ${members.length === 1 ? 'them' : 'these people'} as attendees instead.`,
      );
    const now = new Date();
    return fresh.map((f) => ({
      guestId: newId(),
      email: f.email,
      name: f.name,
      response: 'pending',
      linkNonce: randomBytes(12).toString('base64url'),
      invite: { status: this.mailer.enabled ? 'sending' : 'not_configured', at: null, error: null },
      invitedBy: ctx.userId,
      invitedAt: now,
    }));
  }

  /** The organizer's copy of a guest's link (to paste anywhere when email isn't set up). */
  async link(ctx: TenantContext, meeting: MeetingDoc, guestId: string) {
    if (meeting.organizerId !== ctx.userId)
      throw forbidden('Only the organizer can share guest links');
    const g = meeting.guests?.find((x) => x.guestId === guestId);
    if (!g) throw notFound('Guest');
    return { url: this.joinUrl(ctx.tenantId, meeting._id, g) };
  }

  /**
   * Emails each guest (asynchronously) and records the outcome on their guest record.
   * Without SMTP, guests are marked `not_configured` and nothing is sent.
   */
  email(
    tenantId: string,
    meeting: MeetingDoc,
    guests: MeetingGuestDoc[],
    kind: GuestEmailKind,
    onUpdated?: () => void,
  ) {
    if (!guests.length) return;
    const col = this.db.for(tenantId).meetings;
    const mark = async (guestId: string, invite: MeetingGuestDoc['invite']) => {
      if (kind === 'cancelled-for-you') return; // that guest record is gone
      await col
        .updateOne(
          { _id: meeting._id, 'guests.guestId': guestId },
          { $set: { 'guests.$.invite': invite } },
        )
        .catch(() => undefined);
    };
    if (!this.mailer.enabled) {
      const job = (async () => {
        for (const g of guests)
          await mark(g.guestId, { status: 'not_configured', at: null, error: null });
        onUpdated?.();
      })();
      this.track(job);
      return;
    }
    const job = (async () => {
      const organizer = await this.organizer(tenantId, meeting);
      for (const g of guests) {
        await mark(g.guestId, { status: 'sending', at: new Date(), error: null });
        try {
          await this.sendOne(tenantId, meeting, g, kind, organizer);
          await mark(g.guestId, { status: 'sent', at: new Date(), error: null });
        } catch (e) {
          await mark(g.guestId, {
            status: 'failed',
            at: new Date(),
            error: e instanceof Error ? e.message : 'Sending failed',
          });
        }
      }
      onUpdated?.();
    })();
    this.track(job);
  }

  /** Waits for queued emails (tests, and graceful shutdown). */
  async flush(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  private track(p: Promise<void>) {
    const job = p.catch((e) => this.log.warn(`guest email job failed: ${String(e)}`));
    this.pending.add(job);
    void job.finally(() => this.pending.delete(job));
  }

  private async organizer(tenantId: string, meeting: MeetingDoc) {
    const [user, tenant] = await Promise.all([
      this.db
        .for(tenantId)
        .users.findOne({ _id: meeting.organizerId }, { projection: { displayName: 1, email: 1 } }),
      this.db.tenants.findOne({ _id: tenantId }, { projection: { name: 1 } }),
    ]);
    return {
      name: user?.displayName ?? 'The organizer',
      email: user?.email ?? this.mailer.fromAddress?.email ?? 'no-reply@localhost',
      organization: tenant?.name ?? 'Sampledge Connect',
    };
  }

  private async sendOne(
    tenantId: string,
    meeting: MeetingDoc,
    g: MeetingGuestDoc,
    kind: GuestEmailKind,
    organizer: { name: string; email: string; organization: string },
  ) {
    const url = this.joinUrl(tenantId, meeting._id, g);
    const cancel = kind === 'cancelled' || kind === 'cancelled-for-you';
    const ics = buildIcs({
      method: cancel ? 'CANCEL' : 'REQUEST',
      uid: `${meeting._id}@sampledge-connect`,
      sequence: meeting.sequence ?? 0,
      startsAt: meeting.startsAt,
      endsAt: meeting.endsAt,
      stamp: new Date(),
      title: meeting.title,
      description: [meeting.agenda, `Join: ${url}`].filter(Boolean).join('\n\n'),
      url,
      organizer: { name: organizer.name, email: organizer.email },
      attendee: { name: g.name, email: g.email },
      alarmMinutes: meeting.remindMinutes[meeting.remindMinutes.length - 1] ?? null,
    });
    const body = guestEmail(kind, {
      title: meeting.title,
      agenda: meeting.agenda,
      startsAt: meeting.startsAt,
      endsAt: meeting.endsAt,
      timeZone: meeting.timeZone,
      organizerName: organizer.name,
      organizationName: organizer.organization,
      guestName: g.name,
      url,
    });
    await this.mailer.send({
      to: { name: g.name, email: g.email },
      subject: body.subject,
      text: body.text,
      html: body.html,
      calendar: { method: cancel ? 'CANCEL' : 'REQUEST', content: ics },
    });
  }

  // ---------- the guest's side (public, authenticated by the link) ----------

  private window(m: MeetingDoc) {
    return {
      opens: new Date(m.startsAt.getTime() - GUEST_EARLY_JOIN_MINUTES * 60_000),
      closes: new Date(m.endsAt.getTime() + GUEST_LATE_JOIN_MINUTES * 60_000),
    };
  }

  async view(token: string): Promise<GuestMeetingView> {
    const { meeting: m, guest: g } = await this.resolve(token);
    const organizer = await this.organizer(m.tenantId, m);
    const w = this.window(m);
    return {
      meetingId: m._id,
      title: m.title,
      agenda: m.agenda,
      startsAt: m.startsAt.toISOString(),
      endsAt: m.endsAt.toISOString(),
      timeZone: m.timeZone,
      media: m.media,
      status: m.status,
      organizerName: organizer.name,
      organizationName: organizer.organization,
      guest: { guestId: g.guestId, name: g.name, email: g.email, response: g.response },
      joinOpensAt: w.opens.toISOString(),
      joinClosesAt: w.closes.toISOString(),
    };
  }

  async rsvp(token: string, input: unknown, toMeeting: ToMeeting): Promise<GuestMeetingView> {
    const { response } = parse(GuestRsvpRequestSchema, input);
    const { meeting: m, guest: g } = await this.resolve(token);
    if (m.status === 'cancelled') throw new AppError('CONFLICT', 'This meeting was cancelled');
    const updated = await this.db
      .for(m.tenantId)
      .meetings.findOneAndUpdate(
        { _id: m._id, 'guests.guestId': g.guestId },
        { $set: { 'guests.$.response': response, updatedAt: new Date() } },
        { returnDocument: 'after' },
      );
    if (updated) this.broadcastMeeting(m.tenantId, updated, toMeeting);
    return this.view(token);
  }

  /** The invite as a downloadable .ics (for guests whose email dropped the attachment). */
  async ics(token: string): Promise<{ fileName: string; content: string }> {
    const { meeting: m, guest: g } = await this.resolve(token);
    const organizer = await this.organizer(m.tenantId, m);
    const url = this.joinUrl(m.tenantId, m._id, g);
    const content = buildIcs({
      method: m.status === 'cancelled' ? 'CANCEL' : 'REQUEST',
      uid: `${m._id}@sampledge-connect`,
      sequence: m.sequence ?? 0,
      startsAt: m.startsAt,
      endsAt: m.endsAt,
      stamp: new Date(),
      title: m.title,
      description: [m.agenda, `Join: ${url}`].filter(Boolean).join('\n\n'),
      url,
      organizer: { name: organizer.name, email: organizer.email },
      attendee: { name: g.name, email: g.email },
      alarmMinutes: m.remindMinutes[m.remindMinutes.length - 1] ?? null,
    });
    const safe =
      m.title
        .replace(/[^\p{L}\p{N} _-]+/gu, '')
        .trim()
        .slice(0, 60) || 'meeting';
    return { fileName: `${safe}.ics`, content };
  }

  /**
   * Where the guest stands. With `ask`, also puts them in the lobby of the live call (the
   * page calls this with their name when they press Join, then polls without it).
   */
  async lobby(token: string, input?: unknown): Promise<GuestJoinState> {
    const name = input === undefined ? null : parse(GuestLobbyRequestSchema, input).name;
    const { meeting: m, guest: g } = await this.resolve(token);
    const none = (state: GuestJoinState['state'], call: CallDoc | null = null): GuestJoinState => ({
      state,
      callId: call?._id ?? null,
      recording: !!call?.recording,
      join: null,
    });
    if (m.status === 'cancelled') return none('cancelled');
    const now = Date.now();
    const w = this.window(m);
    if (now < w.opens.getTime()) return none('too_early');
    if (now > w.closes.getTime()) return none('ended');

    let call = await this.calls.liveCall(m.tenantId, m.conversationId);
    if (!call) return none('not_started');
    const decided = call.guests?.find((x) => x.guestId === g.guestId);
    if (decided?.state === 'denied') return none('denied', call);
    if (decided)
      return {
        state: 'admitted',
        callId: call._id,
        recording: !!call.recording,
        join: await this.calls.guestJoinToken(call, { guestId: g.guestId, name: decided.name }),
      };
    const waiting = call.lobby?.some((l) => l.guestId === g.guestId);
    if (!waiting && name === null) return none('ready', call);
    call = await this.calls.enterLobby(m.tenantId, call, {
      guestId: g.guestId,
      meetingId: m._id,
      name: name ?? call.lobby?.find((l) => l.guestId === g.guestId)?.name ?? g.name,
      email: g.email,
    });
    // Admitted between our read and the push (or by a racing request).
    const now2 = call.guests?.find((x) => x.guestId === g.guestId);
    if (now2?.state === 'denied') return none('denied', call);
    if (now2)
      return {
        state: 'admitted',
        callId: call._id,
        recording: !!call.recording,
        join: await this.calls.guestJoinToken(call, { guestId: g.guestId, name: now2.name }),
      };
    return none('waiting', call);
  }

  async leaveLobby(token: string): Promise<void> {
    const { meeting: m, guest: g } = await this.resolve(token);
    const call = await this.calls.liveCall(m.tenantId, m.conversationId);
    if (call) await this.calls.leaveLobby(m.tenantId, call._id, g.guestId);
  }

  // ---------- meeting chat ----------

  /** The live call this guest is admitted to (else a 403 the page shows as "join first"). */
  private async admittedCall(token: string) {
    const { meeting: m, guest: g } = await this.resolve(token);
    const call = await this.calls.liveCall(m.tenantId, m.conversationId);
    const me = call?.guests?.find((x) => x.guestId === g.guestId);
    if (!call || !me || me.state === 'denied') throw forbidden('Join the meeting to use its chat');
    return { meeting: m, guest: g, call, name: me.name };
  }

  /**
   * Meeting chat as a guest sees it: messages since this call started (never the chat's
   * earlier history), text only, attachments by name.
   */
  async chat(token: string): Promise<GuestChatResponse> {
    const { meeting: m, guest: g, call } = await this.admittedCall(token);
    const t = this.db.for(m.tenantId);
    const docs = await t.messages
      .find(
        {
          conversationId: m.conversationId,
          messageType: 'text',
          deletedAt: null,
          createdAt: { $gte: call.startedAt },
        },
        { sort: { serverSequence: -1 }, limit: 200 },
      )
      .toArray();
    docs.reverse();
    const userIds = [
      ...new Set(docs.map((d) => d.senderId).filter((id) => !id.startsWith('guest:'))),
    ];
    const users = userIds.length
      ? await t.users.find({ _id: { $in: userIds } }, { projection: { displayName: 1 } }).toArray()
      : [];
    const names = new Map(users.map((u) => [u._id, u.displayName]));
    const mine = guestIdentity(g.guestId);
    return {
      messages: docs.map((d) => {
        const guest = (d.metadata as { guest?: { name?: string } } | undefined)?.guest;
        return {
          messageId: d._id,
          senderName: guest?.name ?? names.get(d.senderId) ?? 'Someone',
          fromGuest: !!guest,
          mine: d.senderId === mine,
          text: d.content.text,
          attachmentNames: (d.attachments ?? []).map((a) => a.fileName),
          createdAt: d.createdAt.toISOString(),
          editedAt: d.editedAt?.toISOString() ?? null,
        };
      }),
    };
  }

  async sendChat(token: string, input: unknown): Promise<GuestChatResponse> {
    const { text } = parse(GuestChatSendSchema, input);
    const { meeting: m, guest: g, name } = await this.admittedCall(token);
    await this.rateLimit.consume('message_send', `${m.tenantId}:guest:${g.guestId}`);
    await this.messages.postGuest(m.tenantId, m.conversationId, { guestId: g.guestId, name }, text);
    return this.chat(token);
  }

  broadcastMeeting(tenantId: string, m: MeetingDoc, toMeeting: ToMeeting) {
    const dto = toMeeting(m);
    for (const a of m.attendees) this.realtime.toUser(tenantId, a.userId, 'meeting:upsert', dto);
  }
}
