import { readFileSync } from 'node:fs';
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { Filter } from 'mongodb';
import {
  CreatePlatformOrgSchema,
  ORG_DELETION_GRACE_DAYS,
  PlatformOrgQuerySchema,
  ScheduleDeletionSchema,
  SuspendOrgSchema,
  UpdatePlatformOrgSchema,
  type PlatformHealth,
  type PlatformOrg,
  type PlatformOrgDetail,
  type PlatformOrgPage,
  type PlatformOrgPerson,
  type PlatformOverview,
  type PlatformSupportView,
  type TenantRole,
} from '@sampledge/contracts';
import { AppError, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import type {
  BillingInvoiceDoc,
  BillingSubscriptionDoc,
  TenantDoc,
} from '../database/documents.js';
import { TenantDb } from '../database/tenant-db.js';
import { MIGRATIONS } from '../database/migrations/runner.js';
import { REDIS } from '../redis/redis.module.js';
import { AdminService } from '../admin/admin.service.js';
import { AuthService } from '../auth/auth.service.js';
import { SessionService } from '../auth/session.service.js';
import { readOidcSettings } from '../auth/sso-settings.js';
import { BillingService, emptySub, toInvoice, toSubscription } from '../billing/billing.service.js';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service.js';
import { Metrics } from '../health/metrics.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';
import { NetworkTenant } from '../network/network-tenant.js';
import { PlatformAdmins } from './platform-admins.js';
import { PlatformAudit } from './platform-audit.service.js';

const DAY = 86_400_000;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const VERSION: string = (() => {
  try {
    return (
      (
        JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
          version?: string;
        }
      ).version ?? 'unknown'
    );
  } catch {
    return 'unknown';
  }
})();

/** Security events shown in the support view. */
const SUPPORT_EVENTS = [
  'auth.login_failed',
  'auth.mfa_failed',
  'auth.sso_failed',
  'auth.mfa_reset_by_admin',
  'auth.mfa_disabled',
  'auth.mfa_enabled',
  'device.revoked',
  'member.deactivated',
  'member.role_changed',
];

/**
 * The super admin console (docs/super-admin.md): every organization, usage and health,
 * and the organization lifecycle. Each mutation is written to the platform audit log and
 * the organization's own log, and pushed live to every platform admin.
 */
@Injectable()
export class PlatformService {
  constructor(
    private readonly db: TenantDb,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly admins: PlatformAdmins,
    private readonly audit: PlatformAudit,
    private readonly adminSvc: AdminService,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly billing: BillingService,
    private readonly settings: IntegrationSettingsService,
    private readonly metrics: Metrics,
    private readonly gateway: RealtimeGateway,
    private readonly realtime: RealtimePublisher,
    private readonly network: NetworkTenant,
  ) {}

  // ─── overview ─────────────────────────────────────────────────────────────

  async overview(ctx: TenantContext): Promise<PlatformOverview> {
    await this.admins.assert(ctx, 'overview.view');
    const raw = this.db.raw;
    const netId = await this.network.id();
    const orgs = { tenantId: { $ne: netId } };
    const now = Date.now();
    const since30 = new Date(now - 30 * DAY);
    const [
      tenants,
      signupRows,
      people,
      twoStep,
      devices,
      recentDevices,
      messages,
      storage,
      subs,
      plans,
      openReports,
      health,
    ] = await Promise.all([
      this.db.tenants
        .find(
          { kind: { $ne: 'network' } },
          { projection: { status: 1, deletion: 1, createdAt: 1 } },
        )
        .toArray(),
      this.db.tenants
        .aggregate<{ _id: string; n: number }>([
          { $match: { kind: { $ne: 'network' }, createdAt: { $gte: since30 } } },
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
              n: { $sum: 1 },
            },
          },
        ])
        .toArray(),
      raw.collection('users').countDocuments({ ...orgs, status: 'active' }),
      raw.collection('users').countDocuments({
        ...orgs,
        status: 'active',
        'mfa.enabledAt': { $ne: null, $exists: true },
      }),
      raw.collection('devices').countDocuments({ ...orgs, revokedAt: null }),
      raw.collection('devices').countDocuments({
        ...orgs,
        revokedAt: null,
        lastSeenAt: { $gte: new Date(now - 7 * DAY) },
      }),
      raw
        .collection('messages')
        .countDocuments({ ...orgs, createdAt: { $gte: new Date(now - 7 * DAY) }, deletedAt: null }),
      raw
        .collection('attachments')
        .aggregate<{ bytes: number }>([
          { $match: { ...orgs, status: 'ready', deletedAt: { $in: [null] } } },
          {
            $group: { _id: null, bytes: { $sum: { $ifNull: ['$storedBytes', '$sizeBytes'] } } },
          },
        ])
        .toArray(),
      raw.collection<BillingSubscriptionDoc>('billing_subscriptions').find({}).toArray(),
      this.db.billingPlans.find({}).toArray(),
      raw.collection('network_reports').countDocuments({ tenantId: netId, status: 'open' }),
      this.health(),
    ]);

    const live = new Set(tenants.map((t) => t._id));
    const mine = subs.filter((s) => live.has(s.tenantId));
    const byPlan = new Map<string | null, number>();
    const counts = { trialing: 0, active: 0, pastDue: 0, none: 0 };
    const revenue = new Map<string, number>();
    const planById = new Map(plans.map((p) => [p._id, p]));
    for (const t of tenants) {
      const s = mine.find((x) => x.tenantId === t._id);
      const status = s?.status ?? 'none';
      if (status === 'trialing') counts.trialing++;
      else if (status === 'active') counts.active++;
      else if (status === 'past_due') counts.pastDue++;
      else counts.none++;
      const pid = s && status !== 'none' && status !== 'canceled' ? s.planId : null;
      byPlan.set(pid, (byPlan.get(pid) ?? 0) + 1);
      const plan = pid ? planById.get(pid) : undefined;
      if (plan && (status === 'active' || status === 'past_due')) {
        const per =
          s!.interval === 'year' && plan.yearlyPerSeat !== null
            ? Math.round(plan.yearlyPerSeat / 12)
            : plan.monthlyPerSeat;
        revenue.set(plan.currency, (revenue.get(plan.currency) ?? 0) + per * s!.seats);
      }
    }
    const signups = new Map(signupRows.map((r) => [r._id, r.n]));
    const days: { day: string; count: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const day = new Date(now - i * DAY).toISOString().slice(0, 10);
      days.push({ day, count: signups.get(day) ?? 0 });
    }
    return {
      organizations: {
        total: tenants.length,
        active: tenants.filter((t) => t.status === 'active').length,
        suspended: tenants.filter((t) => t.status === 'suspended' && !t.deletion).length,
        pendingDeletion: tenants.filter((t) => !!t.deletion).length,
        newLast30Days: tenants.filter((t) => t.createdAt >= since30).length,
      },
      people: { active: people, twoStepOn: twoStep },
      devices: { active: devices, seenLast7Days: recentDevices },
      messagesLast7Days: messages,
      storageBytes: storage[0]?.bytes ?? 0,
      signups: days,
      subscriptions: counts,
      plans: [...byPlan.entries()]
        .map(([planId, n]) => ({
          planId,
          name: planId ? (planById.get(planId)?.name ?? 'Unknown plan') : 'No plan',
          organizations: n,
        }))
        .sort((a, b) => b.organizations - a.organizations),
      monthlyRevenue: [...revenue.entries()].map(([currency, amount]) => ({ currency, amount })),
      moderation: { openReports },
      health,
    };
  }

  async health(): Promise<PlatformHealth> {
    const time = async (f: () => Promise<unknown>) => {
      const t0 = performance.now();
      try {
        await f();
        return { ok: true, latencyMs: Math.round(performance.now() - t0) };
      } catch {
        return { ok: false, latencyMs: null };
      }
    };
    const [mongo, redis, applied, integrations] = await Promise.all([
      time(() => this.db.raw.command({ ping: 1 })),
      time(() => this.redis.ping()),
      this.db.raw
        .collection<{ _id: string }>('_migrations')
        .find({ _id: { $ne: '__lock__' } }, { projection: { _id: 1 } })
        .toArray(),
      this.settings.list({ tenantId: null }).catch(() => []),
    ]);
    const done = new Set(applied.map((m) => m._id));
    return {
      api: {
        version: VERSION,
        node: process.version,
        uptimeSeconds: Math.round((Date.now() - this.metrics.startedAt) / 1000),
      },
      mongo,
      redis,
      realtime: { sockets: this.gateway.connectedSockets() },
      migrations: {
        applied: done.size,
        pending: MIGRATIONS.map((m) => m.id).filter((id) => !done.has(id)),
      },
      http: this.metrics.totals(),
      integrations: integrations
        .filter((v) => !v.provider.planned)
        .map((v) => ({
          providerId: v.provider.id,
          name: v.provider.label,
          enabled: v.enabled,
          lastTest: v.lastTest ? { ok: v.lastTest.ok, at: v.lastTest.testedAt } : null,
        })),
    };
  }

  // ─── organizations ────────────────────────────────────────────────────────

  async list(ctx: TenantContext, query: unknown): Promise<PlatformOrgPage> {
    await this.admins.assert(ctx, 'orgs.view');
    const q = parse(PlatformOrgQuerySchema, query);
    const f: Filter<TenantDoc> = { kind: { $ne: 'network' } };
    if (q.status === 'active') f.status = 'active';
    if (q.status === 'suspended') Object.assign(f, { status: 'suspended', deletion: null });
    if (q.status === 'deleting') Object.assign(f, { deletion: { $ne: null, $exists: true } });
    if (q.q) {
      const re = new RegExp(escapeRe(q.q), 'i');
      f.$or = [{ name: re }, { slug: re }];
    }
    const [rows, total] = await Promise.all([
      this.db.tenants
        .find(f, { sort: { createdAt: -1, _id: -1 } })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .toArray(),
      this.db.tenants.countDocuments(f),
    ]);
    return { items: await this.rows(rows), total, page: q.page, pageSize: q.limit };
  }

  async detail(ctx: TenantContext, tenantId: string): Promise<PlatformOrgDetail> {
    await this.admins.assert(ctx, 'orgs.view');
    const t = await this.tenant(tenantId);
    const scoped = this.db.for(tenantId);
    const [org, overview, members, invoices, history] = await Promise.all([
      this.rows([t]).then((r) => r[0]!),
      this.adminSvc.overviewFor(tenantId),
      scoped.memberships.find({ role: { $in: ['owner', 'admin'] } }).toArray(),
      scoped.billing_invoices.find({}, { sort: { createdAt: -1 }, limit: 12 }).toArray(),
      this.audit.forOrg(tenantId),
    ]);
    return {
      org,
      overview,
      admins: await this.people(
        tenantId,
        new Map(members.map((m) => [m.userId, m.role])),
        members.map((m) => m.userId),
      ),
      invoices: (invoices as BillingInvoiceDoc[]).map(toInvoice),
      history,
    };
  }

  async support(
    ctx: TenantContext,
    tenantId: string,
    ip: string | null,
  ): Promise<PlatformSupportView> {
    await this.admins.assert(ctx, 'support.view');
    const t = await this.tenant(tenantId);
    const s = this.db.for(tenantId);
    const [memberships, devices, integrations, sso, events] = await Promise.all([
      s.memberships
        .find({}, { projection: { userId: 1, role: 1 } })
        .limit(1000)
        .toArray(),
      s.devices.find({}, { sort: { lastSeenAt: -1 }, limit: 200 }).toArray(),
      this.settings.list({ tenantId }).catch(() => []),
      readOidcSettings(this.settings, tenantId),
      s.audit_logs
        .find({ action: { $in: SUPPORT_EVENTS } }, { sort: { at: -1 }, limit: 50 })
        .toArray(),
    ]);
    const roles = new Map(memberships.map((m) => [m.userId, m.role]));
    const people = await this.people(tenantId, roles, [...roles.keys()]);
    const name = new Map(people.map((p) => [p.userId, p.name]));
    const perUser = new Map<string, number>();
    for (const d of devices)
      if (!d.revokedAt) perUser.set(d.userId, (perUser.get(d.userId) ?? 0) + 1);
    await this.audit.record({
      ctx,
      action: 'platform.support_viewed',
      tenantId,
      target: { type: 'tenant', id: tenantId, label: t.name },
      ip,
      orgAction: 'tenant.support_viewed',
    });
    return {
      tenantId,
      members: people.map((p) => ({ ...p, devices: perUser.get(p.userId) ?? 0 })),
      devices: devices.slice(0, 100).map((d) => ({
        sessionId: d._id,
        userName: name.get(d.userId) ?? 'Former member',
        name: d.name,
        platform: d.platform,
        lastSeenAt: d.lastSeenAt.toISOString(),
        revoked: !!d.revokedAt,
      })),
      integrations: integrations
        .filter((v) => !v.provider.planned && (v.enabled || v.saved))
        .map((v) => ({
          providerId: v.provider.id,
          name: v.provider.label,
          enabled: v.enabled,
          source: v.source,
          lastTest: v.lastTest
            ? { ok: v.lastTest.ok, at: v.lastTest.testedAt, message: v.lastTest.message }
            : null,
        })),
      signIn: { ssoEnabled: !!sso, passwordLogin: !sso || sso.allowPasswordLogin },
      events: await this.adminSvc.entries(tenantId, events),
    };
  }

  async create(ctx: TenantContext, body: unknown, ip: string | null): Promise<PlatformOrg> {
    await this.admins.assert(ctx, 'orgs.manage');
    const req = parse(CreatePlatformOrgSchema, body);
    const p = await this.auth.provisionTenant({
      slug: req.slug,
      name: req.name,
      ownerEmail: req.ownerEmail,
      ownerName: req.ownerName,
      password: req.temporaryPassword,
    });
    if (req.planId) {
      try {
        await this.billing.assign(ctx, p.tenant._id, {
          planId: req.planId,
          status: 'active',
          seats: 1,
        });
      } catch (e) {
        await p.undo();
        throw e;
      }
    }
    await this.audit.record({
      ctx,
      action: 'platform.org_created',
      tenantId: p.tenant._id,
      target: { type: 'tenant', id: p.tenant._id, label: req.name },
      metadata: { slug: req.slug, ownerEmail: req.ownerEmail, planId: req.planId },
      ip,
    });
    await this.db.for(p.tenant._id).audit_logs.insertOne({
      actorId: null,
      action: 'tenant.created',
      target: { type: 'tenant', id: p.tenant._id },
      ip: null,
      userAgent: null,
      at: new Date(),
      metadata: { by: 'SampConnect' },
    });
    this.changed(p.tenant._id);
    return (await this.rows([await this.tenant(p.tenant._id)]))[0]!;
  }

  async rename(ctx: TenantContext, tenantId: string, body: unknown, ip: string | null) {
    await this.admins.assert(ctx, 'orgs.manage');
    const { name } = parse(UpdatePlatformOrgSchema, body);
    const t = await this.tenant(tenantId);
    if (t.name !== name) {
      await this.db.tenants.updateOne({ _id: tenantId }, { $set: { name } });
      await this.audit.record({
        ctx,
        action: 'platform.org_renamed',
        tenantId,
        target: { type: 'tenant', id: tenantId, label: name },
        metadata: { from: t.name, to: name },
        ip,
        orgAction: 'tenant.renamed_by_platform',
      });
      this.realtime.toTenant(tenantId, 'tenant:updated', { area: 'branding' });
      this.changed(tenantId);
    }
    return (await this.rows([await this.tenant(tenantId)]))[0]!;
  }

  async suspend(ctx: TenantContext, tenantId: string, body: unknown, ip: string | null) {
    await this.admins.assert(ctx, 'orgs.manage');
    const { reason } = parse(SuspendOrgSchema, body);
    const t = await this.tenant(tenantId);
    if (tenantId === ctx.tenantId)
      throw new AppError('CONFLICT', 'You can’t suspend the organization you are signed in to.');
    if (t.status !== 'suspended') {
      const me = await this.db
        .for(ctx.tenantId)
        .users.findOne({ _id: ctx.userId }, { projection: { displayName: 1 } });
      await this.db.tenants.updateOne(
        { _id: tenantId },
        {
          $set: {
            status: 'suspended',
            suspension: { at: new Date(), reason, byName: me?.displayName ?? 'Platform admin' },
          },
        },
      );
      await this.cut(tenantId);
      await this.audit.record({
        ctx,
        action: 'platform.org_suspended',
        tenantId,
        target: { type: 'tenant', id: tenantId, label: t.name },
        metadata: { reason },
        ip,
        orgAction: 'tenant.suspended',
      });
      this.changed(tenantId);
    }
    return (await this.rows([await this.tenant(tenantId)]))[0]!;
  }

  async reactivate(ctx: TenantContext, tenantId: string, ip: string | null) {
    await this.admins.assert(ctx, 'orgs.manage');
    const t = await this.tenant(tenantId);
    if (t.deletion) throw new AppError('CONFLICT', 'Cancel the scheduled deletion first.');
    if (t.status !== 'active') {
      await this.db.tenants.updateOne(
        { _id: tenantId },
        { $set: { status: 'active', suspension: null } },
      );
      await this.sessions.invalidateTenant(tenantId);
      await this.audit.record({
        ctx,
        action: 'platform.org_reactivated',
        tenantId,
        target: { type: 'tenant', id: tenantId, label: t.name },
        metadata: { reason: t.suspension?.reason ?? null },
        ip,
        orgAction: 'tenant.reactivated',
      });
      this.changed(tenantId);
    }
    return (await this.rows([await this.tenant(tenantId)]))[0]!;
  }

  async scheduleDeletion(ctx: TenantContext, tenantId: string, body: unknown, ip: string | null) {
    await this.admins.assert(ctx, 'orgs.delete');
    const { confirmSlug } = parse(ScheduleDeletionSchema, body);
    const t = await this.tenant(tenantId);
    if (confirmSlug !== t.slug)
      throw new AppError('VALIDATION_FAILED', `Type ${t.slug} to confirm.`);
    if (tenantId === ctx.tenantId)
      throw new AppError('CONFLICT', 'You can’t delete the organization you are signed in to.');
    if (!t.deletion) {
      const sub = await this.db.for(tenantId).billing_subscriptions.findOne({});
      if (sub?.provider === 'stripe' && sub.stripeSubscriptionId && sub.status !== 'canceled')
        throw new AppError(
          'CONFLICT',
          'This organization pays online. Cancel its subscription in the payment provider first, so nobody is charged after it’s gone.',
        );
      const now = new Date();
      const me = await this.db
        .for(ctx.tenantId)
        .users.findOne({ _id: ctx.userId }, { projection: { displayName: 1 } });
      await this.db.tenants.updateOne(
        { _id: tenantId },
        {
          $set: {
            status: 'suspended',
            suspension: t.suspension ?? {
              at: now,
              reason: 'Scheduled for deletion',
              byName: me?.displayName ?? 'Platform admin',
            },
            deletion: {
              scheduledFor: new Date(now.getTime() + ORG_DELETION_GRACE_DAYS * DAY),
              requestedAt: now,
              requestedBy: me?.displayName ?? 'Platform admin',
              previousStatus: t.status,
              purgingAt: null,
            },
          },
        },
      );
      await this.cut(tenantId);
      await this.audit.record({
        ctx,
        action: 'platform.org_deletion_scheduled',
        tenantId,
        target: { type: 'tenant', id: tenantId, label: t.name },
        metadata: { graceDays: ORG_DELETION_GRACE_DAYS, orgName: t.name },
        ip,
        orgAction: 'tenant.deletion_scheduled',
      });
      this.changed(tenantId);
    }
    return (await this.rows([await this.tenant(tenantId)]))[0]!;
  }

  async cancelDeletion(ctx: TenantContext, tenantId: string, ip: string | null) {
    await this.admins.assert(ctx, 'orgs.delete');
    const t = await this.tenant(tenantId);
    if (t.deletion) {
      const res = await this.db.tenants.updateOne(
        { _id: tenantId, 'deletion.purgingAt': null },
        {
          $set: {
            deletion: null,
            status: t.deletion.previousStatus,
            ...(t.deletion.previousStatus === 'active' ? { suspension: null } : {}),
          },
        },
      );
      if (!res.modifiedCount)
        throw new AppError('CONFLICT', 'The erase has already started and can’t be stopped.');
      await this.sessions.invalidateTenant(tenantId);
      await this.audit.record({
        ctx,
        action: 'platform.org_deletion_cancelled',
        tenantId,
        target: { type: 'tenant', id: tenantId, label: t.name },
        ip,
        orgAction: 'tenant.deletion_cancelled',
      });
      this.changed(tenantId);
    }
    return (await this.rows([await this.tenant(tenantId)]))[0]!;
  }

  // ─── internals ────────────────────────────────────────────────────────────

  /** Signs everyone out of a suspended organization, on every device, right away. */
  private async cut(tenantId: string) {
    await this.sessions.invalidateTenant(tenantId);
    this.realtime.disconnectTenant(tenantId);
  }

  private changed(tenantId: string) {
    this.realtime.toPlatform('platform:changed', { area: 'orgs', tenantId });
  }

  private async tenant(tenantId: string): Promise<TenantDoc> {
    const t = await this.db.tenants.findOne({ _id: tenantId });
    if (!t || t.kind === 'network') throw notFound('Organization');
    return t;
  }

  private async people(
    tenantId: string,
    roles: Map<string, TenantRole>,
    ids: string[],
  ): Promise<PlatformOrgPerson[]> {
    const s = this.db.for(tenantId);
    const [users, seen] = await Promise.all([
      s.users
        .find(
          { _id: { $in: ids } },
          { projection: { displayName: 1, email: 1, status: 1, mfa: 1 }, sort: { displayName: 1 } },
        )
        .toArray(),
      s.devices
        .aggregate<{ _id: string; at: Date }>([
          { $match: { userId: { $in: ids } } },
          { $group: { _id: '$userId', at: { $max: '$lastSeenAt' } } },
        ])
        .toArray(),
    ]);
    const last = new Map(seen.map((r) => [r._id, r.at]));
    return users.map((u) => ({
      userId: u._id,
      name: u.displayName,
      email: u.email,
      role: roles.get(u._id) ?? 'member',
      status: u.status,
      twoStep: !!u.mfa?.enabledAt,
      lastSeenAt: last.get(u._id)?.toISOString() ?? null,
    }));
  }

  private async rows(tenants: TenantDoc[]): Promise<PlatformOrg[]> {
    if (!tenants.length) return [];
    const ids = tenants.map((t) => t._id);
    const [subs, plans, seen, usage] = await Promise.all([
      this.db.raw
        .collection<BillingSubscriptionDoc>('billing_subscriptions')
        .find({ tenantId: { $in: ids } })
        .toArray(),
      this.db.billingPlans.find({}, { projection: { name: 1 } }).toArray(),
      this.db.raw
        .collection('devices')
        .aggregate<{ _id: string; at: Date }>([
          { $match: { tenantId: { $in: ids } } },
          { $group: { _id: '$tenantId', at: { $max: '$lastSeenAt' } } },
        ])
        .toArray(),
      Promise.all(ids.map((id) => this.billing.usage(id))),
    ]);
    const sub = new Map(subs.map((s) => [s.tenantId, s]));
    const plan = new Map(plans.map((p) => [p._id, p.name]));
    const last = new Map(seen.map((r) => [r._id, r.at]));
    return tenants.map((t, i) => {
      const s = sub.get(t._id) ?? emptySub(t._id);
      return {
        tenantId: t._id,
        slug: t.slug,
        name: t.name,
        status: t.status,
        createdAt: t.createdAt.toISOString(),
        members: usage[i]!.members,
        storageBytes: usage[i]!.storageBytes,
        plan:
          s.planId && s.status !== 'none' && s.status !== 'canceled'
            ? { planId: s.planId, name: plan.get(s.planId) ?? 'Unknown plan' }
            : null,
        subscription: toSubscription(s),
        suspension: t.suspension
          ? {
              at: t.suspension.at.toISOString(),
              reason: t.suspension.reason,
              byName: t.suspension.byName,
            }
          : t.status === 'suspended'
            ? { at: t.createdAt.toISOString(), reason: '', byName: '' }
            : null,
        deletionScheduledFor: t.deletion?.scheduledFor.toISOString() ?? null,
        lastActiveAt: last.get(t._id)?.toISOString() ?? null,
      };
    });
  }
}
