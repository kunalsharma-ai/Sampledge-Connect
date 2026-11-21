import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CreateWidgetSessionRequestSchema,
  EnsureRecordConversationRequestSchema,
  LinkIdentityRequestSchema,
  MODULE_CATALOG,
  PostRecordMessageRequestSchema,
  SIGNATURE_HEADER,
  type IdentityLink,
  type LinkedRecord,
  type ModuleEventResult,
  type WidgetSession,
} from '@sampledge/contracts';
import { MongoServerError } from 'mongodb';
import { z } from 'zod';
import { AppError, notFound, parse } from '../common/errors.js';
import { TenantDb } from '../database/tenant-db.js';
import { SessionService } from '../auth/session.service.js';
import { AuditService } from '../audit/audit.service.js';
import { RateLimitService } from '../redis/redis.module.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { toMessage } from '../messages/message.mapper.js';
import { WorkStore } from './collections.js';
import type { IdentityLinkDoc } from './docs.js';
import { ModuleEventsService } from './module-events.service.js';
import {
  ModuleCaller,
  ModuleKeyGuard,
  ModuleKeysService,
  RawBody,
  type ModulePrincipal,
} from './module-keys.service.js';
import { RecordsService, toLinkedRecord } from './records.service.js';
import { verifySignature } from './signing.js';

export const toIdentityLink = (l: IdentityLinkDoc): IdentityLink => ({
  module: l.module,
  externalUserId: l.externalUserId,
  userId: l.userId,
  email: l.email,
  matchedBy: l.matchedBy,
  createdAt: l.createdAt.toISOString(),
});

const RecordParams = z.object({
  type: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
  id: z.string().min(1).max(128),
});

/**
 * The API a Sampledge module's server calls (see docs/sdk.md). Authenticated with the module's
 * Connect API key; events must also carry a valid HMAC signature. Everything is scoped to the
 * key's tenant and module: a Samptrek key can only touch Samptrek records.
 */
@Controller('v1/integration')
@UseGuards(ModuleKeyGuard)
export class IntegrationApiController {
  constructor(
    private readonly keys: ModuleKeysService,
    private readonly events: ModuleEventsService,
    private readonly records: RecordsService,
    private readonly store: WorkStore,
    private readonly db: TenantDb,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly rateLimit: RateLimitService,
  ) {}

  private limit(p: ModulePrincipal) {
    return this.rateLimit.consume('module_api', `${p.tenantId}:${p.module}`);
  }

  /** GET /v1/integration/me: which tenant and module this key belongs to (connection check). */
  @Get('me')
  async me(@ModuleCaller() p: ModulePrincipal) {
    const tenant = await this.db.tenants.findOne({ _id: p.tenantId });
    return {
      module: p.module,
      moduleName: MODULE_CATALOG[p.module].name,
      tenantId: p.tenantId,
      tenantName: tenant?.name ?? null,
      signingSecretSet: !!(await this.keys.signingSecret(p)),
    };
  }

  /** POST /v1/integration/events: a signed module event. */
  @Post('events')
  @HttpCode(200)
  async event(
    @ModuleCaller() p: ModulePrincipal,
    @RawBody() raw: string,
    @Headers(SIGNATURE_HEADER) signature: string | undefined,
    @Body() body: unknown,
  ): Promise<ModuleEventResult> {
    await this.limit(p);
    const secret = await this.keys.signingSecret(p);
    if (!secret)
      throw new AppError('FORBIDDEN', 'No event signing secret is set for this module in Connect');
    const check = verifySignature(secret, raw, signature);
    if (check !== 'ok')
      throw new AppError(
        'UNAUTHENTICATED',
        check === 'stale'
          ? 'Signature timestamp is too old or in the future (check the clock)'
          : check === 'missing'
            ? 'Missing Sampledge-Signature header'
            : 'Signature does not match',
      );
    return this.events.receive(p.tenantId, p.module, body, 'module');
  }

  /** PUT /v1/integration/records: find or create the conversation for a record. */
  @Put('records')
  async ensure(@ModuleCaller() p: ModulePrincipal, @Body() body: unknown): Promise<LinkedRecord> {
    await this.limit(p);
    const req = parse(EnsureRecordConversationRequestSchema, body);
    const people = await this.records.resolvePeople(p.tenantId, p.module, req.members);
    const { record } = await this.records.ensureRecordConversation(p.tenantId, p.module, {
      record: req.record,
      parent: req.parent,
      target: req.parent ? 'parent' : 'record',
      memberIds: people.userIds,
      topic: req.topic,
    });
    return toLinkedRecord(record);
  }

  @Get('records/:type/:id')
  async getRecord(
    @ModuleCaller() p: ModulePrincipal,
    @Param() params: unknown,
  ): Promise<LinkedRecord> {
    const { type, id } = parse(RecordParams, params);
    const r = await this.records.findRecord(p.tenantId, p.module, type, id);
    if (!r) throw notFound('Record');
    return toLinkedRecord(r);
  }

  /** Recent messages of a record's conversation, newest first (for "linked conversation history"). */
  @Get('records/:type/:id/messages')
  async history(
    @ModuleCaller() p: ModulePrincipal,
    @Param() params: unknown,
    @Query('limit') limitRaw?: string,
  ) {
    await this.limit(p);
    const { type, id } = parse(RecordParams, params);
    const r = await this.records.findRecord(p.tenantId, p.module, type, id);
    if (!r?.conversationId) throw notFound('Record');
    const limit = Math.min(Math.max(Number(limitRaw) || 50, 1), 200);
    const rows = await this.db
      .for(p.tenantId)
      .messages.find(
        { conversationId: r.conversationId, deletedAt: null },
        { sort: { serverSequence: -1 }, limit },
      )
      .toArray();
    return { record: toLinkedRecord(r), messages: rows.map(toMessage) };
  }

  /** Post a message into a record's conversation as the module, optionally notifying people. */
  @Post('records/:type/:id/messages')
  async post(@ModuleCaller() p: ModulePrincipal, @Param() params: unknown, @Body() body: unknown) {
    await this.limit(p);
    const { type, id } = parse(RecordParams, params);
    const req = parse(PostRecordMessageRequestSchema, body);
    const r = await this.records.findRecord(p.tenantId, p.module, type, id);
    if (!r?.conversationId) throw notFound('Record');
    const w = this.store.for(p.tenantId);
    const eventId = `message:${req.idempotencyKey}`;
    try {
      await w.integration_events.insertOne({
        module: p.module,
        eventId,
        type: 'message.posted',
        recordType: type,
        recordId: id,
        recordTitle: r.title,
        source: 'module',
        status: 'processed',
        actions: [],
        conversationId: r.conversationId,
        messageId: null,
        taskId: null,
        approvalId: null,
        unmatchedPeople: [],
        error: null,
        receivedAt: new Date(),
      });
    } catch (e) {
      if (e instanceof MongoServerError && e.code === 11000) {
        const prior = await w.integration_events.findOne({ module: p.module, eventId });
        return {
          duplicate: true,
          conversationId: r.conversationId,
          messageId: prior?.messageId ?? null,
        };
      }
      throw e;
    }
    const people = await this.records.resolvePeople(p.tenantId, p.module, req.notify);
    if (people.userIds.length)
      await this.records.addMembers(p.tenantId, p.module, r.conversationId, people.userIds);
    const msg = await this.records.postCard(p.tenantId, p.module, r.conversationId, req.text, {
      moduleMessage: { module: p.module, recordType: type, recordId: id },
    });
    await w.integration_events.updateOne(
      { module: p.module, eventId },
      {
        $set: {
          messageId: msg._id,
          actions: ['message.posted'],
          unmatchedPeople: people.unmatched,
        },
      },
    );
    if (people.userIds.length)
      await this.notifications.notifyAbout(
        p.tenantId,
        msg,
        people.userIds,
        'alert',
        MODULE_CATALOG[p.module].name,
      );
    return {
      duplicate: false,
      conversationId: r.conversationId,
      messageId: msg._id,
      unmatchedPeople: people.unmatched,
    };
  }

  /** PUT /v1/integration/identities: link a module user id to a Connect user. */
  @Put('identities')
  async link(@ModuleCaller() p: ModulePrincipal, @Body() body: unknown): Promise<IdentityLink> {
    await this.limit(p);
    const req = parse(LinkIdentityRequestSchema, body);
    const t = this.db.for(p.tenantId);
    const user = req.userId
      ? await t.users.findOne({ _id: req.userId, status: 'active' })
      : await t.users.findOne({ email: req.email!, status: 'active' });
    if (!user) throw notFound('Connect user');
    const l = await this.records.saveLink(
      p.tenantId,
      p.module,
      req.externalUserId,
      user._id,
      user.email,
      req.userId ? 'manual' : 'email',
    );
    return toIdentityLink(l);
  }

  @Get('identities/:externalUserId')
  async identity(@ModuleCaller() p: ModulePrincipal, @Param('externalUserId') ext: string) {
    const l = await this.store
      .for(p.tenantId)
      .identity_links.findOne({ module: p.module, externalUserId: String(ext).slice(0, 128) });
    if (!l) throw notFound('Identity link');
    return toIdentityLink(l);
  }

  /**
   * POST /v1/integration/widget-sessions: shared sign-on for the embedded chat widget. The
   * module's server vouches for its signed-in user; Connect issues a normal device session for
   * the matching Connect user (listed under their devices, revocable like any other).
   */
  @Post('widget-sessions')
  async widget(@ModuleCaller() p: ModulePrincipal, @Body() body: unknown): Promise<WidgetSession> {
    await this.limit(p);
    const req = parse(CreateWidgetSessionRequestSchema, body);
    const people = await this.records.resolvePeople(p.tenantId, p.module, [req.user]);
    const userId = people.userIds[0];
    if (!userId) throw notFound('Connect user for this person');
    const t = this.db.for(p.tenantId);
    const membership = await t.memberships.findOne({ userId });
    if (!membership) throw notFound('Connect user for this person');
    let conversationId: string | null = null;
    if (req.record) {
      const { record } = await this.records.ensureRecordConversation(p.tenantId, p.module, {
        record: req.record,
        target: 'record',
        memberIds: [userId],
      });
      conversationId = record.conversationId;
    }
    const deviceId = randomUUID();
    const tokens = await this.sessions.create({
      tenantId: p.tenantId,
      userId,
      role: membership.role,
      device: {
        deviceId,
        name: req.deviceName ?? `${MODULE_CATALOG[p.module].name} chat widget`,
        platform: 'web',
      },
    });
    await this.audit.record({
      tenantId: p.tenantId,
      actorId: userId,
      action: 'integration.widget_session',
      target: { type: 'integration', id: p.module },
      metadata: { sessionId: tokens.sessionId, conversationId },
    });
    return { ...tokens, deviceId, userId, tenantId: p.tenantId, conversationId };
  }
}
