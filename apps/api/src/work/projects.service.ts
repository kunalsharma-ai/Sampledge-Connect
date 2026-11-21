import { Injectable } from '@nestjs/common';
import { MongoServerError } from 'mongodb';
import { CreateProjectRequestSchema, type Project, type RecordRef } from '@sampledge/contracts';
import { AppError, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { WorkStore } from '../integrations/collections.js';
import type { ProjectDoc } from '../integrations/docs.js';

const PROJECT_STATUSES = ['active', 'on_hold', 'at_risk', 'completed', 'cancelled'] as const;
const asStatus = (v: unknown): ProjectDoc['status'] | null =>
  typeof v === 'string' && (PROJECT_STATUSES as readonly string[]).includes(v)
    ? (v as ProjectDoc['status'])
    : null;
const asDate = (v: unknown): Date | null => {
  if (typeof v !== 'string') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Projects: Samptrek projects (kept current by project.* and milestone.* events) and projects
 * made in Connect. Each has a project channel; tasks and approvals in it count toward it.
 */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly store: WorkStore,
    private readonly conversations: ConversationsService,
  ) {}

  private async counts(tenantId: string, conversationIds: string[]) {
    const w = this.store.for(tenantId);
    const now = new Date();
    const [tasks, approvals] = await Promise.all([
      w.tasks
        .aggregate<{ _id: string; open: number; overdue: number }>([
          {
            $match: {
              conversationId: { $in: conversationIds },
              status: { $in: ['open', 'in_progress', 'blocked'] },
            },
          },
          {
            $group: {
              _id: '$conversationId',
              open: { $sum: 1 },
              overdue: {
                $sum: {
                  $cond: [{ $and: [{ $ne: ['$dueAt', null] }, { $lt: ['$dueAt', now] }] }, 1, 0],
                },
              },
            },
          },
        ])
        .toArray(),
      w.approvals
        .aggregate<{ _id: string; n: number }>([
          { $match: { conversationId: { $in: conversationIds }, status: 'pending' } },
          { $group: { _id: '$conversationId', n: { $sum: 1 } } },
        ])
        .toArray(),
    ]);
    return {
      tasks: new Map(tasks.map((t) => [t._id, t])),
      approvals: new Map(approvals.map((a) => [a._id, a.n])),
    };
  }

  private toDto(p: ProjectDoc, c: Awaited<ReturnType<ProjectsService['counts']>>): Project {
    const t = p.conversationId ? c.tasks.get(p.conversationId) : undefined;
    return {
      projectId: p._id,
      name: p.name,
      description: p.description,
      status: p.status,
      source: p.source,
      externalId: p.externalId,
      url: p.url,
      conversationId: p.conversationId,
      ownerIds: p.ownerIds,
      dueAt: p.dueAt?.toISOString() ?? null,
      milestones: p.milestones.map((m) => ({ ...m, dueAt: m.dueAt?.toISOString() ?? null })),
      openTasks: t?.open ?? 0,
      overdueTasks: t?.overdue ?? 0,
      pendingApprovals: (p.conversationId && c.approvals.get(p.conversationId)) || 0,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  /** Projects whose channel the caller can read. */
  async list(ctx: TenantContext): Promise<Project[]> {
    const readable = new Set(
      (await this.conversations.listReadable(ctx)).map((c) => c.conversationId),
    );
    const rows = await this.store
      .for(ctx.tenantId)
      .projects.find({}, { sort: { updatedAt: -1 }, limit: 500 })
      .toArray();
    const visible = rows.filter((p) => p.conversationId && readable.has(p.conversationId));
    const c = await this.counts(
      ctx.tenantId,
      visible.map((p) => p.conversationId!),
    );
    return visible.map((p) => this.toDto(p, c));
  }

  async get(ctx: TenantContext, id: string): Promise<Project> {
    const p = await this.store.for(ctx.tenantId).projects.findOne({ _id: id });
    if (!p || !p.conversationId) throw notFound('Project');
    await this.conversations.authorize(ctx, p.conversationId, 'conversation.read');
    return this.toDto(p, await this.counts(ctx.tenantId, [p.conversationId]));
  }

  async create(ctx: TenantContext, body: unknown): Promise<Project> {
    const req = parse(CreateProjectRequestSchema, body);
    const c = await this.conversations.create(ctx, {
      kind: req.private ? 'channel_private' : 'channel_public',
      name: req.name,
      topic: req.description ? req.description.slice(0, 250) : `Project: ${req.name}`,
      memberIds: req.memberIds,
    });
    const now = new Date();
    const p = await this.store.for(ctx.tenantId).projects.insertOne({
      name: req.name,
      description: req.description,
      status: 'active',
      source: 'connect',
      externalId: null,
      url: null,
      conversationId: c.conversationId,
      ownerIds: [ctx.userId],
      dueAt: req.dueAt ? new Date(req.dueAt) : null,
      milestones: [],
      createdBy: ctx.userId,
      createdAt: now,
      updatedAt: now,
    });
    return this.toDto(p, await this.counts(ctx.tenantId, [c.conversationId]));
  }

  /** project.created / project.updated from Samptrek. */
  async upsertFromSamptrek(
    tenantId: string,
    record: RecordRef,
    data: Record<string, unknown>,
    conversationId: string | null,
    ownerIds: string[],
    botId: string,
  ) {
    const now = new Date();
    const set: Partial<ProjectDoc> = { name: record.title.slice(0, 80), updatedAt: now };
    if (record.url) set.url = record.url;
    if (conversationId) set.conversationId = conversationId;
    const status = asStatus(data.status);
    if (status) set.status = status;
    if ('dueAt' in data) set.dueAt = asDate(data.dueAt);
    if (typeof data.description === 'string') set.description = data.description.slice(0, 2000);
    try {
      await this.store.for(tenantId).projects.updateOne(
        { source: 'samptrek', externalId: record.id },
        {
          $set: set,
          $addToSet: { ownerIds: { $each: ownerIds } },
          $setOnInsert: {
            source: 'samptrek',
            externalId: record.id,
            ...(status ? {} : { status: 'active' }),
            ...('description' in set ? {} : { description: '' }),
            ...('dueAt' in set ? {} : { dueAt: null }),
            ...(record.url ? {} : { url: null }),
            ...(conversationId ? {} : { conversationId: null }),
            milestones: [],
            createdBy: botId,
            createdAt: now,
          } as never,
        },
        { upsert: true },
      );
    } catch (e) {
      if (!(e instanceof MongoServerError && e.code === 11000)) throw e;
    }
  }

  /** milestone.* from Samptrek: keeps the project's milestone list current. */
  async milestone(
    tenantId: string,
    parent: RecordRef | undefined,
    record: RecordRef,
    eventType: string,
    data: Record<string, unknown>,
    conversationId: string | null,
    botId: string,
  ) {
    if (!parent)
      throw new AppError('VALIDATION_FAILED', 'Milestone events need `parent` (the project)');
    await this.upsertFromSamptrek(tenantId, parent, {}, conversationId, [], botId);
    const w = this.store.for(tenantId);
    const p = await w.projects.findOne({ source: 'samptrek', externalId: parent.id });
    if (!p) return;
    const status: ProjectDoc['milestones'][number]['status'] =
      eventType === 'milestone.reached'
        ? 'reached'
        : data.status === 'missed'
          ? 'missed'
          : eventType === 'milestone.due'
            ? 'due'
            : 'upcoming';
    const ms = p.milestones.filter((m) => m.milestoneId !== record.id);
    const prev = p.milestones.find((m) => m.milestoneId === record.id);
    ms.push({
      milestoneId: record.id,
      title: record.title.slice(0, 160),
      dueAt: asDate(data.dueAt) ?? prev?.dueAt ?? null,
      status,
    });
    ms.sort((a, b) => (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity));
    await w.projects.updateOne(
      { _id: p._id },
      { $set: { milestones: ms.slice(-50), updatedAt: new Date() } },
    );
  }
}
