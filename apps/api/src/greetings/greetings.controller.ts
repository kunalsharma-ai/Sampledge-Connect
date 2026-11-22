import { Body, Controller, Get, Injectable, Put, UseGuards } from '@nestjs/common';
import {
  DEFAULT_GREETING_POLICY,
  GreetingPolicySchema,
  greetingAllowed,
  greetingOccasion,
  tenantCan,
  type GreetingCard,
  type GreetingPolicy,
  type GreetingPolicyState,
} from '@sampledge/contracts';
import { AppError, forbidden, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { AuthGuard, Ctx } from '../auth/auth.guard.js';
import { TenantDb } from '../database/tenant-db.js';
import { AuditService } from '../audit/audit.service.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';

/**
 * Greeting cards (festival and occasion cards in chat). The cards themselves are ordinary
 * messages (`metadata.greeting`, see MessagesService.send); this holds the organization's
 * rules: on or off, and which categories are offered. Changes reach every device live
 * through `tenant:updated` (area `greetings`). The PUT replaces the whole value, so it is
 * safe to retry.
 */
@Injectable()
export class GreetingsService {
  constructor(
    private readonly db: TenantDb,
    private readonly realtime: RealtimePublisher,
    private readonly audit: AuditService,
  ) {}

  async policy(tenantId: string): Promise<GreetingPolicy> {
    const t = await this.db.tenants.findOne(
      { _id: tenantId },
      { projection: { greetingPolicy: 1 } },
    );
    const r = GreetingPolicySchema.safeParse(t?.greetingPolicy ?? DEFAULT_GREETING_POLICY);
    return r.success ? r.data : DEFAULT_GREETING_POLICY;
  }

  /** Throws unless the organization offers this card. Used when a greeting is sent. */
  async assertAllowed(tenantId: string, card: GreetingCard): Promise<void> {
    const policy = await this.policy(tenantId);
    if (!policy.enabled)
      throw new AppError('VALIDATION_FAILED', 'Greeting cards are turned off in this organization');
    if (!greetingAllowed(policy, card.occasionId))
      throw new AppError(
        'VALIDATION_FAILED',
        `Your organization doesn’t offer ${greetingOccasion(card.occasionId)?.name ?? 'that'} cards`,
      );
  }

  async setPolicy(ctx: TenantContext, body: unknown): Promise<GreetingPolicyState> {
    if (!tenantCan(ctx, 'themes.manage'))
      throw forbidden('You can’t set greeting card rules in this organization');
    const p = parse(GreetingPolicySchema, body);
    const policy: GreetingPolicy = {
      enabled: p.enabled,
      hiddenCategories: [...new Set(p.hiddenCategories)],
    };
    await this.db.tenants.updateOne({ _id: ctx.tenantId }, { $set: { greetingPolicy: policy } });
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'tenant.greetings_updated',
      metadata: { enabled: policy.enabled, hiddenCategories: policy.hiddenCategories },
    });
    this.realtime.toTenant(ctx.tenantId, 'tenant:updated', { area: 'greetings' });
    return { policy };
  }
}

@Controller('v1')
@UseGuards(AuthGuard)
export class GreetingsController {
  constructor(private readonly greetings: GreetingsService) {}

  @Get('greetings/policy')
  async get(@Ctx() ctx: TenantContext): Promise<GreetingPolicyState> {
    return { policy: await this.greetings.policy(ctx.tenantId) };
  }

  @Put('admin/greetings')
  set(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.greetings.setPolicy(ctx, body);
  }
}
