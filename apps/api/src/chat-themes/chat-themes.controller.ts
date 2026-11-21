import { Body, Controller, Get, Injectable, Put, UseGuards } from '@nestjs/common';
import {
  ChatThemePolicySchema,
  DEFAULT_CHAT_THEME_POLICY,
  SetChatThemeRequestSchema,
  effectiveChatTheme,
  type ChatThemeId,
  type ChatThemePolicy,
  type ChatThemeState,
} from '@sampledge/contracts';
import { AppError, forbidden, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { AuthGuard, Ctx } from '../auth/auth.guard.js';
import { TenantDb } from '../database/tenant-db.js';
import { AuditService } from '../audit/audit.service.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';

/**
 * Chat themes: each person's choice (synced to all of their devices with `chat-theme:changed`)
 * and the organization's default and allowed list (owners and admins; `tenant:updated`
 * area `chat_themes`). Both PUTs replace the whole value, so the offline queue can retry them.
 */
@Injectable()
export class ChatThemesService {
  constructor(
    private readonly db: TenantDb,
    private readonly realtime: RealtimePublisher,
    private readonly audit: AuditService,
  ) {}

  async policy(tenantId: string): Promise<ChatThemePolicy> {
    const t = await this.db.tenants.findOne(
      { _id: tenantId },
      { projection: { chatThemePolicy: 1 } },
    );
    const r = ChatThemePolicySchema.safeParse(t?.chatThemePolicy ?? DEFAULT_CHAT_THEME_POLICY);
    return r.success ? r.data : DEFAULT_CHAT_THEME_POLICY;
  }

  async state(ctx: TenantContext): Promise<ChatThemeState> {
    const [u, policy] = await Promise.all([
      this.db
        .for(ctx.tenantId)
        .users.findOne({ _id: ctx.userId }, { projection: { chatTheme: 1 } }),
      this.policy(ctx.tenantId),
    ]);
    if (!u) throw notFound('User');
    const themeId = (u.chatTheme ?? null) as ChatThemeId | null;
    return { themeId, policy, effective: effectiveChatTheme(themeId, policy) };
  }

  async set(ctx: TenantContext, body: unknown): Promise<ChatThemeState> {
    const { themeId } = parse(SetChatThemeRequestSchema, body);
    const policy = await this.policy(ctx.tenantId);
    if (themeId && policy.allowed && !policy.allowed.includes(themeId))
      throw new AppError('VALIDATION_FAILED', 'Your organization doesn’t offer that chat theme');
    await this.db
      .for(ctx.tenantId)
      .users.updateOne({ _id: ctx.userId }, { $set: { chatTheme: themeId } });
    this.realtime.toUser(ctx.tenantId, ctx.userId, 'chat-theme:changed', { themeId });
    return this.state(ctx);
  }

  async setPolicy(ctx: TenantContext, body: unknown): Promise<ChatThemeState> {
    if (ctx.role !== 'owner' && ctx.role !== 'admin')
      throw forbidden('Only owners and admins can set chat theme rules');
    const p = parse(ChatThemePolicySchema, body);
    const allowed = p.allowed ? [...new Set([p.defaultThemeId, ...p.allowed])] : null;
    const policy: ChatThemePolicy = { defaultThemeId: p.defaultThemeId, allowed };
    await this.db.tenants.updateOne({ _id: ctx.tenantId }, { $set: { chatThemePolicy: policy } });
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'tenant.chat_themes_updated',
      metadata: { defaultThemeId: policy.defaultThemeId, allowed: policy.allowed?.length ?? 'all' },
    });
    this.realtime.toTenant(ctx.tenantId, 'tenant:updated', { area: 'chat_themes' });
    return this.state(ctx);
  }
}

@Controller('v1')
@UseGuards(AuthGuard)
export class ChatThemesController {
  constructor(private readonly themes: ChatThemesService) {}

  @Get('me/chat-theme')
  get(@Ctx() ctx: TenantContext) {
    return this.themes.state(ctx);
  }

  @Put('me/chat-theme')
  set(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.themes.set(ctx, body);
  }

  @Put('admin/chat-themes')
  setPolicy(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.themes.setPolicy(ctx, body);
  }
}
