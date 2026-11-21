import { Injectable, Logger } from '@nestjs/common';
import { MongoServerError } from 'mongodb';
import {
  CreateApprovalRequestSchema,
  DecideApprovalRequestSchema,
  ListApprovalsQuerySchema,
  MODULE_CATALOG,
  formatFact,
  tenantCan,
  type Approval,
  type ApprovalCategory,
} from '@sampledge/contracts';
import { AppError, forbidden, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { TenantDb } from '../database/tenant-db.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { MessagesService } from '../messages/messages.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';
import { AuditService } from '../audit/audit.service.js';
import { WorkStore } from '../integrations/collections.js';
import type { ApprovalDoc, WorkRecordDoc } from '../integrations/docs.js';
import { ModuleActionsService } from '../integrations/module-actions.service.js';
import { WebhooksService } from '../integrations/webhooks.service.js';
import { recordOf } from './tasks.service.js';

export const toApproval = (a: ApprovalDoc): Approval => ({
  approvalId: a._id,
  title: a.title,
  description: a.description,
  category: a.category,
  amount: a.amount,
  requesterId: a.requesterId,
  approverIds: a.approverIds,
  policy: a.policy,
  decisions: a.decisions.map((d) => ({ ...d, at: d.at.toISOString() })),
  status: a.status,
  conversationId: a.conversationId,
  sourceMessageId: a.sourceMessageId,
  record: a.record,
  origin: a.origin,
  dueAt: a.dueAt?.toISOString() ?? null,
  createdAt: a.createdAt.toISOString(),
  decidedAt: a.decidedAt?.toISOString() ?? null,
});

const STATUS_WORD: Record<ApprovalDoc['status'], string> = {
  pending: 'Waiting for a decision',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

/**
 * Approvals: pricing, survey launch, expense, budget, invoice and leave decisions. Only the
 * named approvers decide; a decision is final and audit logged. Approvals on HR and finance
 * records are visible only to the requester, the approvers and members of the private chat.
 */
@Injectable()
export class ApprovalsService {
  private readonly log = new Logger('Approvals');

  constructor(
    private readonly db: TenantDb,
    private readonly store: WorkStore,
    private readonly conversations: ConversationsService,
    private readonly messages: MessagesService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimePublisher,
    private readonly actions: ModuleActionsService,
    private readonly webhooks: WebhooksService,
    private readonly audit: AuditService,
  ) {}

  private async canSee(ctx: TenantContext, a: ApprovalDoc) {
    if (a.requesterId === ctx.userId || a.approverIds.includes(ctx.userId)) return true;
    if (a.conversationId) {
      try {
        await this.conversations.authorize(ctx, a.conversationId, 'conversation.read');
        return true;
      } catch {
        return false;
      }
    }
    return ctx.role === 'owner' || ctx.role === 'admin';
  }

  private async load(ctx: TenantContext, id: string) {
    const a = await this.store.for(ctx.tenantId).approvals.findOne({ _id: id });
    if (!a || !(await this.canSee(ctx, a))) throw notFound('Approval');
    return a;
  }

  async get(ctx: TenantContext, id: string) {
    return toApproval(await this.load(ctx, id));
  }

  private async checkApprovers(tenantId: string, ids: string[], conversationId: string | null) {
    const unique = [...new Set(ids)];
    const found = await this.db
      .for(tenantId)
      .users.countDocuments({ _id: { $in: unique }, status: 'active' });
    if (found !== unique.length)
      throw new AppError('VALIDATION_FAILED', 'One or more approvers do not exist');
    if (conversationId) {
      const c = await this.db.for(tenantId).conversations.findOne({ _id: conversationId });
      if (c && c.kind !== 'channel_public') {
        const members = new Set(await this.conversations.memberIds(tenantId, conversationId));
        if (unique.some((id) => !members.has(id)))
          throw new AppError('VALIDATION_FAILED', 'Approvers must be members of this conversation');
      }
    }
    return unique;
  }

  async create(ctx: TenantContext, body: unknown): Promise<Approval> {
    const req = parse(CreateApprovalRequestSchema, body);
    const w = this.store.for(ctx.tenantId);
    const requestKey = req.clientRequestId ? `client:${ctx.userId}:${req.clientRequestId}` : null;
    if (requestKey) {
      const prior = await w.approvals.findOne({ requestKey });
      if (prior) return toApproval(prior);
    }
    let record: WorkRecordDoc | null = null;
    if (req.conversationId) {
      await this.conversations.authorize(ctx, req.conversationId, 'message.send');
      record = recordOf(
        await w.linked_records.findOne(
          { conversationId: req.conversationId, channelKey: null, parent: null },
          { sort: { createdAt: 1 } },
        ),
      );
      if (req.sourceMessageId) {
        const m = await this.db.for(ctx.tenantId).messages.findOne({
          _id: req.sourceMessageId,
          conversationId: req.conversationId,
          deletedAt: null,
        });
        if (!m) throw notFound('Message');
      }
    } else if (req.sourceMessageId) {
      throw new AppError('VALIDATION_FAILED', 'sourceMessageId needs its conversationId');
    }
    const approverIds = await this.checkApprovers(
      ctx.tenantId,
      req.approverIds,
      req.conversationId,
    );
    if (approverIds.includes(ctx.userId) && approverIds.length === 1)
      throw new AppError(
        'VALIDATION_FAILED',
        'You cannot be the only approver of your own request',
      );
    const doc = await this.insert(ctx.tenantId, {
      title: req.title,
      description: req.description,
      category: req.category,
      amount: req.amount,
      requesterId: ctx.userId,
      approverIds,
      policy: req.policy,
      conversationId: req.conversationId,
      sourceMessageId: req.sourceMessageId,
      record,
      origin: 'connect',
      requestKey,
      dueAt: req.dueAt ? new Date(req.dueAt) : null,
    });
    if (doc.duplicate) return toApproval(doc.doc);
    return toApproval(await this.afterCreate(ctx.tenantId, doc.doc, { postCard: true }));
  }

  async createFromModule(
    tenantId: string,
    input: {
      title: string;
      description: string;
      category: ApprovalCategory;
      amount: ApprovalDoc['amount'];
      requesterId: string;
      approverIds: string[];
      conversationId: string | null;
      record: WorkRecordDoc;
      dueAt: Date | null;
      requestKey: string;
    },
  ): Promise<ApprovalDoc> {
    const r = await this.insert(tenantId, {
      ...input,
      policy: 'any',
      sourceMessageId: null,
      origin: 'module',
    });
    if (r.duplicate) return r.doc;
    return this.afterCreate(tenantId, r.doc, { postCard: false });
  }

  private async insert(
    tenantId: string,
    d: Omit<
      ApprovalDoc,
      '_id' | 'tenantId' | 'status' | 'decisions' | 'createdAt' | 'decidedAt' | 'cardMessageId'
    >,
  ) {
    try {
      const doc = await this.store.for(tenantId).approvals.insertOne({
        ...d,
        status: 'pending',
        decisions: [],
        cardMessageId: null,
        createdAt: new Date(),
        decidedAt: null,
      });
      return { doc, duplicate: false };
    } catch (e) {
      if (e instanceof MongoServerError && e.code === 11000 && d.requestKey) {
        const prior = await this.store
          .for(tenantId)
          .approvals.findOne({ requestKey: d.requestKey });
        if (prior) return { doc: prior, duplicate: true };
      }
      throw e;
    }
  }

  cardText(a: ApprovalDoc) {
    const amt = a.amount ? ` · ${formatFact('money', a.amount)}` : '';
    return `Approval: ${a.title}${amt} (${STATUS_WORD[a.status]})`;
  }
  cardMeta(a: ApprovalDoc) {
    return {
      work: {
        kind: 'approval',
        id: a._id,
        title: a.title,
        status: a.status,
        summary: `${a.category} approval${a.amount ? ` · ${formatFact('money', a.amount)}` : ''}`,
      },
    };
  }

  private async afterCreate(tenantId: string, a: ApprovalDoc, opts: { postCard: boolean }) {
    let doc = a;
    if (opts.postCard && a.conversationId) {
      const msg = await this.messages.postSystem(
        tenantId,
        a.conversationId,
        a.requesterId,
        this.cardText(a),
        this.cardMeta(a),
      );
      await this.store
        .for(tenantId)
        .approvals.updateOne({ _id: a._id }, { $set: { cardMessageId: msg.messageId } });
      doc = { ...doc, cardMessageId: msg.messageId };
      const m = await this.db.for(tenantId).messages.findOne({ _id: msg.messageId });
      if (m)
        await this.notifications
          .notifyAbout(tenantId, m, a.approverIds, 'approval', 'Your approval is needed')
          .catch((e) => this.log.warn(`approval notify: ${String(e)}`));
    }
    this.broadcast(tenantId, doc);
    void this.webhooks.emit(
      tenantId,
      'approval.requested',
      toApproval(doc),
      doc.record?.module ?? null,
    );
    return doc;
  }

  /** Set the card the module event posted, so decisions update it. */
  async attachCard(tenantId: string, approvalId: string, messageId: string) {
    await this.store
      .for(tenantId)
      .approvals.updateOne({ _id: approvalId }, { $set: { cardMessageId: messageId } });
  }

  private broadcast(tenantId: string, a: ApprovalDoc) {
    const dto = toApproval(a);
    for (const u of new Set([a.requesterId, ...a.approverIds]))
      this.realtime.toUser(tenantId, u, 'approval:upsert', dto);
  }

  async decide(ctx: TenantContext, id: string, body: unknown): Promise<Approval> {
    const req = parse(DecideApprovalRequestSchema, body);
    const a = await this.load(ctx, id);
    if (!a.approverIds.includes(ctx.userId))
      throw forbidden('You are not an approver of this request');
    if (a.status !== 'pending')
      throw new AppError('CONFLICT', `This request is already ${a.status}`);
    if (a.decisions.some((d) => d.userId === ctx.userId))
      throw new AppError('CONFLICT', 'You already decided');
    const decisions = [
      ...a.decisions,
      { userId: ctx.userId, decision: req.decision, comment: req.comment, at: new Date() },
    ];
    let status: ApprovalDoc['status'] = 'pending';
    if (req.decision === 'reject') status = 'rejected';
    else if (a.policy === 'any') status = 'approved';
    else if (
      a.approverIds.every((u) => decisions.some((d) => d.userId === u && d.decision === 'approve'))
    )
      status = 'approved';
    const updated = await this.store.for(ctx.tenantId).approvals.findOneAndUpdate(
      // Optimistic concurrency: only if nobody decided in between.
      {
        _id: id,
        status: 'pending',
        'decisions.userId': { $ne: ctx.userId },
        decisions: { $size: a.decisions.length },
      },
      { $set: { decisions, status, decidedAt: status === 'pending' ? null : new Date() } },
      { returnDocument: 'after' },
    );
    if (!updated)
      throw new AppError('CONFLICT', 'Someone decided at the same time; reload and try again');
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'approval.decided',
      target: { type: 'approval', id },
      metadata: { decision: req.decision, status, category: a.category },
    });
    await this.settled(ctx.tenantId, updated, ctx.userId);
    return toApproval(updated);
  }

  async cancel(ctx: TenantContext, id: string): Promise<Approval> {
    const a = await this.load(ctx, id);
    const admin = ctx.role === 'owner' || ctx.role === 'admin';
    if (a.requesterId !== ctx.userId && !admin) throw forbidden();
    if (a.status !== 'pending')
      throw new AppError('CONFLICT', `This request is already ${a.status}`);
    const updated = (await this.store
      .for(ctx.tenantId)
      .approvals.findOneAndUpdate(
        { _id: id, status: 'pending' },
        { $set: { status: 'cancelled', decidedAt: new Date() } },
        { returnDocument: 'after' },
      ))!;
    await this.settled(ctx.tenantId, updated, ctx.userId);
    return toApproval(updated);
  }

  private async settled(tenantId: string, a: ApprovalDoc, actorId: string) {
    if (a.cardMessageId)
      await this.messages.updateSystem(tenantId, a.cardMessageId, this.cardText(a), {
        ...(await this.existingMeta(tenantId, a.cardMessageId)),
        ...this.cardMeta(a),
      });
    this.broadcast(tenantId, a);
    if (a.status === 'pending') return;
    if (a.cardMessageId && a.status !== 'cancelled') {
      const m = await this.db.for(tenantId).messages.findOne({ _id: a.cardMessageId });
      if (m)
        await this.notifications
          .notifyAbout(
            tenantId,
            { ...m, senderId: actorId },
            [a.requesterId],
            'approval',
            `Request ${a.status}`,
          )
          .catch(() => {});
    }
    void this.webhooks.emit(tenantId, 'approval.decided', toApproval(a), a.record?.module ?? null);
    if (a.record && a.status !== 'cancelled') {
      const auto = MODULE_CATALOG[a.record.module].actions.find(
        (x) => x.automatic === 'approval.decided',
      );
      if (auto)
        await this.actions.run(
          tenantId,
          a.record.module,
          'approval.decided',
          { type: a.record.recordType, id: a.record.externalId, title: a.record.title },
          { approval: toApproval(a) },
          actorId,
        );
    }
  }

  private async existingMeta(tenantId: string, messageId: string) {
    const m = await this.db.for(tenantId).messages.findOne({ _id: messageId });
    return (m?.metadata ?? {}) as Record<string, unknown>;
  }

  async list(ctx: TenantContext, query: unknown): Promise<Approval[]> {
    const q = parse(ListApprovalsQuerySchema, query);
    const w = this.store.for(ctx.tenantId);
    const filter: Record<string, unknown> = {};
    if (q.status === 'pending') filter.status = 'pending';
    else if (q.status === 'decided') filter.status = { $ne: 'pending' };
    switch (q.scope) {
      case 'to_decide':
        filter.approverIds = ctx.userId;
        break;
      case 'requested':
        filter.requesterId = ctx.userId;
        break;
      case 'conversation':
        if (!q.conversationId)
          throw new AppError('VALIDATION_FAILED', 'conversationId is required');
        await this.conversations.authorize(ctx, q.conversationId, 'conversation.read');
        filter.conversationId = q.conversationId;
        break;
      case 'record': {
        const rec = q.linkId ? await w.linked_records.findOne({ _id: q.linkId }) : null;
        if (!rec?.conversationId) throw notFound('Record');
        await this.conversations.authorize(ctx, rec.conversationId, 'conversation.read');
        filter['record.module'] = rec.module;
        filter['record.externalId'] = rec.externalId;
        break;
      }
      case 'all':
        if (!tenantCan(ctx.role, 'members.manage')) throw forbidden();
        break;
    }
    const rows = await w.approvals.find(filter, { sort: { _id: -1 }, limit: q.limit }).toArray();
    if (q.scope !== 'all') return rows.map(toApproval);
    const out: ApprovalDoc[] = [];
    for (const r of rows) if (await this.canSee(ctx, r)) out.push(r);
    return out.map(toApproval);
  }
}
