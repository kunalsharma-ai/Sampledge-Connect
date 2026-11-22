import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import {
  MfaCodeRequestSchema,
  MfaDisableRequestSchema,
  RefreshRequestSchema,
} from '@sampledge/contracts';
import { parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthGuard, Ctx } from './auth.guard.js';
import { AuthService, type RequestMeta } from './auth.service.js';
import { MfaService } from './mfa.service.js';
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
    private readonly mfa: MfaService,
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

  /** Second step when login answered `mfaRequired`. */
  @Post('mfa/verify')
  @HttpCode(200)
  verifyMfa(@Body() body: unknown, @Req() req: Request) {
    return this.auth.verifyMfa(body, meta(req));
  }

  @Get('mfa')
  @UseGuards(AuthGuard)
  mfaStatus(@Ctx() ctx: TenantContext) {
    return this.mfa.status(ctx);
  }

  /** Starts authenticator setup; returns the secret and otpauth URL. */
  @Post('mfa/totp/setup')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  mfaSetup(@Ctx() ctx: TenantContext) {
    return this.mfa.setup(ctx);
  }

  /** Confirms setup with a first code; returns one-time recovery codes. */
  @Post('mfa/totp/enable')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  mfaEnable(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.mfa.enable(ctx, parse(MfaCodeRequestSchema, body).code);
  }

  @Post('mfa/disable')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  mfaDisable(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    const r = parse(MfaDisableRequestSchema, body);
    return this.mfa.disable(ctx, r.password, r.code);
  }

  @Post('mfa/recovery-codes')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  mfaRecoveryCodes(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.mfa.regenerateRecoveryCodes(ctx, parse(MfaCodeRequestSchema, body).code);
  }

  /** Change your own password; your other devices are signed out. */
  @Post('password')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  changePassword(@Ctx() ctx: TenantContext, @Body() body: unknown, @Req() req: Request) {
    return this.auth.changePassword(ctx, body, meta(req));
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
