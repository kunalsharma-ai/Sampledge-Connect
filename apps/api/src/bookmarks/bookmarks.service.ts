import { Injectable } from '@nestjs/common';
import { MongoServerError } from 'mongodb';
import { MAX_BOOKMARKS_PER_USER, type Bookmark } from '@sampledge/contracts';
import { AppError, notFound } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { TenantDb } from '../database/tenant-db.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { toMessage } from '../messages/message.mapper.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';

/** Private, per-user saved messages. Nobody else can see what you saved. */
@Injectable()
export class BookmarksService {
  constructor(
    private readonly db: TenantDb,
    private readonly conversations: ConversationsService,
    private readonly realtime: RealtimePublisher,
  ) {}

  async add(ctx: TenantContext, messageId: string): Promise<{ saved: true }> {
    const t = this.db.for(ctx.tenantId);
    const m = await t.messages.findOne({ _id: messageId });
    if (!m) throw notFound('Message');
    await this.conversations.authorize(ctx, m.conversationId, 'conversation.read');
    if ((await t.bookmarks.countDocuments({ userId: ctx.userId })) >= MAX_BOOKMARKS_PER_USER) {
      throw new AppError(
        'VALIDATION_FAILED',
        `You can save up to ${MAX_BOOKMARKS_PER_USER} messages`,
      );
    }
    try {
      await t.bookmarks.insertOne({
        userId: ctx.userId,
        messageId,
        conversationId: m.conversationId,
        createdAt: new Date(),
      });
    } catch (e) {
      if (!(e instanceof MongoServerError && e.code === 11000)) throw e; // already saved
    }
    this.realtime.toUser(ctx.tenantId, ctx.userId, 'bookmark:updated', { messageId, saved: true });
    return { saved: true };
  }

  async remove(ctx: TenantContext, messageId: string): Promise<void> {
    await this.db.for(ctx.tenantId).bookmarks.deleteMany({ userId: ctx.userId, messageId });
    this.realtime.toUser(ctx.tenantId, ctx.userId, 'bookmark:updated', { messageId, saved: false });
  }

  /** Newest first. Messages in conversations the caller can no longer read are left out. */
  async list(ctx: TenantContext): Promise<{ items: Bookmark[] }> {
    const t = this.db.for(ctx.tenantId);
    const rows = await t.bookmarks
      .find({ userId: ctx.userId }, { sort: { _id: -1 }, limit: MAX_BOOKMARKS_PER_USER })
      .toArray();
    if (rows.length === 0) return { items: [] };
    const readable = new Set(
      (await this.conversations.listReadable(ctx)).map((c) => c.conversationId),
    );
    const visible = rows.filter((r) => readable.has(r.conversationId));
    const messages = await t.messages
      .find({ _id: { $in: visible.map((r) => r.messageId) } })
      .toArray();
    const byId = new Map(messages.map((m) => [m._id, m]));
    return {
      items: visible
        .filter((r) => byId.has(r.messageId))
        .map((r) => ({
          messageId: r.messageId,
          conversationId: r.conversationId,
          createdAt: r.createdAt.toISOString(),
          message: toMessage(byId.get(r.messageId)!),
        })),
    };
  }
}
