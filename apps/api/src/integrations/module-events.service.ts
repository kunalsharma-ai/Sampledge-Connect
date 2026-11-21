import { Injectable, Logger } from '@nestjs/common';
import { MongoServerError } from 'mongodb';
import {
  MODULE_CATALOG,
  ModuleEventSchema,
  formatFact,
  moduleEventDef,
  uuidv7,
  type ModuleCardMetadata,
  type ModuleEvent,
  type ModuleEventLog,
  type ModuleEventResult,
  type SampledgeModule,
} from '@sampledge/contracts';
import { AppError, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { TenantDb } from '../database/tenant-db.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { TasksService } from '../work/tasks.service.js';
import { ApprovalsService } from '../work/approvals.service.js';
import { ProjectsService } from '../work/projects.service.js';
import { WorkStore } from './collections.js';
import type { IntegrationEventDoc, LinkedRecordDoc } from './docs.js';
import { ModuleSettingsService } from './module-settings.service.js';
import { RecordsService, toLinkedRecord } from './records.service.js';
import { WebhooksService } from './webhooks.service.js';

const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

const toResult = (d: IntegrationEventDoc, duplicate: boolean): ModuleEventResult => ({
  eventId: d.eventId,
  duplicate,
  status: d.status,
  actions: d.actions,
  conversationId: d.conversationId,
  messageId: d.messageId,
  taskId: d.taskId,
  approvalId: d.approvalId,
  unmatchedPeople: d.unmatchedPeople,
  error: d.error,
});

export const toEventLog = (d: IntegrationEventDoc): ModuleEventLog => ({
  ...toResult(d, false),
  module: d.module,
  type: d.type,
  recordTitle: d.recordTitle,
  source: d.source,
  receivedAt: d.receivedAt.toISOString(),
});

function scalarFacts(
  e: ModuleEvent,
  defFacts: { key: string; format: Parameters<typeof formatFact>[0] }[],
): LinkedRecordDoc['fields'] {
  const out: LinkedRecordDoc['fields'] = {};
  for (const f of defFacts) {
    const v = e.data[f.key];
    if (v === undefined) continue;
    if (f.format === 'money') out[f.key] = formatFact('money', v);
    else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null)
      out[f.key] = typeof v === 'string' ? v.slice(0, 300) : v;
  }
  return out;
}

function moneyOf(v: unknown): { amountMinor: number; currency: string } | null {
  const m = v as { amountMinor?: unknown; currency?: unknown } | null;
  if (
    m &&
    typeof m.amountMinor === 'number' &&
    Number.isInteger(m.amountMinor) &&
    m.amountMinor >= 0 &&
    typeof m.currency === 'string' &&
    /^[A-Z]{3}$/.test(m.currency)
  )
    return { amountMinor: m.amountMinor, currency: m.currency };
  return null;
}

const dateOf = (v: unknown) => {
  if (typeof v !== 'string') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * The adapter engine. Runs a module event through the catalogue: find or create the record's
 * conversation, add and notify the people involved, create tasks or approvals, keep projects
 * current, and post a card. Each eventId is processed once (a retry gets the stored result).
 */
@Injectable()
export class ModuleEventsService {
  private readonly logger = new Logger('ModuleEvents');

  constructor(
    private readonly db: TenantDb,
    private readonly store: WorkStore,
    private readonly settings: ModuleSettingsService,
    private readonly records: RecordsService,
    private readonly tasks: TasksService,
    private readonly approvals: ApprovalsService,
    private readonly projects: ProjectsService,
    private readonly notifications: NotificationsService,
    private readonly webhooks: WebhooksService,
  ) {}

  async receive(
    tenantId: string,
    m: SampledgeModule,
    body: unknown,
    source: 'module' | 'admin_test' = 'module',
  ): Promise<ModuleEventResult> {
    const e = parse(ModuleEventSchema, body);
    const s = await this.settings.get(tenantId, m);
    if (!s.enabled)
      throw new AppError('FORBIDDEN', `${MODULE_CATALOG[m].name} is not enabled in Connect`);
    const w = this.store.for(tenantId);

    const base: Omit<IntegrationEventDoc, '_id' | 'tenantId'> = {
      module: m,
      eventId: e.eventId,
      type: e.type,
      recordType: e.record.type,
      recordId: e.record.id,
      recordTitle: e.record.title,
      source,
      status: 'failed',
      actions: [],
      conversationId: null,
      messageId: null,
      taskId: null,
      approvalId: null,
      unmatchedPeople: [],
      error: 'processing',
      receivedAt: new Date(),
    };
    let row: IntegrationEventDoc;
    try {
      row = await w.integration_events.insertOne(base);
    } catch (err) {
      if (!(err instanceof MongoServerError && err.code === 11000)) throw err;
      const prior = await w.integration_events.findOne({ module: m, eventId: e.eventId });
      if (!prior) throw err;
      // A failed attempt may be retried with the same eventId; anything else is a duplicate.
      const stuck = prior.error === 'processing' && Date.now() - prior.receivedAt.getTime() > 120_000;
      if (!(prior.status === 'failed' && (prior.error !== 'processing' || stuck)))
        return toResult(prior, true);
      await w.integration_events.updateOne(
        { _id: prior._id },
        { $set: { error: 'processing', receivedAt: new Date() } },
      );
      row = { ...prior, error: 'processing' };
    }

    let result: Omit<IntegrationEventDoc, '_id' | 'tenantId'>;
    try {
      result = await this.process(tenantId, m, e, source, base);
    } catch (err) {
      const msg = err instanceof AppError ? err.message : 'Internal error while processing';
      if (!(err instanceof AppError)) this.logger.error(`event ${m}/${e.eventId}: ${(err as Error).stack}`);
      result = { ...base, status: 'failed', error: msg };
    }
    await w.integration_events.updateOne(
      { _id: row._id },
      {
        $set: {
          status: result.status,
          actions: result.actions,
          conversationId: result.conversationId,
          messageId: result.messageId,
          taskId: result.taskId,
          approvalId: result.approvalId,
          unmatchedPeople: result.unmatchedPeople,
          error: result.error,
        },
      },
    );
    return toResult({ ...row, ...result }, false);
  }

  private async process(
    tenantId: string,
    m: SampledgeModule,
    e: ModuleEvent,
    source: 'module' | 'admin_test',
    base: Omit<IntegrationEventDoc, '_id' | 'tenantId'>,
  ): Promise<Omit<IntegrationEventDoc, '_id' | 'tenantId'>> {
    const def = moduleEventDef(m, e.type);
    if (!def)
      return {
        ...base,
        status: 'ignored',
        error: `${MODULE_CATALOG[m].name} event type "${e.type}" is not handled by Connect`,
      };
    const actions: string[] = [];
    const people = await this.records.resolvePeople(tenantId, m, e.people);
    const actor = e.actor ? await this.records.resolvePeople(tenantId, m, [e.actor]) : null;
    const botId = await this.records.botUserId(tenantId, m);

    if (def.linkIdentities) {
      let linked = 0;
      for (const p of e.people)
        if (p.externalUserId && p.email) {
          const r = await this.records.resolvePeople(tenantId, m, [p]);
          if (r.userIds.length) linked++;
        }
      actions.push(`identities.linked:${linked}`);
      return {
        ...base,
        status: 'processed',
        error: null,
        actions,
        unmatchedPeople: people.unmatched,
      };
    }

    const members = [...new Set([...people.userIds, ...(actor?.userIds ?? [])])];
    const { record, created } = await this.records.ensureRecordConversation(tenantId, m, {
      record: e.record,
      parent: e.parent,
      target: def.conversation,
      memberIds: members,
    });
    const conversationId = record.conversationId!;
    if (created) {
      actions.push('conversation.created');
      void this.webhooks.emit(tenantId, 'record.linked', toLinkedRecord(record), m);
    }
    if (people.userIds.length) actions.push(`members.added:${people.userIds.length}`);

    await this.records.updateRecordFacts(tenantId, record._id, scalarFacts(e, def.facts), e.type);
    if (def.project === 'upsert') {
      await this.projects.upsertFromSamptrek(tenantId, e.record, e.data, conversationId, people.userIds, botId);
      actions.push('project.updated');
    } else if (def.project === 'milestone') {
      await this.projects.milestone(tenantId, e.parent, e.record, e.type, e.data, conversationId, botId);
      actions.push('milestone.updated');
    }

    const workRecord = {
      module: m,
      recordType: e.record.type,
      externalId: e.record.id,
      title: e.record.title,
      url: e.record.url ?? null,
    };
    let taskId: string | null = null;
    let approvalId: string | null = null;
    if (def.task) {
      const priority = (PRIORITIES as readonly string[]).includes(String(e.data.priority))
        ? (e.data.priority as (typeof PRIORITIES)[number])
        : def.task.priority;
      const t = await this.tasks.createFromModule(tenantId, {
        title: (def.type === 'task.assigned' ? e.record.title : (e.summary ?? e.record.title)).slice(0, 200),
        description: e.summary ?? '',
        kind: def.task.kind,
        priority,
        assigneeIds: people.userIds,
        dueAt: dateOf(e.data.dueAt),
        conversationId,
        record: workRecord,
        createdBy: actor?.userIds[0] ?? botId,
        requestKey: `module:${m}:${e.eventId}`,
      });
      taskId = t._id;
      actions.push('task.created');
    }
    if (def.approval) {
      if (!people.userIds.length)
        throw new AppError(
          'VALIDATION_FAILED',
          'Approval events need at least one approver in `people` with a Connect account',
        );
      const a = await this.approvals.createFromModule(tenantId, {
        title: (e.summary ?? e.record.title).slice(0, 200),
        description: e.summary ?? '',
        category: def.approval.category,
        amount: moneyOf(e.data.amount),
        requesterId: actor?.userIds[0] ?? botId,
        approverIds: people.userIds,
        conversationId,
        record: workRecord,
        dueAt: dateOf(e.data.dueAt),
        requestKey: `module:${m}:${e.eventId}`,
      });
      approvalId = a._id;
      actions.push('approval.created');
    }

    const facts = def.facts
      .map((f) => ({ label: f.label, value: formatFact(f.format, e.data[f.key]) }))
      .filter((f): f is { label: string; value: string } => f.value !== null)
      .slice(0, 8);
    const card: ModuleCardMetadata = {
      module: m,
      eventType: e.type,
      eventLabel: def.label,
      tone: def.tone,
      record: { type: e.record.type, id: e.record.id, title: e.record.title, url: e.record.url ?? null },
      facts,
      taskId,
      approvalId,
      test: source === 'admin_test',
    };
    const summary = e.summary ?? def.description;
    const text = `${source === 'admin_test' ? '[Test] ' : ''}${def.label} · ${e.record.title}: ${summary}`.slice(0, 4000);
    const msg = await this.records.postCard(tenantId, m, conversationId, text, { module: card });
    actions.push('card.posted');
    if (approvalId) await this.approvals.attachCard(tenantId, approvalId, msg._id);

    if (def.notify && people.userIds.length) {
      const kind = def.approval ? 'approval' : def.task ? 'task' : 'alert';
      await this.notifications.notifyAbout(
        tenantId,
        msg,
        people.userIds,
        kind,
        `${MODULE_CATALOG[m].name}: ${def.label}`,
      );
      actions.push(`notified:${people.userIds.length}`);
    }

    return {
      ...base,
      status: 'processed',
      error: null,
      actions,
      conversationId,
      messageId: msg._id,
      taskId,
      approvalId,
      unmatchedPeople: people.unmatched,
    };
  }

  /** Admin "Send test event": the catalogue example, addressed to the admin, marked as a test. */
  async sendTest(ctx: TenantContext, m: SampledgeModule, type: string): Promise<ModuleEventResult> {
    const def = moduleEventDef(m, type);
    if (!def) throw notFound('Event type');
    const me = await this.db.for(ctx.tenantId).users.findOne({ _id: ctx.userId });
    if (!me) throw notFound('User');
    const ex = def.example;
    return this.receive(
      ctx.tenantId,
      m,
      {
        eventId: `test-${uuidv7()}`,
        type,
        occurredAt: new Date().toISOString(),
        record: { ...ex.record, id: `TEST-${ex.record.id}`, title: `${ex.record.title} (test)` },
        ...(ex.parent
          ? { parent: { ...ex.parent, id: `TEST-${ex.parent.id}`, title: `${ex.parent.title} (test)` } }
          : {}),
        people: [{ email: me.email }],
        summary: ex.summary,
        data: ex.data,
      },
      'admin_test',
    );
  }

  async log(ctx: TenantContext, m: SampledgeModule, limit = 50): Promise<ModuleEventLog[]> {
    const rows = await this.store
      .for(ctx.tenantId)
      .integration_events.find({ module: m }, { sort: { _id: -1 }, limit: Math.min(limit, 200) })
      .toArray();
    return rows.map(toEventLog);
  }
}
