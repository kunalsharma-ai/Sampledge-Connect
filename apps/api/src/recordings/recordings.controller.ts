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
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard, Ctx } from '../auth/auth.guard.js';
import type { TenantContext } from '../common/tenant-context.js';
import { RecordingsService } from './recordings.service.js';

@Controller('v1')
export class RecordingsController {
  constructor(private readonly recordings: RecordingsService) {}

  /** Recordings in my conversations (filter by conversation or kind), newest first. */
  @Get('recordings')
  @UseGuards(AuthGuard)
  list(@Ctx() ctx: TenantContext, @Query() q: Record<string, string>) {
    return this.recordings.list(ctx, q);
  }

  /** Delete a recording (who recorded it, a conversation moderator, or an admin). */
  @Delete('recordings/:id')
  @UseGuards(AuthGuard)
  remove(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.recordings.remove(ctx, id);
  }

  @Get('admin/recording-settings')
  @UseGuards(AuthGuard)
  settings(@Ctx() ctx: TenantContext) {
    return this.recordings.getSettings(ctx);
  }

  @Put('admin/recording-settings')
  @UseGuards(AuthGuard)
  setSettings(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.recordings.setSettings(ctx, body);
  }

  /** Returns a signed link to a ZIP of recordings in a date range (admins). */
  @Post('admin/recordings/export')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  createExport(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.recordings.createExport(ctx, body);
  }

  /** The ZIP itself. Authenticated by the signature, so a browser can open it directly. */
  @Get('recordings/export/:tenantId')
  async export(
    @Param('tenantId') tenantId: string,
    @Query() q: Record<string, string>,
    @Res() res: Response,
  ) {
    const { fileName, stream } = await this.recordings.streamExport(tenantId, q);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }
}
