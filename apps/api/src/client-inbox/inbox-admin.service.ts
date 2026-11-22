import { Injectable } from '@nestjs/common';
import { MongoServerError } from 'mongodb';
import {
  INBOX_PRIORITIES,
  INBOX_STATUSES,
  InboxSettingsSchema,
  MergeClientRequestSchema,
  UpdateClientRequestSchema,
  UpsertTemplateRequestSchema,
  tenantCan,
  type ClientProfile,
  type ConnectorProvider,
  type InboxAnalytics,
  type InboxSettings,
  type InboxTemplate,
} from '@sampledge/contracts';
import { z } from 'zod';
import { AppError, forbidden, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import type { InboxTemplateDoc } from '../database/documents.js';
import { newId, TenantDb } from '../database/tenant-db.js';
import { AuditService } from '../audit/audit.service.js';
import { InboxAccess } from './inbox-events.js';
import { settingsOf, toClient } from './mappers.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';

const toTemplate = (t: InboxTemplateDoc): InboxTemplate => ({
  templateId: t._id,
  name: t.name,
  shortcut: t.shortcut,
  body: t.body,
  createdBy: t.createdBy,
  updatedAt: t.updatedAt.toISOString(),
});

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2) * 10) / 10;
};

/** Client profiles, response templates, inbox settings and the supervisor dashboard. */
@Injectable()
export class InboxAdminService {
  constructor(
    private readonly db: TenantDb,
    private readonly access: InboxAccess,
    private readonly audit: AuditService,
    private readonly realtime: RealtimePublisher,
  ) {}

  /** Templates and settings changed: every device re-reads them (`tenant:updated` inbox). */
  private changed(tenantId: string) {
    this.realtime.toTenant(tenantId, 'tenant:updated', { area: 'inbox' });
  }

  private supervise(ctx: TenantContext) {
    if (!tenantCan(ctx.role, 'inbox.supervise'))
      throw forbidden('Only inbox supervisors can do that');
  }

  // ---------- clients ----------

  async client(ctx: TenantContext, id: string): Promise<ClientProfile> {
    await this.access.scope(ctx);
    const t = this.db.for(ctx.tenantId);
    const c = await t.client_profiles.findOne({ _id: id });
    if (!c) throw notFound('Client');
    if (c.mergedInto) return this.client(ctx, c.mergedInto);
    const [accounts, convs] = await Promise.all([
      t.external_accounts.find({ clientId: id }).toArray(),
      t.external_conversations.find({ clientId: id }, { projection: { links: 1 } }).toArray(),
    ]);
    return toClient(c, accounts, convs);
  }

  async searchClients(ctx: TenantContext, q: string) {
    await this.access.scope(ctx);
    const t = this.db.for(ctx.tenantId);
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 80), 'i');
    const found = await t.client_profiles
      .find(
        {
          mergedInto: null,
          ...(q ? { $or: [{ name: rx }, { company: rx }, { email: rx }, { phone: rx }] } : {}),
        },
        { sort: { updatedAt: -1 }, limit: 30 },
      )
      .toArray();
    return Promise.all(found.map((c) => this.client(ctx, c._id)));
  }

  async updateClient(ctx: TenantContext, id: string, input: unknown) {
    await this.access.scope(ctx);
    const req = parse(UpdateClientRequestSchema, input);
    const set: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(req))
      if (v !== undefined) set[k] = k === 'email' && v ? String(v).toLowerCase() : v;
    if (req.tags) set.tags = [...new Set(req.tags.map((x) => x.toLowerCase()))];
    const r = await this.db
      .for(ctx.tenantId)
      .client_profiles.updateOne({ _id: id, mergedInto: null }, { $set: set });
    if (!r.matchedCount) throw notFound('Client');
    return this.client(ctx, id);
  }

  /** Identity matching by hand: fold `fromClientId` (its identities and conversations) into this client. */
  async mergeClient(ctx: TenantContext, id: string, input: unknown) {
    await this.access.scope(ctx);
    const { fromClientId } = parse(MergeClientRequestSchema, input);
    if (fromClientId === id)
      throw new AppError('VALIDATION_FAILED', 'Cannot merge a client into itself');
    const t = this.db.for(ctx.tenantId);
    const [into, from] = await Promise.all([
      t.client_profiles.findOne({ _id: id, mergedInto: null }),
      t.client_profiles.findOne({ _id: fromClientId, mergedInto: null }),
    ]);
    if (!into || !from) throw notFound('Client');
    const now = new Date();
    const convs = await t.external_conversations
      .find({ clientId: fromClientId }, { projection: { _id: 1 } })
      .toArray();
    await t.external_accounts.updateMany({ clientId: fromClientId }, { $set: { clientId: id } });
    await t.external_conversations.updateMany(
      { clientId: fromClientId },
      { $set: { clientId: id, updatedAt: now } },
    );
    await t.client_profiles.updateOne(
      { _id: id },
      {
        $set: {
          company: into.company ?? from.company,
          email: into.email ?? from.email,
          phone: into.phone ?? from.phone,
          title: into.title ?? from.title,
          ownerId: into.ownerId ?? from.ownerId,
          tags: [...new Set([...into.tags, ...from.tags])],
          updatedAt: now,
        },
      },
    );
    await t.client_profiles.updateOne(
      { _id: fromClientId },
      { $set: { mergedInto: id, updatedAt: now } },
    );
    if (convs.length)
      await t.inbox_activity.insertMany(
        convs.map((c) => ({
          conversationId: c._id,
          kind: 'client_merged',
          actorId: ctx.userId,
          summary: `Client "${from.name}" merged into "${into.name}"`,
          createdAt: now,
        })),
      );
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'inbox.client_merged',
      target: { type: 'client', id },
      metadata: { fromClientId },
    });
    return this.client(ctx, id);
  }

  // ---------- templates ----------

  async templates(ctx: TenantContext): Promise<InboxTemplate[]> {
    await this.access.scope(ctx);
    const list = await this.db
      .for(ctx.tenantId)
      .inbox_templates.find({}, { sort: { name: 1 }, limit: 500 })
      .toArray();
    return list.map(toTemplate);
  }

  async upsertTemplate(
    ctx: TenantContext,
    id: string | null,
    input: unknown,
  ): Promise<InboxTemplate> {
    await this.access.scope(ctx);
    const req = parse(UpsertTemplateRequestSchema, input);
    const t = this.db.for(ctx.tenantId);
    try {
      if (!id) {
        const created = toTemplate(
          await t.inbox_templates.insertOne({
            ...req,
            createdBy: ctx.userId,
            updatedAt: new Date(),
          }),
        );
        this.changed(ctx.tenantId);
        return created;
      }
      const cur = await t.inbox_templates.findOne({ _id: id });
      if (!cur) throw notFound('Template');
      if (cur.createdBy !== ctx.userId && !tenantCan(ctx.role, 'inbox.supervise'))
        throw forbidden('Only the author or a supervisor can edit this template');
      const doc = await t.inbox_templates.findOneAndUpdate(
        { _id: id },
        { $set: { ...req, updatedAt: new Date() } },
        { returnDocument: 'after' },
      );
      this.changed(ctx.tenantId);
      return toTemplate(doc!);
    } catch (e) {
      if (e instanceof MongoServerError && e.code === 11000)
        throw new AppError('CONFLICT', `Shortcut /${req.shortcut} is already used`);
      throw e;
    }
  }

  async deleteTemplate(ctx: TenantContext, id: string) {
    await this.access.scope(ctx);
    const t = this.db.for(ctx.tenantId);
    const cur = await t.inbox_templates.findOne({ _id: id });
    if (!cur) throw notFound('Template');
    if (cur.createdBy !== ctx.userId && !tenantCan(ctx.role, 'inbox.supervise')) throw forbidden();
    await t.inbox_templates.deleteMany({ _id: id });
    this.changed(ctx.tenantId);
    return { deleted: true as const };
  }

  // ---------- settings ----------

  async getSettings(ctx: TenantContext): Promise<InboxSettings> {
    await this.access.scope(ctx);
    return settingsOf(await this.db.for(ctx.tenantId).inbox_settings.findOne({}));
  }

  async setSettings(ctx: TenantContext, input: unknown): Promise<InboxSettings> {
    this.supervise(ctx);
    const req = parse(
      InboxSettingsSchema.extend({
        teams: z
          .array(InboxSettingsSchema.shape.teams.element.extend({ teamId: z.string().max(64) }))
          .max(50),
      }),
      input,
    );
    const t = this.db.for(ctx.tenantId);
    const ids = new Set([...req.escalationContactIds, ...req.teams.flatMap((x) => x.memberIds)]);
    const members = await t.memberships
      .find({ userId: { $in: [...ids] }, role: { $ne: 'guest' } }, { projection: { userId: 1 } })
      .toArray();
    if (members.length !== ids.size)
      throw new AppError(
        'VALIDATION_FAILED',
        'Teams and escalation contacts must be members of this organization',
      );
    const teams = req.teams.map((x) => ({
      teamId: x.teamId || newId(),
      name: x.name,
      memberIds: [...new Set(x.memberIds)],
    }));
    const value = { ...req, teams, updatedAt: new Date(), updatedBy: ctx.userId };
    await t.inbox_settings.updateOne({}, { $set: value }, { upsert: true });
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'inbox.settings_updated',
    });
    this.changed(ctx.tenantId);
    return settingsOf({ ...value, _id: '', tenantId: ctx.tenantId });
  }

  // ---------- supervisor dashboard ----------

  async analytics(ctx: TenantContext, days: number): Promise<InboxAnalytics> {
    this.supervise(ctx);
    const t = this.db.for(ctx.tenantId);
    const to = new Date();
    const from = new Date(to.getTime() - Math.min(Math.max(days, 1), 90) * 86_400_000);
    const active = {
      status: { $in: ['open', 'pending', 'snoozed'] as ('open' | 'pending' | 'snoozed')[] },
    };
    const [connectors, recent, activeConvs, msgsByDay, msgsByConnector, repliesByAgent, clients] =
      await Promise.all([
        t.connectors.find({}, { projection: { provider: 1 } }).toArray(),
        t.external_conversations
          .find(
            {
              $or: [
                { createdAt: { $gte: from } },
                { resolvedAt: { $gte: from } },
                { firstResponseAt: { $gte: from } },
              ],
            },
            {
              projection: {
                provider: 1,
                createdAt: 1,
                resolvedAt: 1,
                firstResponseAt: 1,
                firstResponseMet: 1,
                assigneeId: 1,
              },
              limit: 20_000,
            },
          )
          .toArray(),
        t.external_conversations
          .find(active, {
            projection: {
              status: 1,
              priority: 1,
              assigneeId: 1,
              slaDueAt: 1,
              subject: 1,
              clientId: 1,
            },
            limit: 20_000,
          })
          .toArray(),
        t.external_messages
          .aggregate<{ _id: { day: string; dir: 'inbound' | 'outbound' }; n: number }>([
            { $match: { createdAt: { $gte: from } } },
            {
              $group: {
                _id: {
                  day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                  dir: '$direction',
                },
                n: { $sum: 1 },
              },
            },
          ])
          .toArray(),
        t.external_messages
          .aggregate<{ _id: string; n: number }>([
            { $match: { createdAt: { $gte: from }, direction: 'inbound' } },
            { $group: { _id: '$connectorId', n: { $sum: 1 } } },
          ])
          .toArray(),
        t.external_messages
          .aggregate<{ _id: string; n: number }>([
            {
              $match: {
                createdAt: { $gte: from },
                direction: 'outbound',
                authorId: { $type: 'string' },
              },
            },
            { $group: { _id: '$authorId', n: { $sum: 1 } } },
          ])
          .toArray(),
        Promise.resolve(null),
      ]);
    void clients;
    const providerOf = new Map(connectors.map((c) => [c._id, c.provider]));
    const now = to.getTime();
    const frt = (c: (typeof recent)[number]) =>
      c.firstResponseAt && c.firstResponseAt >= from
        ? (c.firstResponseAt.getTime() - c.createdAt.getTime()) / 60_000
        : null;

    const byProvider = new Map<ConnectorProvider, { conversations: number; inbound: number }>();
    for (const c of recent)
      if (c.createdAt >= from) {
        const p = byProvider.get(c.provider) ?? { conversations: 0, inbound: 0 };
        p.conversations++;
        byProvider.set(c.provider, p);
      }
    for (const m of msgsByConnector) {
      const prov = providerOf.get(m._id);
      if (!prov) continue;
      const p = byProvider.get(prov) ?? { conversations: 0, inbound: 0 };
      p.inbound += m.n;
      byProvider.set(prov, p);
    }

    const answered = recent.filter((c) => c.firstResponseAt && c.firstResponseAt >= from);
    const agents = new Map<
      string,
      { open: number; resolved: number; replies: number; breached: number; frt: number[] }
    >();
    const agent = (id: string) => {
      let a = agents.get(id);
      if (!a) agents.set(id, (a = { open: 0, resolved: 0, replies: 0, breached: 0, frt: [] }));
      return a;
    };
    for (const c of activeConvs)
      if (c.assigneeId) {
        const a = agent(c.assigneeId);
        a.open++;
        if (c.slaDueAt && c.slaDueAt.getTime() <= now) a.breached++;
      }
    for (const c of recent) {
      if (!c.assigneeId) continue;
      if (c.resolvedAt && c.resolvedAt >= from) agent(c.assigneeId).resolved++;
      const f = frt(c);
      if (f !== null) agent(c.assigneeId).frt.push(f);
    }
    for (const r of repliesByAgent) agent(r._id).replies = r.n;

    const daily = new Map<string, { inbound: number; outbound: number }>();
    for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 86_400_000))
      daily.set(d.toISOString().slice(0, 10), { inbound: 0, outbound: 0 });
    for (const x of msgsByDay) {
      const row = daily.get(x._id.day) ?? { inbound: 0, outbound: 0 };
      row[x._id.dir] += x.n;
      daily.set(x._id.day, row);
    }

    const breachedList = activeConvs
      .filter((c) => c.slaDueAt && c.slaDueAt.getTime() <= now)
      .sort((a, b) => a.slaDueAt!.getTime() - b.slaDueAt!.getTime())
      .slice(0, 20);
    const names = new Map(
      (
        await t.client_profiles
          .find({ _id: { $in: breachedList.map((c) => c.clientId) } }, { projection: { name: 1 } })
          .toArray()
      ).map((c) => [c._id, c.name]),
    );
    const met = answered.filter((c) => c.firstResponseMet !== null);

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      totals: {
        conversations: recent.filter((c) => c.createdAt >= from).length,
        inbound: msgsByDay.filter((x) => x._id.dir === 'inbound').reduce((n, x) => n + x.n, 0),
        outbound: msgsByDay.filter((x) => x._id.dir === 'outbound').reduce((n, x) => n + x.n, 0),
        resolved: recent.filter((c) => c.resolvedAt && c.resolvedAt >= from).length,
        open: activeConvs.length,
        unassigned: activeConvs.filter((c) => !c.assigneeId).length,
        breachedNow: breachedList.length,
      },
      medianFirstResponseMinutes: median(answered.map(frt).filter((x): x is number => x !== null)),
      slaMetRate: met.length
        ? Math.round((met.filter((c) => c.firstResponseMet).length / met.length) * 1000) / 1000
        : null,
      byProvider: [...byProvider]
        .map(([provider, v]) => ({ provider, ...v }))
        .sort((a, b) => b.inbound - a.inbound),
      byStatus: INBOX_STATUSES.filter((s) => s !== 'resolved').map((status) => ({
        status,
        count: activeConvs.filter((c) => c.status === status).length,
      })),
      byPriority: INBOX_PRIORITIES.map((priority) => ({
        priority,
        count: activeConvs.filter((c) => c.priority === priority).length,
      })),
      agents: [...agents]
        .map(([userId, a]) => ({
          userId,
          open: a.open,
          resolved: a.resolved,
          replies: a.replies,
          breached: a.breached,
          medianFirstResponseMinutes: median(a.frt),
        }))
        .sort((a, b) => b.open - a.open),
      daily: [...daily]
        .map(([day, v]) => ({ day, ...v }))
        .sort((a, b) => a.day.localeCompare(b.day)),
      breaches: breachedList.map((c) => ({
        conversationId: c._id,
        subject: c.subject,
        clientName: names.get(c.clientId) ?? 'Client',
        assigneeId: c.assigneeId,
        dueAt: c.slaDueAt!.toISOString(),
      })),
    };
  }
}
