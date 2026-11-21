import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { MongoServerError } from 'mongodb';
import type { Redis } from 'ioredis';
import {
  MODULE_CATALOG,
  isRestrictedRecord,
  type ConversationTarget,
  type IdentityRef,
  type LinkedRecord,
  type RecordRef,
  type SampledgeModule,
} from '@sampledge/contracts';
import { AppError } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { TenantDb } from '../database/tenant-db.js';
import type { MessageDoc } from '../database/documents.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { MessagesService } from '../messages/messages.service.js';
import { REDIS } from '../redis/redis.module.js';
import { withLock } from '../redis/lock.js';
import { ARGON2_OPTIONS } from '../auth/auth.service.js';
import { WorkStore } from './collections.js';
import type { IdentityLinkDoc, LinkedRecordDoc } from './docs.js';
import { ModuleSettingsService } from './module-settings.service.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';

export const BOT_EMAIL_DOMAIN = 'modules.sampledge.invalid';

export const toLinkedRecord = (d: LinkedRecordDoc): LinkedRecord => ({
  linkId: d._id,
  module: d.module,
  recordType: d.recordType,
  externalId: d.externalId,
  title: d.title,
  url: d.url,
  conversationId: d.conversationId,
  parent: d.parent,
  sensitivity: d.sensitivity,
  fields: d.fields,
  lastEventType: d.lastEventType,
  createdAt: d.createdAt.toISOString(),
  updatedAt: d.updatedAt.toISOString(),
});

/** Channel names allow letters, numbers, spaces and - _ . (see CreateConversationRequest). */
function channelName(title: string): string {
  const cleaned = title
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N} _.-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[^\p{L}\p{N}]+/u, '');
  return (cleaned || 'record').slice(0, 64).trim();
}

export interface ResolvedPeople {
  userIds: string[];
  /** Display strings for people with no Connect account. */
  unmatched: string[];
}

/**
 * The shared plumbing every module adapter uses: the module's bot user, identity mapping,
 * record ↔ conversation links, and posting cards.
 */
@Injectable()
export class RecordsService {
  constructor(
    private readonly db: TenantDb,
    private readonly store: WorkStore,
    private readonly conversations: ConversationsService,
    private readonly messages: MessagesService,
    private readonly settings: ModuleSettingsService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly realtime: RealtimePublisher,
  ) {}

  /** Tell everyone in the conversation that its linked records changed (live Details panel). */
  notifyChanged(
    tenantId: string,
    conversationId: string | null,
    linkId: string,
    reason: 'linked' | 'updated' | 'action',
  ) {
    if (conversationId)
      this.realtime.toConversation(tenantId, conversationId, 'record:changed', {
        conversationId,
        linkId,
        reason,
      });
  }

  /* ---------- bot users ---------- */

  /**
   * Each module posts as its own bot user ("Samptrek"), so its cards are clearly not from a
   * person. The bot has an unusable random password and the least-privileged guest role.
   */
  async botUserId(tenantId: string, m: SampledgeModule): Promise<string> {
    const w = this.store.for(tenantId);
    const existing = await w.module_bots.findOne({ module: m });
    if (existing) return existing.userId;
    const t = this.db.for(tenantId);
    const email = `${m}@${BOT_EMAIL_DOMAIN}`;
    let user = await t.users.findOne({ email });
    if (!user) {
      try {
        user = await t.users.insertOne({
          email,
          passwordHash: await argon2.hash(randomBytes(32).toString('base64url'), ARGON2_OPTIONS),
          displayName: MODULE_CATALOG[m].name,
          title: `${MODULE_CATALOG[m].category} · Sampledge module`,
          status: 'active',
          createdAt: new Date(),
        });
        const ws = await t.workspaces.findOne({ isDefault: true });
        if (ws)
          await t.memberships.updateOne(
            { userId: user._id, workspaceId: ws._id },
            {
              $setOnInsert: {
                userId: user._id,
                workspaceId: ws._id,
                role: 'guest',
                createdAt: new Date(),
              } as never,
            },
            { upsert: true },
          );
      } catch (e) {
        if (!(e instanceof MongoServerError && e.code === 11000)) throw e;
        user = await t.users.findOne({ email });
        if (!user) throw e;
      }
    }
    try {
      await w.module_bots.insertOne({ module: m, userId: user._id });
    } catch (e) {
      if (!(e instanceof MongoServerError && e.code === 11000)) throw e;
    }
    return user._id;
  }

  /** Internal principal for acting as the bot (creating channels, adding members). */
  async botCtx(tenantId: string, m: SampledgeModule): Promise<TenantContext> {
    const [userId, ws] = await Promise.all([
      this.botUserId(tenantId, m),
      this.db.for(tenantId).workspaces.findOne({ isDefault: true }),
    ]);
    if (!ws) throw new AppError('INTERNAL', 'Tenant has no default workspace');
    // 'member' only for channel creation inside this process; never issued as a token.
    return {
      tenantId,
      userId,
      sessionId: `module:${m}`,
      deviceId: `module:${m}`,
      role: 'member',
      workspaceId: ws._id,
    };
  }

  /* ---------- identity mapping ---------- */

  /**
   * Maps module people to Connect users: an identity link first, then an active user with the
   * same email (creating the link). Bots and deactivated users never match.
   */
  async resolvePeople(
    tenantId: string,
    m: SampledgeModule,
    refs: IdentityRef[],
  ): Promise<ResolvedPeople> {
    const w = this.store.for(tenantId);
    const t = this.db.for(tenantId);
    const userIds = new Set<string>();
    const unmatched: string[] = [];
    for (const ref of refs) {
      let userId: string | null = null;
      if (ref.externalUserId) {
        const link = await w.identity_links.findOne({
          module: m,
          externalUserId: ref.externalUserId,
        });
        if (link) {
          const u = await t.users.findOne({ _id: link.userId, status: 'active' });
          if (u) userId = u._id;
        }
      }
      if (!userId && ref.email && !ref.email.endsWith(`@${BOT_EMAIL_DOMAIN}`)) {
        const u = await t.users.findOne({ email: ref.email, status: 'active' });
        if (u) {
          userId = u._id;
          if (ref.externalUserId)
            await this.saveLink(tenantId, m, ref.externalUserId, u._id, ref.email, 'email');
        }
      }
      if (userId) userIds.add(userId);
      else unmatched.push(ref.email ?? ref.name ?? ref.externalUserId ?? 'unknown');
    }
    return { userIds: [...userIds], unmatched };
  }

  async saveLink(
    tenantId: string,
    m: SampledgeModule,
    externalUserId: string,
    userId: string,
    email: string | null,
    matchedBy: 'email' | 'manual',
  ): Promise<IdentityLinkDoc> {
    const w = this.store.for(tenantId);
    // A manual link always wins; an email match never overwrites a manual one.
    const filter =
      matchedBy === 'manual'
        ? { module: m, externalUserId }
        : { module: m, externalUserId, matchedBy: 'email' as const };
    try {
      const doc = await w.identity_links.findOneAndUpdate(
        filter,
        {
          $set: { userId, email, matchedBy },
          $setOnInsert: { module: m, externalUserId, createdAt: new Date() } as never,
        },
        { upsert: true, returnDocument: 'after' },
      );
      return doc!;
    } catch (e) {
      if (e instanceof MongoServerError && e.code === 11000) {
        const existing = await w.identity_links.findOne({ module: m, externalUserId });
        if (existing) return existing;
      }
      throw e;
    }
  }

  /* ---------- records and their conversations ---------- */

  async findRecord(tenantId: string, m: SampledgeModule, type: string, externalId: string) {
    return this.store
      .for(tenantId)
      .linked_records.findOne({ module: m, recordType: type, externalId });
  }

  /**
   * Finds or creates the conversation an event belongs to, adds `memberIds`, and returns the
   * linked record. Serialized per record so two concurrent events open one channel.
   */
  async ensureRecordConversation(
    tenantId: string,
    m: SampledgeModule,
    opts: {
      record: RecordRef;
      parent?: RecordRef;
      target: ConversationTarget;
      memberIds: string[];
      topic?: string;
      /** false: link the record but don't create a conversation if none exists. */
      create?: boolean;
    },
  ): Promise<{ record: LinkedRecordDoc; created: boolean }> {
    const { record, parent, target } = opts;
    const settings = await this.settings.get(tenantId, m);
    const w = this.store.for(tenantId);

    // The record whose conversation is used: itself, its parent, or a shared module channel.
    let owner: { type: string; id: string; title: string; url?: string; channelKey: string | null };
    let restricted = isRestrictedRecord(m, record.type);
    if (typeof target === 'object') {
      owner = {
        type: '_channel',
        id: target.channel,
        title: target.name,
        channelKey: target.channel,
      };
      restricted = target.visibility === 'private';
    } else if (target === 'parent' && parent) {
      owner = { ...parent, channelKey: null };
      restricted = restricted || isRestrictedRecord(m, parent.type);
    } else {
      owner = { ...record, channelKey: null };
    }

    const lockKey = `lock:record:${tenantId}:${m}:${owner.type}:${owner.id}`;
    let created = false;
    const ownerDoc = await withLock(
      this.redis,
      lockKey,
      async () => {
        const now = new Date();
        let doc = await w.linked_records.findOne({
          module: m,
          recordType: owner.type,
          externalId: owner.id,
        });
        if (!doc) {
          doc = await w.linked_records.insertOne({
            module: m,
            recordType: owner.type,
            externalId: owner.id,
            title: owner.title,
            url: owner.url ?? null,
            conversationId: null,
            parent: null,
            sensitivity: restricted ? 'restricted' : 'standard',
            fields: {},
            lastEventType: null,
            channelKey: owner.channelKey,
            createdAt: now,
            updatedAt: now,
          });
        } else if (owner.type !== '_channel' && (doc.title !== owner.title || owner.url)) {
          await w.linked_records.updateOne(
            { _id: doc._id },
            { $set: { title: owner.title, url: owner.url ?? doc.url, updatedAt: now } },
          );
          doc = { ...doc, title: owner.title, url: owner.url ?? doc.url };
        }
        if (!doc.conversationId && opts.create !== false) {
          const conversationId = await this.createConversation(tenantId, m, {
            title: owner.title,
            topic:
              typeof target === 'object'
                ? target.topic
                : (opts.topic ??
                  `${MODULE_CATALOG[m].name} ${owner.type.replace(/_/g, ' ')} ${owner.id}`),
            private: restricted || settings.channelVisibility === 'private',
            memberIds: opts.memberIds,
          });
          await w.linked_records.updateOne({ _id: doc._id }, { $set: { conversationId } });
          doc = { ...doc, conversationId };
          created = true;
        }
        return doc;
      },
      { ttlMs: 15_000, waitMs: 10_000 },
    );

    if (ownerDoc.conversationId && !created && opts.memberIds.length)
      await this.addMembers(tenantId, m, ownerDoc.conversationId, opts.memberIds);

    if (owner.type === record.type && owner.id === record.id) {
      if (created) this.notifyChanged(tenantId, ownerDoc.conversationId, ownerDoc._id, 'linked');
      return { record: ownerDoc, created };
    }

    // The event's own record (a milestone, a shared-channel announcement) points at the owner's chat.
    const now = new Date();
    const before = await w.linked_records.findOne({
      module: m,
      recordType: record.type,
      externalId: record.id,
    });
    const own = await w.linked_records.findOneAndUpdate(
      { module: m, recordType: record.type, externalId: record.id },
      {
        $set: {
          title: record.title,
          url: record.url ?? null,
          conversationId: ownerDoc.conversationId,
          parent:
            owner.type === '_channel'
              ? null
              : { type: owner.type, id: owner.id, title: owner.title },
          updatedAt: now,
        },
        $setOnInsert: {
          module: m,
          recordType: record.type,
          externalId: record.id,
          sensitivity: restricted ? 'restricted' : 'standard',
          fields: {},
          lastEventType: null,
          channelKey: null,
          createdAt: now,
        } as never,
      },
      { upsert: true, returnDocument: 'after' },
    );
    if (own && (created || before?.conversationId !== own.conversationId))
      this.notifyChanged(tenantId, own.conversationId, own._id, 'linked');
    return { record: own!, created };
  }

  private async createConversation(
    tenantId: string,
    m: SampledgeModule,
    opts: { title: string; topic: string; private: boolean; memberIds: string[] },
  ): Promise<string> {
    const ctx = await this.botCtx(tenantId, m);
    const base = channelName(opts.title);
    for (let attempt = 0; attempt < 5; attempt++) {
      const name = attempt === 0 ? base : `${base.slice(0, 60)} ${randomBytes(2).toString('hex')}`;
      try {
        const c = await this.conversations.create(ctx, {
          kind: opts.private ? 'channel_private' : 'channel_public',
          name,
          topic: opts.topic.slice(0, 250),
          memberIds: opts.memberIds.filter((id) => id !== ctx.userId),
        });
        return c.conversationId;
      } catch (e) {
        if (e instanceof AppError && e.code === 'CONFLICT') continue;
        throw e;
      }
    }
    throw new AppError('CONFLICT', 'Could not find a free channel name');
  }

  async addMembers(tenantId: string, m: SampledgeModule, conversationId: string, ids: string[]) {
    const ctx = await this.botCtx(tenantId, m);
    const current = new Set(await this.conversations.memberIds(tenantId, conversationId));
    const missing = [...new Set(ids)].filter((id) => !current.has(id) && id !== ctx.userId);
    if (!missing.length) return;
    // The bot owns the conversations it created; for others it must be a member with rights.
    if (!current.has(ctx.userId)) return;
    await this.conversations.addMembers(ctx, conversationId, { userIds: missing });
  }

  async updateRecordFacts(
    tenantId: string,
    recordId: string,
    fields: LinkedRecordDoc['fields'],
    eventType: string,
  ) {
    const set: Record<string, unknown> = { lastEventType: eventType, updatedAt: new Date() };
    for (const [k, v] of Object.entries(fields)) set[`fields.${k}`] = v;
    const doc = await this.store
      .for(tenantId)
      .linked_records.findOneAndUpdate(
        { _id: recordId },
        { $set: set },
        { returnDocument: 'after' },
      );
    if (doc) this.notifyChanged(tenantId, doc.conversationId, doc._id, 'updated');
  }

  /** Posts a module card as the module's bot and returns the stored message. */
  async postCard(
    tenantId: string,
    m: SampledgeModule,
    conversationId: string,
    text: string,
    metadata: Record<string, unknown>,
  ): Promise<MessageDoc> {
    const bot = await this.botUserId(tenantId, m);
    const msg = await this.messages.postSystem(tenantId, conversationId, bot, text, metadata);
    const doc = await this.db.for(tenantId).messages.findOne({ _id: msg.messageId });
    return doc!;
  }

  /** Records linked to a conversation (excluding shared-channel markers). */
  async recordsForConversation(tenantId: string, conversationId: string) {
    return this.store
      .for(tenantId)
      .linked_records.find({ conversationId }, { sort: { updatedAt: -1 }, limit: 20 })
      .toArray();
  }
}
