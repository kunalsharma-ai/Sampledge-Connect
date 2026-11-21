import { Injectable } from '@nestjs/common';
import { AppError, forbidden } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { TenantDb } from '../database/tenant-db.js';
import { NetworkPolicyService } from './network-policy.service.js';
import { NetworkTenant } from './network-tenant.js';

/**
 * Routes a network session may call. Everything else (admin, billing, AI, modules, meetings,
 * integrations, recordings…) is organization-only and refused for network tokens, so the
 * network tenant can never become a back door into organization features.
 */
const ALLOWED: { prefix: string; methods?: string[] }[] = [
  { prefix: '/v1/network' },
  { prefix: '/v1/auth' },
  { prefix: '/v1/me' },
  { prefix: '/v1/users', methods: ['GET'] },
  { prefix: '/v1/devices' },
  { prefix: '/v1/conversations' },
  { prefix: '/v1/messages' },
  { prefix: '/v1/sync' },
  { prefix: '/v1/uploads' },
  { prefix: '/v1/attachments' },
  { prefix: '/v1/calls' },
  { prefix: '/v1/notifications' },
  { prefix: '/v1/push' },
  { prefix: '/v1/bookmarks' },
];

const TTL_MS = 15_000;

@Injectable()
export class NetworkGate {
  private access = new Map<string, { at: number; reason: string | null }>();

  constructor(
    private readonly network: NetworkTenant,
    private readonly db: TenantDb,
    private readonly policy: NetworkPolicyService,
  ) {}

  /** Called by the auth guard for every request; a no-op for organization sessions. */
  async check(ctx: TenantContext, method: string, path: string): Promise<void> {
    if (!(await this.network.isNetwork(ctx.tenantId))) return;
    const p = path.split('?')[0]!;
    const ok = ALLOWED.some(
      (a) =>
        (p === a.prefix || p.startsWith(`${a.prefix}/`)) &&
        (!a.methods || a.methods.includes(method.toUpperCase())),
    );
    if (!ok) throw forbidden('This is not available in Sampledge Network');
    // Conversations: only the endpoints the network supports. Creating groups or channels
    // directly is refused by the permission model (network members are 'guest').
    await this.assertAccess(ctx);
  }

  /** Socket handshake and periodic recheck. */
  async assertAccess(ctx: TenantContext): Promise<void> {
    if (!(await this.network.isNetwork(ctx.tenantId))) return;
    const reason = await this.reason(ctx.userId);
    if (reason) throw new AppError('FORBIDDEN', reason);
  }

  /** A linked work identity stops working when the person leaves or their admin turns it off. */
  private async reason(userId: string): Promise<string | null> {
    const hit = this.access.get(userId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.reason;
    const net = await this.network.scoped();
    const profile = await net.network_profiles.findOne({ userId });
    let reason: string | null = null;
    if (profile?.homeTenantId && profile.homeUserId) {
      const home = this.db.for(profile.homeTenantId);
      const [user, membership, tenant] = await Promise.all([
        home.users.findOne({ _id: profile.homeUserId }, { projection: { status: 1 } }),
        home.memberships.findOne({ userId: profile.homeUserId }, { projection: { _id: 1 } }),
        this.db.tenants.findOne({ _id: profile.homeTenantId }, { projection: { status: 1 } }),
      ]);
      if (!user || user.status !== 'active' || !membership || tenant?.status !== 'active')
        reason = 'Your organization account is no longer active';
      else if (!(await this.policy.get(profile.homeTenantId)).enabled)
        reason = 'Your organization turned off external connections';
    }
    this.access.set(userId, { at: Date.now(), reason });
    return reason;
  }

  /** Drop cached decisions (after a policy change in this process). */
  forget() {
    this.access.clear();
  }
}
