import { Injectable } from '@nestjs/common';
import { AppError, forbidden } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import type { ConversationDoc } from '../database/documents.js';
import { NetworkTenant } from './network-tenant.js';

/**
 * Network rules the shared conversation code enforces. Organization tenants are unaffected;
 * in the network tenant a DM needs an accepted connection and no block, and members can only
 * be added to community groups if they are in that community.
 */
@Injectable()
export class NetworkRules {
  constructor(private readonly network: NetworkTenant) {}

  async isNetwork(tenantId: string) {
    return this.network.isNetwork(tenantId);
  }

  async blockedBetween(a: string, b: string): Promise<boolean> {
    const net = await this.network.scoped();
    return !!(await net.network_blocks.findOne({
      $or: [
        { userId: a, blockedUserId: b },
        { userId: b, blockedUserId: a },
      ],
    }));
  }

  async connected(a: string, b: string): Promise<boolean> {
    const net = await this.network.scoped();
    return !!(await net.network_connections.findOne({ userId: a, otherUserId: b }));
  }

  /** Before creating a DM in the network tenant. */
  async assertCanDm(ctx: TenantContext, otherId: string): Promise<void> {
    if (!(await this.isNetwork(ctx.tenantId))) return;
    if (await this.blockedBetween(ctx.userId, otherId)) throw forbidden("You can't message this person");
    if (!(await this.connected(ctx.userId, otherId)))
      throw new AppError('FORBIDDEN', 'Connect with this person before messaging them');
  }

  /** Before sending (and calling) in a network conversation. */
  async assertCanSend(ctx: TenantContext, c: ConversationDoc, memberIds: () => Promise<string[]>) {
    if (!(await this.isNetwork(ctx.tenantId))) return;
    if (c.kind !== 'dm') return;
    const other = (await memberIds()).find((id) => id !== ctx.userId);
    if (!other) return;
    if (await this.blockedBetween(ctx.userId, other)) throw forbidden("You can't message this person");
    if (!(await this.connected(ctx.userId, other)))
      throw forbidden('You are no longer connected with this person');
  }

  /** Before adding people to a network conversation. */
  async assertCanAdd(ctx: TenantContext, c: ConversationDoc, userIds: string[]) {
    if (!(await this.isNetwork(ctx.tenantId))) return;
    const net = await this.network.scoped();
    if (!c.communityId) throw forbidden('Add people through the community');
    const active = await net.community_members.countDocuments({
      communityId: c.communityId,
      userId: { $in: userIds },
      status: 'active',
    });
    if (active !== new Set(userIds).size)
      throw new AppError('VALIDATION_FAILED', 'Only community members can join its groups');
  }
}
