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
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { AuthGuard, Ctx } from '../auth/auth.guard.js';
import { MessagesService } from '../messages/messages.service.js';
import { ConversationsService } from './conversations.service.js';

@Controller('v1/conversations')
@UseGuards(AuthGuard)
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly messages: MessagesService,
  ) {}

  @Get()
  list(@Ctx() ctx: TenantContext) {
    return this.conversations.listReadable(ctx);
  }

  @Post()
  create(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.conversations.create(ctx, body);
  }

  @Get(':id')
  get(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.conversations.get(ctx, id);
  }

  @Post(':id/join')
  @HttpCode(200)
  join(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.conversations.join(ctx, id);
  }

  @Post(':id/members')
  @HttpCode(200)
  addMembers(@Ctx() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.conversations.addMembers(ctx, id, body);
  }

  @Delete(':id/members/:userId')
  @HttpCode(204)
  removeMember(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.conversations.removeMember(ctx, id, userId);
  }

  @Patch(':id')
  archive(@Ctx() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    const { archived } = parse(z.object({ archived: z.boolean() }), body);
    return this.conversations.archive(ctx, id, archived);
  }

  @Get(':id/messages')
  history(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Query() query: Record<string, string>,
  ) {
    return this.messages.history(ctx, id, query);
  }

  /** REST fallback for sending (same idempotent path as the `message:send` socket event). */
  @Post(':id/messages')
  @HttpCode(200)
  send(@Ctx() ctx: TenantContext, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.messages.send(ctx, { ...body, conversationId: id });
  }
}

@Controller('v1/messages')
@UseGuards(AuthGuard)
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Patch(':id')
  edit(@Ctx() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.messages.edit(ctx, id, body);
  }

  @Delete(':id')
  remove(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.messages.remove(ctx, id);
  }

  /** Add a reaction. Idempotent. The emoji is URL-encoded in the path. */
  @Put(':id/reactions/:emoji')
  addReaction(@Ctx() ctx: TenantContext, @Param('id') id: string, @Param('emoji') emoji: string) {
    return this.messages.react(ctx, { messageId: id, emoji, op: 'add' });
  }

  /** Remove the caller's reaction. Idempotent. */
  @Delete(':id/reactions/:emoji')
  removeReaction(
    @Ctx() ctx: TenantContext,
    @Param('id') id: string,
    @Param('emoji') emoji: string,
  ) {
    return this.messages.react(ctx, { messageId: id, emoji, op: 'remove' });
  }

  @Post('receipts')
  @HttpCode(200)
  receipt(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.messages.ackReceipt(ctx, body);
  }
}
