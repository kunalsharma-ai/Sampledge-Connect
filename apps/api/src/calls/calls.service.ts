import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { MongoServerError, type Db } from 'mongodb';
import type { Redis } from 'ioredis';
import {
  StartCallRequestSchema,
  formatCallDuration,
  guestIdentity,
  isGuestIdentity,
  GUEST_IDENTITY_PREFIX,
  type Call,
  type CallJoinResponse,
  type CallSystemMetadata,
  type CallsConfig,
} from '@sampledge/contracts';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { AppError, forbidden, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import type {
  CallDoc,
  CallGuestDoc,
  CallLobbyDoc,
  CallParticipantDoc,
  CallRecordingDoc,
} from '../database/documents.js';
import { MONGO_DB } from '../database/database.module.js';
import { TenantDb, newId } from '../database/tenant-db.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { MessagesService } from '../messages/messages.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';
import { REDIS } from '../redis/redis.module.js';
import { RecordingsService } from '../recordings/recordings.service.js';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service.js';
import {
  LiveKitClient,
  egressFinished,
  liveKitFromValues,
  normalizeEgress,
  type EgressInfo,
  type LiveKitWebhookEvent,
} from './livekit.js';

const JOIN_TOKEN_TTL_S = 10 * 60;
/** How long a "joined" participant may be missing from the SFU before we mark them left. */
const CONNECT_GRACE_MS = 30_000;
const SWEEP_EVERY_MS = 10_000;

export const toCall = (c: CallDoc): Call => ({
  callId: c._id,
  conversationId: c.conversationId,
  media: c.media,
  status: c.status,
  startedBy: c.startedBy,
  startedAt: c.startedAt.toISOString(),
  endedAt: c.endedAt?.toISOString() ?? null,
  participants: c.participants.map((p) => ({
    userId: p.userId,
    state: p.state,
    joinedAt: p.joinedAt?.toISOString() ?? null,
    leftAt: p.leftAt?.toISOString() ?? null,
  })),
  recording: c.recording
    ? {
        status: c.recording.status,
        startedBy: c.recording.startedBy,
        startedAt: c.recording.startedAt.toISOString(),
      }
    : null,
  lobby: (c.lobby ?? []).map((l) => ({
    guestId: l.guestId,
    meetingId: l.meetingId,
    name: l.name,
    email: l.email,
    requestedAt: l.requestedAt.toISOString(),
  })),
  guests: (c.guests ?? []).map((g) => ({
    guestId: g.guestId,
    meetingId: g.meetingId,
    name: g.name,
    email: g.email,
    state: g.state,
    decidedBy: g.decidedBy,
    joinedAt: g.joinedAt?.toISOString() ?? null,
  })),
});

/** A guest who stops polling the lobby (closed the tab) drops out of it after this long. */
export const LOBBY_STALE_MS = 30_000;

/** A starting/stopping recording that hasn't heard from egress for this long is re-checked. */
const RECORDING_RECHECK_MS = 60_000;

/**
 * Call records and SFU access. MongoDB is the source of truth for who was invited, who joined
 * and when the call ended; the SFU (LiveKit) carries the media. Three paths keep the two in
 * step: explicit REST join/leave from clients, signed LiveKit webhooks, and a sweeper that
 * reconciles live calls against the SFU's participant list (covers crashed clients and
 * deployments without webhooks).
 */
@Injectable()
export class CallsService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger(CallsService.name);
  /** Clients by settings fingerprint (organizations on the same server share one). */
  private readonly clients = new Map<string, LiveKitClient>();
  private readonly stopListening: () => void;
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: TenantDb,
    @Inject(MONGO_DB) private readonly rawDb: Db,
    private readonly conversations: ConversationsService,
    private readonly messages: MessagesService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimePublisher,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly recordings: RecordingsService,
    private readonly settings: IntegrationSettingsService,
  ) {
    // Hot reload: a saved change (on any API node) drops the old clients.
    this.stopListening = settings.onChange('livekit', () => this.clients.clear());
  }

  /**
   * The media server for an organization: its own (Integrations → Calls), else the platform
   * default, else legacy env. null when calls aren't set up.
   */
  async sfu(tenantId: string): Promise<{ client: LiveKitClient; shared: boolean } | null> {
    const r = await this.settings.get(tenantId, 'livekit');
    const s = r?.enabled ? liveKitFromValues(r.values) : null;
    if (!s) return null;
    const key = JSON.stringify(s);
    let client = this.clients.get(key);
    if (!client) {
      client = new LiveKitClient(s);
      this.clients.set(key, client);
    }
    return { client, shared: r!.source !== 'tenant' };
  }

  private async lk(tenantId: string): Promise<LiveKitClient | null> {
    return (await this.sfu(tenantId))?.client ?? null;
  }

  onModuleInit() {
    if (this.cfg.NODE_ENV === 'test') return; // tests drive sweep() directly
    this.sweepTimer = setInterval(() => void this.sweep().catch(() => undefined), SWEEP_EVERY_MS);
    this.sweepTimer.unref();
  }
  onApplicationShutdown() {
    this.stopListening();
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  async config(ctx: TenantContext): Promise<CallsConfig> {
    const sfu = await this.sfu(ctx.tenantId);
    return {
      enabled: !!sfu,
      provider: sfu ? 'livekit' : null,
      ringTimeoutSeconds: this.cfg.CALL_RING_TIMEOUT_SECONDS,
      recordingEnabled: await this.recordingAllowed(ctx.tenantId),
    };
  }

  /**
   * Recording needs the media server's Egress to write into this API's spool directory, which
   * only the deployment's own server (platform settings or env) is set up to do.
   */
  private async recordingAllowed(tenantId: string) {
    const sfu = await this.sfu(tenantId);
    if (!sfu?.shared || !this.cfg.RECORDINGS_SPOOL_DIR) return false;
    return (await this.recordings.settings(tenantId)).callRecordingEnabled;
  }

  // ---------- recording ----------

  /**
   * Starts recording the call (everyone, including screen shares) through the self-hosted
   * egress service. Anyone in the call may start it; everyone sees the indicator at once.
   */
  async startRecording(ctx: TenantContext, callId: string): Promise<Call> {
    const lk = await this.requireSfu(ctx.tenantId);
    const call = await this.load(ctx, callId);
    if (call.status !== 'live') throw new AppError('CONFLICT', 'This call has ended');
    if (!(await this.recordingAllowed(ctx.tenantId)))
      throw new AppError(
        'FORBIDDEN',
        this.cfg.RECORDINGS_SPOOL_DIR
          ? 'Call recording is turned off for your organization'
          : 'Call recording is not set up on this server yet (RECORDINGS_SPOOL_DIR and the egress service)',
      );
    const me = call.participants.find((p) => p.userId === ctx.userId);
    if (me?.state !== 'joined') throw forbidden('Join the call to record it');
    if (call.recording) return toCall(call);
    const now = new Date();
    const audioOnly = call.media === 'audio';
    const rec: CallRecordingDoc = {
      egressId: null,
      status: 'starting',
      startedBy: ctx.userId,
      startedAt: now,
      audioOnly,
      fileName: `${ctx.tenantId}-${call._id}-${now.getTime()}.${audioOnly ? 'm4a' : 'mp4'}`,
    };
    const t = this.db.for(ctx.tenantId);
    const claimed = await t.calls.findOneAndUpdate(
      { _id: call._id, status: 'live', recording: null },
      { $set: { recording: rec } },
      { returnDocument: 'after' },
    );
    if (!claimed) return toCall((await t.calls.findOne({ _id: call._id })) ?? call);
    this.broadcast(ctx.tenantId, claimed);
    let info: EgressInfo;
    try {
      info = await lk.startRoomRecording(call.room, {
        filepath: `${this.cfg.LIVEKIT_EGRESS_OUTPUT_DIR.replace(/\/$/, '')}/${rec.fileName}`,
        audioOnly,
      });
    } catch (e) {
      this.log.warn(`recording start failed for ${call._id}: ${String(e)}`);
      const cleared = await t.calls.findOneAndUpdate(
        { _id: call._id, 'recording.startedAt': now },
        { $set: { recording: null } },
        { returnDocument: 'after' },
      );
      if (cleared) this.broadcast(ctx.tenantId, cleared);
      throw new AppError(
        'UNAVAILABLE',
        "The recording service isn't reachable right now. Try again shortly.",
      );
    }
    const active = await t.calls.findOneAndUpdate(
      { _id: call._id, 'recording.startedAt': now, 'recording.egressId': null },
      {
        $set: {
          'recording.egressId': info.egressId,
          'recording.status': info.status === 'EGRESS_ACTIVE' ? 'active' : 'starting',
        },
      },
      { returnDocument: 'after' },
    );
    if (active) this.broadcast(ctx.tenantId, active);
    await this.recordings.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'call.recording.start',
      target: { type: 'call', id: call._id },
    });
    return toCall(active ?? claimed);
  }

  /** Stops the recording; the file arrives in the chat once egress has finished writing it. */
  async stopRecording(ctx: TenantContext, callId: string): Promise<Call> {
    const call = await this.load(ctx, callId);
    if (!call.recording || call.recording.status === 'stopping') return toCall(call);
    const me = call.participants.find((p) => p.userId === ctx.userId);
    if (me?.state !== 'joined' && call.recording.startedBy !== ctx.userId)
      throw forbidden('Join the call to stop the recording');
    return toCall(await this.requestStop(ctx.tenantId, call));
  }

  private async requestStop(tenantId: string, call: CallDoc): Promise<CallDoc> {
    const t = this.db.for(tenantId);
    const stopping = await t.calls.findOneAndUpdate(
      { _id: call._id, 'recording.startedAt': call.recording!.startedAt },
      { $set: { 'recording.status': 'stopping' } },
      { returnDocument: 'after' },
    );
    if (!stopping) return call;
    this.broadcast(tenantId, stopping);
    const egressId = stopping.recording?.egressId;
    const lk = egressId ? await this.lk(tenantId) : null;
    if (egressId && lk) {
      try {
        const info = await lk.stopEgress(egressId);
        if (info && egressFinished(info.status)) await this.applyEgress(info);
      } catch (e) {
        // The sweeper re-checks it; egress also stops by itself when the room closes.
        this.log.warn(`stop egress ${egressId} failed: ${String(e)}`);
      }
    }
    return (await t.calls.findOne({ _id: call._id })) ?? stopping;
  }

  /** Applies an egress status (webhook, stop response or sweeper check). */
  async applyEgress(info: EgressInfo): Promise<void> {
    const call = await this.rawDb
      .collection<CallDoc>('calls')
      .findOne({ 'recording.egressId': info.egressId });
    if (!call?.recording) return;
    const t = this.db.for(call.tenantId);
    if (info.status === 'EGRESS_ACTIVE' && call.recording.status === 'starting') {
      const u = await t.calls.findOneAndUpdate(
        { _id: call._id, 'recording.egressId': info.egressId, 'recording.status': 'starting' },
        { $set: { 'recording.status': 'active' } },
        { returnDocument: 'after' },
      );
      if (u) this.broadcast(call.tenantId, u);
      return;
    }
    if (!egressFinished(info.status)) return;
    // Exactly one path (webhook, stop, sweeper) gets to import the file.
    const cleared = await t.calls.findOneAndUpdate(
      { _id: call._id, 'recording.egressId': info.egressId },
      { $set: { recording: null } },
      { returnDocument: 'after' },
    );
    if (!cleared) return;
    this.broadcast(call.tenantId, cleared);
    const rec = call.recording;
    const file = info.files[0];
    if (info.status === 'EGRESS_COMPLETE' || info.status === 'EGRESS_LIMIT_REACHED') {
      const durationMs = file?.durationMs || Math.max(0, Date.now() - rec.startedAt.getTime());
      await this.recordings
        .importCallRecording(call, rec, durationMs)
        .catch((e) => this.log.warn(`import of recording for ${call._id} failed: ${String(e)}`));
    } else {
      this.log.warn(`recording ${info.egressId} ended ${info.status}: ${info.error}`);
      await this.recordings.postFailed(call, rec);
    }
  }

  private broadcast(tenantId: string, call: CallDoc) {
    this.realtime.toConversation(tenantId, call.conversationId, 'call:updated', toCall(call));
  }

  /** Stops over-long recordings and re-checks ones egress hasn't reported on. */
  private async sweepRecordings(now: Date) {
    const calls = await this.rawDb
      .collection<CallDoc>('calls')
      .find({ recording: { $type: 'object' } })
      .limit(200)
      .toArray();
    for (const call of calls) {
      const rec = call.recording!;
      try {
        const age = now.getTime() - rec.startedAt.getTime();
        if (rec.status !== 'stopping' && age > this.cfg.RECORDING_MAX_MINUTES * 60_000) {
          await this.requestStop(call.tenantId, call);
          continue;
        }
        if (call.status === 'ended' && rec.status !== 'stopping') {
          await this.requestStop(call.tenantId, call);
          continue;
        }
        if (rec.status === 'active' && call.status === 'live') continue;
        if (age < RECORDING_RECHECK_MS) continue;
        if (!rec.egressId) {
          // Start never got an egress id back (API crashed mid-start): drop it.
          const t = this.db.for(call.tenantId);
          const u = await t.calls.findOneAndUpdate(
            { _id: call._id, 'recording.startedAt': rec.startedAt, 'recording.egressId': null },
            { $set: { recording: null } },
            { returnDocument: 'after' },
          );
          if (u) this.broadcast(call.tenantId, u);
          continue;
        }
        const lk = await this.lk(call.tenantId);
        if (!lk) continue;
        const info = await lk.getEgress(rec.egressId);
        if (info) await this.applyEgress(info);
      } catch (e) {
        this.log.warn(`recording sweep for ${call._id} failed: ${String(e)}`);
      }
    }
  }

  private async requireSfu(tenantId: string): Promise<LiveKitClient> {
    const lk = await this.lk(tenantId);
    if (!lk)
      throw new AppError(
        'UNAVAILABLE',
        'Calls are not set up yet. An administrator needs to add the media server in Integrations → Calls.',
      );
    return lk;
  }

  // ---------- client actions ----------

  /** Starts a call in a conversation, or joins the one already live there. */
  async start(
    ctx: TenantContext,
    conversationId: string,
    input: unknown,
  ): Promise<CallJoinResponse> {
    const lk = await this.requireSfu(ctx.tenantId);
    const req = parse(StartCallRequestSchema, input ?? {});
    const { conversation } = await this.conversations.authorize(
      ctx,
      conversationId,
      'message.send',
    );
    const t = this.db.for(ctx.tenantId);

    const live = await t.calls.findOne({ conversationId, status: 'live' });
    if (live) return this.join(ctx, live._id);

    const now = new Date();
    const ringUntil = new Date(now.getTime() + this.cfg.CALL_RING_TIMEOUT_SECONDS * 1000);
    const members = await this.conversations.memberIds(ctx.tenantId, conversationId);
    const callId = newId();
    const room = `sc_${ctx.tenantId}_${callId}`;
    try {
      await lk.createRoom(room, { emptyTimeoutSeconds: 120, maxParticipants: 300 });
    } catch {
      throw new AppError(
        'UNAVAILABLE',
        "The media server isn't reachable right now. Try again shortly.",
      );
    }
    let doc: CallDoc;
    try {
      doc = await t.calls.insertOne({
        _id: callId,
        conversationId,
        media: req.media,
        status: 'live',
        startedBy: ctx.userId,
        startedAt: now,
        endedAt: null,
        room,
        participants: [ctx.userId, ...members.filter((m) => m !== ctx.userId)].map((userId) =>
          userId === ctx.userId
            ? { userId, state: 'joined', joinedAt: now, leftAt: null, ringUntil: null }
            : { userId, state: 'ringing', joinedAt: null, leftAt: null, ringUntil },
        ),
        messageId: null,
        lastActivityAt: now,
        recording: null,
      });
    } catch (e) {
      // Someone else started a call here at the same moment: join theirs.
      if (e instanceof MongoServerError && e.code === 11000) {
        const winner = await t.calls.findOne({ conversationId, status: 'live' });
        if (winner) return this.join(ctx, winner._id);
      }
      throw e;
    }

    try {
      const msg = await this.messages.postSystem(
        ctx.tenantId,
        conversationId,
        ctx.userId,
        `${req.media === 'video' ? 'Video' : 'Voice'} call started`,
        { call: this.systemMetadata(doc) },
      );
      await t.calls.updateOne({ _id: callId }, { $set: { messageId: msg.messageId } });
      doc.messageId = msg.messageId;
    } catch (e) {
      this.log.warn(`call card for ${callId} not posted: ${String(e)}`);
    }

    const dto = toCall(doc);
    this.realtime.toConversation(ctx.tenantId, conversationId, 'call:updated', dto);
    const invitees = doc.participants.filter((p) => p.state === 'ringing').map((p) => p.userId);
    for (const userId of invitees)
      this.realtime.toUser(ctx.tenantId, userId, 'call:ringing', {
        call: dto,
        callerId: ctx.userId,
        conversationId,
        media: doc.media,
        expiresAt: ringUntil.toISOString(),
      });
    void this.notifications
      .pushCallRinging(ctx.tenantId, doc, conversation, invitees, ringUntil)
      .catch((e) => this.log.warn(`call push failed for ${callId}: ${String(e)}`));

    return { call: dto, join: await this.joinToken(ctx, doc) };
  }

  async join(ctx: TenantContext, callId: string): Promise<CallJoinResponse> {
    await this.requireSfu(ctx.tenantId);
    const call = await this.load(ctx, callId);
    if (call.status !== 'live') throw new AppError('CONFLICT', 'This call has ended');
    const updated = await this.setState(ctx.tenantId, call, ctx.userId, 'joined');
    if (!updated) throw new AppError('CONFLICT', 'This call has ended');
    return { call: toCall(updated), join: await this.joinToken(ctx, updated) };
  }

  async leave(ctx: TenantContext, callId: string): Promise<Call> {
    const call = await this.load(ctx, callId);
    if (call.status !== 'live') return toCall(call);
    const updated = await this.setState(ctx.tenantId, call, ctx.userId, 'left');
    return toCall((await this.maybeFinish(ctx.tenantId, updated ?? call)) ?? updated ?? call);
  }

  async decline(ctx: TenantContext, callId: string): Promise<Call> {
    const call = await this.load(ctx, callId);
    if (call.status !== 'live') return toCall(call);
    const me = call.participants.find((p) => p.userId === ctx.userId);
    if (!me || me.state !== 'ringing') return toCall(call);
    const updated = await this.setState(ctx.tenantId, call, ctx.userId, 'declined');
    return toCall((await this.maybeFinish(ctx.tenantId, updated ?? call)) ?? updated ?? call);
  }

  /** Ends the call for everyone. Allowed for whoever started it and for conversation moderators. */
  async end(ctx: TenantContext, callId: string): Promise<Call> {
    const call = await this.load(ctx, callId);
    if (call.status !== 'live') return toCall(call);
    if (call.startedBy !== ctx.userId) {
      const { membership } = await this.conversations.authorize(
        ctx,
        call.conversationId,
        'conversation.read',
      );
      const isAdmin = ctx.role === 'owner' || ctx.role === 'admin';
      if (!(
        membership?.role === 'owner' ||
        membership?.role === 'moderator' ||
        (isAdmin && membership)
      ))
        throw forbidden(
          'Only the person who started the call or a moderator can end it for everyone',
        );
    }
    return toCall((await this.finish(ctx.tenantId, call._id)) ?? call);
  }

  async get(ctx: TenantContext, callId: string): Promise<Call> {
    return toCall(await this.load(ctx, callId));
  }

  /** The live call in a conversation, or null. */
  async active(ctx: TenantContext, conversationId: string): Promise<Call | null> {
    await this.conversations.authorize(ctx, conversationId, 'conversation.read');
    const c = await this.db.for(ctx.tenantId).calls.findOne({ conversationId, status: 'live' });
    return c ? toCall(c) : null;
  }

  /** Live calls in every conversation the caller belongs to (to show "Join" banners on load). */
  async listActive(ctx: TenantContext): Promise<Call[]> {
    const t = this.db.for(ctx.tenantId);
    const mine = await t.conversation_members
      .find({ userId: ctx.userId }, { projection: { conversationId: 1 } })
      .toArray();
    if (!mine.length) return [];
    const calls = await t.calls
      .find({ status: 'live', conversationId: { $in: mine.map((m) => m.conversationId) } })
      .toArray();
    return calls.map(toCall);
  }

  // ---------- SFU events ----------

  /**
   * Room names carry the organization (`sc_<tenantId>_<callId>`), so the event is checked
   * against that organization's media server secret. Anything else is rejected.
   */
  async handleWebhook(rawBody: Buffer, authorization: string | undefined): Promise<void> {
    let tenantId: string | null = null;
    try {
      const body = JSON.parse(rawBody.toString('utf8')) as {
        room?: { name?: string };
        egressInfo?: { roomName?: string; room_name?: string };
        egress_info?: { roomName?: string; room_name?: string };
      };
      const eg = body.egressInfo ?? body.egress_info;
      const room = body.room?.name ?? eg?.roomName ?? eg?.room_name ?? '';
      tenantId = /^sc_([^_]+)_/.exec(room)?.[1] ?? null;
    } catch {
      tenantId = null;
    }
    const lk = tenantId ? await this.lk(tenantId) : null;
    if (!lk) throw new AppError('UNAUTHENTICATED', 'Invalid webhook signature');
    const event = await lk.verifyWebhook(rawBody, authorization);
    if (!event) throw new AppError('UNAUTHENTICATED', 'Invalid webhook signature');
    await this.applySfuEvent(event);
  }

  async applySfuEvent(event: LiveKitWebhookEvent): Promise<void> {
    if (event.event?.startsWith('egress_')) {
      const info = normalizeEgress(event.egressInfo ?? event.egress_info);
      if (info) await this.applyEgress(info);
      return;
    }
    const room = event.room?.name;
    if (!room?.startsWith('sc_')) return;
    const call = await this.rawDb.collection<CallDoc>('calls').findOne({ room });
    if (!call || call.status !== 'live') return;
    const identity = event.participant?.identity;
    if (identity && isGuestIdentity(identity) && event.event !== 'room_finished') {
      const guestId = identity.slice(GUEST_IDENTITY_PREFIX.length);
      if (event.event === 'participant_joined')
        await this.setGuestState(call.tenantId, call, guestId, 'joined');
      else if (event.event === 'participant_left') {
        const updated = await this.setGuestState(call.tenantId, call, guestId, 'left');
        await this.maybeFinish(call.tenantId, updated ?? call);
      }
      return;
    }
    if (event.event === 'room_finished') {
      await this.finish(call.tenantId, call._id);
    } else if (event.event === 'participant_joined' && identity) {
      await this.setState(call.tenantId, call, identity, 'joined');
    } else if (event.event === 'participant_left' && identity) {
      const updated = await this.setState(call.tenantId, call, identity, 'left');
      await this.maybeFinish(call.tenantId, updated ?? call);
    }
  }

  /**
   * Housekeeping across tenants: expire unanswered rings, and reconcile live calls with the
   * SFU so a closed tab or a crashed phone never leaves a call "live" forever.
   * Guarded by a Redis lock so only one API replica sweeps at a time.
   */
  async sweep(now = new Date()): Promise<void> {
    const ok = await this.redis.set('lock:calls:sweep', '1', 'PX', SWEEP_EVERY_MS - 500, 'NX');
    if (ok !== 'OK' && this.cfg.NODE_ENV !== 'test') return;
    const calls = await this.rawDb
      .collection<CallDoc>('calls')
      .find({ status: 'live' })
      .limit(500)
      .toArray();
    for (const call of calls) {
      try {
        await this.sweepOne(call, now);
      } catch (e) {
        this.log.warn(`sweep of call ${call._id} failed: ${String(e)}`);
      }
    }
    await this.sweepRecordings(now);
  }

  private async sweepOne(call: CallDoc, now: Date) {
    const t = this.db.for(call.tenantId);
    let changed = false;
    const participants = call.participants.map((p) => ({ ...p }));
    for (const p of participants) {
      if (p.state === 'ringing' && p.ringUntil && p.ringUntil <= now) {
        p.state = 'missed';
        changed = true;
      }
    }
    let presentIds: Set<string> | null = null;
    const lk = await this.lk(call.tenantId).catch(() => null);
    if (lk) {
      let present: Set<string> | null = null;
      try {
        present = new Set(await lk.listParticipants(call.room));
      } catch {
        present = null; // SFU unreachable: don't guess.
      }
      presentIds = present;
      if (present) {
        for (const p of participants) {
          if (p.state === 'joined' && !present.has(p.userId)) {
            const since = Math.max(call.lastActivityAt.getTime(), p.joinedAt?.getTime() ?? 0);
            if (now.getTime() - since > CONNECT_GRACE_MS) {
              p.state = 'left';
              p.leftAt = now;
              changed = true;
            }
          } else if (present.has(p.userId) && p.state !== 'joined') {
            p.state = 'joined';
            p.joinedAt ??= now;
            p.leftAt = null;
            changed = true;
          }
        }
      }
    }
    const lobby = (call.lobby ?? []).filter(
      (l) => now.getTime() - (l.seenAt ?? l.requestedAt).getTime() <= LOBBY_STALE_MS,
    );
    if (lobby.length !== (call.lobby ?? []).length) changed = true;
    const guests = (call.guests ?? []).map((g) => ({ ...g }));
    if (presentIds) {
      for (const g of guests) {
        const here = presentIds.has(guestIdentity(g.guestId));
        if (g.state === 'joined' && !here) {
          const since = Math.max(call.lastActivityAt.getTime(), g.joinedAt?.getTime() ?? 0);
          if (now.getTime() - since > CONNECT_GRACE_MS) {
            g.state = 'left';
            g.leftAt = now;
            changed = true;
          }
        } else if (here && g.state !== 'joined' && g.state !== 'denied') {
          g.state = 'joined';
          g.joinedAt ??= now;
          g.leftAt = null;
          changed = true;
        }
      }
    }
    let current: CallDoc = call;
    if (changed) {
      const updated = await t.calls.findOneAndUpdate(
        { _id: call._id, status: 'live', lastActivityAt: call.lastActivityAt },
        { $set: { participants, lobby, guests } },
        { returnDocument: 'after' },
      );
      if (!updated) return; // changed underneath us; next sweep will look again
      current = updated;
      this.realtime.toConversation(
        call.tenantId,
        call.conversationId,
        'call:updated',
        toCall(updated),
      );
    }
    await this.maybeFinish(call.tenantId, current);
  }

  // ---------- external guests (lobby) ----------

  /** The live call in a conversation, across tenants' scoping (guest flows have no user context). */
  async liveCall(tenantId: string, conversationId: string): Promise<CallDoc | null> {
    return this.db.for(tenantId).calls.findOne({ conversationId, status: 'live' });
  }

  /**
   * Puts a guest in the lobby of a live call (or refreshes their place in it, which the guest
   * page does on every poll). Returns the call as it now stands. A guest already admitted
   * (who reloaded the page) or denied stays as they are.
   */
  async enterLobby(
    tenantId: string,
    call: CallDoc,
    entry: Omit<CallLobbyDoc, 'requestedAt' | 'seenAt'>,
  ): Promise<CallDoc> {
    const t = this.db.for(tenantId);
    const decided = call.guests?.find((g) => g.guestId === entry.guestId);
    if (decided) return call;
    const now = new Date();
    const waiting = call.lobby?.find((l) => l.guestId === entry.guestId);
    if (waiting) {
      const updated = await t.calls.findOneAndUpdate(
        { _id: call._id, status: 'live', 'lobby.guestId': entry.guestId },
        { $set: { 'lobby.$.seenAt': now, 'lobby.$.name': entry.name } },
        { returnDocument: 'after' },
      );
      if (updated && waiting.name !== entry.name) this.broadcast(tenantId, updated);
      return updated ?? call;
    }
    const updated = await t.calls.findOneAndUpdate(
      {
        _id: call._id,
        status: 'live',
        'lobby.guestId': { $ne: entry.guestId },
        'guests.guestId': { $ne: entry.guestId },
      },
      { $push: { lobby: { $each: [{ ...entry, requestedAt: now, seenAt: now }], $slice: -200 } } },
      { returnDocument: 'after' },
    );
    if (!updated) return (await t.calls.findOne({ _id: call._id })) ?? call;
    this.broadcast(tenantId, updated);
    return updated;
  }

  /** A guest closed the join page: leave the lobby. */
  async leaveLobby(tenantId: string, callId: string, guestId: string): Promise<void> {
    const updated = await this.db
      .for(tenantId)
      .calls.findOneAndUpdate(
        { _id: callId, status: 'live', 'lobby.guestId': guestId },
        { $pull: { lobby: { guestId } } },
        { returnDocument: 'after' },
      );
    if (updated) this.broadcast(tenantId, updated);
  }

  /** Admit or deny someone waiting in the lobby. Anyone currently in the call may decide. */
  async decideGuest(
    ctx: TenantContext,
    callId: string,
    guestId: string,
    allow: boolean,
  ): Promise<Call> {
    const call = await this.load(ctx, callId);
    if (call.status !== 'live') throw new AppError('CONFLICT', 'This call has ended');
    const me = call.participants.find((p) => p.userId === ctx.userId);
    if (me?.state !== 'joined') throw forbidden('Join the call to let people in from the lobby');
    const waiting = call.lobby?.find((l) => l.guestId === guestId);
    if (!waiting) {
      const decided = call.guests?.find((g) => g.guestId === guestId);
      if (decided) return toCall(call); // someone else got there first
      throw notFound('Lobby entry');
    }
    const guest: CallGuestDoc = {
      guestId,
      meetingId: waiting.meetingId,
      name: waiting.name,
      email: waiting.email,
      state: allow ? 'admitted' : 'denied',
      decidedBy: ctx.userId,
      joinedAt: null,
      leftAt: null,
    };
    const updated = await this.db.for(ctx.tenantId).calls.findOneAndUpdate(
      { _id: call._id, status: 'live', 'lobby.guestId': guestId },
      {
        $pull: { lobby: { guestId } },
        $push: { guests: guest },
        $set: { lastActivityAt: new Date() },
      },
      { returnDocument: 'after' },
    );
    if (!updated)
      return toCall((await this.db.for(ctx.tenantId).calls.findOne({ _id: callId })) ?? call);
    this.broadcast(ctx.tenantId, updated);
    return toCall(updated);
  }

  /** SFU token for an admitted guest. Identity `guest:<id>` keeps them apart from members. */
  async guestJoinToken(call: CallDoc, guest: { guestId: string; name: string }) {
    const lk = await this.requireSfu(call.tenantId);
    const { token, expiresAt } = await lk.token({
      identity: guestIdentity(guest.guestId),
      name: `${guest.name} (guest)`,
      metadata: JSON.stringify({ guestId: guest.guestId, guest: true }),
      grant: {
        room: call.room,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
        canUpdateOwnMetadata: true,
      },
      ttlSeconds: JOIN_TOKEN_TTL_S,
    });
    return { url: lk.settings.publicUrl, token, expiresAt: expiresAt.toISOString() };
  }

  /** Takes a guest out of a call (their invite was withdrawn). */
  async removeGuest(tenantId: string, conversationId: string, guestId: string): Promise<void> {
    const call = await this.liveCall(tenantId, conversationId);
    if (!call) return;
    const known =
      call.lobby?.some((l) => l.guestId === guestId) ||
      call.guests?.some((g) => g.guestId === guestId);
    if (!known) return;
    const updated = await this.db.for(tenantId).calls.findOneAndUpdate(
      { _id: call._id, status: 'live' },
      {
        $pull: { lobby: { guestId } },
        $set: {
          guests: (call.guests ?? []).map((g) =>
            g.guestId === guestId ? { ...g, state: 'denied' as const, leftAt: new Date() } : g,
          ),
        },
      },
      { returnDocument: 'after' },
    );
    const lk = await this.lk(tenantId);
    if (lk) await lk.removeParticipant(call.room, guestIdentity(guestId)).catch(() => undefined);
    if (updated) this.broadcast(tenantId, updated);
  }

  private async setGuestState(
    tenantId: string,
    call: CallDoc,
    guestId: string,
    state: 'joined' | 'left',
  ): Promise<CallDoc | null> {
    const g = call.guests?.find((x) => x.guestId === guestId);
    // Only admitted guests can hold a token; anything else is ignored.
    if (!g || g.state === 'denied' || g.state === state) return call;
    const now = new Date();
    const updated = await this.db.for(tenantId).calls.findOneAndUpdate(
      { _id: call._id, status: 'live', 'guests.guestId': guestId },
      {
        $set: {
          'guests.$.state': state,
          ...(state === 'joined'
            ? { 'guests.$.leftAt': null, ...(g.joinedAt ? {} : { 'guests.$.joinedAt': now }) }
            : { 'guests.$.leftAt': now }),
          lastActivityAt: now,
        },
      },
      { returnDocument: 'after' },
    );
    if (updated) this.broadcast(tenantId, updated);
    return updated;
  }

  // ---------- internals ----------

  private async load(ctx: TenantContext, callId: string): Promise<CallDoc> {
    const call = await this.db.for(ctx.tenantId).calls.findOne({ _id: callId });
    if (!call) throw notFound('Call');
    // Same visibility as the conversation: non-members get 404, not 403.
    await this.conversations.authorize(ctx, call.conversationId, 'message.send').catch((e) => {
      if (e instanceof AppError && e.code === 'FORBIDDEN') throw notFound('Call');
      throw e;
    });
    return call;
  }

  /** Sets one participant's state (adding them if they weren't invited) and broadcasts it. */
  private async setState(
    tenantId: string,
    call: CallDoc,
    userId: string,
    state: CallParticipantDoc['state'],
  ): Promise<CallDoc | null> {
    const t = this.db.for(tenantId);
    const now = new Date();
    const existing = call.participants.find((p) => p.userId === userId);
    let updated: CallDoc | null;
    if (existing) {
      if (existing.state === state) return call;
      updated = await t.calls.findOneAndUpdate(
        { _id: call._id, status: 'live', 'participants.userId': userId },
        {
          $set: {
            'participants.$.state': state,
            'participants.$.ringUntil': null,
            ...(state === 'joined'
              ? {
                  'participants.$.leftAt': null,
                  ...(existing.joinedAt ? {} : { 'participants.$.joinedAt': now }),
                }
              : state === 'left'
                ? { 'participants.$.leftAt': now }
                : {}),
            lastActivityAt: now,
          },
        },
        { returnDocument: 'after' },
      );
    } else {
      if (state !== 'joined') return call;
      updated = await t.calls.findOneAndUpdate(
        { _id: call._id, status: 'live', 'participants.userId': { $ne: userId } },
        {
          $push: { participants: { userId, state, joinedAt: now, leftAt: null, ringUntil: null } },
          $set: { lastActivityAt: now },
        },
        { returnDocument: 'after' },
      );
    }
    if (updated)
      this.realtime.toConversation(tenantId, call.conversationId, 'call:updated', toCall(updated));
    return updated;
  }

  /**
   * A call ends when nobody is left in it, or when the caller is alone and every invitee
   * has declined or missed it (an unanswered call should not stay open forever).
   */
  private async maybeFinish(tenantId: string, call: CallDoc): Promise<CallDoc | null> {
    if (call.status !== 'live') return null;
    const guestsIn = (call.guests ?? []).filter((g) => g.state === 'joined').length;
    const guestsEver = (call.guests ?? []).filter((g) => g.joinedAt).length;
    const joined = call.participants.filter((p) => p.state === 'joined').length + guestsIn;
    const ringing = call.participants.some((p) => p.state === 'ringing');
    const everJoined = call.participants.filter((p) => p.joinedAt).length + guestsEver;
    if (joined === 0 || (joined === 1 && !ringing && everJoined === 1))
      return this.finish(tenantId, call._id);
    return null;
  }

  private async finish(tenantId: string, callId: string): Promise<CallDoc | null> {
    const t = this.db.for(tenantId);
    const call = await t.calls.findOne({ _id: callId, status: 'live' });
    if (!call) return null;
    const now = new Date();
    const participants = call.participants.map((p) => ({
      ...p,
      state:
        p.state === 'ringing'
          ? ('missed' as const)
          : p.state === 'joined'
            ? ('left' as const)
            : p.state,
      leftAt: p.state === 'joined' ? now : p.leftAt,
      ringUntil: null,
    }));
    const guests = (call.guests ?? []).map((g) =>
      g.state === 'joined' || g.state === 'admitted'
        ? { ...g, state: g.joinedAt ? ('left' as const) : g.state, leftAt: now }
        : g,
    );
    const ended = await t.calls.findOneAndUpdate(
      { _id: callId, status: 'live' },
      {
        $set: {
          status: 'ended',
          endedAt: now,
          participants,
          lobby: [],
          guests,
          lastActivityAt: now,
        },
      },
      { returnDocument: 'after' },
    );
    if (!ended) return null; // another path finished it first
    this.realtime.toConversation(tenantId, ended.conversationId, 'call:ended', toCall(ended));
    if (ended.messageId) {
      const meta = this.systemMetadata(ended);
      const media = ended.media === 'video' ? 'video' : 'voice';
      const text =
        meta.status === 'ended'
          ? `${media === 'video' ? 'Video' : 'Voice'} call ended · ${formatCallDuration(meta.durationSec ?? 0)}`
          : meta.status === 'declined'
            ? `${media === 'video' ? 'Video' : 'Voice'} call declined`
            : `Missed ${media} call`;
      await this.messages
        .updateSystem(tenantId, ended.messageId, text, { call: meta })
        .catch((e) => this.log.warn(`call card update failed: ${String(e)}`));
    }
    if (ended.recording && ended.recording.status !== 'stopping') {
      // Stop before closing the room so egress finalizes the file cleanly.
      await this.requestStop(tenantId, ended).catch(() => undefined);
    }
    const lk = await this.lk(tenantId).catch(() => null);
    if (lk) void lk.deleteRoom(ended.room).catch(() => undefined);
    return ended;
  }

  private systemMetadata(call: CallDoc): CallSystemMetadata {
    const joined = call.participants.filter((p) => p.joinedAt);
    const others = call.participants.filter((p) => p.userId !== call.startedBy);
    let status: CallSystemMetadata['status'] = 'started';
    if (call.status === 'ended') {
      if (joined.length >= 2) status = 'ended';
      else if (others.length > 0 && others.every((p) => p.state === 'declined'))
        status = 'declined';
      else status = 'missed';
    }
    return {
      callId: call._id,
      media: call.media,
      status,
      startedBy: call.startedBy,
      startedAt: call.startedAt.toISOString(),
      endedAt: call.endedAt?.toISOString() ?? null,
      durationSec: call.endedAt
        ? Math.max(0, Math.round((call.endedAt.getTime() - call.startedAt.getTime()) / 1000))
        : null,
      participantIds: joined.map((p) => p.userId),
    };
  }

  private async joinToken(ctx: TenantContext, call: CallDoc) {
    const lk = await this.requireSfu(ctx.tenantId);
    const user = await this.db
      .for(ctx.tenantId)
      .users.findOne({ _id: ctx.userId }, { projection: { displayName: 1 } });
    const { token, expiresAt } = await lk.token({
      identity: ctx.userId,
      name: user?.displayName ?? 'Guest',
      metadata: JSON.stringify({ userId: ctx.userId }),
      grant: {
        room: call.room,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
        canUpdateOwnMetadata: true,
      },
      ttlSeconds: JOIN_TOKEN_TTL_S,
    });
    return { url: lk.settings.publicUrl, token, expiresAt: expiresAt.toISOString() };
  }
}
