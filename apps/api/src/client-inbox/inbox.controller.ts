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
import { AuthGuard, Ctx } from '../auth/auth.guard.js';
import type { TenantContext } from '../common/tenant-context.js';
import { InboxService } from './inbox.service.js';
import { InboxAdminService } from './inbox-admin.service.js';

@Controller('v1/inbox')
@UseGuards(AuthGuard)
export class InboxController {
  constructor(
    private readonly inbox: InboxService,
    private readonly admin: InboxAdminService,
  ) {}

  @Get('conversations')
  list(@Ctx() ctx: TenantContext, @Query() q: Record<string, string>) {
    return this.inbox.list(ctx, q);
  }

  /** Handoff channels only: start a conversation the client began in their own app. */
  @Post('conversations')
  create(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.inbox.createHandoffConversation(ctx, body);
  }

  @Get('conversations/:id')
  detail(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.inbox.detail(ctx, id);
  }

  @Patch('conversations/:id')
  update(@Ctx() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.inbox.update(ctx, id, body);
  }

  /** A reply to the client. Goes to the provider through the outbound queue. */
  @Post('conversations/:id/replies')
  reply(@Ctx() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.inbox.reply(ctx, id, body);
  }

  @Post('conversations/:id/replies/:messageId/retry')
  @HttpCode(200)
  retry(@Ctx() ctx: TenantContext, @Param('id') id: string, @Param('messageId') messageId: string) {
    return this.inbox.retry(ctx, id, messageId);
  }

  /** An internal note. Stored separately and never sent to the client. */
  @Post('conversations/:id/notes')
  note(@Ctx() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.inbox.addNote(ctx, id, body);
  }

  @Post('conversations/:id/escalate')
  @HttpCode(200)
  escalate(@Ctx() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.inbox.escalate(ctx, id, body);
  }

  @Post('conversations/:id/links')
  link(@Ctx() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.inbox.addLink(ctx, id, body);
  }

  @Delete('conversations/:id/links/:linkId')
  unlink(@Ctx() ctx: TenantContext, @Param('id') id: string, @Param('linkId') linkId: string) {
    return this.inbox.removeLink(ctx, id, linkId);
  }

  @Post('conversations/:id/log-inbound')
  @HttpCode(200)
  logInbound(@Ctx() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.inbox.logInbound(ctx, id, body);
  }

  @Get('clients')
  clients(@Ctx() ctx: TenantContext, @Query('q') q = '') {
    return this.admin.searchClients(ctx, q);
  }

  @Get('clients/:id')
  client(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.admin.client(ctx, id);
  }

  @Patch('clients/:id')
  updateClient(@Ctx() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.admin.updateClient(ctx, id, body);
  }

  @Post('clients/:id/merge')
  @HttpCode(200)
  merge(@Ctx() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.admin.mergeClient(ctx, id, body);
  }

  @Get('templates')
  templates(@Ctx() ctx: TenantContext) {
    return this.admin.templates(ctx);
  }

  @Post('templates')
  createTemplate(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.admin.upsertTemplate(ctx, null, body);
  }

  @Put('templates/:id')
  updateTemplate(@Ctx() ctx: TenantContext, @Param('id') id: string, @Body() body: unknown) {
    return this.admin.upsertTemplate(ctx, id, body);
  }

  @Delete('templates/:id')
  deleteTemplate(@Ctx() ctx: TenantContext, @Param('id') id: string) {
    return this.admin.deleteTemplate(ctx, id);
  }

  @Get('settings')
  settings(@Ctx() ctx: TenantContext) {
    return this.admin.getSettings(ctx);
  }

  @Put('settings')
  setSettings(@Ctx() ctx: TenantContext, @Body() body: unknown) {
    return this.admin.setSettings(ctx, body);
  }

  @Get('analytics')
  analytics(@Ctx() ctx: TenantContext, @Query('days') days = '7') {
    return this.admin.analytics(ctx, Number(days) || 7);
  }
}
