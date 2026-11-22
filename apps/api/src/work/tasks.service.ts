import { Injectable, Logger } from '@nestjs/common';
import { MongoServerError } from 'mongodb';
import {
  CreateTaskRequestSchema,
  ListTasksQuerySchema,
  MODULE_CATALOG,
  UpdateTaskRequestSchema,
  tenantCan,
  type Task,
  type TaskKind,
  type TaskPriority,
} from '@sampledge/contracts';
import { AppError, forbidden, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { TenantDb } from '../database/tenant-db.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { MessagesService } from '../messages/messages.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';
import { WorkStore } from '../integrations/collections.js';
import type { LinkedRecordDoc, TaskDoc, WorkRecordDoc } from '../integrations/docs.js';
import { ModuleActionsService } from '../integrations/module-actions.service.js';
import { WebhooksService } from '../integrations/webhooks.service.js';

export const toTask = (t: TaskDoc): Task => ({
  taskId: t._id,
  title: t.title,
  description: t.description,
  kind: t.kind,
  status: t.status,
  priority: t.priority,
  assigneeIds: t.assigneeIds,
  createdBy: t.createdBy,
  dueAt: t.dueAt?.toISOString() ?? null,
  conversationId: t.conversationId,
  sourceMessageId: t.sourceMessageId,
  sourceExcerpt: t.sourceExcerpt,
  record: t.record,
  origin: t.origin,
  moduleSync: t.moduleSync
    ? { status: t.moduleSync.status, at: t.moduleSync.at.toISOString() }
    : null,
  createdAt: t.createdAt.toISOString(),
  updatedAt: t.updatedAt.toISOString(),
  completedAt: t.completedAt?.toISOString() ?? null,
});

export const recordOf = (r: LinkedRecordDoc | null): WorkRecordDoc | null =>
  r && r.recordType !== '_channel'
    ? {
        module: r.module,
        recordType: r.recordType,
        externalId: r.externalId,
        title: r.title,
        url: r.url,
      }
    : null;

const KIND_WORD: Record<TaskKind, string> = {
  task: 'Task',
  bug: 'Bug',
  follow_up: 'Follow-up',
  escalation: 'Escalation',
};
const STATUS_WORD: Record<TaskDoc['status'], string> = {
  open: 'Open',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
  cancelled: 'Cancelled',
};

/**
 * Tasks: Connect's own work items, created by hand, from a chat message ("chat-to-task") or by
 * a module event. A task in a conversation posts a live card there; assignees are notified.
 */
@Injectable()
export class TasksService {
  private readonly log = new Logger('Tasks');

  constructor(
    private readonly db: TenantDb,
    private readonly store: WorkStore,
    private readonly conversations: ConversationsService,
    private readonly messages: MessagesService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimePublisher,
    private readonly actions: ModuleActionsService,
    private readonly webhooks: WebhooksService,
  ) {}

  private isAdmin(ctx: TenantContext) {
    return tenantCan(ctx, 'work.manage');
  }

  async canSee(ctx: TenantContext, t: TaskDoc): Promise<boolean> {
    if (t.createdBy === ctx.userId || t.assigneeIds.includes(ctx.userId)) return true;
    if (t.conversationId) {
      try {
        await this.conversations.authorize(ctx, t.conversationId, 'conversation.read');
        return true;
      } catch {
        return false;
      }
    }
    return this.isAdmin(ctx);
  }

  private async load(ctx: TenantContext, id: string): Promise<TaskDoc> {
    const t = await this.store.for(ctx.tenantId).tasks.findOne({ _id: id });
    if (!t || !(await this.canSee(ctx, t))) throw notFound('Task');
    return t;
  }

  async get(ctx: TenantContext, id: string): Promise<Task> {
    return toTask(await this.load(ctx, id));
  }

  private async checkAssignees(tenantId: string, ids: string[], conversationId: string | null) {
    const unique = [...new Set(ids)];
    if (!unique.length) return unique;
    const found = await this.db
      .for(tenantId)
      .users.countDocuments({ _id: { $in: unique }, status: 'active' });
    if (found !== unique.length)
      throw new AppError('VALIDATION_FAILED', 'One or more assignees do not exist');
    if (conversationId) {
      const c = await this.db.for(tenantId).conversations.findOne({ _id: conversationId });
      if (c && c.kind !== 'channel_public') {
        const members = new Set(await this.conversations.memberIds(tenantId, conversationId));
        if (unique.some((id) => !members.has(id)))
          throw new AppError('VALIDATION_FAILED', 'Assignees must be members of this conversation');
      }
    }
    return unique;
  }

  async create(ctx: TenantContext, body: unknown): Promise<Task> {
    const req = parse(CreateTaskRequestSchema, body);
    const w = this.store.for(ctx.tenantId);
    if (req.clientRequestId) {
      const prior = await w.tasks.findOne({
        requestKey: `client:${ctx.userId}:${req.clientRequestId}`,
      });
      if (prior) return toTask(prior);
    }
    let excerpt: string | null = null;
    let record: WorkRecordDoc | null = null;
    if (req.conversationId) {
      await this.conversations.authorize(ctx, req.conversationId, 'message.send');
      const linked = await w.linked_records.findOne(
        { conversationId: req.conversationId, channelKey: null, parent: null },
        { sort: { createdAt: 1 } },
      );
      record = recordOf(linked);
      if (req.sourceMessageId) {
        const m = await this.db.for(ctx.tenantId).messages.findOne({
          _id: req.sourceMessageId,
          conversationId: req.conversationId,
          deletedAt: null,
        });
        if (!m) throw notFound('Message');
        excerpt = m.content.text.replace(/\s+/g, ' ').trim().slice(0, 280) || null;
      }
    } else if (req.sourceMessageId) {
      throw new AppError('VALIDATION_FAILED', 'sourceMessageId needs its conversationId');
    }
    const assigneeIds = await this.checkAssignees(
      ctx.tenantId,
      req.assigneeIds,
      req.conversationId,
    );
    const task = await this.insert(ctx.tenantId, {
      title: req.title,
      description: req.description,
      kind: req.kind,
      priority: req.priority,
      assigneeIds,
      createdBy: ctx.userId,
      dueAt: req.dueAt ? new Date(req.dueAt) : null,
      conversationId: req.conversationId,
      sourceMessageId: req.sourceMessageId,
      sourceExcerpt: excerpt,
      record,
      origin: 'connect',
      requestKey: req.clientRequestId ? `client:${ctx.userId}:${req.clientRequestId}` : null,
    });
    if (task.duplicate) return toTask(task.doc);
    const doc = await this.afterCreate(ctx.tenantId, task.doc, { postCard: true });
    return toTask(doc);
  }

  /** Used by module events: no card here (the event card carries the task). */
  async createFromModule(
    tenantId: string,
    input: {
      title: string;
      description: string;
      kind: TaskKind;
      priority: TaskPriority;
      assigneeIds: string[];
      dueAt: Date | null;
      conversationId: string | null;
      record: WorkRecordDoc;
      createdBy: string;
      requestKey: string;
    },
  ): Promise<TaskDoc> {
    const r = await this.insert(tenantId, {
      ...input,
      sourceMessageId: null,
      sourceExcerpt: null,
      origin: 'module',
    });
    if (r.duplicate) return r.doc;
    return this.afterCreate(tenantId, r.doc, { postCard: false });
  }

  private async insert(
    tenantId: string,
    d: Omit<
      TaskDoc,
      | '_id'
      | 'tenantId'
      | 'status'
      | 'createdAt'
      | 'updatedAt'
      | 'completedAt'
      | 'cardMessageId'
      | 'moduleSync'
    >,
  ): Promise<{ doc: TaskDoc; duplicate: boolean }> {
    const now = new Date();
    try {
      const doc = await this.store.for(tenantId).tasks.insertOne({
        ...d,
        status: 'open',
        cardMessageId: null,
        moduleSync: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      });
      return { doc, duplicate: false };
    } catch (e) {
      if (e instanceof MongoServerError && e.code === 11000 && d.requestKey) {
        const prior = await this.store.for(tenantId).tasks.findOne({ requestKey: d.requestKey });
        if (prior) return { doc: prior, duplicate: true };
      }
      throw e;
    }
  }

  cardText(t: TaskDoc) {
    return `${KIND_WORD[t.kind]}: ${t.title} (${STATUS_WORD[t.status]})`;
  }
  cardMeta(t: TaskDoc) {
    return {
      work: {
        kind: 'task',
        id: t._id,
        title: t.title,
        status: t.status,
        summary: `${KIND_WORD[t.kind]} · ${t.priority} priority`,
      },
    };
  }

  private async afterCreate(tenantId: string, t: TaskDoc, opts: { postCard: boolean }) {
    const w = this.store.for(tenantId);
    let doc = t;
    if (opts.postCard && t.conversationId) {
      const msg = await this.messages.postSystem(
        tenantId,
        t.conversationId,
        t.createdBy,
        this.cardText(t),
        this.cardMeta(t),
      );
      await w.tasks.updateOne({ _id: t._id }, { $set: { cardMessageId: msg.messageId } });
      doc = { ...doc, cardMessageId: msg.messageId };
      const m = await this.db.for(tenantId).messages.findOne({ _id: msg.messageId });
      if (m)
        await this.notifications
          .notifyAbout(tenantId, m, t.assigneeIds, 'task', 'New task for you')
          .catch((e) => this.log.warn(`task notify: ${String(e)}`));
    }
    if (doc.record && doc.origin === 'connect') doc = await this.pushToModule(tenantId, doc);
    this.broadcast(tenantId, doc);
    void this.webhooks.emit(tenantId, 'task.created', toTask(doc), doc.record?.module ?? null);
    return doc;
  }

  /** Chat-to-task in a linked conversation: create the task in the module too (live mode). */
  private async pushToModule(tenantId: string, t: TaskDoc): Promise<TaskDoc> {
    const rec = t.record!;
    const auto = MODULE_CATALOG[rec.module].actions.find((a) => a.automatic === 'task.created');
    if (!auto) return t;
    const creator = await this.db.for(tenantId).users.findOne({ _id: t.createdBy });
    const assignees = await this.db
      .for(tenantId)
      .users.find({ _id: { $in: t.assigneeIds } }, { projection: { email: 1, displayName: 1 } })
      .toArray();
    const action = await this.actions.run(
      tenantId,
      rec.module,
      'task.created',
      { type: rec.recordType, id: rec.externalId, title: rec.title },
      {
        task: toTask(t),
        createdBy: { userId: t.createdBy, email: creator?.email ?? null },
        assignees: assignees.map((a) => ({ userId: a._id, email: a.email, name: a.displayName })),
      },
      t.createdBy,
    );
    const moduleSync = { status: action.status, at: new Date() };
    await this.store.for(tenantId).tasks.updateOne({ _id: t._id }, { $set: { moduleSync } });
    return { ...t, moduleSync };
  }

  private broadcast(tenantId: string, t: TaskDoc) {
    const dto = toTask(t);
    for (const u of new Set([t.createdBy, ...t.assigneeIds]))
      this.realtime.toUser(tenantId, u, 'task:upsert', dto);
  }

  async update(ctx: TenantContext, id: string, body: unknown): Promise<Task> {
    const req = parse(UpdateTaskRequestSchema, body);
    const t = await this.load(ctx, id);
    const allowed =
      t.createdBy === ctx.userId || t.assigneeIds.includes(ctx.userId) || this.isAdmin(ctx);
    if (!allowed) throw forbidden('Only the creator, assignees or an admin can change this task');
    const set: Partial<TaskDoc> = { updatedAt: new Date() };
    if (req.title !== undefined) set.title = req.title;
    if (req.description !== undefined) set.description = req.description;
    if (req.priority !== undefined) set.priority = req.priority;
    if (req.dueAt !== undefined) set.dueAt = req.dueAt ? new Date(req.dueAt) : null;
    if (req.assigneeIds !== undefined)
      set.assigneeIds = await this.checkAssignees(ctx.tenantId, req.assigneeIds, t.conversationId);
    if (req.status !== undefined && req.status !== t.status) {
      set.status = req.status;
      set.completedAt = req.status === 'done' ? new Date() : null;
    }
    const doc = (await this.store
      .for(ctx.tenantId)
      .tasks.findOneAndUpdate({ _id: id }, { $set: set }, { returnDocument: 'after' }))!;
    if (doc.cardMessageId)
      await this.messages.updateSystem(
        ctx.tenantId,
        doc.cardMessageId,
        this.cardText(doc),
        this.cardMeta(doc),
      );
    const added = (set.assigneeIds ?? []).filter((u) => !t.assigneeIds.includes(u));
    if (added.length && doc.cardMessageId) {
      const m = await this.db.for(ctx.tenantId).messages.findOne({ _id: doc.cardMessageId });
      if (m)
        await this.notifications.notifyAbout(ctx.tenantId, m, added, 'task', 'New task for you');
    }
    this.broadcast(ctx.tenantId, doc);
    for (const u of t.assigneeIds.filter((u) => !doc.assigneeIds.includes(u)))
      this.realtime.toUser(ctx.tenantId, u, 'task:upsert', toTask(doc));
    void this.webhooks.emit(ctx.tenantId, 'task.updated', toTask(doc), doc.record?.module ?? null);
    return toTask(doc);
  }

  async list(ctx: TenantContext, query: unknown): Promise<Task[]> {
    const q = parse(ListTasksQuerySchema, query);
    const w = this.store.for(ctx.tenantId);
    const filter: Record<string, unknown> = {};
    if (q.status === 'active') filter.status = { $in: ['open', 'in_progress', 'blocked'] };
    else if (q.status === 'done') filter.status = { $in: ['done', 'cancelled'] };
    switch (q.scope) {
      case 'mine':
        filter.assigneeIds = ctx.userId;
        break;
      case 'created':
        filter.createdBy = ctx.userId;
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
        filter['record.recordType'] = rec.recordType;
        filter['record.externalId'] = rec.externalId;
        break;
      }
      case 'all':
        if (!tenantCan(ctx, 'members.manage')) throw forbidden();
        break;
    }
    const rows = await w.tasks
      .find(filter, { sort: { dueAt: 1, _id: -1 }, limit: q.limit })
      .toArray();
    if (q.scope !== 'all') return rows.map(toTask);
    // Admins see everything except tasks in private conversations they can't read.
    const visible: TaskDoc[] = [];
    for (const r of rows) if (await this.canSee(ctx, r)) visible.push(r);
    return visible.map(toTask);
  }
}
