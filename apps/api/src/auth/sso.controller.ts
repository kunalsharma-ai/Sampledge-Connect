import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { SsoExchangeRequestSchema, TenantSlugSchema } from '@sampledge/contracts';
import { parse } from '../common/errors.js';
import { RateLimitService } from '../redis/redis.module.js';
import { meta } from './auth.controller.js';
import { SsoService } from './sso.service.js';

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** OpenID Connect single sign-on. Configured per workspace in Admin → Integrations. */
@Controller('v1/auth/sso')
export class SsoController {
  constructor(
    private readonly sso: SsoService,
    private readonly rateLimit: RateLimitService,
  ) {}

  /** The provider sends people back here. Declared before `:slug` so it isn't taken as one. */
  @Get('callback')
  async callback(@Query() q: Record<string, unknown>, @Req() req: Request, @Res() res: Response) {
    const to = await this.sso.callback(
      {
        code: str(q.code),
        state: str(q.state),
        error: str(q.error),
        error_description: str(q.error_description),
      },
      meta(req),
    );
    res.redirect(302, to);
  }

  @Post('exchange')
  @HttpCode(200)
  async exchange(@Body() body: unknown, @Req() req: Request) {
    await this.rateLimit.consume('login_ip', req.ip ?? 'unknown');
    return this.sso.exchange(parse(SsoExchangeRequestSchema, body).code);
  }

  @Get(':slug')
  info(@Param('slug') slug: string) {
    return this.sso.info(parse(TenantSlugSchema, slug));
  }

  /** Redirects the browser to the identity provider. */
  @Get(':slug/start')
  async start(
    @Param('slug') slug: string,
    @Query() q: Record<string, unknown>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.rateLimit.consume('login_ip', req.ip ?? 'unknown');
    const url = await this.sso.start(
      parse(TenantSlugSchema, slug),
      {
        returnTo: str(q.returnTo),
        deviceId: str(q.deviceId),
        deviceName: str(q.deviceName),
        platform: str(q.platform),
      },
      `${req.protocol}://${req.get('host')}`,
    );
    res.redirect(302, url);
  }
}
