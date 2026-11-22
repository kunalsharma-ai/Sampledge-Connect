import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Filter } from 'mongodb';
import {
  ActivityRetentionSchema,
  DEFAULT_TENANT_POLICY,
  PlatformActivityQuerySchema,
  SetPermissionPolicySchema,
  TENANT_ROLES,
  type ActivityRetention,
  type ForcedPasswordReset,
  type PlatformActivityEntry,
  type PlatformActivityPage,
  type PlatformOrgPermissions,
  type PlatformPermissionDefaults,
  type TenantPermissionPolicy,
} from '@sampledge/contracts';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { AppError, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { AdminService } from '../admin/admin.service.js';
import { AuthService, type RequestMeta } from '../auth/auth.service.js';
import type { AuditLogDoc } from '../database/documents.js';
import { TenantDb } from '../database/tenant-db.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';
import { PermissionPolicy, cleanPolicy } from './permission-policy.service.js';
import { PlatformAdmins } from './platform-admins.js';
import { PlatformAudit } from './platform-audit.service.js';

const EXPORT_MAX = 50_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

const same = (a: TenantPermissionPolicy, b: TenantPermissionPolicy) =>
  TENANT_ROLES.every((r) => a[r].length === b[r].length && a[r].every((p) => b[r].includes(p)));

/**
 * The super admin's controls over every organization (docs/super-admin.md):
 * what each role may do, every organization's activity in one log, how long activity is kept,
 * and forcing someone to choose a new password.
 */
@Injectable()
export class PlatformControlService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('PlatformControl');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: TenantDb,
    private readonly admins: PlatformAdmins,
    private readonly audit: PlatformAudit,
    private readonly adminSvc: AdminService,
    private readonly auth: AuthService,
    private readonly policy: PermissionPolicy,
    private readonly realtime: RealtimePublisher,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  onModuleInit() {
    if (this.cfg.NODE_ENV === 'test') return;
    this.timer = setInterval(
      () => void this.applyRetention().catch((e) => this.log.error(e)),
      HOUR,
    );
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ─── permissions ──────────────────────────────────────────────────────────

  async defaults(ctx: TenantContext): Promise<PlatformPermissionDefaults> {
    await this.admins.assert(ctx, 'orgs.view');
    const [policy, customOrganizations] = await Promise.all([
      this.policy.platformDefault(),
      this.db.tenants.countDocuments({ permissions: { $type: 'object' } }),
    ]);
    return {
      builtIn: DEFAULT_TENANT_POLICY,
      policy,
      customized: !same(policy, DEFAULT_TENANT_POLICY),
      customOrganizations,
    };
  }

  async setDefaults(ctx: TenantContext, body: unknown, ip: string | null) {
    await this.admins.assert(ctx, 'permissions.manage');
    const req = parse(SetPermissionPolicySchema, body);
    const policy = cleanPolicy(req.policy);
    await this.db.platformSettings.updateOne(
      { _id: 'permissions' },
      { $set: { policy, updatedAt: new Date(), updatedBy: ctx.userId } },
      { upsert: true },
    );
    await this.policy.bump();
    await this.audit.record({
      ctx,
      action: 'platform.permissions_default_changed',
      target: { type: 'permissions', id: 'default', label: 'Every organization' },
      metadata: { policy: policy ?? 'built-in' },
      ip,
    });
    this.realtime.toPlatform('platform:changed', { area: 'permissions' });
    return this.defaults(ctx);
  }

  async orgPermissions(ctx: TenantContext, tenantId: string): Promise<PlatformOrgPermissions> {
    await this.admins.assert(ctx, 'orgs.view');
    await this.tenant(tenantId);
    const [own, platformDefault] = await Promise.all([
      this.policy.orgPolicy(tenantId),
      this.policy.platformDefault(),
    ]);
    return { tenantId, policy: own ?? platformDefault, inherits: !own, platformDefault };
  }

  async setOrgPermissions(ctx: TenantContext, tenantId: string, body: unknown, ip: string | null) {
    await this.admins.assert(ctx, 'permissions.manage');
    const t = await this.tenant(tenantId);
    const req = parse(SetPermissionPolicySchema, body);
    const policy = cleanPolicy(req.policy);
    await this.db.tenants.updateOne({ _id: tenantId }, { $set: { permissions: policy } });
    await this.policy.bump();
    await this.audit.record({
      ctx,
      action: 'platform.permissions_org_changed',
      tenantId,
      target: { type: 'tenant', id: tenantId, label: t.name },
      metadata: { orgName: t.name, policy: policy ?? 'platform default' },
      ip,
      orgAction: 'tenant.permissions_changed_by_platform',
    });
    this.realtime.toPlatform('platform:changed', { area: 'permissions', tenantId });
    return this.orgPermissions(ctx, tenantId);
  }

  // ─── activity across every organization ───────────────────────────────────

  async activity(ctx: TenantContext, query: unknown): Promise<PlatformActivityPage> {
    await this.admins.assert(ctx, 'activity.view');
    const q = parse(PlatformActivityQuerySchema, query);
    const rows = await this.rows(q, q.limit + 1);
    const more = rows.length > q.limit;
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      items: await this.entries(page),
      nextCursor: more && last ? `${last.at.getTime()}_${last._id}` : null,
    };
  }

  /** CSV of the filtered activity, newest first, up to 50,000 rows. The export is audited. */
  async exportCsv(ctx: TenantContext, query: unknown, ip: string | null): Promise<string> {
    await this.admins.assert(ctx, 'activity.view');
    const q = parse(PlatformActivityQuerySchema, { ...(query as object), limit: 200 });
    const items = await this.entries(await this.rows(q, EXPORT_MAX));
    const cell = (v: unknown) => {
      const s = v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const head = [
      'time',
      'organization',
      'organization_address',
      'action',
      'description',
      'category',
      'person',
      'person_id',
      'target_type',
      'target_id',
      'target_name',
      'ip',
      'device',
      'details',
    ];
    const lines = items.map((e) =>
      [
        e.at,
        e.org.name,
        e.org.slug,
        e.action,
        e.label,
        e.category,
        e.actor?.name,
        e.actor?.userId,
        e.target?.type,
        e.target?.id,
        e.target?.name,
        e.ip,
        e.userAgent,
        e.metadata,
      ]
        .map(cell)
        .join(','),
    );
    await this.audit.record({
      ctx,
      action: 'platform.activity_exported',
      tenantId: q.tenantId ?? null,
      metadata: { rows: items.length, filters: { ...q, limit: undefined } },
      ip,
    });
    return [head.join(','), ...lines].join('\r\n') + '\r\n';
  }

  async retention(ctx: TenantContext): Promise<ActivityRetention> {
    await this.admins.assert(ctx, 'activity.view');
    const [s, oldest] = await Promise.all([
      this.db.platformSettings.findOne({ _id: 'activity' }),
      this.db.raw
        .collection<AuditLogDoc>('audit_logs')
        .find({}, { sort: { at: 1 }, limit: 1, projection: { at: 1 } })
        .next(),
    ]);
    return { days: s?.retentionDays ?? null, oldestAt: oldest?.at.toISOString() ?? null };
  }

  async setRetention(ctx: TenantContext, body: unknown, ip: string | null) {
    await this.admins.assert(ctx, 'permissions.manage');
    const req = parse(ActivityRetentionSchema, body);
    await this.db.platformSettings.updateOne(
      { _id: 'activity' },
      { $set: { retentionDays: req.days, updatedAt: new Date(), updatedBy: ctx.userId } },
      { upsert: true },
    );
    await this.audit.record({
      ctx,
      action: 'platform.activity_retention_changed',
      metadata: { days: req.days },
      ip,
    });
    await this.applyRetention();
    this.realtime.toPlatform('platform:changed', { area: 'activity' });
    return this.retention(ctx);
  }

  /** Deletes organization activity older than the kept window. Super admin history is kept. */
  async applyRetention(now = new Date()): Promise<number> {
    const s = await this.db.platformSettings.findOne({ _id: 'activity' });
    if (!s?.retentionDays) return 0;
    const r = await this.db.raw
      .collection<AuditLogDoc>('audit_logs')
      .deleteMany({ at: { $lt: new Date(now.getTime() - s.retentionDays * DAY) } });
    if (r.deletedCount) this.log.log(`Removed ${r.deletedCount} activity entries past retention`);
    return r.deletedCount;
  }

  // ─── passwords ────────────────────────────────────────────────────────────

  async forcePasswordReset(
    ctx: TenantContext,
    tenantId: string,
    userId: string,
    meta: RequestMeta,
  ): Promise<ForcedPasswordReset> {
    await this.admins.assert(ctx, 'orgs.manage');
    const t = await this.tenant(tenantId);
    if (tenantId === ctx.tenantId && userId === ctx.userId)
      throw new AppError('CONFLICT', 'Change your own password in your account settings.');
    const me = await this.db.for(ctx.tenantId).users.findOne({ _id: ctx.userId });
    const r = await this.auth.forcePasswordReset(
      tenantId,
      userId,
      `${me?.displayName ?? 'SampConnect'} (SampConnect)`,
      meta,
    );
    await this.audit.record({
      ctx,
      action: 'platform.org_password_reset_forced',
      tenantId,
      target: { type: 'user', id: userId, label: `${r.user.displayName} (${r.user.email})` },
      metadata: { orgName: t.name, signedOutDevices: r.signedOutDevices },
      ip: meta.ip,
    });
    return { userId, signedOutDevices: r.signedOutDevices };
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

  private rows(q: ReturnType<typeof PlatformActivityQuerySchema.parse>, limit: number) {
    const base = this.adminSvc.filter(q) as Filter<AuditLogDoc> & Record<string, unknown>;
    const f: Filter<AuditLogDoc> = q.tenantId ? { ...base, tenantId: q.tenantId } : base;
    return this.db.raw
      .collection<AuditLogDoc>('audit_logs')
      .find(f, { sort: { at: -1, _id: -1 }, limit })
      .toArray();
  }

  private async entries(rows: AuditLogDoc[]): Promise<PlatformActivityEntry[]> {
    const byTenant = new Map<string, AuditLogDoc[]>();
    for (const r of rows) byTenant.set(r.tenantId, [...(byTenant.get(r.tenantId) ?? []), r]);
    const tenants = await this.db.tenants
      .find({ _id: { $in: [...byTenant.keys()] } }, { projection: { name: 1, slug: 1 } })
      .toArray();
    const org = new Map(
      tenants.map((t) => [t._id, { tenantId: t._id, name: t.name, slug: t.slug }]),
    );
    const out = new Map<string, PlatformActivityEntry>();
    for (const [tenantId, list] of byTenant) {
      const o = org.get(tenantId) ?? { tenantId, name: 'Deleted organization', slug: '' };
      for (const e of await this.adminSvc.entries(tenantId, list)) out.set(e.id, { ...e, org: o });
    }
    return rows.map((r) => out.get(r._id)!).filter(Boolean);
  }

  private async tenant(tenantId: string) {
    const t = await this.db.tenants.findOne({ _id: tenantId });
    if (!t || t.kind === 'network') throw notFound('Organization');
    return t;
  }
}
