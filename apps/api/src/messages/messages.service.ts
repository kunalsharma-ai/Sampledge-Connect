import { Inject, Injectable, Logger } from '@nestjs/common';
import { MongoServerError } from 'mongodb';
import type { Redis } from 'ioredis';
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  AckReceiptRequestSchema,
  CreatePollRequestSchema,
  PollVoteRequestSchema,
  type MyPollVote,
  EditMessageRequestSchema,
  ListMessagesQuerySchema,
  MAX_PINS_PER_CONVERSATION,
  MAX_REACTIONS_PER_MESSAGE,
  RECEIPT_TRACKING_MAX_MEMBERS,
  SendMessageRequestSchema,
  SetReactionRequestSchema,
  type Message,
  type Receipt,
  type SendMessageAck,
  uuidv7,
} from '@sampledge/contracts';
import { AppError, forbidden, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import type { AttachmentDoc, AttachmentSnapshot, MessageDoc } from '../database/documents.js';
import { TenantDb, newId } from '../database/tenant-db.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';
import { REDIS, RateLimitService } from '../redis/redis.module.js';
import { withLock } from '../redis/lock.js';
import { pollClosedAt, toMessage, toReceipt } from './message.mapper.js';
import { WebhooksService } from '../integrations/webhooks.service.js';

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
    private readonly webhooks: WebhooksService,
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
    const forward = req.forwardOf
      ? await this.prepareForward(ctx, req.forwardOf, req.conversationId, ordered.length)
      : null;

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
          attachmentIds: [...attachmentIds, ...(forward?.copies.map((c) => c._id) ?? [])],
          attachments: [...ordered, ...(forward?.copies ?? [])].map((f) => ({
            attachmentId: f._id,
            fileName: f.fileName,
            mimeType: f.mimeType,
            sizeBytes: f.sizeBytes,
            width: f.width,
            height: f.height,
            createdAt: f.createdAt,
            recording: f.recording ?? null,
            durationMs: f.durationMs ?? null,
          })),
          replyToMessageId: req.replyToMessageId ?? null,
          serverSequence: seq,
          changeSequence: seq,
          createdAt: new Date(),
          editedAt: null,
          deletedAt: null,
          metadata: {
            ...(req.composedAt ? { composedAt: req.composedAt } : {}),
            ...(forward ? { forwarded: forward.snapshot } : {}),
          },
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
    // Forwarded files become rows of the target conversation that share the original bytes.
    if (forward?.copies.length)
      await t.attachments.insertMany(forward.copies.map((c) => ({ ...c, messageId: doc._id })));
    const message = toMessage(doc);
    this.realtime.toConversation(ctx.tenantId, req.conversationId, 'message:new', message);
    try {
      await this.notifications.onMessageCreated(ctx.tenantId, doc, replyParentSenderId);
    } catch (e) {
      // The message is committed and delivered; a missed notification must not fail the send.
      this.log.error(`notification fan-out failed for ${doc._id}: ${String(e)}`);
    }
    // Webhook subscribers of linked (module record) conversations. Best effort, never blocks.
    void this.webhooks
      .onMessageCreated(ctx.tenantId, doc)
      .catch((e) => this.log.warn(`webhook fan-out failed for ${doc._id}: ${String(e)}`));
    return { clientMessageId: req.clientMessageId, message, duplicate: false };
  }

  /**
   * Checks a forward and builds what the new message carries: a snapshot of the original (the
   * first original when forwarding a forward) and copies of its files for the target.
   */
  private async prepareForward(
    ctx: TenantContext,
    sourceId: string,
    targetConversationId: string,
    ownFiles: number,
  ) {
    const t = this.db.for(ctx.tenantId);
    const src = await t.messages.findOne({ _id: sourceId });
    if (!src || src.deletedAt || src.messageType !== 'text' || src.poll)
      throw new AppError('VALIDATION_FAILED', 'That message can’t be forwarded');
    // Not readable looks like not found, so private ids do not leak.
    const { conversation } = await this.conversations.authorize(
      ctx,
      src.conversationId,
      'conversation.read',
    );
    if (conversation.allowForwarding === false && src.conversationId !== targetConversationId)
      throw forbidden('Forwarding is turned off in that conversation');
    const prior = src.metadata?.forwarded as Record<string, unknown> | undefined;
    const names = async () => {
      if (conversation.kind !== 'dm') return conversation.name ? `#${conversation.name}` : null;
      const other = (await this.conversations.memberIds(ctx.tenantId, conversation._id)).find(
        (id) => id !== ctx.userId,
      );
      const u = other ? await t.users.findOne({ _id: other }) : null;
      return u?.displayName ?? null;
    };
    const snapshot =
      prior && typeof prior.messageId === 'string'
        ? prior
        : {
            messageId: src._id,
            conversationId: src.conversationId,
            senderId: src.senderId,
            text: src.content.text,
            createdAt: src.createdAt.toISOString(),
            from: conversation.kind === 'group' ? (conversation.name ?? null) : await names(),
          };
    const live = (src.attachments ?? []).filter((a) => !a.deletedAt);
    if (live.length + ownFiles > MAX_ATTACHMENTS_PER_MESSAGE)
      throw new AppError('VALIDATION_FAILED', 'Too many files to forward with this message');
    const originals = live.length
      ? await t.attachments
          .find({ _id: { $in: live.map((a) => a.attachmentId) }, deletedAt: null, status: 'ready' })
          .toArray()
      : [];
    const now = new Date();
    const copies: (Omit<AttachmentDoc, 'tenantId'> & { _id: string })[] = originals.map((o) => ({
      ...o,
      _id: newId(),
      conversationId: targetConversationId,
      uploaderId: ctx.userId,
      messageId: null,
      createdAt: now,
      copyOf: o.copyOf ?? o._id,
      callId: null,
    }));
    return { snapshot, copies };
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
    if (m.senderId !== ctx.userId || m.messageType === 'system')
      throw new AppError('FORBIDDEN', 'You can only edit your own messages');
    if (m.poll)
      throw new AppError('CONFLICT', 'Polls can’t be edited. Close it and start a new one.');
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

  /**
   * Posts a server-authored system message (for example a call card) on behalf of `senderId`.
   * It syncs and renders like any message but never notifies, and members cannot edit it.
   */
  async postSystem(
    tenantId: string,
    conversationId: string,
    senderId: string,
    text: string,
    metadata: Record<string, unknown>,
    attachments: AttachmentSnapshot[] = [],
  ): Promise<Message> {
    const t = this.db.for(tenantId);
    const doc = await withLock(this.redis, this.lockKey(tenantId, conversationId), async () => {
      const seq = await this.nextSequence(tenantId, conversationId, true);
      return t.messages.insertOne({
        conversationId,
        clientMessageId: uuidv7(),
        senderId,
        senderDeviceId: 'server',
        messageType: 'system',
        content: { text, mentions: [] },
        attachmentIds: attachments.map((a) => a.attachmentId),
        ...(attachments.length ? { attachments } : {}),
        replyToMessageId: null,
        serverSequence: seq,
        changeSequence: seq,
        createdAt: new Date(),
        editedAt: null,
        deletedAt: null,
        metadata,
      });
    });
    const message = toMessage(doc);
    this.realtime.toConversation(tenantId, conversationId, 'message:new', message);
    return message;
  }

  /**
   * A text message from an external meeting guest (see GuestsService). The sender is the
   * guest's identity, never a user id, and `metadata.guest` carries their name.
   */
  async postGuest(
    tenantId: string,
    conversationId: string,
    guest: { guestId: string; name: string },
    text: string,
  ): Promise<Message> {
    const t = this.db.for(tenantId);
    const doc = await withLock(this.redis, this.lockKey(tenantId, conversationId), async () => {
      const seq = await this.nextSequence(tenantId, conversationId, true);
      return t.messages.insertOne({
        conversationId,
        clientMessageId: uuidv7(),
        senderId: `guest:${guest.guestId}`,
        senderDeviceId: 'guest',
        messageType: 'text',
        content: { text, mentions: [] },
        attachmentIds: [],
        replyToMessageId: null,
        serverSequence: seq,
        changeSequence: seq,
        createdAt: new Date(),
        editedAt: null,
        deletedAt: null,
        metadata: { guest: { guestId: guest.guestId, name: guest.name } },
      });
    });
    const message = toMessage(doc);
    this.realtime.toConversation(tenantId, conversationId, 'message:new', message);
    return message;
  }

  /** Replaces a system message's text and metadata (for example when a call ends). */
  async updateSystem(
    tenantId: string,
    messageId: string,
    text: string,
    metadata: Record<string, unknown>,
  ): Promise<Message | null> {
    const t = this.db.for(tenantId);
    const m = await t.messages.findOne({ _id: messageId, messageType: 'system' });
    if (!m || m.deletedAt) return null;
    const updated = await withLock(
      this.redis,
      this.lockKey(tenantId, m.conversationId),
      async () => {
        const seq = await this.nextSequence(tenantId, m.conversationId, false);
        return t.messages.findOneAndUpdate(
          { _id: messageId, deletedAt: null },
          { $set: { content: { text, mentions: [] }, metadata, changeSequence: seq } },
          { returnDocument: 'after' },
        );
      },
    );
    if (!updated) return null;
    const dto = toMessage(updated);
    this.realtime.toConversation(tenantId, m.conversationId, 'message:updated', dto);
    return dto;
  }

  /**
   * Marks one attachment on a message as deleted (its bytes are gone) so every device shows
   * "deleted" instead of a broken player. Bumps changeSequence so it syncs offline.
   */
  async markAttachmentDeleted(
    tenantId: string,
    messageId: string,
    attachmentId: string,
    at: Date,
  ): Promise<Message | null> {
    const t = this.db.for(tenantId);
    const m = await t.messages.findOne({ _id: messageId });
    if (!m) return null;
    const updated = await withLock(
      this.redis,
      this.lockKey(tenantId, m.conversationId),
      async () => {
        const seq = await this.nextSequence(tenantId, m.conversationId, false);
        return t.messages.findOneAndUpdate(
          { _id: messageId, 'attachments.attachmentId': attachmentId },
          { $set: { 'attachments.$.deletedAt': at, changeSequence: seq } },
          { returnDocument: 'after' },
        );
      },
    );
    if (!updated) return null;
    const dto = toMessage(updated);
    this.realtime.toConversation(tenantId, m.conversationId, 'message:updated', dto);
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
      m.senderId === ctx.userId && m.messageType !== 'system'
        ? 'message.delete.own'
        : 'message.delete.any',
    );
    if (m.deletedAt) return toMessage(m);
    return this.tombstone(ctx.tenantId, m, ctx.userId);
  }

  /**
   * SampConnect Network moderation: a platform operator or community moderator removes a
   * reported message. Authorization is done by the caller (ModerationService).
   */
  async removeAsModerator(
    tenantId: string,
    messageId: string,
    byUserId: string,
  ): Promise<Message | null> {
    const m = await this.db.for(tenantId).messages.findOne({ _id: messageId });
    if (!m) return null;
    if (m.deletedAt) return toMessage(m);
    return this.tombstone(tenantId, m, byUserId, true);
  }

  private async tombstone(
    tenantId: string,
    m: MessageDoc,
    byUserId: string,
    moderated = false,
  ): Promise<Message> {
    const t = this.db.for(tenantId);
    const updated = await withLock(
      this.redis,
      this.lockKey(tenantId, m.conversationId),
      async () => {
        const seq = await this.nextSequence(tenantId, m.conversationId, false);
        return t.messages.findOneAndUpdate(
          { _id: m._id },
          {
            $set: {
              content: { text: '', mentions: [] },
              pinned: null,
              deletedAt: new Date(),
              changeSequence: seq,
              metadata: { deletedBy: byUserId, ...(moderated ? { moderated: true } : {}) },
            },
          },
          { returnDocument: 'after' },
        );
      },
    );
    const dto = toMessage(updated!);
    this.realtime.toConversation(tenantId, m.conversationId, 'message:updated', dto);
    await this.notifications.onMessageDeleted(tenantId, m._id);
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

  // ---------- polls ----------

  /** Post a poll. Idempotent on clientMessageId, like an ordinary send. */
  async createPoll(ctx: TenantContext, conversationId: string, input: unknown): Promise<Message> {
    const req = parse(CreatePollRequestSchema, input);
    const t = this.db.for(ctx.tenantId);
    const existing = await t.messages.findOne({ clientMessageId: req.clientMessageId });
    if (existing) return this.duplicateAck(ctx, existing, conversationId).message;
    await this.rateLimit.consume('message_send', `${ctx.tenantId}:${ctx.userId}`);
    await this.conversations.authorize(ctx, conversationId, 'message.send');
    const closesAt = req.closesAt ? new Date(req.closesAt) : null;
    if (closesAt && closesAt.getTime() < Date.now() + 60_000)
      throw new AppError('VALIDATION_FAILED', 'The closing time must be at least a minute away');
    let doc: MessageDoc;
    try {
      doc = await withLock(this.redis, this.lockKey(ctx.tenantId, conversationId), async () => {
        const seq = await this.nextSequence(ctx.tenantId, conversationId, true);
        return t.messages.insertOne({
          conversationId,
          clientMessageId: req.clientMessageId,
          senderId: ctx.userId,
          senderDeviceId: ctx.deviceId,
          messageType: 'text',
          // Older clients render the question as plain text.
          content: { text: `📊 ${req.question}`, mentions: [] },
          attachmentIds: [],
          replyToMessageId: null,
          serverSequence: seq,
          changeSequence: seq,
          createdAt: new Date(),
          editedAt: null,
          deletedAt: null,
          metadata: {},
          poll: {
            question: req.question,
            options: req.options.map((text, i) => ({ optionId: `o${i + 1}`, text })),
            multiple: req.multiple,
            anonymous: req.anonymous,
            closesAt,
            closedAt: null,
            closedBy: null,
            votes: [],
          },
        });
      });
    } catch (e) {
      if (e instanceof MongoServerError && e.code === 11000) {
        const winner = await t.messages.findOne({ clientMessageId: req.clientMessageId });
        if (winner) return this.duplicateAck(ctx, winner, conversationId).message;
      }
      throw e;
    }
    const message = toMessage(doc);
    this.realtime.toConversation(ctx.tenantId, conversationId, 'message:new', message);
    try {
      await this.notifications.onMessageCreated(ctx.tenantId, doc, null);
    } catch (e) {
      this.log.error(`notification fan-out failed for ${doc._id}: ${String(e)}`);
    }
    return message;
  }

  /** Replace the caller's vote. An empty list withdraws it. */
  async votePoll(ctx: TenantContext, messageId: string, input: unknown): Promise<Message> {
    const req = parse(PollVoteRequestSchema, input);
    const t = this.db.for(ctx.tenantId);
    const m = await t.messages.findOne({ _id: messageId });
    if (!m?.poll) throw notFound('Poll');
    await this.conversations.authorize(ctx, m.conversationId, 'message.react');
    const optionIds = [...new Set(req.optionIds)];
    if (optionIds.some((id) => !m.poll!.options.some((o) => o.optionId === id)))
      throw new AppError('VALIDATION_FAILED', 'Unknown poll option');
    if (!m.poll.multiple && optionIds.length > 1)
      throw new AppError('VALIDATION_FAILED', 'This poll allows one choice');
    const dto = await this.mutatePoll(ctx, m, (poll) => {
      if (pollClosedAt(poll)) throw new AppError('CONFLICT', 'This poll is closed');
      const mine = poll.votes.find((v) => v.userId === ctx.userId);
      if (mine && mine.optionIds.join() === optionIds.join()) return false;
      poll.votes = optionIds.length
        ? mine
          ? poll.votes.map((v) => (v.userId === ctx.userId ? { ...v, optionIds } : v))
          : [...poll.votes, { userId: ctx.userId, optionIds, at: new Date() }]
        : poll.votes.filter((v) => v.userId !== ctx.userId);
      return true;
    });
    // Your other devices learn your choice even when the poll hides who voted.
    this.realtime.toUser(ctx.tenantId, ctx.userId, 'poll:myVote', { messageId, optionIds });
    return dto;
  }

  /** Close voting. The author or a moderator can close. */
  async closePoll(ctx: TenantContext, messageId: string): Promise<Message> {
    const t = this.db.for(ctx.tenantId);
    const m = await t.messages.findOne({ _id: messageId });
    if (!m?.poll) throw notFound('Poll');
    if (m.senderId === ctx.userId)
      await this.conversations.authorize(ctx, m.conversationId, 'message.react');
    else await this.conversations.authorize(ctx, m.conversationId, 'message.delete.any');
    return this.mutatePoll(ctx, m, (poll) => {
      if (pollClosedAt(poll)) return false;
      poll.closedAt = new Date();
      poll.closedBy = ctx.userId;
      return true;
    });
  }

  /** The caller's own choice; the only way to see it in an anonymous poll. */
  async myPollVote(ctx: TenantContext, messageId: string): Promise<MyPollVote> {
    const m = await this.db.for(ctx.tenantId).messages.findOne({ _id: messageId });
    if (!m?.poll) throw notFound('Poll');
    await this.conversations.authorize(ctx, m.conversationId, 'conversation.read');
    return {
      messageId,
      optionIds: m.poll.votes.find((v) => v.userId === ctx.userId)?.optionIds ?? [],
    };
  }

  private async mutatePoll(
    ctx: TenantContext,
    m: MessageDoc,
    change: (poll: NonNullable<MessageDoc['poll']>) => boolean,
  ): Promise<Message> {
    const t = this.db.for(ctx.tenantId);
    if (m.deletedAt) throw new AppError('CONFLICT', 'Message was deleted');
    const result = await withLock(
      this.redis,
      this.lockKey(ctx.tenantId, m.conversationId),
      async () => {
        const cur = await t.messages.findOne({ _id: m._id });
        if (!cur?.poll || cur.deletedAt) throw new AppError('CONFLICT', 'Message was deleted');
        const poll = { ...cur.poll, votes: [...cur.poll.votes] };
        if (!change(poll)) return { doc: cur, changed: false };
        const seq = await this.nextSequence(ctx.tenantId, m.conversationId, false);
        const doc = await t.messages.findOneAndUpdate(
          { _id: m._id },
          { $set: { poll, changeSequence: seq } },
          { returnDocument: 'after' },
        );
        return { doc: doc!, changed: true };
      },
    );
    const dto = toMessage(result.doc);
    if (result.changed)
      this.realtime.toConversation(ctx.tenantId, m.conversationId, 'message:updated', dto);
    return dto;
  }

  /** Pin or unpin a message for everyone in the conversation. Idempotent. */
  async pin(ctx: TenantContext, messageId: string, pin: boolean): Promise<Message> {
    const t = this.db.for(ctx.tenantId);
    const m = await t.messages.findOne({ _id: messageId });
    if (!m) throw notFound('Message');
    await this.conversations.authorize(ctx, m.conversationId, 'message.pin');
    if (m.deletedAt) throw new AppError('CONFLICT', 'Message was deleted');
    const result = await withLock(
      this.redis,
      this.lockKey(ctx.tenantId, m.conversationId),
      async () => {
        const cur = await t.messages.findOne({ _id: messageId });
        if (!cur || cur.deletedAt) throw new AppError('CONFLICT', 'Message was deleted');
        if (!!cur.pinned === pin) return { doc: cur, changed: false };
        if (pin) {
          const pins = await t.messages.countDocuments({
            conversationId: m.conversationId,
            'pinned.pinnedAt': { $type: 'date' },
          });
          if (pins >= MAX_PINS_PER_CONVERSATION) {
            throw new AppError(
              'VALIDATION_FAILED',
              `A conversation can have up to ${MAX_PINS_PER_CONVERSATION} pinned messages`,
            );
          }
        }
        const seq = await this.nextSequence(ctx.tenantId, m.conversationId, false);
        const doc = await t.messages.findOneAndUpdate(
          { _id: messageId },
          {
            $set: {
              pinned: pin ? { pinnedBy: ctx.userId, pinnedAt: new Date() } : null,
              changeSequence: seq,
            },
          },
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
