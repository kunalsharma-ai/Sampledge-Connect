import { Injectable } from '@nestjs/common';
import type { Filter } from 'mongodb';
import {
  AUDIT_CATEGORY_PREFIXES,
  AuditQuerySchema,
  auditCategory,
  auditLabel,
  tenantCan,
  type AdminOverview,
  type AuditEntry,
  type AuditPage,
  type TenantRole,
} from '@sampledge/contracts';
import { AppError, forbidden, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import type { AuditLogDoc } from '../database/documents.js';
import { TenantDb } from '../database/tenant-db.js';
import { AuditService } from '../audit/audit.service.js';
import { BillingService } from '../billing/billing.service.js';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service.js';
import { readOidcSettings } from '../auth/sso-settings.js';

const DAY = 86_400_000;
const EXPORT_MAX = 10_000;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Administration home and the audit log viewer. */
@Injectable()
export class AdminService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly billing: BillingService,
    private readonly settings: IntegrationSettingsService,
  ) {}

  private assert(ctx: TenantContext) {
    if (!tenantCan(ctx.role, 'audit.read')) throw forbidden();
  }

  async overview(ctx: TenantContext): Promise<AdminOverview> {
    this.assert(ctx);
    const t = this.db.for(ctx.tenantId);
    const now = Date.now();
    const [
      tenant,
      users,
      memberships,
      devices,
      recentDevices,
      messages,
      conversations,
      billing,
      sso,
      integrations,
      security,
    ] = await Promise.all([
      this.db.tenants.findOne({ _id: ctx.tenantId }),
      t.users.find({}, { projection: { status: 1, mfa: 1 } }).toArray(),
      t.memberships.find({}, { projection: { userId: 1, role: 1 } }).toArray(),
      t.devices.countDocuments({ revokedAt: null }),
      t.devices.countDocuments({ revokedAt: null, lastSeenAt: { $gte: new Date(now - 7 * DAY) } }),
      t.messages.countDocuments({ createdAt: { $gte: new Date(now - 7 * DAY) }, deletedAt: null }),
      t.conversations.countDocuments({}),
      this.billing.summary(ctx.tenantId),
      readOidcSettings(this.settings, ctx.tenantId),
      this.settings.list({ tenantId: ctx.tenantId }).catch(() => []),
      t.audit_logs
        .find(
          {
            action: {
              $in: [
                'auth.login_failed',
                'auth.mfa_failed',
                'auth.sso_failed',
                'auth.mfa_reset_by_admin',
                'auth.mfa_disabled',
                'device.revoked',
              ],
            },
          },
          { sort: { at: -1 }, limit: 6 },
        )
        .toArray(),
    ]);
    if (!tenant) throw notFound('Organization');
    const roleOf = new Map(memberships.map((m) => [m.userId, m.role]));
    const byRole: Record<TenantRole, number> = { owner: 0, admin: 0, member: 0, guest: 0 };
    let active = 0;
    let twoStep = 0;
    for (const u of users) {
      if (u.status !== 'active') continue;
      active += 1;
      const r = roleOf.get(u._id);
      if (r) byRole[r] += 1;
      if (u.mfa?.enabledAt) twoStep += 1;
    }
    const live = integrations.filter((v) => v.enabled && v.source && !v.provider.planned);
    return {
      organization: {
        name: tenant.name,
        slug: tenant.slug,
        createdAt: tenant.createdAt.toISOString(),
      },
      members: {
        total: users.length,
        active,
        deactivated: users.length - active,
        byRole,
        twoStepOn: twoStep,
      },
      devices: { active: devices, seenLast7Days: recentDevices },
      activity: { messagesLast7Days: messages, conversations },
      storageBytes: billing.storageBytes,
      plan: { name: billing.planName, status: billing.status },
      signIn: { ssoEnabled: !!sso, passwordLogin: !sso || sso.allowPasswordLogin },
      integrations: {
        connected: live.length,
        failing: live.filter((v) => v.lastTest && !v.lastTest.ok).length,
      },
      security: await this.entries(ctx.tenantId, security),
    };
  }

  async auditPage(ctx: TenantContext, query: unknown): Promise<AuditPage> {
    this.assert(ctx);
    const q = parse(AuditQuerySchema, query);
    const rows = await this.db
      .for(ctx.tenantId)
      .audit_logs.find(this.filter(q), { sort: { at: -1, _id: -1 }, limit: q.limit + 1 })
      .toArray();
    const more = rows.length > q.limit;
    const page = rows.slice(0, q.limit);
    return {
      items: await this.entries(ctx.tenantId, page),
      nextCursor: more
        ? `${page[page.length - 1]!.at.getTime()}_${page[page.length - 1]!._id}`
        : null,
    };
  }

  /** CSV of the filtered log (newest first, up to 10,000 rows). The export itself is audited. */
  async exportCsv(ctx: TenantContext, query: unknown): Promise<string> {
    this.assert(ctx);
    const q = parse(AuditQuerySchema, { ...(query as object), limit: 200 });
    const rows = await this.db
      .for(ctx.tenantId)
      .audit_logs.find(this.filter(q), { sort: { at: -1, _id: -1 }, limit: EXPORT_MAX })
      .toArray();
    const items = await this.entries(ctx.tenantId, rows);
    const cell = (v: unknown) => {
      const s = v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
      // Neutralize spreadsheet formulas, then quote.
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const lines = [
      [
        'time',
        'action',
        'description',
        'category',
        'actor',
        'actor_id',
        'target_type',
        'target_id',
        'target_name',
        'ip',
        'user_agent',
        'details',
      ].join(','),
      ...items.map((e) =>
        [
          e.at,
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
      ),
    ];
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'audit.exported',
      metadata: { rows: items.length, filters: { ...q, limit: undefined } },
    });
    return lines.join('\r\n') + '\r\n';
  }

  private filter(q: ReturnType<typeof AuditQuerySchema.parse>): Filter<AuditLogDoc> {
    const f: Filter<AuditLogDoc> & Record<string, unknown> = {};
    const and: Filter<AuditLogDoc>[] = [];
    if (q.category === 'other') {
      and.push({
        action: {
          $not: new RegExp(
            Object.values(AUDIT_CATEGORY_PREFIXES)
              .map((r) => r.source)
              .join('|'),
          ),
        },
      });
    } else if (q.category) and.push({ action: { $regex: AUDIT_CATEGORY_PREFIXES[q.category] } });
    if (q.actorId) and.push({ actorId: q.actorId });
    if (q.from || q.to)
      and.push({
        at: {
          ...(q.from ? { $gte: new Date(q.from) } : {}),
          ...(q.to ? { $lte: new Date(q.to) } : {}),
        },
      });
    if (q.q) {
      const re = new RegExp(escapeRe(q.q), 'i');
      and.push({ $or: [{ action: re }, { ip: re }, { 'target.id': re }] } as Filter<AuditLogDoc>);
    }
    if (q.before) {
      const [ms, id] = q.before.split('_');
      const at = new Date(Number(ms));
      if (!id || Number.isNaN(at.getTime())) throw new AppError('VALIDATION_FAILED', 'Bad cursor');
      and.push({ $or: [{ at: { $lt: at } }, { at, _id: { $lt: id } }] } as Filter<AuditLogDoc>);
    }
    if (and.length) f.$and = and;
    return f;
  }

  /** Adds people's names and plain-language labels. */
  private async entries(tenantId: string, rows: AuditLogDoc[]): Promise<AuditEntry[]> {
    const ids = new Set<string>();
    for (const r of rows) {
      if (r.actorId) ids.add(r.actorId);
      if (r.target?.type === 'user') ids.add(r.target.id);
    }
    const users = ids.size
      ? await this.db
          .for(tenantId)
          .users.find({ _id: { $in: [...ids] } }, { projection: { displayName: 1 } })
          .toArray()
      : [];
    const name = new Map(users.map((u) => [u._id, u.displayName]));
    return rows.map((r) => ({
      id: r._id,
      at: r.at.toISOString(),
      action: r.action,
      label: auditLabel(r.action),
      category: auditCategory(r.action),
      actor: r.actorId ? { userId: r.actorId, name: name.get(r.actorId) ?? 'Former member' } : null,
      target: r.target
        ? {
            ...r.target,
            ...(r.target.type === 'user' && name.has(r.target.id)
              ? { name: name.get(r.target.id) }
              : {}),
          }
        : null,
      ip: r.ip,
      userAgent: r.userAgent,
      metadata: r.metadata ?? {},
    }));
  }
}
