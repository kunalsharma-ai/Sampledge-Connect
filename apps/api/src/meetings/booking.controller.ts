import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard, Ctx } from '../auth/auth.guard.js';
import type { TenantContext } from '../common/tenant-context.js';
import { RateLimitService } from '../redis/redis.module.js';
import { BookingService } from './booking.service.js';

/** Hosts manage their booking pages. */
@Controller('v1/booking-pages')
@UseGuards(AuthGuard)
export class BookingPagesController {
  constructor(private readonly booking: BookingService) {}

  @Get()
  list(@Ctx() ctx: TenantContext) {
    return this.booking.list(ctx);
  }

  @Post()
  create(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.booking.create(ctx, body);
  }

  @Patch(':id')
  update(@Ctx() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.booking.update(ctx, id, body);
  }

  @Delete(':id')
  remove(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.booking.remove(ctx, id);
  }
}

/** The public booking page (no account). Rate-limited per IP. */
@Controller('v1/book')
export class PublicBookingController {
  constructor(
    private readonly booking: BookingService,
    private readonly rateLimit: RateLimitService,
  ) {}

  private limit(req: Request) {
    return this.rateLimit.consume('guest_link', req.ip ?? 'unknown');
  }

  @Get(':slug')
  async view(@Param('slug') slug: string, @Req() req: Request) {
    await this.limit(req);
    return this.booking.view(slug);
  }

  @Get(':slug/slots')
  async slots(
    @Param('slug') slug: string,
    @Query() query: Record<string, string>,
    @Req() req: Request,
  ) {
    await this.limit(req);
    return this.booking.slots(slug, query);
  }

  @Post(':slug')
  async book(@Param('slug') slug: string, @Body() body: unknown, @Req() req: Request) {
    await this.limit(req);
    await this.rateLimit.consume('booking_create', req.ip ?? 'unknown');
    return this.booking.book(slug, body);
  }
}
