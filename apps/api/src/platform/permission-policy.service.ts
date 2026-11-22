import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import {
  DEFAULT_TENANT_POLICY,
  TENANT_PERMISSIONS,
  TENANT_PERMISSIONS_BEFORE_KNOWN_LIST,
  TENANT_ROLES,
  type TenantPermission,
  type TenantPermissionPolicy,
  type TenantRole,
} from '@sampledge/contracts';
import { REDIS } from '../redis/redis.module.js';
import { TenantDb } from '../database/tenant-db.js';

const TTL_S = 30;
const VERSION_KEY = 'tenant-perms:ver';

/**
 * Keeps only known permissions and fills missing roles from the built-in rules. A permission
 * the saved policy didn't know about yet (added to SampConnect after it was saved, see
 * `_known`) keeps its built-in grant.
 */
export function cleanPolicy(
  raw: Record<string, string[]> | null | undefined,
): TenantPermissionPolicy | null {
  if (!raw) return null;
  const savedWith = new Set<string>(
    Array.isArray(raw._known) ? raw._known : TENANT_PERMISSIONS_BEFORE_KNOWN_LIST,
  );
  return Object.fromEntries(
    TENANT_ROLES.map((r) => [
      r,
      Array.isArray(raw[r])
        ? TENANT_PERMISSIONS.filter((p) =>
            savedWith.has(p) ? raw[r]!.includes(p) : DEFAULT_TENANT_POLICY[r].includes(p),
          )
        : [...DEFAULT_TENANT_POLICY[r]],
    ]),
  ) as TenantPermissionPolicy;
}

/** What to store: the policy plus the permissions it was saved with. */
export function storedPolicy(
  policy: TenantPermissionPolicy | null,
): Record<string, string[]> | null {
  return policy ? { ...policy, _known: [...TENANT_PERMISSIONS] } : null;
}

/**
 * What each role may do in each organization (docs/super-admin.md → Permissions):
 * the organization's own rules if a super admin set them, else the platform default,
 * else SampConnect's built-in rules. Cached in Redis for 30 seconds; a change bumps a
 * version so every API instance picks it up on the next request.
 */
@Injectable()
export class PermissionPolicy {
  constructor(
    private readonly db: TenantDb,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async grants(tenantId: string, role: TenantRole): Promise<readonly TenantPermission[]> {
    return (await this.effective(tenantId))[role];
  }

  async effective(tenantId: string): Promise<TenantPermissionPolicy> {
    const ver = (await this.redis.get(VERSION_KEY)) ?? '0';
    const key = `tenant-perms:${ver}:${tenantId}`;
    const hit = await this.redis.get(key);
    if (hit) return JSON.parse(hit) as TenantPermissionPolicy;
    const [own, def] = await Promise.all([this.orgPolicy(tenantId), this.platformDefault()]);
    const policy = own ?? def;
    await this.redis.set(key, JSON.stringify(policy), 'EX', TTL_S);
    return policy;
  }

  async orgPolicy(tenantId: string): Promise<TenantPermissionPolicy | null> {
    const t = await this.db.tenants.findOne({ _id: tenantId }, { projection: { permissions: 1 } });
    return cleanPolicy(t?.permissions);
  }

  async platformDefault(): Promise<TenantPermissionPolicy> {
    const d = await this.db.platformSettings.findOne({ _id: 'permissions' });
    return cleanPolicy(d?.policy) ?? DEFAULT_TENANT_POLICY;
  }

  /** After any change: every cached policy is stale. */
  async bump() {
    await this.redis.incr(VERSION_KEY);
  }
}
