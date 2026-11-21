import { Inject, Injectable, Logger } from '@nestjs/common';
import { MongoBulkWriteError, MongoServerError } from 'mongodb';
import {
  ListNotificationsQuerySchema,
  MarkNotificationsReadRequestSchema,
  NOTIFICATION_PREVIEW_LENGTH,
  type Notification,
  type NotificationPage,
  type CallPushData,
  type PushData,
} from '@sampledge/contracts';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PushProviders, type PushMessage } from '../push/push-provider.js';
import { parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import type {
  CallDoc,
  ConversationDoc,
  MessageDoc,
  NotificationDoc,
} from '../database/documents.js';
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
  private readonly log = new Logger(NotificationsService.name);

  constructor(
    private readonly db: TenantDb,
    private readonly realtime: RealtimePublisher,
    private readonly pushProviders: PushProviders,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  /**
   * Fan-out for a newly created message, honouring each member's notify level:
   *  - mention: in-app + push, unless the level is 'none'.
   *  - reply to your message: in-app + push, only at level 'all'.
   *  - any message in a DM: push only (unread badges cover it in-app), only at level 'all'.
   * Recipients must be current members and never the sender. A mention wins over a reply.
   * Runs after the message is committed; the caller logs failures instead of failing the send.
   */
  async onMessageCreated(
    tenantId: string,
    message: MessageDoc,
    replyParentSenderId: string | null,
  ): Promise<void> {
    const t = this.db.for(tenantId);
    const [conversation, members] = await Promise.all([
      t.conversations.findOne({ _id: message.conversationId }),
      t.conversation_members
        .find(
          { conversationId: message.conversationId },
          { projection: { userId: 1, notifyLevel: 1 } },
        )
        .toArray(),
    ]);
    if (!conversation) return;
    const mentioned = new Set(message.content.mentions);
    const targets = new Map<string, NotificationDoc['kind'] | 'dm'>();
    for (const m of members) {
      if (m.userId === message.senderId) continue;
      const level = m.notifyLevel ?? 'all';
      if (level === 'none') continue;
      if (mentioned.has(m.userId)) targets.set(m.userId, 'mention');
      else if (level === 'all' && m.userId === replyParentSenderId) targets.set(m.userId, 'reply');
      else if (level === 'all' && conversation.kind === 'dm') targets.set(m.userId, 'dm');
    }
    if (targets.size === 0) return;

    const preview = previewOf(message);
    const now = new Date();
    const inApp = [...targets].filter((x): x is [string, NotificationDoc['kind']] => x[1] !== 'dm');
    let created: NotificationDoc[] = [];
    if (inApp.length) {
      try {
        created = await t.notifications.insertMany(
          inApp.map(([userId, kind]) => ({
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
        // A duplicate means this fan-out already ran (a retried request): send nothing twice.
        if (
          (e instanceof MongoBulkWriteError || e instanceof MongoServerError) &&
          e.code === 11000
        ) {
          return;
        }
        throw e;
      }
      for (const d of created)
        this.realtime.toUser(tenantId, d.userId, 'notification:new', toNotification(d));
    }

    void this.push(tenantId, message, conversation, targets, created, preview).catch((e) =>
      this.log.warn(`push fan-out failed for ${message._id}: ${String(e)}`),
    );
  }

  private async push(
    tenantId: string,
    message: MessageDoc,
    conversation: ConversationDoc,
    targets: Map<string, NotificationDoc['kind'] | 'dm'>,
    created: NotificationDoc[],
    preview: string,
  ) {
    const provider = await this.pushProviders.forTenant(tenantId);
    if (provider.name === null) return;
    const t = this.db.for(tenantId);
    const devices = await t.devices
      .find({
        userId: { $in: [...targets.keys()] },
        revokedAt: null,
        'push.token': { $exists: true },
      })
      .toArray();
    const sendable = devices.filter((d) => d.push && provider.accepts(d.push.provider));
    if (sendable.length === 0) return;

    const sender = await t.users.findOne(
      { _id: message.senderId },
      { projection: { displayName: 1 } },
    );
    const senderName = sender?.displayName ?? 'Someone';
    const title =
      conversation.kind === 'dm'
        ? senderName
        : `${senderName} in ${conversation.kind === 'group' ? (conversation.name ?? 'a group') : `#${conversation.name ?? 'channel'}`}`;
    const byUser = new Map(created.map((n) => [n.userId, n]));
    const live = new Map<string, Set<string>>();
    const unread = new Map<string, number>();
    const messages: PushMessage[] = [];
    for (const d of sendable) {
      if (!live.has(d.userId))
        live.set(d.userId, await this.realtime.liveSessions(tenantId, d.userId));
      // The app is open on this device: it already shows the message in real time.
      if (live.get(d.userId)!.has(d._id)) continue;
      if (!unread.has(d.userId))
        unread.set(
          d.userId,
          await t.notifications.countDocuments({ userId: d.userId, readAt: null }),
        );
      const kind = targets.get(d.userId)!;
      const n = byUser.get(d.userId) ?? null;
      const data: PushData = {
        type: 'message',
        conversationId: message.conversationId,
        messageId: message._id,
        kind,
        notificationId: n?._id ?? null,
        unreadCount: unread.get(d.userId)!,
      };
      messages.push({
        token: d.push!.token,
        title,
        body: provider.showPreviews
          ? kind === 'mention'
            ? `Mentioned you: ${preview}`
            : kind === 'reply'
              ? `Replied: ${preview}`
              : preview
          : kind === 'mention'
            ? 'Mentioned you'
            : kind === 'reply'
              ? 'Replied to your message'
              : 'New message',
        data: { ...data },
        badge: data.unreadCount,
      });
    }
    if (messages.length === 0) return;
    const { invalidTokens } = await provider.send(messages);
    if (invalidTokens.length)
      await t.devices.updateMany(
        { 'push.token': { $in: invalidTokens } },
        { $set: { push: null } },
      );
  }

  /**
   * Incoming-call push for invitees whose phone isn't connected right now (a connected app
   * already got `call:ringing`). Members who set the conversation to 'none' are not rung by push.
   */
  async pushCallRinging(
    tenantId: string,
    call: CallDoc,
    conversation: ConversationDoc,
    inviteeIds: string[],
    expiresAt: Date,
  ): Promise<void> {
    if (inviteeIds.length === 0) return;
    const provider = await this.pushProviders.forTenant(tenantId);
    if (provider.name === null) return;
    const t = this.db.for(tenantId);
    const muted = new Set(
      (
        await t.conversation_members
          .find(
            { conversationId: conversation._id, userId: { $in: inviteeIds }, notifyLevel: 'none' },
            { projection: { userId: 1 } },
          )
          .toArray()
      ).map((m) => m.userId),
    );
    const targets = inviteeIds.filter((id) => !muted.has(id));
    if (!targets.length) return;
    const devices = (
      await t.devices
        .find({ userId: { $in: targets }, revokedAt: null, 'push.token': { $exists: true } })
        .toArray()
    ).filter((d) => d.push && provider.accepts(d.push.provider));
    if (!devices.length) return;
    const caller = await t.users.findOne(
      { _id: call.startedBy },
      { projection: { displayName: 1 } },
    );
    const callerName = caller?.displayName ?? 'Someone';
    const what = call.media === 'video' ? 'video call' : 'voice call';
    const body =
      conversation.kind === 'dm'
        ? `Incoming ${what}`
        : `${what[0]!.toUpperCase()}${what.slice(1)} in ${conversation.kind === 'group' ? (conversation.name ?? 'a group') : `#${conversation.name ?? 'channel'}`}`;
    const live = new Map<string, Set<string>>();
    const messages: PushMessage[] = [];
    for (const d of devices) {
      if (!live.has(d.userId))
        live.set(d.userId, await this.realtime.liveSessions(tenantId, d.userId));
      if (live.get(d.userId)!.has(d._id)) continue;
      const data: CallPushData = {
        type: 'call',
        callId: call._id,
        conversationId: conversation._id,
        media: call.media,
        callerId: call.startedBy,
        expiresAt: expiresAt.toISOString(),
      };
      messages.push({ token: d.push!.token, title: callerName, body, data: { ...data } });
    }
    if (!messages.length) return;
    const { invalidTokens } = await provider.send(messages);
    if (invalidTokens.length)
      await t.devices.updateMany(
        { 'push.token': { $in: invalidTokens } },
        { $set: { push: null } },
      );
  }

  /**
   * Generic push to users' devices that aren't connected right now (connected apps get the
   * socket event instead). Used for meeting invites, changes and reminders.
   */
  async pushToUsers(
    tenantId: string,
    userIds: string[],
    title: string,
    body: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    if (userIds.length === 0) return;
    const provider = await this.pushProviders.forTenant(tenantId);
    if (provider.name === null) return;
    const t = this.db.for(tenantId);
    const devices = (
      await t.devices
        .find({ userId: { $in: userIds }, revokedAt: null, 'push.token': { $exists: true } })
        .toArray()
    ).filter((d) => d.push && provider.accepts(d.push.provider));
    const live = new Map<string, Set<string>>();
    const messages: PushMessage[] = [];
    for (const d of devices) {
      if (!live.has(d.userId))
        live.set(d.userId, await this.realtime.liveSessions(tenantId, d.userId));
      if (live.get(d.userId)!.has(d._id)) continue;
      messages.push({ token: d.push!.token, title, body, data });
    }
    if (!messages.length) return;
    const { invalidTokens } = await provider.send(messages);
    if (invalidTokens.length)
      await t.devices.updateMany(
        { 'push.token': { $in: invalidTokens } },
        { $set: { push: null } },
      );
  }

  /**
   * Notifies chosen people about a server-posted card (module alerts, task assignments,
   * approval requests): in-app notification, live event and push. Respects each person's
   * notify level ('none' mutes, 'mentions' still gets these since they're addressed to them).
   * Idempotent per user and message.
   */
  async notifyAbout(
    tenantId: string,
    message: Pick<MessageDoc, '_id' | 'conversationId' | 'senderId' | 'content' | 'attachments'>,
    userIds: string[],
    kind: 'alert' | 'task' | 'approval',
    pushTitle: string,
  ): Promise<void> {
    const t = this.db.for(tenantId);
    const members = await t.conversation_members
      .find(
        { conversationId: message.conversationId, userId: { $in: userIds } },
        { projection: { userId: 1, notifyLevel: 1 } },
      )
      .toArray();
    const targets = members
      .filter((m) => m.userId !== message.senderId && (m.notifyLevel ?? 'all') !== 'none')
      .map((m) => m.userId);
    if (!targets.length) return;
    const preview = previewOf(message);
    const now = new Date();
    const created: NotificationDoc[] = [];
    for (const userId of targets) {
      try {
        created.push(
          await t.notifications.insertOne({
            userId,
            kind,
            conversationId: message.conversationId,
            messageId: message._id,
            actorId: message.senderId,
            preview,
            createdAt: now,
            readAt: null,
          }),
        );
      } catch (e) {
        if (e instanceof MongoServerError && e.code === 11000) continue;
        throw e;
      }
    }
    for (const d of created)
      this.realtime.toUser(tenantId, d.userId, 'notification:new', toNotification(d));
    void (async () => {
      for (const d of created) {
        const unreadCount = await t.notifications.countDocuments({
          userId: d.userId,
          readAt: null,
        });
        const data: PushData = {
          type: 'message',
          conversationId: message.conversationId,
          messageId: message._id,
          kind,
          notificationId: d._id,
          unreadCount,
        };
        await this.pushToUsers(tenantId, [d.userId], pushTitle, preview, { ...data });
      }
    })().catch((e) => this.log.warn(`push failed for ${message._id}: ${String(e)}`));
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
