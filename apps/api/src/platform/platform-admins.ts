import { Inject, Injectable, Logger } from '@nestjs/common';
import { platformCan, type PlatformPermission, type PlatformRole } from '@sampledge/contracts';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { TenantDb, newId } from '../database/tenant-db.js';
import { forbidden } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { PlatformAudit } from './platform-audit.service.js';

const CACHE_MS = 10_000;

/**
 * Platform admins: work accounts (an organization + a person) with a platform role, kept in
 * the `platform_admins` collection and managed in the super admin console.
 *
 * PLATFORM_ADMIN_EMAILS only bootstraps the first super admin: while nobody holds the
 * super admin role, a listed account becomes one the first time it is checked. Entries can
 * be pinned to an organization as `org-slug:email` (recommended).
 */
@Injectable()
export class PlatformAdmins {
  private readonly log = new Logger('PlatformAdmins');
  private readonly bootstrap: { slug: string | null; email: string }[];
  private readonly cache = new Map<string, { role: PlatformRole | null; at: number }>();

  constructor(
    private readonly db: TenantDb,
    private readonly audit: PlatformAudit,
    @Inject(APP_CONFIG) cfg: AppConfig,
  ) {
    this.bootstrap = cfg.PLATFORM_ADMIN_EMAILS.split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .map((s) => {
        const i = s.lastIndexOf(':');
        return i > 0 ? { slug: s.slice(0, i), email: s.slice(i + 1) } : { slug: null, email: s };
      });
  }

  /** The person's platform role, or null. */
  async roleOf(ctx: Pick<TenantContext, 'tenantId' | 'userId'>): Promise<PlatformRole | null> {
    const key = `${ctx.tenantId}:${ctx.userId}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.role;
    const doc = await this.db.platformAdmins.findOne(
      { tenantId: ctx.tenantId, userId: ctx.userId },
      { projection: { role: 1 } },
    );
    const role = doc?.role ?? (await this.tryBootstrap(ctx));
    this.cache.set(key, { role, at: Date.now() });
    return role;
  }

  async is(ctx: Pick<TenantContext, 'tenantId' | 'userId'>): Promise<boolean> {
    return (await this.roleOf(ctx)) !== null;
  }

  async can(ctx: Pick<TenantContext, 'tenantId' | 'userId'>, p: PlatformPermission) {
    return platformCan(await this.roleOf(ctx), p);
  }

  /** Throws FORBIDDEN unless the person has the permission; returns their role. */
  async assert(ctx: TenantContext, p: PlatformPermission = 'overview.view'): Promise<PlatformRole> {
    const role = await this.roleOf(ctx);
    if (!role || !platformCan(role, p)) throw forbidden();
    return role;
  }

  forget(tenantId?: string, userId?: string) {
    if (tenantId && userId) this.cache.delete(`${tenantId}:${userId}`);
    else this.cache.clear();
  }

  private async tryBootstrap(ctx: Pick<TenantContext, 'tenantId' | 'userId'>) {
    if (this.bootstrap.length === 0) return null;
    if (await this.db.platformAdmins.countDocuments({ role: 'owner' }, { limit: 1 })) return null;
    const [u, t] = await Promise.all([
      this.db
        .for(ctx.tenantId)
        .users.findOne({ _id: ctx.userId }, { projection: { email: 1, status: 1 } }),
      this.db.tenants.findOne({ _id: ctx.tenantId }, { projection: { slug: 1, kind: 1 } }),
    ]);
    if (!u || !t || t.kind === 'network' || u.status !== 'active') return null;
    const email = u.email.toLowerCase();
    if (!this.bootstrap.some((b) => b.email === email && (!b.slug || b.slug === t.slug)))
      return null;
    try {
      await this.db.platformAdmins.insertOne({
        _id: newId(),
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        email,
        role: 'owner',
        addedAt: new Date(),
        addedBy: null,
        bootstrap: true,
      });
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e;
    }
    this.log.log(`First super admin set up from PLATFORM_ADMIN_EMAILS (${t.slug})`);
    await this.audit.record({
      ctx: { ...ctx, sessionId: '', deviceId: '', role: 'owner', workspaceId: '' },
      action: 'platform.admin_bootstrapped',
      target: { type: 'platform_admin', id: ctx.userId, label: email },
    });
    return 'owner' as const;
  }
}
