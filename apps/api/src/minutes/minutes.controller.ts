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
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard, Ctx } from '../auth/auth.guard.js';
import type { TenantContext } from '../common/tenant-context.js';
import { MinutesService, type RenderedFile } from './minutes.service.js';

function send(res: Response, f: RenderedFile) {
  res.setHeader('Content-Type', f.mimeType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
  );
  res.setHeader('Content-Length', String(f.body.length));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.end(f.body);
}

/** Minutes of meeting and chat export (docs/minutes.md). */
@Controller('v1')
@UseGuards(AuthGuard)
export class MinutesController {
  constructor(private readonly minutes: MinutesService) {}

  @Get('minutes/config')
  config(@Ctx() ctx: TenantContext) {
    return this.minutes.config(ctx);
  }

  @Get('admin/minutes-settings')
  settings(@Ctx() ctx: TenantContext) {
    return this.minutes.getSettings(ctx);
  }

  @Put('admin/minutes-settings')
  setSettings(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.minutes.setSettings(ctx, body);
  }

  @Get('calls/:callId/minutes')
  forCall(@Ctx() ctx: TenantContext, @Param('callId') callId: string) {
    return this.minutes.forCall(ctx, callId);
  }

  /** Make the draft (or write it again with `regenerate`). */
  @Post('calls/:callId/minutes')
  @HttpCode(200)
  generate(@Ctx() ctx: TenantContext, @Param('callId') callId: string, @Body() body: unknown) {
    return this.minutes.generate(ctx, callId, body);
  }

  @Get('minutes')
  list(@Ctx() ctx: TenantContext, @Query() q: Record<string, string>) {
    return this.minutes.list(ctx, q);
  }

  @Get('minutes/:id')
  get(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.minutes.get(ctx, id);
  }

  @Patch('minutes/:id')
  update(@Ctx() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.minutes.update(ctx, id, body);
  }

  @Post('minutes/:id/share')
  @HttpCode(200)
  share(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.minutes.share(ctx, id);
  }

  @Delete('minutes/:id')
  remove(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.minutes.remove(ctx, id);
  }

  /** PDF or Word in the chosen template: ?format=pdf|docx&template=&transcript=1&tz= */
  @Get('minutes/:id/document')
  async document(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Query() q: Record<string, string>,
    @Res() res: Response,
  ) {
    send(res, await this.minutes.document(ctx, id, q));
  }

  @Get('conversations/:id/export')
  exportAccess(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.minutes.exportAccess(ctx, id);
  }

  /** The export file is the response body (PDF, Word or text). */
  @Post('conversations/:id/export')
  @HttpCode(200)
  async exportChat(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() res: Response,
  ) {
    send(res, await this.minutes.exportChat(ctx, id, body));
  }
}
