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
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CONNECTOR_CATALOG } from '@sampledge/contracts';
import { AuthGuard, Ctx } from '../auth/auth.guard.js';
import type { TenantContext } from '../common/tenant-context.js';
import { ConnectorsService } from './connectors.service.js';
import { WebhookService } from './webhook.service.js';
import type { WebhookRequest } from './adapters/index.js';

@Controller('v1/connectors')
@UseGuards(AuthGuard)
export class ConnectorsController {
  constructor(
    private readonly connectors: ConnectorsService,
    private readonly webhooks: WebhookService,
  ) {}

  /** What every provider supports, before connecting. Static. */
  @Get('catalog')
  catalog() {
    return Object.values(CONNECTOR_CATALOG);
  }

  @Get()
  list(@Ctx() ctx: TenantContext) {
    return this.connectors.list(ctx);
  }

  @Post()
  create(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.connectors.create(ctx, body);
  }

  @Get(':id')
  get(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.connectors.get(ctx, id);
  }

  @Patch(':id')
  update(@Ctx() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.connectors.update(ctx, id, body);
  }

  @Put(':id/credentials')
  rotate(@Ctx() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.connectors.rotateCredentials(ctx, id, body);
  }

  @Post(':id/webhook-url')
  @HttpCode(200)
  rotateWebhook(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.connectors.rotateWebhookUrl(ctx, id);
  }

  @Post(':id/test')
  @HttpCode(200)
  test(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.connectors.test(ctx, id);
  }

  @Post(':id/simulate-inbound')
  @HttpCode(200)
  simulate(@Ctx() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.webhooks.simulateInbound(ctx, id, body);
  }

  @Delete(':id')
  remove(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.connectors.remove(ctx, id);
  }
}

/**
 * Public provider webhooks. No session: authenticity comes from each provider's signature,
 * verified over the exact bytes received (bootstrap keeps req.rawBody).
 */
@Controller('v1/connectors/webhooks')
export class ConnectorWebhooksController {
  constructor(private readonly webhooks: WebhookService) {}

  private async run(
    key: string,
    method: 'GET' | 'POST',
    req: Request & { rawBody?: Buffer },
    res: Response,
  ) {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers))
      if (typeof v === 'string') headers[k.toLowerCase()] = v;
    const query: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.query)) if (typeof v === 'string') query[k] = v;
    const raw: WebhookRequest = {
      method,
      headers,
      query,
      rawBody:
        req.rawBody ?? (typeof req.body === 'string' ? Buffer.from(req.body) : Buffer.alloc(0)),
    };
    const r = await this.webhooks.handle(key, raw);
    res.status(r.status);
    if (r.contentType === 'text/plain') res.type('text/plain').send(String(r.body ?? ''));
    else res.json(r.body ?? {});
  }

  @Post(':key')
  post(@Param('key') key: string, @Req() req: Request, @Res() res: Response) {
    return this.run(key, 'POST', req, res);
  }

  /** WeChat verifies the server URL with a GET carrying echostr. */
  @Get(':key')
  get(@Param('key') key: string, @Req() req: Request, @Res() res: Response) {
    return this.run(key, 'GET', req, res);
  }
}
