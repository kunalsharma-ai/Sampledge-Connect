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

  /**
   * Signed download. Images, PDFs, plain text, audio and video render inline; everything else
   * downloads. `download=1` forces a download (backups). Supports single byte ranges so audio
   * and video can seek (Safari requires it).
   */
  @Get('files/:tenantId/:id')
  async download(
    @Param('tenantId') tenantId: string,
    @Param('id') id: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Query('download') download: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const f = await this.attachments.openSigned(tenantId, id, exp, sig);
    const size = f.size;
    let range: { start: number; end: number } | undefined;
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (m && (m[1] || m[2])) {
      const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
      const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      if (start > end || start >= size) {
        res.status(416).setHeader('Content-Range', `bytes */${size}`).end();
        return;
      }
      range = { start, end };
    }
    const inline = f.inline && download !== '1';
    res.setHeader('Content-Type', f.inline ? f.mimeType : 'application/octet-stream');
    res.setHeader('Accept-Ranges', 'bytes');
    if (range) {
      res.status(206);
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
      res.setHeader('Content-Length', String(range.end - range.start + 1));
    } else {
      res.setHeader('Content-Length', String(size));
    }
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=600');
    const stream = f.open(range);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }
}
