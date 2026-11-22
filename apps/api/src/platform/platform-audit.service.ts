import { Injectable, Logger } from '@nestjs/common';
import type { Filter } from 'mongodb';
import {
  PLATFORM_AUDIT_AREA_PATTERNS,
  PlatformAuditQuerySchema,
  platformAuditArea,
  platformAuditLabel,
  type PlatformAuditEntry,
  type PlatformAuditPage,
} from '@sampledge/contracts';
import { AppError, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import type { PlatformAuditDoc } from '../database/documents.js';
import { newId, TenantDb } from '../database/tenant-db.js';
import { AuditService } from '../audit/audit.service.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface PlatformAuditInput {
  /** The platform admin, or null for the system (the deletion worker). */
  ctx: TenantContext | null;
  action: string;
  /** The organization it affected. */
  tenantId?: string | null;
  target?: { type: string; id: string; label: string } | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  /**
   * Also write this action to the organization's own audit log, so its owners see what
   * SampConnect did to their organization.
   */
  orgAction?: string;
}

/** Append-only log of what super admins do, across organizations. */
@Injectable()
export class PlatformAudit {
  private readonly log = new Logger('PlatformAudit');
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly realtime: RealtimePublisher,
  ) {}

  async record(e: PlatformAuditInput): Promise<void> {
    try {
      let actor: PlatformAuditDoc['actor'] = null;
      if (e.ctx) {
        const [u, t] = await Promise.all([
          this.db
            .for(e.ctx.tenantId)
            .users.findOne({ _id: e.ctx.userId }, { projection: { displayName: 1, email: 1 } }),
          this.db.tenants.findOne({ _id: e.ctx.tenantId }, { projection: { name: 1 } }),
        ]);
        actor = {
          tenantId: e.ctx.tenantId,
          userId: e.ctx.userId,
          name: u?.displayName ?? 'Platform admin',
          email: u?.email ?? '',
          orgName: t?.name ?? '',
        };
      }
      await this.db.platformAudit.insertOne({
        _id: newId(),
        action: e.action,
        at: new Date(),
        tenantId: e.tenantId ?? null,
        actor,
        target: e.target ?? null,
        metadata: e.metadata ?? {},
        ip: e.ip ?? null,
      });
      if (e.orgAction && e.tenantId)
        await this.audit.record({
          tenantId: e.tenantId,
          actorId: null,
          action: e.orgAction,
          target: { type: 'tenant', id: e.tenantId },
          metadata: { by: 'SampConnect', ...(e.metadata ?? {}) },
        });
      this.realtime.toPlatform('platform:changed', { area: 'audit' });
    } catch (err) {
      this.log.error(`Failed to write platform audit ${e.action}: ${(err as Error).message}`);
    }
  }

  async page(query: unknown): Promise<PlatformAuditPage> {
    const q = parse(PlatformAuditQuerySchema, query);
    const and: Filter<PlatformAuditDoc>[] = [];
    if (q.area) and.push({ action: { $regex: PLATFORM_AUDIT_AREA_PATTERNS[q.area] } });
    if (q.tenantId) and.push({ tenantId: q.tenantId });
    if (q.q) {
      const re = new RegExp(escapeRe(q.q), 'i');
      and.push({
        $or: [
          { action: re },
          { 'actor.name': re },
          { 'actor.email': re },
          { 'target.label': re },
          { ip: re },
        ],
      } as Filter<PlatformAuditDoc>);
    }
    if (q.before) {
      const [ms, id] = q.before.split('_');
      const at = new Date(Number(ms));
      if (!id || Number.isNaN(at.getTime())) throw new AppError('VALIDATION_FAILED', 'Bad cursor');
      and.push({
        $or: [{ at: { $lt: at } }, { at, _id: { $lt: id } }],
      } as Filter<PlatformAuditDoc>);
    }
    const rows = await this.db.platformAudit
      .find(and.length ? { $and: and } : {}, {
        sort: { at: -1, _id: -1 },
        limit: q.limit + 1,
      })
      .toArray();
    const more = rows.length > q.limit;
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      items: await this.entries(page),
      nextCursor: more && last ? `${last.at.getTime()}_${last._id}` : null,
    };
  }

  async forOrg(tenantId: string, limit = 20): Promise<PlatformAuditEntry[]> {
    const rows = await this.db.platformAudit
      .find({ tenantId }, { sort: { at: -1, _id: -1 }, limit })
      .toArray();
    return this.entries(rows);
  }

  private async entries(rows: PlatformAuditDoc[]): Promise<PlatformAuditEntry[]> {
    const ids = [...new Set(rows.map((r) => r.tenantId).filter((x): x is string => !!x))];
    const orgs = ids.length
      ? await this.db.tenants.find({ _id: { $in: ids } }, { projection: { name: 1 } }).toArray()
      : [];
    const name = new Map(orgs.map((o) => [o._id, o.name]));
    return rows.map((r) => ({
      id: r._id,
      at: r.at.toISOString(),
      action: r.action,
      label: platformAuditLabel(r.action),
      area: platformAuditArea(r.action),
      actor: r.actor
        ? { name: r.actor.name, email: r.actor.email, orgName: r.actor.orgName }
        : null,
      org: r.tenantId
        ? {
            tenantId: r.tenantId,
            name:
              name.get(r.tenantId) ??
              (typeof r.metadata?.orgName === 'string'
                ? r.metadata.orgName
                : 'Deleted organization'),
          }
        : null,
      target: r.target,
      ip: r.ip,
      metadata: r.metadata ?? {},
    }));
  }
}
