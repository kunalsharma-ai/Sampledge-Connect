import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard, Ctx } from '../auth/auth.guard.js';
import type { TenantContext } from '../common/tenant-context.js';
import { SearchService } from './search.service.js';

@Controller('v1/search')
@UseGuards(AuthGuard)
export class SearchController {
  constructor(private readonly search: SearchService) {}

  /** Universal Search across everything the caller can open. */
  @Get()
  run(@Ctx() ctx: TenantContext, @Query() query: Record<string, string>) {
    return this.search.search(ctx, query);
  }

  @Get('recent')
  recent(@Ctx() ctx: TenantContext) {
    return this.search.recent(ctx);
  }

  /** Replace your recent searches (idempotent). Every device of yours gets `search:recent`. */
  @Put('recent')
  setRecent(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.search.setRecent(ctx, body);
  }
}
