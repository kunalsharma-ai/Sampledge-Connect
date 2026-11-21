import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import { MongoServerError, type Db } from 'mongodb';
import {
  CreateScheduledMessageRequestSchema,
  ListScheduledMessagesQuerySchema,
  MAX_SCHEDULED_PER_USER,
  SCHEDULE_MAX_LEAD_MS,
  SCHEDULE_MIN_LEAD_MS,
  UpdateScheduledMessageRequestSchema,
  type ScheduledMessage,
} from '@sampledge/contracts';
import { AppError, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { MONGO_DB } from '../database/database.module.js';
import type { ScheduledMessageDoc, MembershipDoc, UserDoc } from '../database/documents.js';
import { TenantDb } from '../database/tenant-db.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { MessagesService } from '../messages/messages.service.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';
import { REDIS } from '../redis/redis.module.js';

const SWEEP_MS = 10_000;
/** A claim older than this is treated as abandoned (the replica died mid-send). */
const CLAIM_STALE_MS = 2 * 60_000;
const MAX_ATTEMPTS = 5;

export function toScheduled(d: ScheduledMessageDoc): ScheduledMessage {
  return {
    scheduledId: d._id,
    conversationId: d.conversationId,
    clientMessageId: d.clientMessageId,
    content: d.content,
    replyToMessageId: d.replyToMessageId,
    sendAt: d.sendAt.toISOString(),
    // The short "sending" claim is an implementation detail; clients see it as scheduled.
    status: d.status === 'sending' ? 'scheduled' : d.status,
    messageId: d.messageId,
    error: d.error,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

/**
 * Scheduled messages: stored by the server and sent as their author at sendAt. Sending goes
 * through MessagesService.send with the stored clientMessageId, so a retry after a crash
 * can never post twice, and permissions are checked again at send time.
 */
@Injectable()
export class ScheduledMessagesService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger('ScheduledMessages');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: TenantDb,
    @Inject(MONGO_DB) private readonly rawDb: Db,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly conversations: ConversationsService,
    private readonly messages: MessagesService,
    private readonly realtime: RealtimePublisher,
  ) {}

  onModuleInit() {
    if (this.cfg.NODE_ENV === 'test') return; // tests call sendDue() directly
    this.timer = setInterval(() => void this.sendDue().catch(() => undefined), SWEEP_MS);
    this.timer.unref();
  }
  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  private checkSendAt(iso: string): Date {
    const at = new Date(iso);
    const lead = at.getTime() - Date.now();
    if (lead < SCHEDULE_MIN_LEAD_MS)
      throw new AppError('VALIDATION_FAILED', 'Pick a time at least a minute from now');
    if (lead > SCHEDULE_MAX_LEAD_MS)
      throw new AppError('VALIDATION_FAILED', 'You can schedule up to a year ahead');
    return at;
  }

  async create(
    ctx: TenantContext,
    conversationId: string,
    input: unknown,
  ): Promise<ScheduledMessage> {
    const req = parse(CreateScheduledMessageRequestSchema, input);
    const t = this.db.for(ctx.tenantId);
    const existing = await t.scheduled_messages.findOne({ clientMessageId: req.clientMessageId });
    if (existing) {
      if (existing.userId !== ctx.userId || existing.conversationId !== conversationId)
        throw new AppError('CONFLICT', 'clientMessageId already used');
      return toScheduled(existing);
    }
    await this.conversations.authorize(ctx, conversationId, 'message.send');
    const sendAt = this.checkSendAt(req.sendAt);
    if (req.replyToMessageId) {
      const parent = await t.messages.findOne({ _id: req.replyToMessageId, conversationId });
      if (!parent)
        throw new AppError('VALIDATION_FAILED', 'Reply target not found in this conversation');
    }
    const pending = await t.scheduled_messages.countDocuments({
      userId: ctx.userId,
      status: { $in: ['scheduled', 'sending'] },
    });
    if (pending >= MAX_SCHEDULED_PER_USER)
      throw new AppError(
        'VALIDATION_FAILED',
        `You can have up to ${MAX_SCHEDULED_PER_USER} scheduled messages`,
      );
    const now = new Date();
    try {
      const doc = await t.scheduled_messages.insertOne({
        conversationId,
        userId: ctx.userId,
        clientMessageId: req.clientMessageId,
        content: { text: req.content.text, mentions: req.content.mentions ?? [] },
        replyToMessageId: req.replyToMessageId ?? null,
        sendAt,
        status: 'scheduled',
        messageId: null,
        error: null,
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      });
      return this.publish(doc);
    } catch (e) {
      if (e instanceof MongoServerError && e.code === 11000) {
        const winner = await t.scheduled_messages.findOne({
          clientMessageId: req.clientMessageId,
        });
        if (winner) return toScheduled(winner);
      }
      throw e;
    }
  }

  async list(ctx: TenantContext, query: unknown): Promise<ScheduledMessage[]> {
    const q = parse(ListScheduledMessagesQuerySchema, query);
    const rows = await this.db
      .for(ctx.tenantId)
      .scheduled_messages.find(
        {
          userId: ctx.userId,
          ...(q.conversationId ? { conversationId: q.conversationId } : {}),
          status: q.status
            ? q.status === 'scheduled'
              ? { $in: ['scheduled', 'sending'] }
              : q.status
            : { $in: ['scheduled', 'sending', 'failed'] },
        },
        { sort: { sendAt: 1 }, limit: 500 },
      )
      .toArray();
    return rows.map(toScheduled);
  }

  private async own(ctx: TenantContext, id: string) {
    const d = await this.db
      .for(ctx.tenantId)
      .scheduled_messages.findOne({ _id: id, userId: ctx.userId });
    if (!d) throw notFound('Scheduled message');
    return d;
  }

  async update(ctx: TenantContext, id: string, input: unknown): Promise<ScheduledMessage> {
    const req = parse(UpdateScheduledMessageRequestSchema, input);
    await this.own(ctx, id);
    const $set: Partial<ScheduledMessageDoc> = { updatedAt: new Date() };
    if (req.sendAt) $set.sendAt = this.checkSendAt(req.sendAt);
    if (req.content)
      $set.content = { text: req.content.text, mentions: req.content.mentions ?? [] };
    // A failed message can be rescheduled; it goes back to the queue.
    const doc = await this.db
      .for(ctx.tenantId)
      .scheduled_messages.findOneAndUpdate(
        { _id: id, userId: ctx.userId, status: { $in: ['scheduled', 'failed'] } },
        { $set: { ...$set, status: 'scheduled', error: null, attempts: 0 } },
        { returnDocument: 'after' },
      );
    if (!doc) throw new AppError('CONFLICT', 'This message was already sent or cancelled');
    return this.publish(doc);
  }

  async cancel(ctx: TenantContext, id: string): Promise<ScheduledMessage> {
    await this.own(ctx, id);
    const doc = await this.db
      .for(ctx.tenantId)
      .scheduled_messages.findOneAndUpdate(
        { _id: id, userId: ctx.userId, status: { $in: ['scheduled', 'failed'] } },
        { $set: { status: 'cancelled', updatedAt: new Date() } },
        { returnDocument: 'after' },
      );
    if (!doc) throw new AppError('CONFLICT', 'This message was already sent or cancelled');
    return this.publish(doc);
  }

  /** Send it now instead of waiting. */
  async sendNow(ctx: TenantContext, id: string): Promise<ScheduledMessage> {
    const d = await this.own(ctx, id);
    if (d.status !== 'scheduled' && d.status !== 'failed')
      throw new AppError('CONFLICT', 'This message was already sent or cancelled');
    const claimed = await this.rawDb
      .collection<ScheduledMessageDoc>('scheduled_messages')
      .findOneAndUpdate(
        { _id: d._id, tenantId: d.tenantId, status: { $in: ['scheduled', 'failed'] } },
        { $set: { status: 'sending', updatedAt: new Date() }, $inc: { attempts: 1 } },
        { returnDocument: 'after' },
      );
    if (!claimed) throw new AppError('CONFLICT', 'This message was already sent or cancelled');
    return this.deliver(claimed, true);
  }

  /** Send everything due. Safe to run on every replica: each message is claimed first. */
  async sendDue(now = new Date()): Promise<number> {
    const col = this.rawDb.collection<ScheduledMessageDoc>('scheduled_messages');
    let sent = 0;
    for (let i = 0; i < 200; i++) {
      const claimed = await col.findOneAndUpdate(
        {
          $or: [
            { status: 'scheduled', sendAt: { $lte: now } },
            { status: 'sending', updatedAt: { $lt: new Date(now.getTime() - CLAIM_STALE_MS) } },
          ],
        },
        { $set: { status: 'sending', updatedAt: new Date() }, $inc: { attempts: 1 } },
        { sort: { sendAt: 1 }, returnDocument: 'after' },
      );
      if (!claimed) break;
      const r = await this.deliver(claimed, false);
      if (r.status === 'sent') sent++;
    }
    return sent;
  }

  private async deliver(d: ScheduledMessageDoc, immediate: boolean): Promise<ScheduledMessage> {
    const col = this.rawDb.collection<ScheduledMessageDoc>('scheduled_messages');
    const key = { _id: d._id, tenantId: d.tenantId };
    try {
      const ctx = await this.contextFor(d);
      const ack = await this.messages.send(ctx, {
        conversationId: d.conversationId,
        clientMessageId: d.clientMessageId,
        content: d.content,
        replyToMessageId: d.replyToMessageId,
      });
      const doc = await col.findOneAndUpdate(
        key,
        {
          $set: {
            status: 'sent',
            messageId: ack.message.messageId,
            error: null,
            updatedAt: new Date(),
          },
        },
        { returnDocument: 'after' },
      );
      return this.publish(doc!);
    } catch (e) {
      const permanent =
        (e instanceof AppError &&
          ['FORBIDDEN', 'NOT_FOUND', 'VALIDATION_FAILED', 'CONFLICT'].includes(e.code)) ||
        d.attempts >= MAX_ATTEMPTS ||
        immediate;
      const reason =
        e instanceof AppError && (e.code === 'FORBIDDEN' || e.code === 'NOT_FOUND')
          ? 'You can no longer post in this conversation'
          : (e as Error).message;
      if (!permanent) this.log.warn(`scheduled ${d._id} will retry: ${reason}`);
      const doc = await col.findOneAndUpdate(
        key,
        permanent
          ? { $set: { status: 'failed', error: reason, updatedAt: new Date() } }
          : {
              $set: {
                status: 'scheduled',
                sendAt: new Date(Date.now() + 30_000 * d.attempts),
                updatedAt: new Date(),
              },
            },
        { returnDocument: 'after' },
      );
      return this.publish(doc!);
    }
  }

  /** Rebuild the author's context from the database. A deactivated author can't send. */
  private async contextFor(d: ScheduledMessageDoc): Promise<TenantContext> {
    const t = this.db.for(d.tenantId);
    const [user, membership] = await Promise.all([
      t.users.findOne({ _id: d.userId }) as Promise<UserDoc | null>,
      t.memberships.findOne({ userId: d.userId }) as Promise<MembershipDoc | null>,
    ]);
    if (!user || user.status !== 'active' || !membership)
      throw new AppError('FORBIDDEN', 'Author is no longer active');
    return {
      tenantId: d.tenantId,
      userId: d.userId,
      sessionId: 'scheduled',
      deviceId: 'scheduled',
      role: membership.role,
      workspaceId: membership.workspaceId,
    };
  }

  private publish(d: ScheduledMessageDoc): ScheduledMessage {
    const dto = toScheduled(d);
    this.realtime.toUser(d.tenantId, d.userId, 'scheduled:updated', dto);
    return dto;
  }
}
