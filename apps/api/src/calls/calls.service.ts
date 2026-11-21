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
  type Call,
  type CallJoinResponse,
  type CallSystemMetadata,
  type CallsConfig,
} from '@sampledge/contracts';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { AppError, forbidden, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import type { CallDoc, CallParticipantDoc, CallRecordingDoc } from '../database/documents.js';
import { MONGO_DB } from '../database/database.module.js';
import { TenantDb, newId } from '../database/tenant-db.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { MessagesService } from '../messages/messages.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';
import { REDIS } from '../redis/redis.module.js';
import { RecordingsService } from '../recordings/recordings.service.js';
import {
  LiveKitClient,
  egressFinished,
  liveKitSettings,
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
});

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
  readonly lk: LiveKitClient | null;
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
  ) {
    const s = liveKitSettings(cfg);
    this.lk = s ? new LiveKitClient(s) : null;
  }

  onModuleInit() {
    if (this.cfg.NODE_ENV === 'test') return; // tests drive sweep() directly
    this.sweepTimer = setInterval(() => void this.sweep().catch(() => undefined), SWEEP_EVERY_MS);
    this.sweepTimer.unref();
  }
  onApplicationShutdown() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  async config(ctx: TenantContext): Promise<CallsConfig> {
    return {
      enabled: !!this.lk,
      provider: this.lk ? 'livekit' : null,
      ringTimeoutSeconds: this.cfg.CALL_RING_TIMEOUT_SECONDS,
      recordingEnabled: await this.recordingAllowed(ctx.tenantId),
    };
  }

  private async recordingAllowed(tenantId: string) {
    if (!this.lk || !this.cfg.RECORDINGS_SPOOL_DIR) return false;
    return (await this.recordings.settings(tenantId)).callRecordingEnabled;
  }

  // ---------- recording ----------

  /**
   * Starts recording the call (everyone, including screen shares) through the self-hosted
   * egress service. Anyone in the call may start it; everyone sees the indicator at once.
   */
  async startRecording(ctx: TenantContext, callId: string): Promise<Call> {
    const lk = this.requireSfu();
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
    if (egressId && this.lk) {
      try {
        const info = await this.lk.stopEgress(egressId);
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
    if (!this.lk) return;
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
        const info = await this.lk.getEgress(rec.egressId);
        if (info) await this.applyEgress(info);
      } catch (e) {
        this.log.warn(`recording sweep for ${call._id} failed: ${String(e)}`);
      }
    }
  }

  private requireSfu(): LiveKitClient {
    if (!this.lk)
      throw new AppError(
        'UNAVAILABLE',
        'Calls are not set up on this server yet. An administrator needs to configure the media server (LIVEKIT_*).',
      );
    return this.lk;
  }

  // ---------- client actions ----------

  /** Starts a call in a conversation, or joins the one already live there. */
  async start(
    ctx: TenantContext,
    conversationId: string,
    input: unknown,
  ): Promise<CallJoinResponse> {
    const lk = this.requireSfu();
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
    this.requireSfu();
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

  async handleWebhook(rawBody: Buffer, authorization: string | undefined): Promise<void> {
    const lk = this.requireSfu();
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
    if (this.lk) {
      let present: Set<string> | null = null;
      try {
        present = new Set(await this.lk.listParticipants(call.room));
      } catch {
        present = null; // SFU unreachable: don't guess.
      }
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
    let current: CallDoc = call;
    if (changed) {
      const updated = await t.calls.findOneAndUpdate(
        { _id: call._id, status: 'live', lastActivityAt: call.lastActivityAt },
        { $set: { participants } },
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
    const joined = call.participants.filter((p) => p.state === 'joined');
    const ringing = call.participants.some((p) => p.state === 'ringing');
    const everJoined = call.participants.filter((p) => p.joinedAt);
    if (joined.length === 0 || (joined.length === 1 && !ringing && everJoined.length === 1))
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
    const ended = await t.calls.findOneAndUpdate(
      { _id: callId, status: 'live' },
      { $set: { status: 'ended', endedAt: now, participants, lastActivityAt: now } },
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
    if (this.lk) void this.lk.deleteRoom(ended.room).catch(() => undefined);
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
    const lk = this.requireSfu();
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
