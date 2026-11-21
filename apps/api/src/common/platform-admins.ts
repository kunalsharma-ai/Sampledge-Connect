import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { TenantDb } from '../database/tenant-db.js';
import { forbidden } from './errors.js';
import type { TenantContext } from './tenant-context.js';

/** Platform operators: the email addresses in PLATFORM_ADMIN_EMAILS (a bootstrap value). */
@Injectable()
export class PlatformAdmins {
  private readonly emails: Set<string>;
  constructor(
    private readonly db: TenantDb,
    @Inject(APP_CONFIG) cfg: AppConfig,
  ) {
    this.emails = new Set(
      cfg.PLATFORM_ADMIN_EMAILS.split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    );
  }

  async is(ctx: TenantContext): Promise<boolean> {
    if (this.emails.size === 0) return false;
    const u = await this.db
      .for(ctx.tenantId)
      .users.findOne({ _id: ctx.userId }, { projection: { email: 1 } });
    return !!u && this.emails.has(u.email.toLowerCase());
  }

  async assert(ctx: TenantContext) {
    if (!(await this.is(ctx))) throw forbidden();
  }
}
