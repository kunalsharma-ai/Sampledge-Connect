import { Inject, Injectable } from '@nestjs/common';
import type { Db } from 'mongodb';
import { MONGO_DB } from '../database/database.module.js';
import { TenantDb, type ScopedDb } from '../database/tenant-db.js';
import { ensureNetworkTenant } from '../database/migrations/033-network.js';

/**
 * The one reserved tenant that holds SampConnect Network data. Organization tenants never
 * read it and it never reads them: identities are linked by id only (docs/network.md).
 */
@Injectable()
export class NetworkTenant {
  private ids: Promise<{ tenantId: string; workspaceId: string }> | null = null;
  private known: string | null = null;

  constructor(
    @Inject(MONGO_DB) private readonly mongo: Db,
    private readonly db: TenantDb,
  ) {}

  async get(): Promise<{ tenantId: string; workspaceId: string }> {
    this.ids ??= ensureNetworkTenant(this.mongo).then((r) => {
      this.known = r.tenantId;
      return r;
    });
    try {
      return await this.ids;
    } catch (e) {
      this.ids = null;
      throw e;
    }
  }

  async id(): Promise<string> {
    return (await this.get()).tenantId;
  }

  async isNetwork(tenantId: string): Promise<boolean> {
    if (this.known) return tenantId === this.known;
    return tenantId === (await this.id());
  }

  async scoped(): Promise<ScopedDb> {
    return this.db.for(await this.id());
  }
}
