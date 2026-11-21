import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { RefreshRequestSchema } from '@sampledge/contracts';
import { parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthGuard, Ctx } from './auth.guard.js';
import { AuthService, type RequestMeta } from './auth.service.js';
import { SessionService } from './session.service.js';

export const meta = (req: Request): RequestMeta => ({
  ip: req.ip ?? null,
  userAgent: req.headers['user-agent'] ?? null,
});

@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  /** Organization onboarding: creates tenant, owner, default workspace and #general. */
  @Post('register')
  register(@Body() body: unknown, @Req() req: Request) {
    return this.auth.registerTenant(body, meta(req));
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() body: unknown, @Req() req: Request) {
    return this.auth.login(body, meta(req));
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() body: unknown) {
    return this.auth.refresh(parse(RefreshRequestSchema, body).refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async logout(@Ctx() ctx: TenantContext, @Req() req: Request) {
    await this.sessions.revoke(ctx.tenantId, ctx.sessionId, 'logout');
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'auth.logout',
      target: { type: 'device', id: ctx.sessionId },
      ...meta(req),
    });
  }
}
