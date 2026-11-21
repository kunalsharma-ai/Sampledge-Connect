import { Inject, Injectable, Logger } from '@nestjs/common';
import { MongoServerError } from 'mongodb';
import type { Redis } from 'ioredis';
import {
  AckReceiptRequestSchema,
  EditMessageRequestSchema,
  ListMessagesQuerySchema,
  MAX_REACTIONS_PER_MESSAGE,
  RECEIPT_TRACKING_MAX_MEMBERS,
  SendMessageRequestSchema,
  SetReactionRequestSchema,
  type Message,
  type Receipt,
  type SendMessageAck,
} from '@sampledge/contracts';
import { AppError, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import type { MessageDoc } from '../database/documents.js';
import { TenantDb } from '../database/tenant-db.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';
import { REDIS, RateLimitService } from '../redis/redis.module.js';
import { withLock } from '../redis/lock.js';
import { toMessage, toReceipt } from './message.mapper.js';

@Injectable()
export class MessagesService {
  private readonly log = new Logger(MessagesService.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly db: TenantDb,
    private readonly conversations: ConversationsService,
    private readonly realtime: RealtimePublisher,
    private readonly rateLimit: RateLimitService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private lockKey(tenantId: string, conversationId: string) {
    return `lock:seq:${tenantId}:${conversationId}`;
  }

  /** Allocate the next changeSequence for a conversation. Must run inside the conversation lock. */
  private async nextSequence(
    tenantId: string,
    conversationId: string,
    touchLastMessage: boolean,
  ): Promise<number> {
    const now = new Date();
    const c = await this.db.for(tenantId).conversations.findOneAndUpdate(
      { _id: conversationId },
      {
        $inc: { lastChangeSequence: 1 },
        ...(touchLastMessage ? { $set: { lastMessageAt: now } } : {}),
      },
      { returnDocument: 'after', projection: { lastChangeSequence: 1 } },
    );
    if (!c) throw notFound('Conversation');
    return c.lastChangeSequence;
  }

  /**
   * Idempotent send. The same clientMessageId always yields the same message,
   * whether the retry arrives over REST or Socket.IO, from this device or another.
   */
  async send(ctx: TenantContext, input: unknown): Promise<SendMessageAck> {
    const req = parse(SendMessageRequestSchema, input);
    const t = this.db.for(ctx.tenantId);

    const existing = await t.messages.findOne({ clientMessageId: req.clientMessageId });
    if (existing) return this.duplicateAck(ctx, existing, req.conversationId);

    await this.rateLimit.consume('message_send', `${ctx.tenantId}:${ctx.userId}`);
    await this.conversations.authorize(ctx, req.conversationId, 'message.send');
    let replyParentSenderId: string | null = null;
    if (req.replyToMessageId) {
      const parent = await t.messages.findOne({
        _id: req.replyToMessageId,
        conversationId: req.conversationId,
      });
      if (!parent)
        throw new AppError('VALIDATION_FAILED', 'Reply target not found in this conversation');
      replyParentSenderId = parent.deletedAt ? null : parent.senderId;
    }

    const attachmentIds = [...new Set(req.attachmentIds ?? [])];
    const files = attachmentIds.length
      ? await t.attachments.find({ _id: { $in: attachmentIds } }).toArray()
      : [];
    if (
      files.length !== attachmentIds.length ||
      files.some(
        (f) =>
          f.status !== 'ready' ||
          f.uploaderId !== ctx.userId ||
          f.conversationId !== req.conversationId ||
          f.messageId !== null,
      )
    ) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Attachments must be your own completed, unused uploads in this conversation',
      );
    }
    const ordered = attachmentIds.map((id) => files.find((f) => f._id === id)!);

    let doc: MessageDoc;
    try {
      doc = await withLock(this.redis, this.lockKey(ctx.tenantId, req.conversationId), async () => {
        const seq = await this.nextSequence(ctx.tenantId, req.conversationId, true);
        return t.messages.insertOne({
          conversationId: req.conversationId,
          clientMessageId: req.clientMessageId,
          senderId: ctx.userId,
          senderDeviceId: ctx.deviceId,
          messageType: 'text',
          content: { text: req.content.text, mentions: req.content.mentions ?? [] },
          attachmentIds,
          attachments: ordered.map((f) => ({
            attachmentId: f._id,
            fileName: f.fileName,
            mimeType: f.mimeType,
            sizeBytes: f.sizeBytes,
            width: f.width,
            height: f.height,
            createdAt: f.createdAt,
          })),
          replyToMessageId: req.replyToMessageId ?? null,
          serverSequence: seq,
          changeSequence: seq,
          createdAt: new Date(),
          editedAt: null,
          deletedAt: null,
          metadata: req.composedAt ? { composedAt: req.composedAt } : {},
        });
      });
    } catch (e) {
      // Lost a race with a concurrent retry of the same clientMessageId (leaves a harmless sequence gap).
      if (e instanceof MongoServerError && e.code === 11000) {
        const winner = await t.messages.findOne({ clientMessageId: req.clientMessageId });
        if (winner) return this.duplicateAck(ctx, winner, req.conversationId);
      }
      throw e;
    }

    if (attachmentIds.length) {
      await t.attachments.updateMany(
        { _id: { $in: attachmentIds }, messageId: null },
        { $set: { messageId: doc._id } },
      );
    }
    const message = toMessage(doc);
    this.realtime.toConversation(ctx.tenantId, req.conversationId, 'message:new', message);
    try {
      await this.notifications.onMessageCreated(ctx.tenantId, doc, replyParentSenderId);
    } catch (e) {
      // The message is committed and delivered; a missed notification must not fail the send.
      this.log.error(`notification fan-out failed for ${doc._id}: ${String(e)}`);
    }
    return { clientMessageId: req.clientMessageId, message, duplicate: false };
  }

  private duplicateAck(
    ctx: TenantContext,
    existing: MessageDoc,
    conversationId: string,
  ): SendMessageAck {
    if (existing.senderId !== ctx.userId || existing.conversationId !== conversationId) {
      throw new AppError('CONFLICT', 'clientMessageId already used for a different message');
    }
    return {
      clientMessageId: existing.clientMessageId,
      message: toMessage(existing),
      duplicate: true,
    };
  }

  async edit(ctx: TenantContext, messageId: string, input: unknown): Promise<Message> {
    const req = parse(EditMessageRequestSchema, input);
    const t = this.db.for(ctx.tenantId);
    const m = await t.messages.findOne({ _id: messageId });
    if (!m) throw notFound('Message');
    await this.conversations.authorize(ctx, m.conversationId, 'message.edit.own');
    if (m.senderId !== ctx.userId)
      throw new AppError('FORBIDDEN', 'You can only edit your own messages');
    if (m.deletedAt) throw new AppError('CONFLICT', 'Message was deleted');
    const updated = await withLock(
      this.redis,
      this.lockKey(ctx.tenantId, m.conversationId),
      async () => {
        const seq = await this.nextSequence(ctx.tenantId, m.conversationId, false);
        return t.messages.findOneAndUpdate(
          { _id: messageId, deletedAt: null },
          {
            $set: {
              content: { text: req.content.text, mentions: req.content.mentions ?? [] },
              editedAt: new Date(),
              changeSequence: seq,
            },
          },
          { returnDocument: 'after' },
        );
      },
    );
    if (!updated) throw new AppError('CONFLICT', 'Message was deleted');
    const dto = toMessage(updated);
    this.realtime.toConversation(ctx.tenantId, m.conversationId, 'message:updated', dto);
    return dto;
  }

  /** Soft delete: content is erased and a tombstone syncs to every device. */
  async remove(ctx: TenantContext, messageId: string): Promise<Message> {
    const t = this.db.for(ctx.tenantId);
    const m = await t.messages.findOne({ _id: messageId });
    if (!m) throw notFound('Message');
    await this.conversations.authorize(
      ctx,
      m.conversationId,
      m.senderId === ctx.userId ? 'message.delete.own' : 'message.delete.any',
    );
    if (m.deletedAt) return toMessage(m);
    const updated = await withLock(
      this.redis,
      this.lockKey(ctx.tenantId, m.conversationId),
      async () => {
        const seq = await this.nextSequence(ctx.tenantId, m.conversationId, false);
        return t.messages.findOneAndUpdate(
          { _id: messageId },
          {
            $set: {
              content: { text: '', mentions: [] },
              deletedAt: new Date(),
              changeSequence: seq,
              metadata: { deletedBy: ctx.userId },
            },
          },
          { returnDocument: 'after' },
        );
      },
    );
    const dto = toMessage(updated!);
    this.realtime.toConversation(ctx.tenantId, m.conversationId, 'message:updated', dto);
    await this.notifications.onMessageDeleted(ctx.tenantId, messageId);
    return dto;
  }

  /**
   * Idempotent reaction toggle. A real change bumps changeSequence (so cursor sync
   * carries it to every device) and is broadcast as `message:updated`; a no-op returns
   * the current message without touching the sequence.
   */
  async react(ctx: TenantContext, input: unknown): Promise<Message> {
    const req = parse(SetReactionRequestSchema, input);
    const t = this.db.for(ctx.tenantId);
    const m = await t.messages.findOne({ _id: req.messageId });
    if (!m) throw notFound('Message');
    await this.conversations.authorize(ctx, m.conversationId, 'message.react');
    if (m.deletedAt) throw new AppError('CONFLICT', 'Message was deleted');
    await this.rateLimit.consume('reaction', `${ctx.tenantId}:${ctx.userId}`);

    const result = await withLock(
      this.redis,
      this.lockKey(ctx.tenantId, m.conversationId),
      async () => {
        // Re-read inside the lock: every reaction write for this conversation is serialized here.
        const cur = await t.messages.findOne({ _id: req.messageId });
        if (!cur || cur.deletedAt) throw new AppError('CONFLICT', 'Message was deleted');
        const reactions = (cur.reactions ?? []).map((r) => ({ ...r, userIds: [...r.userIds] }));
        const existing = reactions.find((r) => r.emoji === req.emoji);
        const has = existing?.userIds.includes(ctx.userId) ?? false;
        if (req.op === 'add' ? has : !has) return { doc: cur, changed: false };
        if (req.op === 'add') {
          if (existing) existing.userIds.push(ctx.userId);
          else {
            if (reactions.length >= MAX_REACTIONS_PER_MESSAGE) {
              throw new AppError(
                'VALIDATION_FAILED',
                'This message has too many different reactions',
              );
            }
            reactions.push({ emoji: req.emoji, userIds: [ctx.userId] });
          }
        } else {
          existing!.userIds = existing!.userIds.filter((u) => u !== ctx.userId);
        }
        const next = reactions.filter((r) => r.userIds.length > 0);
        const seq = await this.nextSequence(ctx.tenantId, m.conversationId, false);
        const doc = await t.messages.findOneAndUpdate(
          { _id: req.messageId },
          { $set: { reactions: next, changeSequence: seq } },
          { returnDocument: 'after' },
        );
        return { doc: doc!, changed: true };
      },
    );
    const dto = toMessage(result.doc);
    if (result.changed) {
      this.realtime.toConversation(ctx.tenantId, m.conversationId, 'message:updated', dto);
    }
    return dto;
  }

  async history(ctx: TenantContext, conversationId: string, query: unknown): Promise<Message[]> {
    const q = parse(ListMessagesQuerySchema, query);
    await this.conversations.authorize(ctx, conversationId, 'conversation.read');
    const docs = await this.db
      .for(ctx.tenantId)
      .messages.find(
        { conversationId, ...(q.before ? { serverSequence: { $lt: q.before } } : {}) },
        { sort: { serverSequence: -1 }, limit: q.limit },
      )
      .toArray();
    return docs.reverse().map(toMessage);
  }

  /** Delivered/read watermarks. Watermarks only move forward. */
  async ackReceipt(ctx: TenantContext, input: unknown): Promise<Receipt> {
    const req = parse(AckReceiptRequestSchema, input);
    const { conversation } = await this.conversations.authorize(
      ctx,
      req.conversationId,
      'conversation.read',
    );
    const t = this.db.for(ctx.tenantId);
    const upTo = Math.min(req.upToSequence, conversation.lastChangeSequence);
    const $max: Record<string, number> = { deliveredUpTo: upTo };
    if (req.kind === 'read') $max.readUpTo = upTo;
    const doc = await t.message_receipts.findOneAndUpdate(
      { conversationId: req.conversationId, userId: ctx.userId },
      {
        $max,
        $set: { updatedAt: new Date() },
        $setOnInsert: {
          conversationId: req.conversationId,
          userId: ctx.userId,
          ...(req.kind === 'read' ? {} : { readUpTo: 0 }),
        },
      } as never,
      { upsert: true, returnDocument: 'after' },
    );
    const receipt = toReceipt(doc!);
    const memberCount = await t.conversation_members.countDocuments({
      conversationId: req.conversationId,
    });
    if (memberCount <= RECEIPT_TRACKING_MAX_MEMBERS) {
      this.realtime.toConversation(ctx.tenantId, req.conversationId, 'receipt:updated', receipt);
    } else {
      this.realtime.toUser(ctx.tenantId, ctx.userId, 'receipt:updated', receipt);
    }
    return receipt;
  }
}
