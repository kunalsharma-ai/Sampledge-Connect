import { Body, Controller, Get, Injectable, Param, Put, UseGuards } from '@nestjs/common';
import {
  DEFAULT_MESSAGE_EDITING_POLICY,
  MessageEditingPolicySchema,
  editBlockedReason,
  tenantCan,
  type MessageEditHistory,
  type MessageEditingPolicy,
  type MessageEditingState,
  type MessageVersion,
} from '@sampledge/contracts';
import { AppError, forbidden, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { AuthGuard, Ctx } from '../auth/auth.guard.js';
import { TenantDb } from '../database/tenant-db.js';
import type { MessageDoc } from '../database/documents.js';
import { AuditService } from '../audit/audit.service.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';
import { ConversationsService } from '../conversations/conversations.service.js';

/**
 * Message editing rules and edit history (docs/editing.md).
 *
 * - Rules live on the tenant (`messageEditing`): editing on/off, a time limit, and who can
 *   open earlier versions. Changing them emits `tenant:updated` area `messages`.
 * - A super admin can take editing away from a role with the permission `messages.edit`.
 * - Every edit keeps the text it replaced in `message_edits`, and writes `message.edited`
 *   to the organization's audit log (ids only, never the text), which super admins see in
 *   Activity. Deleting a message erases its history.
 */
@Injectable()
export class MessageEditingService {
  constructor(
    private readonly db: TenantDb,
    private readonly realtime: RealtimePublisher,
    private readonly audit: AuditService,
    private readonly conversations: ConversationsService,
  ) {}

  async policy(tenantId: string): Promise<MessageEditingPolicy> {
    const t = await this.db.tenants.findOne(
      { _id: tenantId },
      { projection: { messageEditing: 1 } },
    );
    const r = MessageEditingPolicySchema.safeParse(t?.messageEditing ?? {});
    return r.success ? r.data : DEFAULT_MESSAGE_EDITING_POLICY;
  }

  async state(ctx: TenantContext): Promise<MessageEditingState> {
    return {
      policy: await this.policy(ctx.tenantId),
      canEditOwn: tenantCan(ctx, 'messages.edit'),
      canManage: tenantCan(ctx, 'messages.manage'),
    };
  }

  /** Throws when the rules don't let this person edit this message now. */
  async assertCanEdit(ctx: TenantContext, m: Pick<MessageDoc, 'createdAt'>) {
    const reason = editBlockedReason(m.createdAt, {
      policy: await this.policy(ctx.tenantId),
      canEditOwn: tenantCan(ctx, 'messages.edit'),
    });
    if (reason) throw new AppError('FORBIDDEN', reason);
  }

  async setPolicy(ctx: TenantContext, body: unknown): Promise<MessageEditingState> {
    if (!tenantCan(ctx, 'messages.manage'))
      throw forbidden('You can’t change message editing rules in this organization');
    const policy = parse(MessageEditingPolicySchema, body);
    await this.db.tenants.updateOne({ _id: ctx.tenantId }, { $set: { messageEditing: policy } });
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'tenant.message_editing_updated',
      metadata: { ...policy },
    });
    this.realtime.toTenant(ctx.tenantId, 'tenant:updated', { area: 'messages' });
    return this.state(ctx);
  }

  /** Keep the text an edit is about to replace. Runs under the conversation lock. */
  async keepVersion(tenantId: string, m: MessageDoc, byUserId: string, at: Date) {
    const t = this.db.for(tenantId);
    const last = await t.message_edits.findOne(
      { messageId: m._id },
      { sort: { version: -1 }, projection: { version: 1 } },
    );
    const version = (last?.version ?? 0) + 1;
    await t.message_edits.insertOne({
      messageId: m._id,
      conversationId: m.conversationId,
      version,
      text: m.content.text,
      mentions: m.content.mentions ?? [],
      writtenAt: m.editedAt ?? m.createdAt,
      replacedAt: at,
      replacedBy: byUserId,
    });
    return version + 1;
  }

  async recordEdit(ctx: TenantContext, m: MessageDoc, version: number) {
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'message.edited',
      target: { type: 'message', id: m._id },
      metadata: { conversationId: m.conversationId, version },
    });
  }

  /** A deleted message keeps no earlier versions. */
  async forget(tenantId: string, messageId: string) {
    await this.db.for(tenantId).message_edits.deleteMany({ messageId });
  }

  async history(ctx: TenantContext, messageId: string): Promise<MessageEditHistory> {
    const t = this.db.for(ctx.tenantId);
    const m = await t.messages.findOne({ _id: messageId });
    if (!m) throw notFound('Message');
    const { access } = await this.conversations.authorize(
      ctx,
      m.conversationId,
      'conversation.read',
    );
    if (m.deletedAt) throw new AppError('CONFLICT', 'Message was deleted');
    const policy = await this.policy(ctx.tenantId);
    const moderator =
      access.conversationRole === 'owner' ||
      access.conversationRole === 'moderator' ||
      ctx.role === 'owner' ||
      ctx.role === 'admin';
    if (policy.historyVisibleTo === 'moderators' && !moderator && m.senderId !== ctx.userId)
      throw forbidden('Only moderators and admins can see earlier versions here');
    const rows = await t.message_edits
      .find({ messageId }, { sort: { version: 1 }, limit: 200 })
      .toArray();
    const versions: MessageVersion[] = rows.map((r) => ({
      version: r.version,
      text: r.text,
      mentions: r.mentions,
      at: r.writtenAt.toISOString(),
      current: false,
    }));
    versions.push({
      version: (rows.at(-1)?.version ?? 0) + 1,
      text: m.content.text,
      mentions: m.content.mentions ?? [],
      at: (m.editedAt ?? m.createdAt).toISOString(),
      current: true,
    });
    return { messageId, conversationId: m.conversationId, versions };
  }
}

@Controller('v1')
@UseGuards(AuthGuard)
export class MessageEditingController {
  constructor(private readonly editing: MessageEditingService) {}

  @Get('message-editing')
  get(@Ctx() ctx: TenantContext) {
    return this.editing.state(ctx);
  }

  @Put('admin/message-editing')
  set(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.editing.setPolicy(ctx, body);
  }

  @Get('messages/:id/edits')
  history(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.editing.history(ctx, id);
  }
}
