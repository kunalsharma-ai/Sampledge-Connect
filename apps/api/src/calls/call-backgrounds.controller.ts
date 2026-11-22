import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CALL_BACKGROUND_MAX_BYTES } from '@sampledge/contracts';
import { AuthGuard, Ctx } from '../auth/auth.guard.js';
import { readRawBody } from '../common/raw-body.js';
import type { TenantContext } from '../common/tenant-context.js';
import { CallBackgroundsService } from './call-backgrounds.service.js';

@Controller('v1')
export class CallBackgroundsController {
  constructor(private readonly backgrounds: CallBackgroundsService) {}

  /** My background in calls, my and the organization's images, the rules and the branding. */
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

  /** How I look on camera; saved to my account so every device uses it. */
  @Put('me/call-appearance')
  @UseGuards(AuthGuard)
  appearance(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.backgrounds.setAppearance(ctx, body);
  }

  /** Adds one of my own backgrounds (raw image/png, image/jpeg or image/webp body, 2 MB) and selects it. */
  @Post('me/call-backgrounds')
  @UseGuards(AuthGuard)
  async add(@Ctx() ctx: TenantContext, @Req() req: Request, @Query('name') name?: string) {
    return this.backgrounds.upload(ctx, await readRawBody(req, CALL_BACKGROUND_MAX_BYTES), name);
  }

  @Delete('me/call-backgrounds/:imageId')
  @UseGuards(AuthGuard)
  removeOne(@Ctx() ctx: TenantContext, @Param('imageId') imageId: string) {
    return this.backgrounds.removeImage(ctx, imageId);
  }

  /** Older single-image form: adds and selects (same as POST me/call-backgrounds). */
  @Put('me/call-background/image')
  @UseGuards(AuthGuard)
  async upload(@Ctx() ctx: TenantContext, @Req() req: Request, @Query('name') name?: string) {
    return this.backgrounds.upload(ctx, await readRawBody(req, CALL_BACKGROUND_MAX_BYTES), name);
  }

  /** Older single-image form: removes my most recent image. */
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

  /** Organization library: admins add backgrounds that everyone can pick. */
  @Post('admin/call-backgrounds/images')
  @UseGuards(AuthGuard)
  async addOrg(@Ctx() ctx: TenantContext, @Req() req: Request, @Query('name') name?: string) {
    return this.backgrounds.addOrganizationImage(
      ctx,
      await readRawBody(req, CALL_BACKGROUND_MAX_BYTES),
      name,
    );
  }

  @Delete('admin/call-backgrounds/images/:imageId')
  @UseGuards(AuthGuard)
  removeOrg(@Ctx() ctx: TenantContext, @Param('imageId') imageId: string) {
    return this.backgrounds.removeOrganizationImage(ctx, imageId);
  }

  /** A background image by its unguessable key (no session, so <img> and canvases load it). */
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
