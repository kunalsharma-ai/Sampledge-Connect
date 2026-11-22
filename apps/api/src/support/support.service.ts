import { Injectable, Logger } from '@nestjs/common';
import { MongoServerError, type Filter } from 'mongodb';
import {
  CreateSupportQuerySchema,
  SupportListQuerySchema,
  SupportReplySchema,
  UpdateSupportQuerySchema,
  type SupportQuery,
  type SupportQueryList,
  type SupportSide,
  type SupportStatus,
} from '@sampledge/contracts';
import { forbidden, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { TenantDb, newId } from '../database/tenant-db.js';
import type { SupportQueryDoc } from '../database/documents.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PlatformAdmins } from '../platform/platform-admins.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';

const LIST_LIMIT = 200;
const isAdmin = (ctx: TenantContext) => ctx.role === 'owner' || ctx.role === 'admin';

/**
 * Help center queries (docs/help-center.md). The asker sees their own; owners and admins see
 * every query in their organization; platform admins with `support.view` see the ones routed to
 * SampConnect support, in every organization. Each change goes live to all three.
 */
@Injectable()
export class SupportService {
  private readonly log = new Logger('SupportService');

  constructor(
    private readonly db: TenantDb,
    private readonly realtime: RealtimePublisher,
    private readonly platformAdmins: PlatformAdmins,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------------------------------------------------------------- the person asking

  async create(ctx: TenantContext, body: unknown): Promise<SupportQuery> {
    const b = parse(CreateSupportQuerySchema, body);
    const t = this.db.for(ctx.tenantId);
    const now = new Date();
    let doc: SupportQueryDoc;
    try {
      doc = await t.support_queries.insertOne({
        clientId: b.clientId,
        requesterId: ctx.userId,
        subject: b.subject,
        body: b.body,
        topic: b.topic,
        featureId: b.featureId ?? null,
        route: b.route,
        status: 'open',
        replies: [],
        createdAt: now,
        updatedAt: now,
        lastReplyAt: null,
        lastReplySide: null,
      });
    } catch (e) {
      // Sent twice (an offline retry): the first one stands.
      if (!(e instanceof MongoServerError && e.code === 11000)) throw e;
      const existing = await t.support_queries.findOne({
        requesterId: ctx.userId,
        clientId: b.clientId,
      });
      if (!existing) throw e;
      return (await this.toViews(ctx.tenantId, [existing]))[0]!;
    }
    await this.changed(doc, 'new');
    return (await this.toViews(ctx.tenantId, [doc]))[0]!;
  }

  async listMine(ctx: TenantContext, q: unknown): Promise<SupportQueryList> {
    const filter = statusFilter(parse(SupportListQuerySchema, q ?? {}).status);
    const rows = await this.db
      .for(ctx.tenantId)
      .support_queries.find(
        { ...filter, requesterId: ctx.userId },
        { sort: { updatedAt: -1 }, limit: LIST_LIMIT },
      )
      .toArray();
    return { items: await this.toViews(ctx.tenantId, rows) };
  }

  /** One query: the asker, the organization's admins, or SampConnect support (routed there). */
  async get(ctx: TenantContext, id: string): Promise<SupportQuery> {
    const doc = await this.load(ctx, id);
    return (await this.toViews(ctx.tenantId, [doc]))[0]!;
  }

  async reply(ctx: TenantContext, id: string, body: unknown): Promise<SupportQuery> {
    const b = parse(SupportReplySchema, body);
    const doc = await this.load(ctx, id);
    const side: SupportSide = doc.requesterId === ctx.userId ? 'requester' : 'org';
    return this.addReply(ctx.tenantId, doc, side, ctx.userId, b.clientId, b.text);
  }

  async update(ctx: TenantContext, id: string, body: unknown): Promise<SupportQuery> {
    const b = parse(UpdateSupportQuerySchema, body);
    const doc = await this.load(ctx, id);
    const mine = doc.requesterId === ctx.userId;
    if (b.route && !isAdmin(ctx) && !mine) throw forbidden();
    // The asker may close or reopen their own query; admins may set any status.
    if (b.status && !isAdmin(ctx) && !(mine && (b.status === 'resolved' || b.status === 'open')))
      throw forbidden();
    const set: Partial<SupportQueryDoc> = { updatedAt: new Date() };
    if (b.status) set.status = b.status;
    if (b.route) set.route = b.route;
    const next = await this.db
      .for(ctx.tenantId)
      .support_queries.findOneAndUpdate({ _id: id }, { $set: set }, { returnDocument: 'after' });
    if (!next) throw notFound('Query');
    await this.changed(next, b.route && doc.route !== 'platform' ? 'escalated' : 'status');
    return (await this.toViews(ctx.tenantId, [next]))[0]!;
  }

  // ---------------------------------------------------------------- organization admins

  async listOrg(ctx: TenantContext, q: unknown): Promise<SupportQueryList> {
    if (!isAdmin(ctx)) throw forbidden();
    const filter = statusFilter(parse(SupportListQuerySchema, q ?? {}).status);
    const rows = await this.db
      .for(ctx.tenantId)
      .support_queries.find(filter, { sort: { updatedAt: -1 }, limit: LIST_LIMIT })
      .toArray();
    return { items: await this.toViews(ctx.tenantId, rows) };
  }

  // ---------------------------------------------------------------- SampConnect support

  async listPlatform(ctx: TenantContext, q: unknown): Promise<SupportQueryList> {
    await this.platformAdmins.assert(ctx, 'support.view');
    const filter = statusFilter(parse(SupportListQuerySchema, q ?? {}).status);
    const rows = await this.db.supportQueriesAllTenants
      .find({ ...filter, route: 'platform' } as Filter<SupportQueryDoc>, {
        sort: { updatedAt: -1 },
        limit: LIST_LIMIT,
      })
      .toArray();
    const byTenant = new Map<string, SupportQueryDoc[]>();
    for (const r of rows) byTenant.set(r.tenantId, [...(byTenant.get(r.tenantId) ?? []), r]);
    const views = (
      await Promise.all([...byTenant].map(([tid, docs]) => this.toViews(tid, docs, true)))
    ).flat();
    return { items: views.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
  }

  async platformReply(
    ctx: TenantContext,
    tenantId: string,
    id: string,
    body: unknown,
  ): Promise<SupportQuery> {
    await this.platformAdmins.assert(ctx, 'support.view');
    const b = parse(SupportReplySchema, body);
    const doc = await this.platformDoc(tenantId, id);
    return this.addReply(tenantId, doc, 'platform', ctx.userId, b.clientId, b.text, ctx.tenantId);
  }

  async platformUpdate(
    ctx: TenantContext,
    tenantId: string,
    id: string,
    body: unknown,
  ): Promise<SupportQuery> {
    await this.platformAdmins.assert(ctx, 'support.view');
    const b = parse(UpdateSupportQuerySchema, body);
    await this.platformDoc(tenantId, id);
    const next = await this.db
      .for(tenantId)
      .support_queries.findOneAndUpdate(
        { _id: id },
        { $set: { updatedAt: new Date(), ...(b.status ? { status: b.status } : {}) } },
        { returnDocument: 'after' },
      );
    if (!next) throw notFound('Query');
    await this.changed(next, 'status');
    return (await this.toViews(tenantId, [next], true))[0]!;
  }

  // ---------------------------------------------------------------- internals

  private async platformDoc(tenantId: string, id: string): Promise<SupportQueryDoc> {
    const doc = await this.db.for(tenantId).support_queries.findOne({ _id: id });
    if (!doc || doc.route !== 'platform') throw notFound('Query');
    return doc;
  }

  private async load(ctx: TenantContext, id: string): Promise<SupportQueryDoc> {
    const doc = await this.db.for(ctx.tenantId).support_queries.findOne({ _id: id });
    if (!doc) throw notFound('Query');
    if (doc.requesterId !== ctx.userId && !isAdmin(ctx)) throw notFound('Query');
    return doc;
  }

  private async addReply(
    tenantId: string,
    doc: SupportQueryDoc,
    side: SupportSide,
    authorId: string,
    clientId: string,
    text: string,
    /** Platform admins belong to their own organization. */
    authorTenantId: string = tenantId,
  ): Promise<SupportQuery> {
    const t = this.db.for(tenantId);
    // A retried reply (same clientId) is added once.
    if (doc.replies.some((r) => r.clientId === clientId))
      return (await this.toViews(tenantId, [doc], side === 'platform'))[0]!;
    const author = await this.db
      .for(authorTenantId)
      .users.findOne({ _id: authorId }, { projection: { displayName: 1 } });
    const now = new Date();
    // An answer from support moves the query to "answered"; the asker writing again reopens it.
    const status: SupportStatus =
      side === 'requester'
        ? doc.status === 'answered' || doc.status === 'resolved'
          ? 'open'
          : doc.status
        : 'answered';
    const next = await t.support_queries.findOneAndUpdate(
      { _id: doc._id, 'replies.clientId': { $ne: clientId } },
      {
        $push: {
          replies: {
            _id: newId(),
            clientId,
            side,
            authorId,
            authorName:
              side === 'platform' ? 'SampConnect support' : (author?.displayName ?? 'Someone'),
            text,
            createdAt: now,
          },
        },
        $set: { updatedAt: now, lastReplyAt: now, lastReplySide: side, status },
      },
      { returnDocument: 'after' },
    );
    const final = next ?? (await t.support_queries.findOne({ _id: doc._id }));
    if (!final) throw notFound('Query');
    if (next) await this.changed(final, side === 'requester' ? 'reply-in' : 'reply-out');
    return (await this.toViews(tenantId, [final], side === 'platform'))[0]!;
  }

  /** Live to the asker's devices, the organization's admins and (if routed) SampConnect support. */
  private async changed(
    doc: SupportQueryDoc,
    why: 'new' | 'status' | 'escalated' | 'reply-in' | 'reply-out',
  ) {
    const e = { queryId: doc._id, tenantId: doc.tenantId };
    const admins = await this.adminIds(doc.tenantId);
    for (const uid of new Set([doc.requesterId, ...admins]))
      this.realtime.toUser(doc.tenantId, uid, 'support:changed', e);
    if (doc.route === 'platform') this.realtime.toPlatform('support:changed', e);
    // A push for the person who needs to act: the asker on an answer, admins on a new question.
    const title = why === 'reply-out' ? 'Your question was answered' : 'New help question';
    const to =
      why === 'reply-out'
        ? [doc.requesterId]
        : why === 'new' || why === 'reply-in'
          ? admins.filter((a) => a !== doc.requesterId)
          : [];
    if (to.length)
      void this.notifications
        .pushToUsers(doc.tenantId, to, title, doc.subject, { type: 'support', queryId: doc._id })
        .catch((err: Error) => this.log.warn(`support push failed: ${err.message}`));
  }

  private async adminIds(tenantId: string): Promise<string[]> {
    const rows = await this.db
      .for(tenantId)
      .memberships.find({ role: { $in: ['owner', 'admin'] } }, { projection: { userId: 1 } })
      .toArray();
    return [...new Set(rows.map((r) => r.userId))];
  }

  private async toViews(
    tenantId: string,
    docs: SupportQueryDoc[],
    withOrg = false,
  ): Promise<SupportQuery[]> {
    if (!docs.length) return [];
    const users = await this.db
      .for(tenantId)
      .users.find(
        { _id: { $in: [...new Set(docs.map((d) => d.requesterId))] } },
        { projection: { displayName: 1, email: 1 } },
      )
      .toArray();
    const byId = new Map(users.map((u) => [u._id, u]));
    const org = withOrg
      ? await this.db.tenants.findOne({ _id: tenantId }, { projection: { name: 1 } })
      : null;
    return docs.map((d) => ({
      queryId: d._id,
      tenantId,
      ...(org ? { organizationName: org.name } : {}),
      requesterId: d.requesterId,
      requesterName: byId.get(d.requesterId)?.displayName ?? 'Former member',
      requesterEmail: byId.get(d.requesterId)?.email ?? '',
      subject: d.subject,
      body: d.body,
      topic: d.topic,
      featureId: d.featureId,
      route: d.route,
      status: d.status,
      replies: d.replies.map((r) => ({
        replyId: r._id,
        side: r.side,
        authorId: r.authorId,
        authorName: r.authorName,
        text: r.text,
        createdAt: r.createdAt.toISOString(),
      })),
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
      lastReplyAt: d.lastReplyAt?.toISOString() ?? null,
      lastReplySide: d.lastReplySide,
    }));
  }
}

function statusFilter(s: SupportStatus | 'active' | 'all'): Filter<SupportQueryDoc> {
  if (s === 'all') return {};
  if (s === 'active') return { status: { $in: ['open', 'in_progress', 'answered'] } };
  return { status: s };
}
