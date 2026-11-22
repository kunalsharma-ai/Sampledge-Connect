import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthGuard, Ctx } from '../auth/auth.guard.js';
import type { TenantContext } from '../common/tenant-context.js';
import { CALL_BACKGROUND_MAX_BYTES } from '@sampledge/contracts';
import { readRawBody } from '../common/raw-body.js';
import { CallBackgroundsService } from './call-backgrounds.service.js';

@Controller('v1')
export class CallBackgroundsController {
  constructor(private readonly backgrounds: CallBackgroundsService) {}

  /** My background in calls, the organization rules and the branding for the logo background. */
  @Get('me/call-background')
  @UseGuards(AuthGuard)
  get(@Ctx() ctx: TenantContext) {
    return this.backgrounds.state(ctx);
  }

  @Put('me/call-background')
  @UseGuards(AuthGuard)
  choose(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.backgrounds.choose(ctx, body);
  }

  /** My own image (raw image/png, image/jpeg or image/webp body, up to 2 MB). */
  @Put('me/call-background/image')
  @UseGuards(AuthGuard)
  async upload(@Ctx() ctx: TenantContext, @Req() req: Request) {
    return this.backgrounds.upload(ctx, await readRawBody(req, CALL_BACKGROUND_MAX_BYTES));
  }

  @Delete('me/call-background/image')
  @UseGuards(AuthGuard)
  remove(@Ctx() ctx: TenantContext) {
    return this.backgrounds.removeImage(ctx);
  }

  @Put('admin/call-backgrounds')
  @UseGuards(AuthGuard)
  setPolicy(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.backgrounds.setPolicy(ctx, body);
  }

  /** A personal background image, by its unguessable key (no session, so <img> and canvases load it). */
  @Get('call-backgrounds/:tenantId/:key')
  @HttpCode(200)
  async image(
    @Param('tenantId') tenantId: string,
    @Param('key') key: string,
    @Res() res: Response,
  ) {
    const { mimeType, data } = await this.backgrounds.image(tenantId, key);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', String(data.length));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(data);
  }
}
