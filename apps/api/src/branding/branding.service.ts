import { Injectable } from '@nestjs/common';
import {
  BrandingInputSchema,
  DEFAULT_APP_NAME,
  LOGO_MAX_BYTES,
  tenantCan,
  type Branding,
  type BrandingView,
  type PublicBranding,
} from '@sampledge/contracts';
import { AppError, forbidden, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import type { TenantDoc } from '../database/documents.js';
import { TenantDb } from '../database/tenant-db.js';
import { AuditService } from '../audit/audit.service.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';

const DEFAULTS: Branding = BrandingInputSchema.parse({});

/** White-label: per-organization name, logo, colors and sign-in page, stored on the tenant. */
@Injectable()
export class BrandingService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly realtime: RealtimePublisher,
  ) {}

  /** The organization's branding with defaults filled in (older tenants have none or a partial one). */
  static resolve(t: Pick<TenantDoc, 'branding'> | null): Branding {
    const b = (t?.branding ?? {}) as Partial<Branding> & { logoUrl?: string };
    const merged = { ...DEFAULTS, ...b };
    const r = BrandingInputSchema.safeParse(merged);
    return r.success ? r.data : DEFAULTS;
  }

  static displayName(t: Pick<TenantDoc, 'branding'> | null) {
    return BrandingService.resolve(t).appName ?? DEFAULT_APP_NAME;
  }

  async get(ctx: TenantContext): Promise<BrandingView> {
    const t = await this.db.tenants.findOne({ _id: ctx.tenantId });
    if (!t) throw notFound('Organization');
    return this.view(t, tenantCan(ctx, 'tenant.manage'));
  }

  async publicFor(slug: string): Promise<PublicBranding> {
    const t = await this.db.tenants.findOne({ slug, status: 'active' });
    if (!t) throw notFound('Workspace');
    const b = BrandingService.resolve(t);
    return {
      organizationName: t.name,
      displayName: b.appName ?? DEFAULT_APP_NAME,
      logo: b.logo,
      primary: b.primary,
      secondary: b.secondary,
      mode: b.mode,
      loginMessage: b.loginMessage,
      hidePoweredBy: b.hidePoweredBy,
    };
  }

  async save(ctx: TenantContext, body: unknown): Promise<BrandingView> {
    if (!tenantCan(ctx, 'tenant.manage'))
      throw forbidden('Only the organization owner can change branding');
    const b = parse(BrandingInputSchema, body);
    if (b.logo) {
      const bytes = Buffer.from(b.logo.slice(b.logo.indexOf(',') + 1), 'base64');
      if (bytes.length > LOGO_MAX_BYTES)
        throw new AppError('VALIDATION_FAILED', 'The logo must be 256 KB or smaller');
      if (
        b.logo.startsWith('data:image/svg+xml') &&
        /<script|\bon\w+\s*=|javascript:/i.test(bytes.toString('utf8'))
      )
        throw new AppError('VALIDATION_FAILED', 'SVG logos can’t contain scripts');
    }
    const now = new Date();
    const before = BrandingService.resolve(await this.db.tenants.findOne({ _id: ctx.tenantId }));
    await this.db.tenants.updateOne(
      { _id: ctx.tenantId },
      {
        $set: {
          branding: { ...b, updatedAt: now, updatedBy: ctx.userId } as TenantDoc['branding'],
        },
      },
    );
    const changed = (Object.keys(b) as (keyof Branding)[]).filter(
      (k) => JSON.stringify(b[k]) !== JSON.stringify(before[k]),
    );
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'tenant.branding_updated',
      metadata: { changed },
    });
    this.realtime.toTenant(ctx.tenantId, 'tenant:updated', { area: 'branding' });
    return this.get(ctx);
  }

  private view(t: TenantDoc, canManage: boolean): BrandingView {
    const b = BrandingService.resolve(t);
    const meta = (t.branding ?? {}) as { updatedAt?: Date };
    return {
      ...b,
      organizationName: t.name,
      displayName: b.appName ?? DEFAULT_APP_NAME,
      updatedAt: meta.updatedAt ? new Date(meta.updatedAt).toISOString() : null,
      canManage,
    };
  }
}
