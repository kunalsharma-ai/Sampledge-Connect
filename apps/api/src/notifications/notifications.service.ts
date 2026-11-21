import { Injectable } from '@nestjs/common';
import { MongoBulkWriteError, MongoServerError } from 'mongodb';
import {
  ListNotificationsQuerySchema,
  MarkNotificationsReadRequestSchema,
  NOTIFICATION_PREVIEW_LENGTH,
  type Notification,
  type NotificationPage,
} from '@sampledge/contracts';
import { parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import type { MessageDoc, NotificationDoc } from '../database/documents.js';
import { TenantDb } from '../database/tenant-db.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';

export const toNotification = (n: NotificationDoc): Notification => ({
  notificationId: n._id,
  kind: n.kind,
  conversationId: n.conversationId,
  messageId: n.messageId,
  actorId: n.actorId,
  preview: n.preview,
  createdAt: n.createdAt.toISOString(),
  readAt: n.readAt?.toISOString() ?? null,
});

export function previewOf(m: Pick<MessageDoc, 'content' | 'attachments'>): string {
  const text = m.content.text.replace(/\s+/g, ' ').trim();
  if (text) {
    return text.length > NOTIFICATION_PREVIEW_LENGTH
      ? `${text.slice(0, NOTIFICATION_PREVIEW_LENGTH - 1)}…`
      : text;
  }
  const n = m.attachments?.length ?? 0;
  return n ? `${n} attachment${n > 1 ? 's' : ''}` : '';
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly db: TenantDb,
    private readonly realtime: RealtimePublisher,
  ) {}

  /**
   * Fan-out for a newly created message. Recipients must be current members of the
   * conversation and never the sender. A mention wins over a reply for the same user.
   * Runs after the message is committed; failures are logged by the caller, not thrown,
   * because the message itself has already been delivered.
   */
  async onMessageCreated(
    tenantId: string,
    message: MessageDoc,
    replyParentSenderId: string | null,
    memberIds: string[],
  ): Promise<void> {
    const members = new Set(memberIds);
    const kinds = new Map<string, NotificationDoc['kind']>();
    if (replyParentSenderId) kinds.set(replyParentSenderId, 'reply');
    for (const u of message.content.mentions) kinds.set(u, 'mention');
    kinds.delete(message.senderId);
    for (const u of kinds.keys()) if (!members.has(u)) kinds.delete(u);
    if (kinds.size === 0) return;

    const t = this.db.for(tenantId);
    const preview = previewOf(message);
    const now = new Date();
    let docs: NotificationDoc[];
    try {
      docs = await t.notifications.insertMany(
        [...kinds].map(([userId, kind]) => ({
          userId,
          kind,
          conversationId: message.conversationId,
          messageId: message._id,
          actorId: message.senderId,
          preview,
          createdAt: now,
          readAt: null,
        })),
      );
    } catch (e) {
      // A duplicate means this fan-out already ran (e.g. a retried request); nothing to add.
      if ((e instanceof MongoBulkWriteError || e instanceof MongoServerError) && e.code === 11000) {
        return;
      }
      throw e;
    }
    for (const d of docs)
      this.realtime.toUser(tenantId, d.userId, 'notification:new', toNotification(d));
  }

  /** A deleted message no longer notifies anyone. */
  async onMessageDeleted(tenantId: string, messageId: string): Promise<void> {
    await this.db.for(tenantId).notifications.deleteMany({ messageId });
  }

  /** Conversation ids among `ids` that the user is still a member of. */
  private async stillMember(ctx: TenantContext, ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.db
      .for(ctx.tenantId)
      .conversation_members.find(
        { userId: ctx.userId, conversationId: { $in: [...new Set(ids)] } },
        { projection: { conversationId: 1 } },
      )
      .toArray();
    return new Set(rows.map((r) => r.conversationId));
  }

  private async unreadCount(ctx: TenantContext): Promise<number> {
    const t = this.db.for(ctx.tenantId);
    const unread = await t.notifications
      .find(
        { userId: ctx.userId, readAt: null },
        { projection: { conversationId: 1 }, limit: 1000 },
      )
      .toArray();
    const ok = await this.stillMember(
      ctx,
      unread.map((n) => n.conversationId),
    );
    return unread.filter((n) => ok.has(n.conversationId)).length;
  }

  async list(ctx: TenantContext, query: unknown): Promise<NotificationPage> {
    const q = parse(ListNotificationsQuerySchema, query);
    const t = this.db.for(ctx.tenantId);
    const rows = await t.notifications
      .find(
        {
          userId: ctx.userId,
          ...(q.unread ? { readAt: null } : {}),
          ...(q.before ? { _id: { $lt: q.before } } : {}),
        },
        { sort: { _id: -1 }, limit: q.limit + 1 },
      )
      .toArray();
    const more = rows.length > q.limit;
    const page = rows.slice(0, q.limit);
    const ok = await this.stillMember(
      ctx,
      page.map((n) => n.conversationId),
    );
    return {
      items: page.filter((n) => ok.has(n.conversationId)).map(toNotification),
      unreadCount: await this.unreadCount(ctx),
      nextBefore: more ? page.at(-1)!._id : null,
    };
  }

  async markRead(ctx: TenantContext, body: unknown): Promise<{ unreadCount: number }> {
    const req = parse(MarkNotificationsReadRequestSchema, body);
    const t = this.db.for(ctx.tenantId);
    const scope =
      'notificationIds' in req
        ? { _id: { $in: req.notificationIds } }
        : 'conversationId' in req
          ? { conversationId: req.conversationId }
          : {};
    const r = await t.notifications.updateMany(
      { userId: ctx.userId, readAt: null, ...scope },
      { $set: { readAt: new Date() } },
    );
    const unreadCount = await this.unreadCount(ctx);
    if (r.modifiedCount > 0) {
      this.realtime.toUser(ctx.tenantId, ctx.userId, 'notification:read', { unreadCount });
    }
    return { unreadCount };
  }
}
