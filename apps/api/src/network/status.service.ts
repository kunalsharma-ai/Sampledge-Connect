import { Injectable } from '@nestjs/common';
import { MongoServerError } from 'mongodb';
import {
  CreateStatusSchema,
  StatusMediaUploadSchema,
  StatusReplySchema,
  type NetworkStatus,
  type SendMessageAck,
  type StatusFeed,
  type UploadTicket,
} from '@sampledge/contracts';
import { AppError, forbidden, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import type { NetworkProfileDoc, NetworkStatusDoc } from '../database/documents.js';
import { AttachmentsService } from '../attachments/attachments.service.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { MessagesService } from '../messages/messages.service.js';
import { RateLimitService } from '../redis/redis.module.js';
import { NetworkPolicyService } from './network-policy.service.js';
import { NetworkService, toPerson } from './network.service.js';

interface Viewer {
  userId: string | null;
  connected: Set<string>;
  following: Set<string>;
  hidden: Set<string>;
}

/** Status updates: text, photo or video; expire after 24 hours by default; private replies. */
@Injectable()
export class StatusService {
  constructor(
    private readonly network: NetworkService,
    private readonly policy: NetworkPolicyService,
    private readonly attachments: AttachmentsService,
    private readonly conversations: ConversationsService,
    private readonly messages: MessagesService,
    private readonly rateLimit: RateLimitService,
  ) {}

  static canView(s: NetworkStatusDoc, v: Viewer): boolean {
    if (s.authorId === v.userId) return true;
    if (v.hidden.has(s.authorId)) return false;
    switch (s.audience) {
      case 'public':
        return true;
      case 'followers':
        return v.connected.has(s.authorId) || v.following.has(s.authorId);
      case 'connections':
        return v.connected.has(s.authorId);
      case 'selected':
        return !!v.userId && s.userIds.includes(v.userId);
    }
  }

  private async viewer(userId: string): Promise<Viewer> {
    const net = await this.network.net();
    const [conns, follows, hidden] = await Promise.all([
      net.network_connections.find({ userId }, { projection: { otherUserId: 1 } }).toArray(),
      net.network_follows
        .find({ followerId: userId, targetType: 'user' }, { projection: { targetId: 1 } })
        .toArray(),
      this.network.hiddenFor(userId),
    ]);
    return {
      userId,
      connected: new Set(conns.map((c) => c.otherUserId)),
      following: new Set(follows.map((f) => f.targetId)),
      hidden,
    };
  }

  async toDto(
    s: NetworkStatusDoc,
    author: NetworkProfileDoc,
    viewerId: string | null,
    viewed: boolean,
  ): Promise<NetworkStatus> {
    const net = await this.network.net();
    let media: NetworkStatus['media'] = null;
    if (s.attachmentId) {
      const tenantId = s.tenantId;
      const [u, a] = await Promise.all([
        this.attachments.signedUrlUnchecked(tenantId, s.attachmentId),
        net.attachments.findOne({ _id: s.attachmentId }, { projection: { mimeType: 1 } }),
      ]);
      if (u && a)
        media = {
          attachmentId: s.attachmentId,
          mimeType: a.mimeType,
          url: u.url,
          expiresAt: u.expiresAt,
        };
    }
    return {
      statusId: s._id,
      clientStatusId: s.clientStatusId,
      author: toPerson(author),
      kind: s.kind,
      text: s.text,
      background: s.background as NetworkStatus['background'],
      media,
      audience: s.audience,
      allowReplies: s.allowReplies,
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      viewedByMe: viewed || s.authorId === viewerId,
      viewCount:
        s.authorId === viewerId
          ? await net.network_status_views.countDocuments({ statusId: s._id })
          : null,
    };
  }

  async mediaUpload(ctx: TenantContext, input: unknown): Promise<UploadTicket> {
    await this.network.assertNetwork(ctx);
    return this.attachments.createStatusUpload(ctx, parse(StatusMediaUploadSchema, input));
  }

  async create(ctx: TenantContext, input: unknown): Promise<NetworkStatus> {
    const net = await this.network.assertNetwork(ctx);
    const req = parse(CreateStatusSchema, input);
    const me = await this.network.requireProfile(ctx.userId);
    const existing = await net.network_statuses.findOne({ clientStatusId: req.clientStatusId });
    if (existing) {
      if (existing.authorId !== ctx.userId) throw new AppError('CONFLICT', 'Duplicate status id');
      return this.toDto(existing, me, ctx.userId, true);
    }
    if (me.homeTenantId && !(await this.policy.get(me.homeTenantId)).allowStatus)
      throw forbidden('Your organization turned off status updates');
    await this.rateLimit.consume('network_post', `status:${ctx.userId}`);
    if (req.attachmentId) {
      const a = await net.attachments.findOne({ _id: req.attachmentId });
      if (
        !a ||
        a.uploaderId !== ctx.userId ||
        a.conversationId !== `status:${ctx.userId}` ||
        a.status !== 'ready'
      )
        throw new AppError('VALIDATION_FAILED', 'Upload the photo or video first');
      const want = req.kind === 'image' ? /^image\// : /^video\//;
      if (!want.test(a.mimeType))
        throw new AppError(
          'VALIDATION_FAILED',
          `That file is not a ${req.kind === 'image' ? 'photo' : 'video'}`,
        );
    }
    const now = new Date();
    let doc: NetworkStatusDoc;
    try {
      doc = await net.network_statuses.insertOne({
        authorId: ctx.userId,
        clientStatusId: req.clientStatusId,
        kind: req.kind,
        text: req.text,
        background: req.background,
        attachmentId: req.attachmentId,
        audience: req.audience,
        userIds: req.audience === 'selected' ? [...new Set(req.userIds)] : [],
        allowReplies: req.allowReplies,
        createdAt: now,
        expiresAt: new Date(now.getTime() + req.expiresInHours * 3_600_000),
      });
    } catch (e) {
      if (e instanceof MongoServerError && e.code === 11000) {
        const raced = await net.network_statuses.findOne({ clientStatusId: req.clientStatusId });
        if (raced) return this.toDto(raced, me, ctx.userId, true);
      }
      throw e;
    }
    await this.network.changed(await this.audienceOf(doc), { scope: 'statuses', id: doc._id });
    return this.toDto(doc, me, ctx.userId, true);
  }

  /** Who should refresh their status feed when this status appears or disappears. */
  private async audienceOf(s: NetworkStatusDoc): Promise<string[]> {
    const net = await this.network.net();
    if (s.audience === 'selected') return [s.authorId, ...s.userIds];
    const [conns, followers] = await Promise.all([
      net.network_connections
        .find({ userId: s.authorId }, { projection: { otherUserId: 1 } })
        .toArray(),
      s.audience === 'connections'
        ? Promise.resolve([])
        : net.network_follows
            .find({ targetType: 'user', targetId: s.authorId }, { projection: { followerId: 1 } })
            .toArray(),
    ]);
    return [s.authorId, ...conns.map((c) => c.otherUserId), ...followers.map((f) => f.followerId)];
  }

  async feed(ctx: TenantContext): Promise<StatusFeed> {
    const net = await this.network.assertNetwork(ctx);
    const v = await this.viewer(ctx.userId);
    const authors = [...new Set([...v.connected, ...v.following])].filter(
      (id) => !v.hidden.has(id),
    );
    const now = new Date();
    const [mine, theirs] = await Promise.all([
      net.network_statuses
        .find({ authorId: ctx.userId, expiresAt: { $gt: now } }, { sort: { createdAt: 1 } })
        .toArray(),
      net.network_statuses
        .find(
          { authorId: { $in: authors }, expiresAt: { $gt: now } },
          { sort: { createdAt: 1 }, limit: 2000 },
        )
        .toArray(),
    ]);
    const visible = theirs.filter((s) => StatusService.canView(s, v));
    const views = await net.network_status_views
      .find(
        { viewerId: ctx.userId, statusId: { $in: visible.map((s) => s._id) } },
        { projection: { statusId: 1 } },
      )
      .toArray();
    const seen = new Set(views.map((x) => x.statusId));
    const profiles = await net.network_profiles
      .find({ userId: { $in: [ctx.userId, ...visible.map((s) => s.authorId)] } })
      .toArray();
    const byId = new Map(profiles.map((p) => [p.userId, p]));
    const me = byId.get(ctx.userId)!;
    const grouped = new Map<string, NetworkStatusDoc[]>();
    for (const s of visible) grouped.set(s.authorId, [...(grouped.get(s.authorId) ?? []), s]);
    const people = await Promise.all(
      [...grouped.entries()]
        .filter(([id]) => byId.has(id))
        .map(async ([id, list]) => ({
          person: toPerson(byId.get(id)!),
          statuses: await Promise.all(
            list.map((s) => this.toDto(s, byId.get(id)!, ctx.userId, seen.has(s._id))),
          ),
          unseen: list.filter((s) => !seen.has(s._id)).length,
        })),
    );
    people.sort(
      (a, b) =>
        Number(b.unseen > 0) - Number(a.unseen > 0) ||
        (b.statuses.at(-1)?.createdAt ?? '').localeCompare(a.statuses.at(-1)?.createdAt ?? ''),
    );
    return {
      mine: await Promise.all(mine.map((s) => this.toDto(s, me, ctx.userId, true))),
      people,
    };
  }

  /** Public statuses of a person, for their public page (no account needed). */
  async publicOf(profile: NetworkProfileDoc): Promise<NetworkStatus[]> {
    const net = await this.network.net();
    const rows = await net.network_statuses
      .find(
        { authorId: profile.userId, audience: 'public', expiresAt: { $gt: new Date() } },
        { sort: { createdAt: -1 }, limit: 20 },
      )
      .toArray();
    return Promise.all(rows.map((s) => this.toDto(s, profile, null, false)));
  }

  private async loadVisible(ctx: TenantContext, statusId: string) {
    const net = await this.network.assertNetwork(ctx);
    const s = await net.network_statuses.findOne({ _id: statusId, expiresAt: { $gt: new Date() } });
    if (!s || !StatusService.canView(s, await this.viewer(ctx.userId))) throw notFound('Status');
    return s;
  }

  async view(ctx: TenantContext, statusId: string): Promise<void> {
    const s = await this.loadVisible(ctx, statusId);
    if (s.authorId === ctx.userId) return;
    const net = await this.network.net();
    const res = await net.network_status_views.updateOne(
      { statusId, viewerId: ctx.userId },
      {
        $setOnInsert: {
          statusId,
          authorId: s.authorId,
          viewerId: ctx.userId,
          viewedAt: new Date(),
        } as never,
      },
      { upsert: true },
    );
    if (res.upsertedCount) {
      // Your other devices mark it seen; the author's view count goes up.
      await this.network.changed([ctx.userId, s.authorId], { scope: 'statuses', id: statusId });
    }
  }

  async viewers(ctx: TenantContext, statusId: string) {
    const net = await this.network.assertNetwork(ctx);
    const s = await net.network_statuses.findOne({ _id: statusId, authorId: ctx.userId });
    if (!s) throw notFound('Status');
    const views = await net.network_status_views
      .find({ statusId }, { sort: { viewedAt: -1 }, limit: 1000 })
      .toArray();
    const ps = await net.network_profiles
      .find({ userId: { $in: views.map((x) => x.viewerId) } })
      .toArray();
    const byId = new Map(ps.map((p) => [p.userId, p]));
    return views
      .filter((x) => byId.has(x.viewerId))
      .map((x) => ({
        person: toPerson(byId.get(x.viewerId)!),
        viewedAt: x.viewedAt.toISOString(),
      }));
  }

  async remove(ctx: TenantContext, statusId: string): Promise<void> {
    const net = await this.network.assertNetwork(ctx);
    const s = await net.network_statuses.findOne({ _id: statusId, authorId: ctx.userId });
    if (!s) return;
    await this.erase(s, ctx.userId);
  }

  /** Moderation: a platform operator removes a reported status. Returns false when it's gone. */
  async removeAsModerator(statusId: string, byUserId: string): Promise<boolean> {
    const net = await this.network.net();
    const s = await net.network_statuses.findOne({ _id: statusId });
    if (!s) return false;
    await this.erase(s, byUserId);
    return true;
  }

  /** Can this person see the status right now (for reports)? */
  async visibleTo(userId: string, statusId: string): Promise<NetworkStatusDoc | null> {
    const net = await this.network.net();
    const s = await net.network_statuses.findOne({ _id: statusId, expiresAt: { $gt: new Date() } });
    return s && StatusService.canView(s, await this.viewer(userId)) ? s : null;
  }

  private async erase(s: NetworkStatusDoc, byUserId: string) {
    const net = await this.network.net();
    const audience = await this.audienceOf(s);
    await net.network_statuses.deleteMany({ _id: s._id });
    await net.network_status_views.deleteMany({ statusId: s._id });
    if (s.attachmentId)
      await net.attachments.updateOne(
        { _id: s.attachmentId },
        { $set: { deletedAt: new Date(), deletedBy: byUserId } },
      );
    await this.network.changed(audience, { scope: 'statuses', id: s._id });
  }

  /** A private reply: lands in your direct message with the author, quoting the status. */
  async reply(ctx: TenantContext, statusId: string, input: unknown): Promise<SendMessageAck> {
    const req = parse(StatusReplySchema, input);
    const s = await this.loadVisible(ctx, statusId);
    if (s.authorId === ctx.userId)
      throw new AppError('VALIDATION_FAILED', "You can't reply to your own status");
    if (!s.allowReplies) throw forbidden('Replies are turned off for this status');
    const dm = await this.conversations.create(ctx, { kind: 'dm', memberIds: [s.authorId] });
    const label =
      s.kind === 'text'
        ? `“${s.text.slice(0, 120)}${s.text.length > 120 ? '…' : ''}”`
        : s.kind === 'image'
          ? 'a photo'
          : 'a video';
    return this.messages.send(ctx, {
      conversationId: dm.conversationId,
      clientMessageId: req.clientMessageId,
      content: { text: `> Replying to your status: ${label}\n\n${req.text}`, mentions: [] },
    });
  }
}
