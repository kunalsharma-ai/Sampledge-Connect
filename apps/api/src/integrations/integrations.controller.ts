import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import {
  LinkIdentityRequestSchema,
  MODULE_CATALOG,
  SampledgeModuleSchema,
  tenantCan,
  type LinkedRecord,
  type ModuleActionDef,
} from '@sampledge/contracts';
import { forbidden, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { AuthGuard, Ctx } from '../auth/auth.guard.js';
import { TenantDb } from '../database/tenant-db.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { AuditService } from '../audit/audit.service.js';
import { WorkStore } from './collections.js';
import { toIdentityLink } from './integration-api.controller.js';
import { ModuleActionsService } from './module-actions.service.js';
import { ModuleEventsService } from './module-events.service.js';
import { ModuleKeysService } from './module-keys.service.js';
import { RecordsService, toLinkedRecord } from './records.service.js';
import { WebhooksService } from './webhooks.service.js';

const requireManage = (ctx: TenantContext) => {
  if (!tenantCan(ctx.role, 'integrations.manage')) throw forbidden();
};
const mod = (v: string) => parse(SampledgeModuleSchema, v);

/** Admin side of the Sampledge modules (integrations.manage), plus per-conversation record context. */
@Controller('v1/integrations')
@UseGuards(AuthGuard)
export class IntegrationsController {
  constructor(
    private readonly keys: ModuleKeysService,
    private readonly events: ModuleEventsService,
    private readonly actions: ModuleActionsService,
    private readonly webhooks: WebhooksService,
    private readonly records: RecordsService,
    private readonly store: WorkStore,
    private readonly db: TenantDb,
    private readonly conversations: ConversationsService,
    private readonly audit: AuditService,
  ) {}

  /* ---------- modules (admin) ---------- */

  @Get('modules')
  status(@Ctx() ctx: TenantContext) {
    requireManage(ctx);
    return this.keys.status(ctx);
  }

  @Post('modules/:module/keys')
  issueKey(@Ctx() ctx: TenantContext, @Param('module') m: string, @Body() body: unknown) {
    requireManage(ctx);
    const opts = parse(z.object({ generateSigningSecret: z.boolean().default(false) }), body ?? {});
    return this.keys.issue(ctx, m, opts);
  }

  @Delete('modules/:module/keys')
  @HttpCode(204)
  async revokeKeys(@Ctx() ctx: TenantContext, @Param('module') m: string) {
    requireManage(ctx);
    await this.keys.revoke(ctx, m);
  }

  @Post('modules/:module/test-event')
  @HttpCode(200)
  testEvent(@Ctx() ctx: TenantContext, @Param('module') m: string, @Body() body: unknown) {
    requireManage(ctx);
    const { type } = parse(z.object({ type: z.string().min(1).max(80) }), body);
    return this.events.sendTest(ctx, mod(m), type);
  }

  @Get('modules/:module/events')
  eventLog(@Ctx() ctx: TenantContext, @Param('module') m: string, @Query('limit') limit?: string) {
    requireManage(ctx);
    return this.events.log(ctx, mod(m), Number(limit) || 50);
  }

  @Get('modules/:module/identities')
  async identities(@Ctx() ctx: TenantContext, @Param('module') m: string) {
    requireManage(ctx);
    const rows = await this.store
      .for(ctx.tenantId)
      .identity_links.find({ module: mod(m) }, { sort: { createdAt: -1 }, limit: 500 })
      .toArray();
    return rows.map(toIdentityLink);
  }

  @Put('modules/:module/identities')
  async linkIdentity(@Ctx() ctx: TenantContext, @Param('module') m: string, @Body() body: unknown) {
    requireManage(ctx);
    const req = parse(LinkIdentityRequestSchema, body);
    const t = this.db.for(ctx.tenantId);
    const user = req.userId
      ? await t.users.findOne({ _id: req.userId, status: 'active' })
      : await t.users.findOne({ email: req.email!, status: 'active' });
    if (!user) throw notFound('Connect user');
    const link = await this.records.saveLink(
      ctx.tenantId,
      mod(m),
      req.externalUserId,
      user._id,
      user.email,
      'manual',
    );
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'integration.identity_linked',
      target: { type: 'user', id: user._id },
      metadata: { module: m, externalUserId: req.externalUserId },
    });
    return toIdentityLink(link);
  }

  @Delete('modules/:module/identities/:externalUserId')
  @HttpCode(204)
  async unlinkIdentity(
    @Ctx() ctx: TenantContext,
    @Param('module') m: string,
    @Param('externalUserId') ext: string,
  ) {
    requireManage(ctx);
    const r = await this.store
      .for(ctx.tenantId)
      .identity_links.deleteMany({ module: mod(m), externalUserId: ext });
    if (!r.deletedCount) throw notFound('Identity link');
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'integration.identity_unlinked',
      target: { type: 'identity_link', id: ext },
      metadata: { module: m },
    });
  }

  @Get('actions')
  listActions(@Ctx() ctx: TenantContext, @Query('module') m?: string) {
    requireManage(ctx);
    return this.actions.list(ctx, m ? mod(m) : undefined);
  }

  @Post('actions/:id/retry')
  retryAction(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    requireManage(ctx);
    return this.actions.retry(ctx, id);
  }

  /* ---------- webhooks (admin) ---------- */

  @Get('webhooks')
  listWebhooks(@Ctx() ctx: TenantContext) {
    requireManage(ctx);
    return this.webhooks.list(ctx);
  }

  @Post('webhooks')
  createWebhook(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    requireManage(ctx);
    return this.webhooks.create(ctx, body);
  }

  @Patch('webhooks/:id')
  patchWebhook(@Ctx() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    requireManage(ctx);
    const { active } = parse(z.object({ active: z.boolean() }), body);
    return this.webhooks.setActive(ctx, id, active);
  }

  @Delete('webhooks/:id')
  @HttpCode(204)
  async deleteWebhook(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    requireManage(ctx);
    await this.webhooks.remove(ctx, id);
  }

  @Get('webhooks/:id/deliveries')
  deliveries(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    requireManage(ctx);
    return this.webhooks.deliveries(ctx, id);
  }

  @Post('webhooks/:id/test')
  @HttpCode(200)
  testWebhook(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    requireManage(ctx);
    return this.webhooks.sendTest(ctx, id);
  }

  /* ---------- record context (any member who can read the conversation) ---------- */

  /** GET /v1/integrations/records?conversationId=: the module records this conversation is about. */
  @Get('records')
  async recordsFor(
    @Ctx() ctx: TenantContext,
    @Query('conversationId') conversationId: string,
  ): Promise<
    (LinkedRecord & { actions: Pick<ModuleActionDef, 'type' | 'label' | 'description'>[] })[]
  > {
    if (!conversationId) return [];
    await this.conversations.authorize(ctx, conversationId, 'conversation.read');
    const rows = await this.records.recordsForConversation(ctx.tenantId, conversationId);
    return rows
      .filter((r) => r.recordType !== '_channel')
      .map((r) => ({
        ...toLinkedRecord(r),
        actions: MODULE_CATALOG[r.module].actions
          .filter((a) => !a.automatic && a.recordTypes.includes(r.recordType))
          .map(({ type, label, description }) => ({ type, label, description })),
      }));
  }

  @Post('records/:linkId/actions')
  @HttpCode(200)
  runAction(@Ctx() ctx: TenantContext, @Param('linkId') linkId: string, @Body() body: unknown) {
    return this.actions.runForRecord(ctx, linkId, body);
  }
}
