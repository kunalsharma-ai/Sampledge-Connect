import { Controller, Delete, Get, HttpCode, Param, Put, UseGuards } from '@nestjs/common';
import { AuthGuard, Ctx } from '../auth/auth.guard.js';
import type { TenantContext } from '../common/tenant-context.js';
import { BookmarksService } from './bookmarks.service.js';

@Controller('v1')
@UseGuards(AuthGuard)
export class BookmarksController {
  constructor(private readonly bookmarks: BookmarksService) {}

  @Get('bookmarks')
  list(@Ctx() ctx: TenantContext) {
    return this.bookmarks.list(ctx);
  }

  /** Save a message for later. Idempotent. */
  @Put('messages/:id/bookmark')
  add(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.bookmarks.add(ctx, id);
  }

  @Delete('messages/:id/bookmark')
  @HttpCode(204)
  remove(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.bookmarks.remove(ctx, id);
  }
}
