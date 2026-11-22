import { Injectable } from '@nestjs/common';
import {
  DEFAULT_NETWORK_POLICY,
  NetworkPolicySchema,
  type NetworkAdminView,
  type NetworkPolicy,
} from '@sampledge/contracts';
import { parse } from '../common/errors.js';
import type { NetworkProfileDoc } from '../database/documents.js';
import { TenantDb } from '../database/tenant-db.js';
import { AuditService } from '../audit/audit.service.js';
import { NetworkTenant } from './network-tenant.js';

const TTL_MS = 15_000;

/** What an organization's admins allow their members to do on SampConnect Network. */
@Injectable()
export class NetworkPolicyService {
  private cache = new Map<string, { at: number; policy: NetworkPolicy }>();

  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly network: NetworkTenant,
  ) {}

  async get(tenantId: string): Promise<NetworkPolicy> {
    const hit = this.cache.get(tenantId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.policy;
    const s = await this.db.for(tenantId).tenant_settings.findOne({});
    const policy = { ...DEFAULT_NETWORK_POLICY, ...(s?.networkPolicy ?? {}) };
    this.cache.set(tenantId, { at: Date.now(), policy });
    return policy;
  }

  async view(tenantId: string): Promise<NetworkAdminView> {
    const net = await this.network.scoped();
    const linked = await net.network_profiles
      .find({ homeTenantId: tenantId }, { projection: { userId: 1 } })
      .toArray();
    const ids = linked.map((p) => p.userId);
    const externalConnections = ids.length
      ? await net.network_connections.countDocuments({ userId: { $in: ids } })
      : 0;
    return { policy: await this.get(tenantId), linkedMembers: ids.length, externalConnections };
  }

  async set(tenantId: string, actorId: string, input: unknown): Promise<NetworkAdminView> {
    const policy = parse(NetworkPolicySchema, input);
    const before = await this.get(tenantId);
    await this.db.for(tenantId).tenant_settings.updateOne(
      {},
      {
        $set: { networkPolicy: policy, updatedAt: new Date(), updatedBy: actorId },
        $setOnInsert: { recordingRetentionDays: null, callRecordingEnabled: true } as never,
      },
      { upsert: true },
    );
    this.cache.delete(tenantId);
    await this.audit.record({
      tenantId,
      actorId,
      action: 'network.policy_updated',
      target: { type: 'tenant', id: tenantId },
      metadata: { before, after: policy },
    });
    return this.view(tenantId);
  }

  /**
   * Whether `me` may connect with, follow or message `other`, given my organization's policy.
   * Returns the reason in words when not.
   */
  async allowsPeer(me: NetworkProfileDoc, other: NetworkProfileDoc): Promise<string | null> {
    if (!me.homeTenantId) return null;
    const p = await this.get(me.homeTenantId);
    if (!p.enabled) return 'Your organization turned off external connections';
    if (other.homeTenantId === me.homeTenantId) return null;
    if (other.kind === 'personal' && !p.allowPersonalAccounts)
      return 'Your organization only allows connections with other organizations';
    if (p.connectWith === 'allowlist') {
      const domain = other.emailDomain ?? '';
      if (!p.allowedDomains.some((d) => domain === d || domain.endsWith(`.${d}`)))
        return 'Your organization only allows connections with approved domains';
    }
    return null;
  }

  /** Both directions: each side's organization must allow the other. */
  async pairBlockedReason(a: NetworkProfileDoc, b: NetworkProfileDoc): Promise<string | null> {
    const mine = await this.allowsPeer(a, b);
    if (mine) return mine;
    const theirs = await this.allowsPeer(b, a);
    return theirs ? "This person's organization doesn't allow this connection" : null;
  }
}
