import {
  Body,
  Controller,
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
import { AuthGuard, Ctx } from '../auth/auth.guard.js';
import type { TenantContext } from '../common/tenant-context.js';
import { AttachmentsService, toAttachment } from './attachments.service.js';

@Controller('v1')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  /** Step 1: declare the file; returns an upload ticket. */
  @Post('uploads')
  @UseGuards(AuthGuard)
  create(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.attachments.createUpload(ctx, body);
  }

  /** Step 2: raw bytes (any Content-Type except application/json). */
  @Put('uploads/:id/content')
  @UseGuards(AuthGuard)
  put(@Ctx() ctx: TenantContext, @Param('id') id: string, @Req() req: Request) {
    return this.attachments.putContent(ctx, id, req);
  }

  /** Step 3: mark ready. Idempotent. */
  @Post('uploads/:id/complete')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  complete(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.attachments.complete(ctx, id);
  }

  @Get('attachments/:id')
  @UseGuards(AuthGuard)
  async meta(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return toAttachment(await this.attachments.get(ctx, id));
  }

  @Get('attachments/:id/url')
  @UseGuards(AuthGuard)
  url(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.attachments.signedUrl(ctx, id);
  }

  /** Signed download. Images, PDFs and plain text render inline; everything else downloads. */
  @Get('files/:tenantId/:id')
  async download(
    @Param('tenantId') tenantId: string,
    @Param('id') id: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ) {
    const f = await this.attachments.openSigned(tenantId, id, exp, sig);
    res.setHeader('Content-Type', f.inline ? f.mimeType : 'application/octet-stream');
    res.setHeader('Content-Length', String(f.size));
    res.setHeader(
      'Content-Disposition',
      `${f.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=600');
    f.stream.on('error', () => res.destroy());
    f.stream.pipe(res);
  }
}
