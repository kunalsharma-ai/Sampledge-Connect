import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { MongoServerError } from 'mongodb';
import {
  CreateCommunityGroupSchema,
  CreateCommunityInviteLinkSchema,
  CreateCommunitySchema,
  InviteToCommunitySchema,
  SetCommunityRoleSchema,
  UpdateCommunitySchema,
  type Community,
  type CommunityGroup,
  type CommunityInviteLink,
  type CommunityMember,
  type CommunityRole,
  type PublicCommunity,
} from '@sampledge/contracts';
import { AppError, forbidden, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import type {
  CommunityDoc,
  CommunityLinkDoc,
  CommunityMemberDoc,
  ConversationDoc,
} from '../database/documents.js';
import type { ScopedDb } from '../database/tenant-db.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';
import { RateLimitService } from '../redis/redis.module.js';
import { NetworkPolicyService } from './network-policy.service.js';
import { NetworkService, colorFor, toPerson } from './network.service.js';

const sha256 = (s: string) => createHash('sha256').update(s).digest('base64url');
const RANK: Record<CommunityRole, number> = { owner: 4, admin: 3, moderator: 2, member: 1 };
const convRole = (r: CommunityRole) =>
  r === 'owner' ? 'owner' : r === 'member' ? 'member' : 'moderator';
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Communities: a public or private space with an announcements channel, groups (each a normal
 * conversation, so chat, files, calls and offline sync all work), roles, join requests,
 * invite links, follows and moderation.
 */
@Injectable()
export class CommunitiesService {
  constructor(
    private readonly network: NetworkService,
    private readonly policy: NetworkPolicyService,
    private readonly conversations: ConversationsService,
    private readonly realtime: RealtimePublisher,
    private readonly rateLimit: RateLimitService,
  ) {}

  private publicUrl(c: CommunityDoc) {
    return c.visibility === 'public' ? `${this.network.webBase}/c/${c.slug}` : null;
  }

  private async assertAllowed(ctx: TenantContext) {
    const me = await this.network.requireProfile(ctx.userId);
    if (me.homeTenantId && !(await this.policy.get(me.homeTenantId)).allowCommunities)
      throw forbidden('Your organization turned off communities');
  }

  private async load(net: ScopedDb, idOrSlug: string): Promise<CommunityDoc> {
    const c = await net.communities.findOne({
      $or: [{ _id: idOrSlug }, { slug: idOrSlug.toLowerCase() }],
    });
    // A community suspended by a platform operator is closed to everyone until restored.
    if (!c || c.suspendedAt) throw notFound('Community');
    return c;
  }

  private async membership(net: ScopedDb, communityId: string, userId: string) {
    return net.community_members.findOne({ communityId, userId });
  }

  /** Private communities are invisible to non-members (NOT_FOUND, not FORBIDDEN). */
  private async visible(ctx: TenantContext, idOrSlug: string) {
    const net = await this.network.assertNetwork(ctx);
    const c = await this.load(net, idOrSlug);
    const m = await this.membership(net, c._id, ctx.userId);
    if (m?.status === 'banned') throw notFound('Community');
    if (c.visibility === 'private' && !m) throw notFound('Community');
    return { net, c, m };
  }

  private requireRole(m: CommunityMemberDoc | null, min: CommunityRole) {
    if (!m || m.status !== 'active' || RANK[m.role] < RANK[min]) throw forbidden();
    return m;
  }

  private async groups(
    net: ScopedDb,
    c: CommunityDoc,
    m: CommunityMemberDoc | null,
  ): Promise<CommunityGroup[]> {
    if (!m || m.status !== 'active') return [];
    const convs = await net.conversations
      .find({ communityId: c._id, archivedAt: null }, { sort: { createdAt: 1 } })
      .toArray();
    const ids = convs.map((x) => x._id);
    const [members, mine] = await Promise.all([
      net.conversation_members
        .aggregate<{ _id: string; n: number }>([
          { $match: { conversationId: { $in: ids } } },
          { $group: { _id: '$conversationId', n: { $sum: 1 } } },
        ])
        .toArray(),
      net.conversation_members
        .find(
          { conversationId: { $in: ids }, userId: m.userId },
          { projection: { conversationId: 1 } },
        )
        .toArray(),
    ]);
    const joined = new Set(mine.map((x) => x.conversationId));
    const count = new Map(members.map((x) => [x._id, x.n]));
    const admin = RANK[m.role] >= RANK.admin;
    return convs
      .filter((x) => x.kind !== 'channel_private' || joined.has(x._id) || admin)
      .map((x) => ({
        conversationId: x._id,
        name: x.name ?? 'Group',
        topic: x.topic ?? '',
        kind: x.communityRole === 'announcements' ? ('announcements' as const) : ('group' as const),
        access: x.kind === 'channel_private' ? ('private' as const) : ('open' as const),
        announcementsOnly: x.postingPolicy === 'moderators',
        memberCount: count.get(x._id) ?? 0,
        joined: joined.has(x._id),
      }));
  }

  async toDto(net: ScopedDb, c: CommunityDoc, userId: string | null): Promise<Community> {
    const m = userId ? await this.membership(net, c._id, userId) : null;
    const [memberCount, followerCount, following] = await Promise.all([
      net.community_members.countDocuments({ communityId: c._id, status: 'active' }),
      net.network_follows.countDocuments({ targetType: 'community', targetId: c._id }),
      userId
        ? net.network_follows.findOne({
            followerId: userId,
            targetType: 'community',
            targetId: c._id,
          })
        : null,
    ]);
    return {
      communityId: c._id,
      slug: c.slug,
      name: c.name,
      description: c.description,
      rules: c.rules,
      visibility: c.visibility,
      joinPolicy: c.joinPolicy,
      memberCount,
      followerCount,
      avatarColor: c.avatarColor,
      createdAt: c.createdAt.toISOString(),
      myRole: m?.status === 'active' ? m.role : null,
      myStatus:
        m?.status === 'active'
          ? 'member'
          : m?.status === 'pending'
            ? 'pending'
            : m?.status === 'invited'
              ? 'invited'
              : null,
      following: !!following,
      groups: await this.groups(net, c, m),
      publicUrl: this.publicUrl(c),
    };
  }

  async admins(net: ScopedDb, communityId: string): Promise<string[]> {
    const rows = await net.community_members
      .find(
        { communityId, status: 'active', role: { $in: ['owner', 'admin', 'moderator'] } },
        { projection: { userId: 1 } },
      )
      .toArray();
    return rows.map((r) => r.userId);
  }

  private async notify(net: ScopedDb, communityId: string, extra: string[] = []) {
    void net;
    await this.network.changed(
      [...(await this.admins(await this.network.net(), communityId)), ...extra],
      {
        scope: 'communities',
        id: communityId,
      },
    );
  }

  /** Inserts a group conversation directly: network members are 'guest' and can't create channels. */
  private async createGroup(
    ctx: TenantContext,
    net: ScopedDb,
    c: Pick<CommunityDoc, '_id'>,
    g: {
      name: string;
      topic: string;
      access: 'open' | 'private';
      announcementsOnly: boolean;
      role: 'announcements' | 'group';
    },
    members: { userId: string; role: CommunityRole }[],
  ): Promise<ConversationDoc> {
    const now = new Date();
    const conv = await net.conversations.insertOne({
      workspaceId: ctx.workspaceId,
      kind: g.access === 'private' ? 'channel_private' : 'channel_public',
      name: g.name,
      topic: g.topic || null,
      createdBy: ctx.userId,
      createdAt: now,
      archivedAt: null,
      lastChangeSequence: 0,
      lastMessageAt: null,
      ...(g.announcementsOnly ? { postingPolicy: 'moderators' as const } : {}),
      communityId: c._id,
      communityRole: g.role,
    });
    if (members.length)
      await net.conversation_members.insertMany(
        members.map((m) => ({
          conversationId: conv._id,
          userId: m.userId,
          role: convRole(m.role),
          joinedAt: now,
        })),
      );
    await this.conversations.announce(
      ctx,
      conv,
      members.map((m) => m.userId),
    );
    return conv;
  }

  private async addToConversation(
    ctx: TenantContext,
    net: ScopedDb,
    conversationId: string,
    userId: string,
    role: CommunityRole,
  ) {
    await net.conversation_members.updateOne(
      { conversationId, userId },
      {
        $setOnInsert: {
          conversationId,
          userId,
          role: convRole(role),
          joinedAt: new Date(),
        } as never,
      },
      { upsert: true },
    );
    const conv = await net.conversations.findOne({ _id: conversationId });
    if (conv)
      await this.conversations.announce(
        { ...ctx, userId },
        conv,
        await this.conversations.memberIds(ctx.tenantId, conversationId),
      );
  }

  private async removeFromCommunityConversations(
    ctx: TenantContext,
    net: ScopedDb,
    communityId: string,
    userId: string,
  ) {
    const convs = await net.conversations
      .find({ communityId }, { projection: { _id: 1 } })
      .toArray();
    const ids = convs.map((x) => x._id);
    await net.conversation_members.deleteMany({ conversationId: { $in: ids }, userId });
    for (const id of ids) {
      this.realtime.leaveConversation(ctx.tenantId, userId, id);
      this.realtime.toUser(ctx.tenantId, userId, 'conversation:revoked', { conversationId: id });
    }
  }

  /** Makes someone an active member: announcements and the default group. */
  private async activate(
    ctx: TenantContext,
    net: ScopedDb,
    c: CommunityDoc,
    userId: string,
    role: CommunityRole,
    invitedBy: string | null,
  ) {
    await net.community_members.updateOne(
      { communityId: c._id, userId },
      {
        $set: { status: 'active', role },
        $setOnInsert: { communityId: c._id, userId, invitedBy, joinedAt: new Date() } as never,
      },
      { upsert: true },
    );
    await this.addToConversation(ctx, net, c.announcementsConversationId, userId, role);
    if (c.defaultGroupId) await this.addToConversation(ctx, net, c.defaultGroupId, userId, role);
  }

  // ─── create, read, update ─────────────────────────────────────────────────

  async create(ctx: TenantContext, input: unknown): Promise<Community> {
    const net = await this.network.assertNetwork(ctx);
    const req = parse(CreateCommunitySchema, input);
    return this.network.once(ctx, req.clientActionId, async () => {
      await this.assertAllowed(ctx);
      await this.rateLimit.consume('network_post', `community:${ctx.userId}`);
      const base =
        req.slug ??
        (req.name
          .toLowerCase()
          .normalize('NFKD')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 34) ||
          'community');
      let slug = base.length >= 3 ? base : `${base}-hub`;
      if (await net.communities.findOne({ slug })) {
        if (req.slug) throw new AppError('CONFLICT', 'That community address is taken');
        slug = `${slug.slice(0, 34)}-${randomBytes(2).toString('hex')}`;
      }
      const now = new Date();
      const id = await this.network.newId();
      let c: CommunityDoc;
      try {
        c = await net.communities.insertOne({
          _id: id,
          slug,
          name: req.name,
          description: req.description,
          rules: req.rules,
          visibility: req.visibility,
          joinPolicy: req.joinPolicy,
          ownerId: ctx.userId,
          announcementsConversationId: 'pending',
          defaultGroupId: null,
          avatarColor: colorFor(id),
          createdAt: now,
          updatedAt: now,
        });
      } catch (e) {
        if (e instanceof MongoServerError && e.code === 11000)
          throw new AppError('CONFLICT', 'That community address is taken');
        throw e;
      }
      await net.community_members.insertOne({
        communityId: c._id,
        userId: ctx.userId,
        role: 'owner',
        status: 'active',
        invitedBy: null,
        joinedAt: now,
      });
      const owner = [{ userId: ctx.userId, role: 'owner' as const }];
      const ann = await this.createGroup(
        ctx,
        net,
        c,
        {
          name: 'Announcements',
          topic: `News from ${req.name}`,
          access: 'open',
          announcementsOnly: true,
          role: 'announcements',
        },
        owner,
      );
      const general = await this.createGroup(
        ctx,
        net,
        c,
        {
          name: 'General',
          topic: 'Introduce yourself and talk with the community',
          access: 'open',
          announcementsOnly: false,
          role: 'group',
        },
        owner,
      );
      await net.communities.updateOne(
        { _id: c._id },
        { $set: { announcementsConversationId: ann._id, defaultGroupId: general._id } },
      );
      c = { ...c, announcementsConversationId: ann._id, defaultGroupId: general._id };
      await this.network.changed([ctx.userId], { scope: 'communities', id: c._id });
      return this.toDto(net, c, ctx.userId);
    });
  }

  async get(ctx: TenantContext, idOrSlug: string): Promise<Community> {
    const { net, c } = await this.visible(ctx, idOrSlug);
    return this.toDto(net, c, ctx.userId);
  }

  async mine(ctx: TenantContext): Promise<Community[]> {
    const net = await this.network.assertNetwork(ctx);
    const rows = await net.community_members
      .find({ userId: ctx.userId, status: { $in: ['active', 'pending', 'invited'] } })
      .toArray();
    const cs = await net.communities
      .find(
        {
          _id: { $in: rows.map((r) => r.communityId) },
          suspendedAt: { $not: { $type: 'date' } },
        } as never,
        { sort: { name: 1 } },
      )
      .toArray();
    return Promise.all(cs.map((c) => this.toDto(net, c, ctx.userId)));
  }

  async discover(ctx: TenantContext, q: string | undefined): Promise<Community[]> {
    const net = await this.network.assertNetwork(ctx);
    const filter: Record<string, unknown> = {
      visibility: 'public',
      suspendedAt: { $not: { $type: 'date' } },
    };
    if (q?.trim())
      filter.$or = [
        { name: new RegExp(escapeRe(q.trim()), 'i') },
        { slug: q.trim().toLowerCase() },
      ];
    const cs = await net.communities
      .find(filter as never, { sort: { createdAt: -1 }, limit: 50 })
      .toArray();
    return Promise.all(cs.map((c) => this.toDto(net, c, ctx.userId)));
  }

  async update(ctx: TenantContext, id: string, input: unknown): Promise<Community> {
    const { net, c, m } = await this.visible(ctx, id);
    const req = parse(UpdateCommunitySchema, input);
    this.requireRole(m, 'admin');
    const $set: Record<string, unknown> = { updatedAt: new Date() };
    for (const k of ['name', 'description', 'visibility', 'joinPolicy', 'rules'] as const)
      if (req[k] !== undefined) $set[k] = req[k];
    await net.communities.updateOne({ _id: c._id }, { $set });
    await this.network.audit_(ctx, 'community.updated', c._id, { fields: Object.keys($set) });
    await this.notifyMembers(net, c._id);
    return this.toDto(net, (await net.communities.findOne({ _id: c._id }))!, ctx.userId);
  }

  private async notifyMembers(net: ScopedDb, communityId: string, extra: string[] = []) {
    const rows = await net.community_members
      .find(
        { communityId, status: { $in: ['active', 'pending', 'invited'] } },
        { projection: { userId: 1 } },
      )
      .toArray();
    await this.network.changed([...rows.map((r) => r.userId), ...extra], {
      scope: 'communities',
      id: communityId,
    });
  }

  // ─── joining ──────────────────────────────────────────────────────────────

  async join(ctx: TenantContext, id: string): Promise<Community> {
    const { net, c, m } = await this.visible(ctx, id);
    await this.assertAllowed(ctx);
    if (m?.status === 'active') return this.toDto(net, c, ctx.userId);
    if (m?.status === 'invited' || (c.visibility === 'public' && c.joinPolicy === 'open')) {
      await this.activate(ctx, net, c, ctx.userId, m?.role ?? 'member', m?.invitedBy ?? null);
      await this.notify(net, c._id, [ctx.userId]);
      return this.toDto(net, c, ctx.userId);
    }
    if (!m)
      await net.community_members.insertOne({
        communityId: c._id,
        userId: ctx.userId,
        role: 'member',
        status: 'pending',
        invitedBy: null,
        joinedAt: new Date(),
      });
    await this.notify(net, c._id, [ctx.userId]);
    return this.toDto(net, c, ctx.userId);
  }

  async leave(ctx: TenantContext, id: string): Promise<void> {
    const { net, c, m } = await this.visible(ctx, id);
    if (!m) return;
    if (m.role === 'owner' && m.status === 'active')
      throw new AppError('VALIDATION_FAILED', 'Make someone else the owner before you leave');
    await net.community_members.deleteMany({ communityId: c._id, userId: ctx.userId });
    await this.removeFromCommunityConversations(ctx, net, c._id, ctx.userId);
    await this.notify(net, c._id, [ctx.userId]);
  }

  async decide(ctx: TenantContext, id: string, userId: string, approve: boolean): Promise<void> {
    const { net, c, m } = await this.visible(ctx, id);
    this.requireRole(m, 'moderator');
    const target = await this.membership(net, c._id, userId);
    if (!target || target.status !== 'pending') throw notFound('Join request');
    if (approve) await this.activate(ctx, net, c, userId, 'member', ctx.userId);
    else await net.community_members.deleteMany({ communityId: c._id, userId, status: 'pending' });
    await this.network.audit_(
      ctx,
      approve ? 'community.request_approved' : 'community.request_denied',
      c._id,
      { userId },
    );
    await this.notify(net, c._id, [userId]);
  }

  /** Members invite their connections; the invitee accepts by joining. */
  async invite(ctx: TenantContext, id: string, input: unknown): Promise<void> {
    const { net, c, m } = await this.visible(ctx, id);
    const req = parse(InviteToCommunitySchema, input);
    this.requireRole(m, 'member');
    if (c.joinPolicy === 'approval' && RANK[m!.role] < RANK.moderator)
      throw forbidden('Only moderators can invite people to this community');
    const conns = await net.network_connections
      .find({ userId: ctx.userId, otherUserId: { $in: req.userIds } })
      .toArray();
    const ok = new Set(conns.map((x) => x.otherUserId));
    const invited: string[] = [];
    for (const userId of req.userIds) {
      if (!ok.has(userId)) continue;
      const existing = await this.membership(net, c._id, userId);
      if (existing?.status === 'active' || existing?.status === 'banned') continue;
      if (existing?.status === 'pending') {
        await this.activate(ctx, net, c, userId, 'member', ctx.userId);
      } else {
        await net.community_members.updateOne(
          { communityId: c._id, userId },
          {
            $setOnInsert: {
              communityId: c._id,
              userId,
              role: 'member',
              status: 'invited',
              invitedBy: ctx.userId,
              joinedAt: new Date(),
            } as never,
          },
          { upsert: true },
        );
      }
      invited.push(userId);
    }
    if (invited.length < new Set(req.userIds).size && !invited.length)
      throw new AppError('VALIDATION_FAILED', 'You can invite your connections only');
    await this.network.audit_(ctx, 'community.invited', c._id, { count: invited.length });
    await this.notify(net, c._id, invited);
  }

  async declineInvite(ctx: TenantContext, id: string): Promise<void> {
    const net = await this.network.assertNetwork(ctx);
    await net.community_members.deleteMany({
      communityId: id,
      userId: ctx.userId,
      status: 'invited',
    });
    await this.network.changed([ctx.userId], { scope: 'communities', id });
  }

  // ─── invite links ─────────────────────────────────────────────────────────

  private toLink(l: CommunityLinkDoc): CommunityInviteLink {
    return {
      linkId: l._id,
      url: `${this.network.webBase}/join/c/${l.token}`,
      expiresAt: l.expiresAt?.toISOString() ?? null,
      maxUses: l.maxUses,
      uses: l.uses,
      revoked: !!l.revokedAt,
    };
  }

  async createLink(ctx: TenantContext, id: string, input: unknown): Promise<CommunityInviteLink> {
    const { net, c, m } = await this.visible(ctx, id);
    const req = parse(CreateCommunityInviteLinkSchema, input);
    this.requireRole(m, 'moderator');
    return this.network.once(ctx, req.clientActionId, async () => {
      const token = randomBytes(18).toString('base64url');
      const l = await net.community_links.insertOne({
        communityId: c._id,
        tokenHash: sha256(token),
        token,
        createdBy: ctx.userId,
        expiresAt: req.expiresInDays ? new Date(Date.now() + req.expiresInDays * 86_400_000) : null,
        maxUses: req.maxUses,
        uses: 0,
        revokedAt: null,
        createdAt: new Date(),
      });
      await this.network.audit_(ctx, 'community.link_created', c._id, {});
      await this.notify(net, c._id);
      return this.toLink(l);
    });
  }

  async links(ctx: TenantContext, id: string): Promise<CommunityInviteLink[]> {
    const { net, c, m } = await this.visible(ctx, id);
    this.requireRole(m, 'moderator');
    const rows = await net.community_links
      .find({ communityId: c._id }, { sort: { createdAt: -1 }, limit: 100 })
      .toArray();
    return rows.map((l) => this.toLink(l));
  }

  async revokeLink(ctx: TenantContext, id: string, linkId: string): Promise<void> {
    const { net, c, m } = await this.visible(ctx, id);
    this.requireRole(m, 'moderator');
    await net.community_links.updateOne(
      { _id: linkId, communityId: c._id },
      { $set: { revokedAt: new Date() } },
    );
    await this.notify(net, c._id);
  }

  async linkPreview(token: string): Promise<PublicCommunity['community'] & { valid: boolean }> {
    const net = await this.network.net();
    const l = await net.community_links.findOne({ tokenHash: sha256(token) });
    if (!l) throw notFound('Invite link');
    const c = await net.communities.findOne({ _id: l.communityId });
    if (!c || c.suspendedAt) throw notFound('Invite link');
    const {
      groups: _g,
      myRole: _r,
      myStatus: _s,
      following: _f,
      ...pub
    } = await this.toDto(net, c, null);
    return { ...pub, valid: this.linkValid(l) };
  }

  private linkValid(l: CommunityLinkDoc) {
    return (
      !l.revokedAt &&
      (!l.expiresAt || l.expiresAt > new Date()) &&
      (l.maxUses === null || l.uses < l.maxUses)
    );
  }

  async joinByLink(ctx: TenantContext, token: string): Promise<Community> {
    const net = await this.network.assertNetwork(ctx);
    await this.assertAllowed(ctx);
    const l = await net.community_links.findOne({ tokenHash: sha256(token) });
    if (!l || !this.linkValid(l)) throw new AppError('NOT_FOUND', 'This invite link has expired');
    const c = await net.communities.findOne({ _id: l.communityId });
    if (!c || c.suspendedAt) throw notFound('Community');
    const m = await this.membership(net, c._id, ctx.userId);
    if (m?.status === 'banned') throw forbidden('You were removed from this community');
    if (m?.status !== 'active') {
      const used = await net.community_links.findOneAndUpdate(
        {
          _id: l._id,
          revokedAt: null,
          ...(l.maxUses !== null ? { uses: { $lt: l.maxUses } } : {}),
        },
        { $inc: { uses: 1 } },
      );
      if (!used) throw new AppError('NOT_FOUND', 'This invite link has expired');
      await this.activate(ctx, net, c, ctx.userId, m?.role ?? 'member', l.createdBy);
      await this.network.audit_(ctx, 'community.joined_by_link', c._id, {});
      await this.notify(net, c._id, [ctx.userId]);
    }
    return this.toDto(net, c, ctx.userId);
  }

  // ─── members and moderation ───────────────────────────────────────────────

  async members(ctx: TenantContext, id: string): Promise<CommunityMember[]> {
    const { net, c, m } = await this.visible(ctx, id);
    this.requireRole(m, 'member');
    const isMod = RANK[m!.role] >= RANK.moderator;
    const rows = await net.community_members
      .find(
        {
          communityId: c._id,
          status: isMod ? { $in: ['active', 'pending', 'invited', 'banned'] } : 'active',
        },
        { limit: 5000 },
      )
      .toArray();
    const hidden = await this.network.hiddenFor(ctx.userId);
    const ps = await net.network_profiles
      .find({ userId: { $in: rows.map((r) => r.userId) } })
      .toArray();
    const byId = new Map(ps.map((p) => [p.userId, p]));
    return rows
      .filter((r) => byId.has(r.userId) && !hidden.has(r.userId))
      .map((r) => ({
        person: toPerson(byId.get(r.userId)!),
        role: r.role,
        status: r.status,
        joinedAt: r.joinedAt.toISOString(),
      }))
      .sort(
        (a, b) =>
          RANK[b.role] - RANK[a.role] || a.person.displayName.localeCompare(b.person.displayName),
      );
  }

  async setRole(ctx: TenantContext, id: string, userId: string, input: unknown): Promise<void> {
    const { net, c, m } = await this.visible(ctx, id);
    const { role } = parse(SetCommunityRoleSchema, input);
    const me = this.requireRole(m, 'admin');
    const target = await this.membership(net, c._id, userId);
    if (!target || target.status !== 'active') throw notFound('Member');
    if (target.role === 'owner') throw forbidden("The owner's role can't be changed");
    if (me.role !== 'owner' && (RANK[target.role] >= RANK.admin || role === 'admin'))
      throw forbidden('Only the owner can manage admins');
    await net.community_members.updateOne({ _id: target._id }, { $set: { role } });
    const convs = await net.conversations
      .find({ communityId: c._id }, { projection: { _id: 1 } })
      .toArray();
    await net.conversation_members.updateMany(
      { conversationId: { $in: convs.map((x) => x._id) }, userId },
      { $set: { role: convRole(role) } },
    );
    await this.network.audit_(ctx, 'community.role_changed', c._id, { userId, role });
    await this.notifyMembers(net, c._id);
  }

  async transferOwnership(ctx: TenantContext, id: string, userId: string): Promise<void> {
    const { net, c, m } = await this.visible(ctx, id);
    if (!m || m.role !== 'owner') throw forbidden();
    const target = await this.membership(net, c._id, userId);
    if (!target || target.status !== 'active') throw notFound('Member');
    await net.community_members.updateOne({ _id: target._id }, { $set: { role: 'owner' } });
    await net.community_members.updateOne({ _id: m._id }, { $set: { role: 'admin' } });
    await net.communities.updateOne({ _id: c._id }, { $set: { ownerId: userId } });
    const convs = await net.conversations
      .find({ communityId: c._id }, { projection: { _id: 1 } })
      .toArray();
    const ids = convs.map((x) => x._id);
    await net.conversation_members.updateMany(
      { conversationId: { $in: ids }, userId },
      { $set: { role: 'owner' } },
    );
    await net.conversation_members.updateMany(
      { conversationId: { $in: ids }, userId: ctx.userId },
      { $set: { role: 'moderator' } },
    );
    await this.network.audit_(ctx, 'community.ownership_transferred', c._id, { userId });
    await this.notifyMembers(net, c._id);
  }

  /** Remove (they may rejoin) or ban (they can't). */
  async remove(ctx: TenantContext, id: string, userId: string, ban: boolean): Promise<void> {
    const { net, c, m } = await this.visible(ctx, id);
    const me = this.requireRole(m, 'moderator');
    const target = await this.membership(net, c._id, userId);
    if (!target) throw notFound('Member');
    if (target.role === 'owner' || (RANK[target.role] >= RANK[me.role] && me.role !== 'owner'))
      throw forbidden();
    if (ban)
      await net.community_members.updateOne(
        { _id: target._id },
        { $set: { status: 'banned', role: 'member' } },
      );
    else await net.community_members.deleteMany({ _id: target._id });
    await this.removeFromCommunityConversations(ctx, net, c._id, userId);
    await this.network.audit_(
      ctx,
      ban ? 'community.member_banned' : 'community.member_removed',
      c._id,
      { userId },
    );
    await this.notifyMembers(net, c._id, [userId]);
  }

  async unban(ctx: TenantContext, id: string, userId: string): Promise<void> {
    const { net, c, m } = await this.visible(ctx, id);
    this.requireRole(m, 'moderator');
    await net.community_members.deleteMany({ communityId: c._id, userId, status: 'banned' });
    await this.notify(net, c._id);
  }

  // ─── groups ───────────────────────────────────────────────────────────────

  async addGroup(ctx: TenantContext, id: string, input: unknown): Promise<Community> {
    const { net, c, m } = await this.visible(ctx, id);
    const req = parse(CreateCommunityGroupSchema, input);
    const me = this.requireRole(m, 'moderator');
    return this.network.once(ctx, req.clientActionId, async () => {
      const clash = await net.conversations.findOne({
        communityId: c._id,
        name: req.name,
        archivedAt: null,
      });
      if (clash) throw new AppError('CONFLICT', 'A group with that name already exists');
      await this.createGroup(
        ctx,
        net,
        c,
        {
          name: req.name,
          topic: req.topic,
          access: req.access,
          announcementsOnly: req.announcementsOnly,
          role: 'group',
        },
        [{ userId: ctx.userId, role: me.role }],
      );
      await this.network.audit_(ctx, 'community.group_created', c._id, { name: req.name });
      await this.notifyMembers(net, c._id);
      return this.toDto(net, c, ctx.userId);
    });
  }

  private async group(net: ScopedDb, c: CommunityDoc, conversationId: string) {
    const g = await net.conversations.findOne({ _id: conversationId, communityId: c._id });
    if (!g) throw notFound('Group');
    return g;
  }

  async joinGroup(ctx: TenantContext, id: string, conversationId: string): Promise<Community> {
    const { net, c, m } = await this.visible(ctx, id);
    const me = this.requireRole(m, 'member');
    const g = await this.group(net, c, conversationId);
    if (g.kind === 'channel_private' && RANK[me.role] < RANK.admin)
      throw forbidden('This group is private. Ask an admin to add you.');
    await this.addToConversation(ctx, net, g._id, ctx.userId, me.role);
    await this.network.changed([ctx.userId], { scope: 'communities', id: c._id });
    return this.toDto(net, c, ctx.userId);
  }

  async addToGroup(
    ctx: TenantContext,
    id: string,
    conversationId: string,
    input: unknown,
  ): Promise<Community> {
    const { net, c, m } = await this.visible(ctx, id);
    this.requireRole(m, 'admin');
    const g = await this.group(net, c, conversationId);
    const { userIds } = parse(InviteToCommunitySchema, input);
    const active = await net.community_members
      .find({ communityId: c._id, userId: { $in: userIds }, status: 'active' })
      .toArray();
    for (const a of active) await this.addToConversation(ctx, net, g._id, a.userId, a.role);
    await this.notifyMembers(net, c._id);
    return this.toDto(net, c, ctx.userId);
  }

  async leaveGroup(ctx: TenantContext, id: string, conversationId: string): Promise<void> {
    const { net, c } = await this.visible(ctx, id);
    const g = await this.group(net, c, conversationId);
    if (g._id === c.announcementsConversationId)
      throw new AppError(
        'VALIDATION_FAILED',
        'Leave the community to stop announcements, or mute the channel',
      );
    await this.conversations.removeMember(ctx, g._id, ctx.userId);
    await this.network.changed([ctx.userId], { scope: 'communities', id: c._id });
  }

  async archiveGroup(ctx: TenantContext, id: string, conversationId: string): Promise<void> {
    const { net, c, m } = await this.visible(ctx, id);
    this.requireRole(m, 'admin');
    const g = await this.group(net, c, conversationId);
    if (g._id === c.announcementsConversationId)
      throw new AppError('VALIDATION_FAILED', 'The announcements channel cannot be removed');
    await net.conversations.updateOne({ _id: g._id }, { $set: { archivedAt: new Date() } });
    const members = await this.conversations.memberIds(ctx.tenantId, g._id);
    await this.conversations.announce(ctx, { ...g, archivedAt: new Date() }, members);
    await this.notifyMembers(net, c._id);
  }

  // ─── moderation (reports) ─────────────────────────────────────────────────

  /** The community and your membership, if you are a moderator, admin or owner of it. */
  async asModerator(ctx: TenantContext, id: string) {
    const { net, c, m } = await this.visible(ctx, id);
    return { net, c, m: this.requireRole(m, 'moderator') };
  }

  /** Platform operators: close a community (hidden, groups archived) until restored. */
  async suspend(c: CommunityDoc, reason: string): Promise<void> {
    const net = await this.network.net();
    if (c.suspendedAt) return;
    const now = new Date();
    const open = await net.conversations.find({ communityId: c._id, archivedAt: null }).toArray();
    await net.communities.updateOne(
      { _id: c._id },
      {
        $set: {
          suspendedAt: now,
          suspendedReason: reason,
          suspendedConversationIds: open.map((x) => x._id),
          updatedAt: now,
        },
      },
    );
    await net.conversations.updateMany(
      { _id: { $in: open.map((x) => x._id) } },
      { $set: { archivedAt: now } },
    );
    await this.announceGroups(
      c,
      open.map((x) => ({ ...x, archivedAt: now })),
    );
    await this.notifyMembers(net, c._id);
  }

  async restore(communityId: string): Promise<void> {
    const net = await this.network.net();
    const c = await net.communities.findOne({ _id: communityId });
    if (!c?.suspendedAt) return;
    const ids = c.suspendedConversationIds ?? [];
    await net.communities.updateOne(
      { _id: c._id },
      {
        $set: { suspendedAt: null, suspendedReason: '', updatedAt: new Date() },
        $unset: { suspendedConversationIds: '' },
      },
    );
    await net.conversations.updateMany({ _id: { $in: ids } }, { $set: { archivedAt: null } });
    const convs = await net.conversations.find({ _id: { $in: ids } }).toArray();
    await this.announceGroups(c, convs);
    await this.notifyMembers(net, c._id);
  }

  /** Sync archived or reopened groups to every member's devices. */
  private async announceGroups(c: CommunityDoc, convs: ConversationDoc[]) {
    const { tenantId, workspaceId } = await this.network.ids();
    for (const conv of convs) {
      const members = await this.conversations.memberIds(tenantId, conv._id);
      await this.conversations.announce(
        {
          tenantId,
          workspaceId,
          userId: c.ownerId,
          sessionId: 'moderation',
          deviceId: 'moderation',
          role: 'guest',
        },
        conv,
        members,
      );
    }
  }

  // ─── public page ──────────────────────────────────────────────────────────

  async publicPage(slug: string): Promise<PublicCommunity> {
    const net = await this.network.net();
    const c = await net.communities.findOne({ slug: slug.toLowerCase(), visibility: 'public' });
    if (!c || c.suspendedAt) throw notFound('Community');
    const {
      groups: _g,
      myRole: _r,
      myStatus: _s,
      following: _f,
      ...community
    } = await this.toDto(net, c, null);
    const msgs = await net.messages
      .find(
        { conversationId: c.announcementsConversationId, deletedAt: null, messageType: 'text' },
        { sort: { serverSequence: -1 }, limit: 20 },
      )
      .toArray();
    const ps = await net.network_profiles
      .find({ userId: { $in: msgs.map((x) => x.senderId) } })
      .toArray();
    const byId = new Map(ps.map((p) => [p.userId, p.displayName]));
    return {
      community,
      announcements: msgs.map((x) => ({
        text: x.content.text,
        at: x.createdAt.toISOString(),
        author: byId.get(x.senderId) ?? 'Admin',
      })),
    };
  }
}
