import { Injectable, Logger } from '@nestjs/common';
import { CONNECTOR_CATALOG, SimulateInboundRequestSchema, tenantCan } from '@sampledge/contracts';
import { forbidden, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { TenantDb } from '../database/tenant-db.js';
import { AuditService } from '../audit/audit.service.js';
import { RateLimitService } from '../redis/redis.module.js';
import { AppError } from '../common/errors.js';
import { InboxService } from '../client-inbox/inbox.service.js';
import { ADAPTERS, WebhookRejected, type WebhookRequest } from './adapters/index.js';
import { ConnectorsService, missingCredentials } from './connectors.service.js';

export interface WebhookResult {
  status: number;
  body: unknown;
  contentType?: string;
  conversationIds: string[];
}

/**
 * Inbound path for every provider: find the connector by its unguessable webhook key, verify
 * the provider's signature over the exact bytes, normalize, and hand messages to the inbox.
 * It does only database work, so a provider storm cannot slow internal chat.
 */
@Injectable()
export class WebhookService {
  private readonly log = new Logger('Webhooks');
  constructor(
    private readonly db: TenantDb,
    private readonly connectors: ConnectorsService,
    private readonly inbox: InboxService,
    private readonly audit: AuditService,
    private readonly limits: RateLimitService,
  ) {}

  async handle(webhookKey: string, req: WebhookRequest): Promise<WebhookResult> {
    const doc = await this.db.unscoped.connectors.findOne({ webhookKey, deletedAt: null });
    const adapter = doc ? ADAPTERS[doc.provider] : null;
    if (
      !doc ||
      !adapter?.verifyWebhook ||
      !adapter.parseWebhook ||
      CONNECTOR_CATALOG[doc.provider].mode === 'handoff'
    )
      return { status: 404, body: { error: 'Unknown webhook' }, conversationIds: [] };
    if (req.method === 'GET' && doc.provider !== 'wechat')
      return { status: 405, body: { error: 'POST only' }, conversationIds: [] };
    try {
      await this.limits.consume('connector_webhook', doc._id);
    } catch (e) {
      if (e instanceof AppError)
        return { status: 429, body: { error: 'Rate limited' }, conversationIds: [] };
      throw e;
    }
    if (missingCredentials(doc).length)
      return { status: 503, body: { error: 'Connector is not configured' }, conversationIds: [] };

    const current = this.connectors.credentials(doc);
    let creds = current;
    try {
      await adapter.verifyWebhook(req, current);
    } catch (e) {
      const previous = this.connectors.previousCredentials(doc);
      let ok = false;
      if (previous && e instanceof WebhookRejected) {
        try {
          await adapter.verifyWebhook(req, previous);
          creds = previous;
          ok = true;
        } catch {
          ok = false;
        }
      }
      if (!ok) {
        await this.db
          .for(doc.tenantId)
          .connectors.updateOne({ _id: doc._id }, { $inc: { 'health.rejectedWebhooks': 1 } });
        await this.audit.record({
          tenantId: doc.tenantId,
          actorId: null,
          action: 'connector.webhook_rejected',
          target: { type: 'connector', id: doc._id },
          ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          metadata: { reason: (e as Error).message.slice(0, 200) },
        });
        return {
          status: 401,
          body: { error: 'Signature verification failed' },
          conversationIds: [],
        };
      }
    }

    let parsed;
    try {
      parsed = adapter.parseWebhook(req, creds);
    } catch (e) {
      if (e instanceof WebhookRejected)
        return { status: 400, body: { error: e.message }, conversationIds: [] };
      throw e;
    }
    const ok = parsed.response ?? { status: 200, body: { ok: true } };
    // A paused connector acknowledges (so the provider stops retrying) but stores nothing.
    if (doc.status === 'paused') return { ...ok, conversationIds: [] };

    const conversationIds: string[] = [];
    for (const m of parsed.messages) {
      const id = await this.inbox.ingest(doc, m);
      if (id) conversationIds.push(id);
    }
    if (parsed.messages.length)
      await this.db
        .for(doc.tenantId)
        .connectors.updateOne({ _id: doc._id }, { $set: { 'health.lastInboundAt': new Date() } });
    return { status: ok.status, body: ok.body, contentType: ok.contentType, conversationIds };
  }

  /** Test mode: build the provider's own signed webhook and run it through the real inbound path. */
  async simulateInbound(ctx: TenantContext, id: string, input: unknown) {
    if (!tenantCan(ctx, 'connectors.manage')) throw forbidden('Only admins can manage connectors');
    const req = parse(SimulateInboundRequestSchema, input);
    const doc = await this.connectors.find(ctx.tenantId, id);
    if (doc.environment !== 'test')
      throw new AppError('VALIDATION_FAILED', 'Simulated messages are only allowed in test mode');
    const adapter = ADAPTERS[doc.provider];
    if (!adapter.buildTestWebhook)
      throw new AppError(
        'VALIDATION_FAILED',
        'This is a handoff channel. Log client messages from the conversation instead.',
      );
    const wh = await adapter.buildTestWebhook(
      {
        fromName: req.fromName,
        fromHandle: req.fromHandle,
        text: req.text,
        threadId: req.threadId ?? '',
        email: req.email,
      },
      this.connectors.credentials(doc),
      `/v1/connectors/webhooks/${doc.webhookKey}`,
    );
    const result = await this.handle(doc.webhookKey, wh);
    return { accepted: result.status < 400, conversationIds: result.conversationIds };
  }
}
