import { Inject, Injectable, Logger } from '@nestjs/common';
import { MongoServerError, type Filter } from 'mongodb';
import {
  AddInboxNoteRequestSchema,
  AddLinkRequestSchema,
  CONNECTOR_CATALOG,
  CreateInboxConversationRequestSchema,
  EscalateRequestSchema,
  INBOX_PRIORITIES,
  ListInboxQuerySchema,
  LogInboundRequestSchema,
  SendInboxReplyRequestSchema,
  UpdateInboxConversationRequestSchema,
  type InboxConversationDetail,
  type InboxList,
  type InboxMessage,
  type InboxNote,
  type InboxPriority,
  type InboxSettings,
  type InboxTimelineItem,
} from '@sampledge/contracts';
import { AppError, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import type {
  ConnectorDoc,
  ExternalConversationDoc,
  ExternalMessageDoc,
  InboxActivityDoc,
} from '../database/documents.js';
import { newId, TenantDb } from '../database/tenant-db.js';
import { AuditService } from '../audit/audit.service.js';
import { RateLimitService } from '../redis/redis.module.js';
import { ADAPTERS, type InboundMessage } from '../connectors/adapters/index.js';
import { InboxAccess } from './inbox-events.js';
import {
  preview,
  settingsOf,
  toActivity,
  toClient,
  toConversation,
  toMessage,
  toNote,
} from './mappers.js';
import { OutboxSignal } from './outbox-signal.js';
import { LINKED_RECORD_RESOLVER, type LinkedRecordResolver } from './linked-records.js';

const isDuplicate = (e: unknown) => e instanceof MongoServerError && e.code === 11000;
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ACTIVE = ['open', 'pending', 'snoozed'] as const;
const rank = (p: InboxPriority) => INBOX_PRIORITIES.indexOf(p);

@Injectable()
export class InboxService {
  private readonly log = new Logger('ClientInbox');
  constructor(
    private readonly db: TenantDb,
    private readonly access: InboxAccess,
    private readonly audit: AuditService,
    private readonly limits: RateLimitService,
    private readonly worker: OutboxSignal,
    @Inject(LINKED_RECORD_RESOLVER) private readonly resolver: LinkedRecordResolver,
  ) {}

  async settings(tenantId: string): Promise<InboxSettings> {
    return settingsOf(await this.db.for(tenantId).inbox_settings.findOne({}));
  }

  private async activity(
    tenantId: string,
    conversationId: string,
    kind: string,
    actorId: string | null,
    summary: string,
  ) {
    await this.db
      .for(tenantId)
      .inbox_activity.insertOne({ conversationId, kind, actorId, summary, createdAt: new Date() });
  }

  /** Loads a conversation the caller may see, or 404 (never 403: existence is not leaked). */
  private async load(ctx: TenantContext, id: string) {
    const scope = await this.access.scope(ctx);
    const c = await this.db.for(ctx.tenantId).external_conversations.findOne({ _id: id });
    if (!c || !this.access.canSee(ctx, scope, c)) throw notFound('Conversation');
    return { c, scope };
  }

  private async isAgent(tenantId: string, userId: string) {
    const m = await this.db.for(tenantId).memberships.findOne({ userId });
    return !!m && m.role !== 'guest';
  }

  private async pickAssignee(
    tenantId: string,
    settings: InboxSettings,
    teamId: string | null,
  ): Promise<string | null> {
    if (!settings.autoAssign || !teamId) return null;
    const members = settings.teams.find((t) => t.teamId === teamId)?.memberIds ?? [];
    if (!members.length) return null;
    const load = await this.db
      .for(tenantId)
      .external_conversations.aggregate<{ _id: string; n: number }>([
        { $match: { assigneeId: { $in: members }, status: { $in: [...ACTIVE] } } },
        { $group: { _id: '$assigneeId', n: { $sum: 1 } } },
      ])
      .toArray();
    const counts = new Map(load.map((x) => [x._id, x.n]));
    return [...members].sort((a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0))[0] ?? null;
  }

  // ---------- inbound ----------

  /** Stores one normalized inbound message. Returns the conversation id, or null for a provider redelivery. */
  async ingest(connector: ConnectorDoc, m: InboundMessage): Promise<string | null> {
    const tenantId = connector.tenantId;
    const t = this.db.for(tenantId);
    const now = new Date();
    const settings = await this.settings(tenantId);

    // 1. Identity: one external account per (connector, provider user), matched to a client profile.
    let account = await t.external_accounts.findOne({
      connectorId: connector._id,
      externalUserId: m.from.externalUserId,
    });
    if (!account) {
      const match =
        (m.from.email &&
          (await t.client_profiles.findOne({
            email: m.from.email.toLowerCase(),
            mergedInto: null,
          }))) ||
        (m.from.phone &&
          (await t.client_profiles.findOne({ phone: m.from.phone, mergedInto: null }))) ||
        null;
      const client =
        match ??
        (await t.client_profiles.insertOne({
          name: m.from.displayName,
          company: null,
          email: m.from.email?.toLowerCase() ?? null,
          phone: m.from.phone ?? null,
          title: null,
          tags: [],
          ownerId: null,
          mergedInto: null,
          createdAt: now,
          updatedAt: now,
        }));
      try {
        account = await t.external_accounts.insertOne({
          connectorId: connector._id,
          provider: connector.provider,
          externalUserId: m.from.externalUserId,
          displayName: m.from.displayName,
          handle: m.from.handle,
          clientId: client._id,
          createdAt: now,
        });
      } catch (e) {
        if (!isDuplicate(e)) throw e;
        account = (await t.external_accounts.findOne({
          connectorId: connector._id,
          externalUserId: m.from.externalUserId,
        }))!;
      }
    } else if (account.displayName !== m.from.displayName || account.handle !== m.from.handle) {
      await t.external_accounts.updateOne(
        { _id: account._id },
        { $set: { displayName: m.from.displayName, handle: m.from.handle } },
      );
    }

    // 2. Conversation: one per provider thread. Upsert so concurrent webhooks cannot create two.
    const conversation = await t.external_conversations.findOneAndUpdate(
      { connectorId: connector._id, externalThreadId: m.externalThreadId },
      {
        $setOnInsert: {
          provider: connector.provider,
          replyContext: {},
          clientId: account.clientId,
          accountId: account._id,
          subject:
            m.subject || `${m.from.displayName} via ${CONNECTOR_CATALOG[connector.provider].name}`,
          status: 'open',
          priority: 'normal',
          assigneeId: null,
          teamId: connector.teamId,
          tags: [],
          slaDueAt: null,
          waitingSince: null,
          firstResponseAt: null,
          firstResponseMet: null,
          slaBreachedAt: null,
          escalation: null,
          links: [],
          lastMessage: null,
          awaitingReply: 0,
          snoozedUntil: null,
          resolvedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true, returnDocument: 'after' },
    );
    let c = conversation!;
    if (c.createdAt.getTime() === now.getTime()) {
      await this.activity(
        tenantId,
        c._id,
        'created',
        null,
        `New conversation from ${m.from.displayName}`,
      );
      const assignee = await this.pickAssignee(tenantId, settings, c.teamId);
      if (assignee) {
        await t.external_conversations.updateOne(
          { _id: c._id },
          { $set: { assigneeId: assignee } },
        );
        c = { ...c, assigneeId: assignee };
        await this.activity(tenantId, c._id, 'assigned', null, 'Auto-assigned');
      }
    }

    // 3. The message itself. A provider redelivery hits the unique index and is dropped.
    try {
      await t.external_messages.insertOne({
        conversationId: c._id,
        connectorId: connector._id,
        direction: 'inbound',
        text: m.text.slice(0, 8000),
        attachments: m.attachments.slice(0, 20),
        authorId: null,
        accountId: account._id,
        externalMessageId: m.externalMessageId,
        clientMessageId: null,
        deliveryState: 'delivered',
        error: null,
        attempts: 0,
        nextAttemptAt: null,
        lockedUntil: null,
        handoffUrl: null,
        sandboxRequest: null,
        createdAt: now,
        sentAt: m.sentAt,
      });
    } catch (e) {
      if (isDuplicate(e)) return null;
      throw e;
    }

    // 4. The client is now waiting: start (or keep) the SLA clock, reopen if needed.
    const waitingSince = c.waitingSince ?? now;
    const slaDueAt =
      c.slaDueAt ?? new Date(waitingSince.getTime() + settings.sla[c.priority] * 60_000);
    const reopened = c.status === 'resolved' || c.status === 'snoozed';
    const updated = await t.external_conversations.findOneAndUpdate(
      { _id: c._id },
      {
        $set: {
          lastMessage: {
            direction: 'inbound',
            preview: preview(m.text, m.attachments.length),
            at: now,
          },
          waitingSince,
          slaDueAt,
          updatedAt: now,
          ...(reopened ? { status: 'open', snoozedUntil: null, resolvedAt: null } : {}),
          ...(c.status === 'pending' ? { status: 'open' } : {}),
          ...Object.fromEntries(
            Object.entries(m.replyContext).map(([k, v]) => [`replyContext.${k}`, v]),
          ),
        },
        $inc: { awaitingReply: 1 },
      },
      { returnDocument: 'after' },
    );
    if (reopened)
      await this.activity(
        tenantId,
        c._id,
        'status_changed',
        null,
        `Reopened: ${c.status} → open (client replied)`,
      );
    await this.access.emit(tenantId, updated!, 'message');
    return c._id;
  }

  // ---------- reading ----------

  async list(ctx: TenantContext, query: unknown): Promise<InboxList> {
    const q = parse(ListInboxQuerySchema, query);
    const scope = await this.access.scope(ctx);
    const t = this.db.for(ctx.tenantId);
    const base = this.access.filter(ctx, scope) as Filter<ExternalConversationDoc>;
    const now = new Date();
    const and: Filter<ExternalConversationDoc>[] = [base];
    if (q.status === 'active' || !q.status) and.push({ status: { $in: [...ACTIVE] } });
    else and.push({ status: q.status });
    if (q.assignee === 'me') and.push({ assigneeId: ctx.userId });
    else if (q.assignee === 'unassigned') and.push({ assigneeId: null });
    else if (q.assignee) and.push({ assigneeId: q.assignee });
    if (q.provider) and.push({ provider: q.provider });
    if (q.priority) and.push({ priority: q.priority });
    if (q.tag) and.push({ tags: q.tag.toLowerCase() });
    if (q.teamId) and.push({ teamId: q.teamId });
    if (q.clientId) and.push({ clientId: q.clientId });
    if (q.sla === 'breached') and.push({ slaDueAt: { $lte: now } });
    if (q.q) {
      const rx = new RegExp(escapeRegex(q.q), 'i');
      const clients = await t.client_profiles
        .find(
          { $or: [{ name: rx }, { company: rx }, { email: rx }] },
          { projection: { _id: 1 }, limit: 200 },
        )
        .toArray();
      and.push({
        $or: [
          { subject: rx },
          { 'lastMessage.preview': rx },
          { tags: q.q.toLowerCase() },
          { clientId: { $in: clients.map((x) => x._id) } },
        ],
      });
    }
    const settings = await this.settings(ctx.tenantId);
    let docs = await t.external_conversations
      .find({ $and: and }, { sort: { updatedAt: -1 }, limit: q.sla === 'due_soon' ? 500 : q.limit })
      .toArray();
    const view = await this.hydrate(ctx.tenantId, docs, settings);
    let items = view;
    if (q.sla === 'due_soon')
      items = view.filter((v) => v.sla.state === 'due_soon').slice(0, q.limit);
    // Waiting clients first (earliest due), then the rest by recent activity.
    items.sort((a, b) => {
      const da = a.sla.dueAt ? Date.parse(a.sla.dueAt) : Infinity;
      const dbb = b.sla.dueAt ? Date.parse(b.sla.dueAt) : Infinity;
      if (da !== dbb) return da - dbb;
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    });
    docs = [];

    const activeBase = {
      $and: [base, { status: { $in: [...ACTIVE] } }],
    } as Filter<ExternalConversationDoc>;
    const [mine, unassigned, active, breached] = await Promise.all([
      t.external_conversations.countDocuments({ $and: [activeBase, { assigneeId: ctx.userId }] }),
      t.external_conversations.countDocuments({ $and: [activeBase, { assigneeId: null }] }),
      t.external_conversations.countDocuments(activeBase),
      t.external_conversations.countDocuments({ $and: [activeBase, { slaDueAt: { $lte: now } }] }),
    ]);
    return { items, counts: { mine, unassigned, active, breached } };
  }

  private async hydrate(
    tenantId: string,
    docs: ExternalConversationDoc[],
    settings: InboxSettings,
  ) {
    const t = this.db.for(tenantId);
    const [clients, connectors] = await Promise.all([
      t.client_profiles
        .find(
          { _id: { $in: [...new Set(docs.map((d) => d.clientId))] } },
          { projection: { name: 1, company: 1 } },
        )
        .toArray(),
      t.connectors
        .find(
          { _id: { $in: [...new Set(docs.map((d) => d.connectorId))] } },
          { projection: { environment: 1 } },
        )
        .toArray(),
    ]);
    const cm = new Map(clients.map((c) => [c._id, c]));
    const km = new Map(connectors.map((c) => [c._id, c]));
    return docs.map((d) =>
      toConversation(d, km.get(d.connectorId) ?? null, cm.get(d.clientId) ?? null, settings),
    );
  }

  async detail(ctx: TenantContext, id: string): Promise<InboxConversationDetail> {
    const { c } = await this.load(ctx, id);
    const t = this.db.for(ctx.tenantId);
    const [settings, messages, notes, activity, client, accounts, clientConvs, connector] =
      await Promise.all([
        this.settings(ctx.tenantId),
        t.external_messages
          .find({ conversationId: id }, { sort: { createdAt: -1 }, limit: 300 })
          .toArray(),
        t.inbox_notes
          .find({ conversationId: id }, { sort: { createdAt: -1 }, limit: 300 })
          .toArray(),
        t.inbox_activity
          .find({ conversationId: id }, { sort: { createdAt: -1 }, limit: 300 })
          .toArray(),
        t.client_profiles.findOne({ _id: c.clientId }),
        t.external_accounts.find({ clientId: c.clientId }).toArray(),
        t.external_conversations
          .find({ clientId: c.clientId }, { projection: { links: 1 } })
          .toArray(),
        t.connectors.findOne({ _id: c.connectorId }),
      ]);
    if (!client) throw notFound('Client');
    const timeline: (InboxTimelineItem & { at: string })[] = [
      ...messages.map((m) => ({
        type: 'message' as const,
        message: toMessage(m),
        at: m.createdAt.toISOString(),
      })),
      ...notes.map((n) => ({
        type: 'note' as const,
        note: toNote(n),
        at: n.createdAt.toISOString(),
      })),
      ...activity.map((a) => ({
        type: 'activity' as const,
        activity: toActivity(a),
        at: a.createdAt.toISOString(),
      })),
    ].sort((a, b) => a.at.localeCompare(b.at));
    return {
      conversation: toConversation(c, connector, client, settings),
      client: toClient(client, accounts, clientConvs),
      timeline: timeline.map(({ at: _at, ...item }) => item as InboxTimelineItem),
    };
  }

  // ---------- replying (external) ----------

  async reply(ctx: TenantContext, id: string, input: unknown): Promise<InboxMessage> {
    const req = parse(SendInboxReplyRequestSchema, input);
    const { c } = await this.load(ctx, id);
    await this.limits.consume('inbox_reply', ctx.userId);
    const t = this.db.for(ctx.tenantId);
    const existing = await t.external_messages.findOne({ clientMessageId: req.clientMessageId });
    if (existing) {
      if (existing.conversationId !== id)
        throw new AppError('CONFLICT', 'clientMessageId already used');
      return toMessage(existing);
    }
    const connector = await t.connectors.findOne({ _id: c.connectorId });
    if (!connector || connector.deletedAt)
      throw new AppError(
        'CONFLICT',
        'This channel was disconnected; replies can no longer be sent',
      );
    const adapter = ADAPTERS[c.provider];
    const now = new Date();
    let state: ExternalMessageDoc['deliveryState'] = 'queued';
    let handoffUrl: string | null = null;
    if (CONNECTOR_CATALOG[c.provider].mode === 'handoff') {
      const account = c.accountId ? await t.external_accounts.findOne({ _id: c.accountId }) : null;
      const r = await adapter.send(req.text, {
        credentials: {},
        http: { sandbox: true, request: async () => ({ status: 200, headers: {}, json: {} }) },
        tokens: { get: async () => null, set: async () => undefined },
        externalThreadId: c.externalThreadId,
        replyContext: c.replyContext,
        clientHandle: account?.handle ?? account?.externalUserId ?? null,
        testMode: connector.environment === 'test',
      });
      if (r.kind === 'handoff') {
        state = 'handoff';
        handoffUrl = r.url;
      }
    }
    let msg: ExternalMessageDoc;
    try {
      msg = await t.external_messages.insertOne({
        conversationId: id,
        connectorId: c.connectorId,
        direction: 'outbound',
        text: req.text,
        attachments: [],
        authorId: ctx.userId,
        accountId: null,
        externalMessageId: null,
        clientMessageId: req.clientMessageId,
        deliveryState: state,
        error: null,
        attempts: 0,
        nextAttemptAt: state === 'queued' ? now : null,
        lockedUntil: null,
        handoffUrl,
        sandboxRequest: null,
        createdAt: now,
        sentAt: null,
      });
    } catch (e) {
      if (!isDuplicate(e)) throw e;
      return toMessage(
        (await t.external_messages.findOne({ clientMessageId: req.clientMessageId }))!,
      );
    }
    // An agent answered: stop the SLA clock and record whether the first reply met it.
    const set: Partial<ExternalConversationDoc> = {
      lastMessage: { direction: 'outbound', preview: preview(req.text), at: now },
      awaitingReply: 0,
      waitingSince: null,
      slaDueAt: null,
      updatedAt: now,
      ...(c.status === 'snoozed' ? { status: 'open' as const, snoozedUntil: null } : {}),
      ...(c.assigneeId ? {} : { assigneeId: ctx.userId }),
    };
    if (!c.firstResponseAt) {
      set.firstResponseAt = now;
      set.firstResponseMet = c.slaDueAt ? now <= c.slaDueAt : true;
    }
    const updated = await t.external_conversations.findOneAndUpdate(
      { _id: id },
      { $set: set },
      { returnDocument: 'after' },
    );
    if (!c.assigneeId)
      await this.activity(
        ctx.tenantId,
        id,
        'assigned',
        ctx.userId,
        'Assigned to the agent who replied',
      );
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'inbox.reply_sent',
      target: { type: 'inbox_conversation', id },
      metadata: {
        messageId: msg._id,
        provider: c.provider,
        ...(req.templateId ? { templateId: req.templateId } : {}),
      },
    });
    if (state === 'queued') this.worker.poke();
    await this.access.emit(ctx.tenantId, updated!, 'message');
    return toMessage(msg);
  }

  async retry(ctx: TenantContext, id: string, messageId: string): Promise<InboxMessage> {
    await this.load(ctx, id);
    const t = this.db.for(ctx.tenantId);
    const m = await t.external_messages.findOneAndUpdate(
      { _id: messageId, conversationId: id, direction: 'outbound', deliveryState: 'failed' },
      {
        $set: {
          deliveryState: 'queued',
          attempts: 0,
          error: null,
          nextAttemptAt: new Date(),
          lockedUntil: null,
        },
      },
      { returnDocument: 'after' },
    );
    if (!m) throw notFound('Failed reply');
    this.worker.poke();
    return toMessage(m);
  }

  // ---------- internal notes (never sent) ----------

  async addNote(ctx: TenantContext, id: string, input: unknown): Promise<InboxNote> {
    const req = parse(AddInboxNoteRequestSchema, input);
    const { c } = await this.load(ctx, id);
    const t = this.db.for(ctx.tenantId);
    try {
      const n = await t.inbox_notes.insertOne({
        conversationId: id,
        authorId: ctx.userId,
        text: req.text,
        mentions: [...new Set(req.mentions)],
        clientNoteId: req.clientNoteId,
        createdAt: new Date(),
      });
      await t.external_conversations.updateOne({ _id: id }, { $set: { updatedAt: new Date() } });
      await this.access.emit(ctx.tenantId, c, 'note');
      return toNote(n);
    } catch (e) {
      if (!isDuplicate(e)) throw e;
      const n = await t.inbox_notes.findOne({ clientNoteId: req.clientNoteId });
      if (!n || n.conversationId !== id)
        throw new AppError('CONFLICT', 'clientNoteId already used');
      return toNote(n);
    }
  }

  // ---------- triage ----------

  async update(ctx: TenantContext, id: string, input: unknown) {
    const req = parse(UpdateInboxConversationRequestSchema, input);
    const { c } = await this.load(ctx, id);
    const t = this.db.for(ctx.tenantId);
    const settings = await this.settings(ctx.tenantId);
    const now = new Date();
    const set: Partial<ExternalConversationDoc> = { updatedAt: now };
    const acts: [string, string][] = [];

    if (req.assigneeId !== undefined && req.assigneeId !== c.assigneeId) {
      if (req.assigneeId && !(await this.isAgent(ctx.tenantId, req.assigneeId)))
        throw new AppError('VALIDATION_FAILED', 'Assignee must be a member of this organization');
      set.assigneeId = req.assigneeId;
      acts.push(req.assigneeId ? ['assigned', `Assigned`] : ['unassigned', 'Unassigned']);
    }
    if (req.teamId !== undefined && req.teamId !== c.teamId) {
      const team = req.teamId ? settings.teams.find((x) => x.teamId === req.teamId) : null;
      if (req.teamId && !team) throw new AppError('VALIDATION_FAILED', 'Unknown inbox team');
      set.teamId = req.teamId;
      acts.push(['team_changed', team ? `Team: ${team.name}` : 'Team removed']);
    }
    if (req.priority && req.priority !== c.priority) {
      set.priority = req.priority;
      if (c.waitingSince)
        set.slaDueAt = new Date(c.waitingSince.getTime() + settings.sla[req.priority] * 60_000);
      acts.push(['priority_changed', `Priority: ${c.priority} → ${req.priority}`]);
    }
    if (req.tags) {
      const tags = [...new Set(req.tags.map((x) => x.toLowerCase()))];
      if (tags.join() !== c.tags.join()) {
        set.tags = tags;
        acts.push(['tags_changed', tags.length ? `Tags: ${tags.join(', ')}` : 'Tags cleared']);
      }
    }
    if (req.subject && req.subject !== c.subject) set.subject = req.subject;
    if (req.status && req.status !== c.status) {
      set.status = req.status;
      if (req.status === 'snoozed') {
        if (!req.snoozedUntil || Date.parse(req.snoozedUntil) <= now.getTime())
          throw new AppError('VALIDATION_FAILED', 'Snoozing needs a future snoozedUntil');
        set.snoozedUntil = new Date(req.snoozedUntil);
      } else set.snoozedUntil = null;
      if (req.status === 'resolved') {
        set.resolvedAt = now;
        set.slaDueAt = null;
        set.waitingSince = null;
        set.awaitingReply = 0;
      } else if (c.status === 'resolved') set.resolvedAt = null;
      acts.push(['status_changed', `Status: ${c.status} → ${req.status}`]);
    }
    const updated = await t.external_conversations.findOneAndUpdate(
      { _id: id },
      { $set: set },
      { returnDocument: 'after' },
    );
    for (const [kind, summary] of acts)
      await this.activity(ctx.tenantId, id, kind, ctx.userId, summary);
    await this.access.emit(ctx.tenantId, updated!, 'updated');
    if (set.teamId !== undefined || set.assigneeId !== undefined)
      await this.access.emit(ctx.tenantId, c, 'updated');
    return this.detail(ctx, id);
  }

  /** Raise the escalation level, bump priority, hand to a supervisor, and tell them. */
  async escalate(ctx: TenantContext, id: string, input: unknown) {
    const req = parse(EscalateRequestSchema, input);
    const { c } = await this.load(ctx, id);
    const settings = await this.settings(ctx.tenantId);
    const to = req.toUserId ?? settings.escalationContactIds[0] ?? null;
    if (to && !(await this.isAgent(ctx.tenantId, to)))
      throw new AppError('VALIDATION_FAILED', 'Unknown escalation contact');
    await this.applyEscalation(ctx.tenantId, c, settings, req.reason, ctx.userId, to);
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'inbox.escalated',
      target: { type: 'inbox_conversation', id },
      metadata: { level: (c.escalation?.level ?? 0) + 1, to },
    });
    return this.detail(ctx, id);
  }

  async applyEscalation(
    tenantId: string,
    c: ExternalConversationDoc,
    settings: InboxSettings,
    reason: string,
    by: string | null,
    to: string | null,
  ) {
    const level = (c.escalation?.level ?? 0) + 1;
    const priority: InboxPriority = rank(c.priority) < rank('high') ? 'high' : 'urgent';
    const now = new Date();
    const updated = await this.db.for(tenantId).external_conversations.findOneAndUpdate(
      { _id: c._id },
      {
        $set: {
          escalation: { level, reason, at: now, by },
          priority,
          ...(c.waitingSince
            ? {
                slaDueAt: new Date(
                  Math.min(
                    c.slaDueAt?.getTime() ?? Infinity,
                    c.waitingSince.getTime() + settings.sla[priority] * 60_000,
                  ),
                ),
              }
            : {}),
          ...(to ? { assigneeId: to } : {}),
          status: c.status === 'resolved' || c.status === 'snoozed' ? 'open' : c.status,
          updatedAt: now,
        },
      },
      { returnDocument: 'after' },
    );
    await this.activity(tenantId, c._id, 'escalated', by, `Escalated to level ${level}: ${reason}`);
    await this.access.emit(tenantId, updated!, 'updated');
  }

  // ---------- SampForce / Samptrek links ----------

  async addLink(ctx: TenantContext, id: string, input: unknown) {
    const req = parse(AddLinkRequestSchema, input);
    const { c } = await this.load(ctx, id);
    if (
      c.links.some(
        (l) =>
          l.module === req.module &&
          l.recordType === req.recordType &&
          l.externalId === req.externalId,
      )
    )
      return this.detail(ctx, id);
    if (c.links.length >= 20) throw new AppError('VALIDATION_FAILED', 'Too many linked records');
    const resolved = await this.resolver
      .resolve(ctx, req.module, req.recordType, req.externalId)
      .catch(() => undefined);
    if (resolved === null)
      throw new AppError('NOT_FOUND', 'That record was not found in the module');
    const link = {
      linkId: newId(),
      module: req.module,
      recordType: req.recordType,
      externalId: req.externalId,
      label: resolved?.label ?? req.label,
      url: resolved?.url ?? req.url,
      verified: !!resolved,
      linkedBy: ctx.userId,
      linkedAt: new Date(),
    };
    await this.db
      .for(ctx.tenantId)
      .external_conversations.updateOne(
        { _id: id },
        { $push: { links: link }, $set: { updatedAt: new Date() } },
      );
    await this.activity(
      ctx.tenantId,
      id,
      'linked',
      ctx.userId,
      `Linked ${req.module === 'sampforce' ? 'SampForce' : 'Samptrek'} ${req.recordType}: ${link.label}`,
    );
    await this.resolver.onLinked?.(ctx, { conversationId: id, ...link }).catch(() => undefined);
    return this.detail(ctx, id);
  }

  async removeLink(ctx: TenantContext, id: string, linkId: string) {
    const { c } = await this.load(ctx, id);
    const link = c.links.find((l) => l.linkId === linkId);
    if (!link) throw notFound('Link');
    await this.db
      .for(ctx.tenantId)
      .external_conversations.updateOne(
        { _id: id },
        { $pull: { links: { linkId } }, $set: { updatedAt: new Date() } },
      );
    await this.activity(ctx.tenantId, id, 'unlinked', ctx.userId, `Unlinked ${link.label}`);
    return this.detail(ctx, id);
  }

  // ---------- handoff channels ----------

  /** Start a conversation by hand on a handoff channel (the client wrote in their own app). */
  async createHandoffConversation(ctx: TenantContext, input: unknown) {
    const req = parse(CreateInboxConversationRequestSchema, input);
    await this.access.scope(ctx);
    const t = this.db.for(ctx.tenantId);
    const connector = await t.connectors.findOne({ _id: req.connectorId, deletedAt: null });
    if (!connector) throw notFound('Connector');
    if (CONNECTOR_CATALOG[connector.provider].mode !== 'handoff')
      throw new AppError(
        'VALIDATION_FAILED',
        'Conversations on this channel start when the client messages you',
      );
    const id = await this.ingest(connector, {
      externalMessageId: `manual:${newId()}`,
      externalThreadId: req.handle,
      replyContext: {},
      from: {
        externalUserId: req.handle,
        displayName: req.clientName,
        handle: req.handle,
        phone: /^\+?\d[\d\s-]{5,}$/.test(req.handle) ? req.handle.replace(/[\s-]/g, '') : null,
        email: req.handle.includes('@') ? req.handle : null,
      },
      text: req.firstMessage || '(conversation started by an agent)',
      attachments: [],
      subject: req.subject,
      sentAt: new Date(),
    });
    const convId =
      id ??
      (await t.external_conversations.findOne({
        connectorId: connector._id,
        externalThreadId: req.handle,
      }))!._id;
    await t.external_conversations.updateOne(
      { _id: convId, assigneeId: null },
      { $set: { assigneeId: ctx.userId } },
    );
    return this.detail(ctx, convId);
  }

  async logInbound(ctx: TenantContext, id: string, input: unknown) {
    const req = parse(LogInboundRequestSchema, input);
    const { c } = await this.load(ctx, id);
    if (CONNECTOR_CATALOG[c.provider].mode !== 'handoff')
      throw new AppError(
        'VALIDATION_FAILED',
        'Only handoff channels take manually logged messages',
      );
    const t = this.db.for(ctx.tenantId);
    const connector = await t.connectors.findOne({ _id: c.connectorId });
    const account = c.accountId ? await t.external_accounts.findOne({ _id: c.accountId }) : null;
    if (!connector || !account) throw notFound('Connector');
    await this.ingest(connector, {
      externalMessageId: `manual:${newId()}`,
      externalThreadId: c.externalThreadId,
      replyContext: {},
      from: {
        externalUserId: account.externalUserId,
        displayName: account.displayName,
        handle: account.handle,
      },
      text: req.text,
      attachments: [],
      sentAt: new Date(),
    });
    await this.activity(
      ctx.tenantId,
      id,
      'status_changed',
      ctx.userId,
      'Client message logged by an agent',
    );
    return this.detail(ctx, id);
  }

  // ---------- background ----------

  /** Marks SLA breaches (and escalates when configured) and wakes snoozed conversations. All tenants. */
  async sweep(now = new Date()) {
    const raw = this.db.unscoped.external_conversations;
    const due = await raw
      .find(
        { slaDueAt: { $lte: now }, slaBreachedAt: null, status: { $in: [...ACTIVE] } },
        { limit: 200 },
      )
      .toArray();
    for (const c of due) {
      const res = await raw.updateOne(
        { _id: c._id, tenantId: c.tenantId, slaBreachedAt: null },
        { $set: { slaBreachedAt: now } },
      );
      if (!res.modifiedCount) continue;
      await this.activity(
        c.tenantId,
        c._id,
        'sla_breached',
        null,
        `SLA breached (${c.priority} priority)`,
      );
      const settings = await this.settings(c.tenantId);
      if (settings.autoEscalateOnBreach && (c.escalation?.level ?? 0) === 0)
        await this.applyEscalation(
          c.tenantId,
          c,
          settings,
          'SLA breached',
          null,
          settings.escalationContactIds[0] ?? null,
        );
      else await this.access.emit(c.tenantId, { ...c, slaBreachedAt: now }, 'updated');
    }
    const woken = await raw
      .find({ status: 'snoozed', snoozedUntil: { $lte: now } }, { limit: 200 })
      .toArray();
    for (const c of woken) {
      await raw.updateOne(
        { _id: c._id, tenantId: c.tenantId },
        { $set: { status: 'open', snoozedUntil: null, updatedAt: now } },
      );
      await this.activity(
        c.tenantId,
        c._id,
        'status_changed',
        null,
        'Snooze ended: snoozed → open',
      );
      await this.access.emit(c.tenantId, c, 'updated');
    }
  }
}

export type { InboxActivityDoc };
