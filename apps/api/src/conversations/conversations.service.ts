import { Injectable } from '@nestjs/common';
import { MongoServerError } from 'mongodb';
import {
  AddMembersRequestSchema,
  CreateConversationRequestSchema,
  conversationCan,
  tenantCan,
  type Conversation,
  type ConversationAccess,
  type ConversationPermission,
  type ConversationRole,
} from '@sampledge/contracts';
import { AppError, forbidden, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import type { ConversationDoc, ConversationMemberDoc } from '../database/documents.js';
import { TenantDb } from '../database/tenant-db.js';
import { AuditService } from '../audit/audit.service.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';

export interface LoadedConversation {
  conversation: ConversationDoc;
  membership: ConversationMemberDoc | null;
  access: ConversationAccess;
}

@Injectable()
export class ConversationsService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly realtime: RealtimePublisher,
  ) {}

  /**
   * Loads a conversation and checks `permission`. Returns NOT_FOUND (not FORBIDDEN)
   * when the caller cannot even read it, so private conversation ids do not leak.
   */
  async authorize(
    ctx: TenantContext,
    conversationId: string,
    permission: ConversationPermission,
  ): Promise<LoadedConversation> {
    const t = this.db.for(ctx.tenantId);
    const [conversation, membership] = await Promise.all([
      t.conversations.findOne({ _id: conversationId }),
      t.conversation_members.findOne({ conversationId, userId: ctx.userId }),
    ]);
    if (!conversation) throw notFound('Conversation');
    const access: ConversationAccess = {
      conversationRole: membership?.role ?? null,
      tenantRole: ctx.role,
      archived: !!conversation.archivedAt,
      isPublicChannel: conversation.kind === 'channel_public',
    };
    if (!conversationCan(access, 'conversation.read')) throw notFound('Conversation');
    if (!conversationCan(access, permission)) throw forbidden();
    return { conversation, membership, access };
  }

  async memberIds(tenantId: string, conversationId: string): Promise<string[]> {
    const rows = await this.db
      .for(tenantId)
      .conversation_members.find({ conversationId }, { projection: { userId: 1 } })
      .toArray();
    return rows.map((r) => r.userId);
  }

  async toDto(
    ctx: TenantContext,
    c: ConversationDoc,
    memberIds?: string[],
    myRole?: ConversationRole | null,
  ): Promise<Conversation> {
    const ids = memberIds ?? (await this.memberIds(ctx.tenantId, c._id));
    let role = myRole;
    if (role === undefined) {
      role =
        (
          await this.db
            .for(ctx.tenantId)
            .conversation_members.findOne({ conversationId: c._id, userId: ctx.userId })
        )?.role ?? null;
    }
    return {
      conversationId: c._id,
      tenantId: c.tenantId,
      workspaceId: c.workspaceId,
      kind: c.kind,
      name: c.name,
      topic: c.topic,
      memberIds: ids,
      createdBy: c.createdBy,
      createdAt: c.createdAt.toISOString(),
      archivedAt: c.archivedAt?.toISOString() ?? null,
      lastChangeSequence: c.lastChangeSequence,
      lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
      myRole: role,
    };
  }

  /** Conversations the caller is a member of, plus every public channel (readable without joining). */
  async listReadable(ctx: TenantContext): Promise<Conversation[]> {
    const t = this.db.for(ctx.tenantId);
    const mine = await t.conversation_members.find({ userId: ctx.userId }).toArray();
    const myRole = new Map(mine.map((m) => [m.conversationId, m.role]));
    const filter =
      ctx.role === 'guest'
        ? { _id: { $in: [...myRole.keys()] } }
        : {
            $or: [
              { _id: { $in: [...myRole.keys()] } },
              { kind: 'channel_public' as const, workspaceId: ctx.workspaceId },
            ],
          };
    const convs = await t.conversations
      .find(filter, { sort: { lastMessageAt: -1 }, limit: 1000 })
      .toArray();
    const allMembers = await t.conversation_members
      .find(
        { conversationId: { $in: convs.map((c) => c._id) } },
        { projection: { conversationId: 1, userId: 1 } },
      )
      .toArray();
    const byConv = new Map<string, string[]>();
    for (const m of allMembers)
      byConv.set(m.conversationId, [...(byConv.get(m.conversationId) ?? []), m.userId]);
    return Promise.all(
      convs.map((c) => this.toDto(ctx, c, byConv.get(c._id) ?? [], myRole.get(c._id) ?? null)),
    );
  }

  async create(ctx: TenantContext, input: unknown): Promise<Conversation> {
    const req = parse(CreateConversationRequestSchema, input);
    const t = this.db.for(ctx.tenantId);
    const now = new Date();

    const permission =
      req.kind === 'dm'
        ? 'conversation.dm.create'
        : req.kind === 'group'
          ? 'conversation.group.create'
          : req.kind === 'channel_public'
            ? 'channel.public.create'
            : 'channel.private.create';
    if (!tenantCan(ctx.role, permission)) throw forbidden();

    const others = [...new Set(req.memberIds)].filter((id) => id !== ctx.userId);
    if (others.length) {
      // Every member must be an active user of the caller's tenant.
      const found = await t.users.countDocuments({ _id: { $in: others }, status: 'active' });
      if (found !== others.length)
        throw new AppError('VALIDATION_FAILED', 'One or more members do not exist');
    }

    if (req.kind === 'dm') {
      if (others.length !== 1)
        throw new AppError('VALIDATION_FAILED', 'A direct message needs exactly one other person');
      const dmKey = [ctx.userId, others[0]!].sort().join(':');
      const existing = await t.conversations.findOne({ dmKey });
      if (existing) return this.toDto(ctx, existing);
      try {
        const c = await t.conversations.insertOne({
          workspaceId: ctx.workspaceId,
          kind: 'dm',
          name: null,
          topic: null,
          dmKey,
          createdBy: ctx.userId,
          createdAt: now,
          archivedAt: null,
          lastChangeSequence: 0,
          lastMessageAt: null,
        });
        await t.conversation_members.insertMany(
          [ctx.userId, others[0]!].map((userId) => ({
            conversationId: c._id,
            userId,
            role: 'owner' as const,
            joinedAt: now,
          })),
        );
        return this.announce(ctx, c, [ctx.userId, others[0]!]);
      } catch (e) {
        if (e instanceof MongoServerError && e.code === 11000) {
          const raced = await t.conversations.findOne({ dmKey });
          if (raced) return this.toDto(ctx, raced);
        }
        throw e;
      }
    }

    const name = 'name' in req && req.name ? req.name : null;
    if (req.kind === 'channel_public' || req.kind === 'channel_private') {
      const clash = await t.conversations.findOne({
        workspaceId: ctx.workspaceId,
        kind: { $in: ['channel_public', 'channel_private'] },
        name,
      });
      if (clash) throw new AppError('CONFLICT', 'A channel with that name already exists');
    }
    const c = await t.conversations.insertOne({
      workspaceId: ctx.workspaceId,
      kind: req.kind,
      name,
      topic: 'topic' in req ? (req.topic ?? null) : null,
      createdBy: ctx.userId,
      createdAt: now,
      archivedAt: null,
      lastChangeSequence: 0,
      lastMessageAt: null,
    });
    const members = [ctx.userId, ...others];
    await t.conversation_members.insertMany(
      members.map((userId) => ({
        conversationId: c._id,
        userId,
        role: userId === ctx.userId ? ('owner' as const) : ('member' as const),
        joinedAt: now,
      })),
    );
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'conversation.created',
      target: { type: 'conversation', id: c._id },
      metadata: { kind: c.kind },
    });
    return this.announce(ctx, c, members);
  }

  private async announce(ctx: TenantContext, c: ConversationDoc, members: string[]) {
    for (const userId of members) {
      this.realtime.joinConversation(ctx.tenantId, userId, c._id);
      const role =
        (
          await this.db
            .for(ctx.tenantId)
            .conversation_members.findOne({ conversationId: c._id, userId })
        )?.role ?? null;
      this.realtime.toUser(
        ctx.tenantId,
        userId,
        'conversation:upsert',
        await this.toDto({ ...ctx, userId }, c, members, role),
      );
    }
    return this.toDto(ctx, c, members);
  }

  async get(ctx: TenantContext, conversationId: string): Promise<Conversation> {
    const { conversation, membership } = await this.authorize(
      ctx,
      conversationId,
      'conversation.read',
    );
    return this.toDto(ctx, conversation, undefined, membership?.role ?? null);
  }

  /** Join a public channel. */
  async join(ctx: TenantContext, conversationId: string): Promise<Conversation> {
    const { conversation, membership } = await this.authorize(
      ctx,
      conversationId,
      'conversation.read',
    );
    if (membership) return this.toDto(ctx, conversation, undefined, membership.role);
    if (conversation.kind !== 'channel_public' || !tenantCan(ctx.role, 'channel.public.join'))
      throw forbidden();
    await this.db.for(ctx.tenantId).conversation_members.updateOne(
      { conversationId, userId: ctx.userId },
      {
        $setOnInsert: {
          conversationId,
          userId: ctx.userId,
          role: 'member',
          joinedAt: new Date(),
        } as never,
      },
      { upsert: true },
    );
    const members = await this.memberIds(ctx.tenantId, conversationId);
    return this.announce(ctx, conversation, members);
  }

  async addMembers(
    ctx: TenantContext,
    conversationId: string,
    input: unknown,
  ): Promise<Conversation> {
    const { userIds } = parse(AddMembersRequestSchema, input);
    const { conversation } = await this.authorize(ctx, conversationId, 'members.add');
    if (conversation.kind === 'dm')
      throw new AppError(
        'VALIDATION_FAILED',
        'Direct messages cannot gain members; start a group instead',
      );
    const t = this.db.for(ctx.tenantId);
    const unique = [...new Set(userIds)];
    const found = await t.users.countDocuments({ _id: { $in: unique }, status: 'active' });
    if (found !== unique.length)
      throw new AppError('VALIDATION_FAILED', 'One or more members do not exist');
    const now = new Date();
    for (const userId of unique) {
      await t.conversation_members.updateOne(
        { conversationId, userId },
        { $setOnInsert: { conversationId, userId, role: 'member', joinedAt: now } as never },
        { upsert: true },
      );
    }
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'conversation.members_added',
      target: { type: 'conversation', id: conversationId },
      metadata: { userIds: unique },
    });
    return this.announce(ctx, conversation, await this.memberIds(ctx.tenantId, conversationId));
  }

  async removeMember(ctx: TenantContext, conversationId: string, userId: string): Promise<void> {
    const self = userId === ctx.userId;
    const { conversation } = await this.authorize(
      ctx,
      conversationId,
      self ? 'conversation.read' : 'members.remove',
    );
    if (conversation.kind === 'dm')
      throw new AppError('VALIDATION_FAILED', 'You cannot leave a direct message');
    await this.db.for(ctx.tenantId).conversation_members.deleteMany({ conversationId, userId });
    this.realtime.leaveConversation(ctx.tenantId, userId, conversationId);
    this.realtime.toUser(ctx.tenantId, userId, 'conversation:revoked', { conversationId });
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'conversation.member_removed',
      target: { type: 'conversation', id: conversationId },
      metadata: { userId },
    });
  }

  async archive(
    ctx: TenantContext,
    conversationId: string,
    archived: boolean,
  ): Promise<Conversation> {
    const { conversation } = await this.authorize(
      ctx,
      conversationId,
      archived ? 'conversation.archive' : 'conversation.read',
    );
    if (
      !archived &&
      !conversationCan(
        {
          ...(await this.authorize(ctx, conversationId, 'conversation.read')).access,
          archived: false,
        },
        'conversation.archive',
      )
    ) {
      throw forbidden();
    }
    const updated = await this.db
      .for(ctx.tenantId)
      .conversations.findOneAndUpdate(
        { _id: conversation._id },
        { $set: { archivedAt: archived ? new Date() : null } },
        { returnDocument: 'after' },
      );
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: archived ? 'conversation.archived' : 'conversation.unarchived',
      target: { type: 'conversation', id: conversationId },
    });
    const members = await this.memberIds(ctx.tenantId, conversationId);
    return this.announce(ctx, updated!, members);
  }
}
