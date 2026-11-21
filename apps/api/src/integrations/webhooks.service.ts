import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  CreateWebhookSubscriptionRequestSchema,
  type SampledgeModule,
  type WebhookDelivery,
  type WebhookEnvelope,
  type WebhookEventType,
  type WebhookSubscription,
} from '@sampledge/contracts';
import { newId } from '../database/tenant-db.js';
import { AppError, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { AuditService } from '../audit/audit.service.js';
import type { MessageDoc } from '../database/documents.js';
import { decryptSecret, encryptSecret } from '../integration-settings/cipher.js';
import { toMessage } from '../messages/message.mapper.js';
import { WorkStore } from './collections.js';
import type { WebhookDeliveryDoc, WebhookSubscriptionDoc } from './docs.js';
import { newSecret, signPayload } from './signing.js';

/** Retry schedule after a failed attempt; after the last one the delivery is dead. */
export const WEBHOOK_BACKOFF_MS = [10_000, 60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 6 * 3600_000];
const MAX_SUBSCRIPTIONS = 25;

const toSubscription = (s: WebhookSubscriptionDoc): WebhookSubscription => ({
  subscriptionId: s._id,
  url: s.url,
  description: s.description,
  events: s.events,
  modules: s.modules,
  active: s.active,
  createdAt: s.createdAt.toISOString(),
  lastDeliveryAt: s.lastDeliveryAt?.toISOString() ?? null,
  lastDeliveryStatus: s.lastDeliveryStatus,
});

const toDelivery = (d: WebhookDeliveryDoc): WebhookDelivery => ({
  deliveryId: d._id,
  subscriptionId: d.subscriptionId,
  event: d.event,
  status: d.status,
  attempts: d.attempts,
  lastStatusCode: d.lastStatusCode,
  lastError: d.lastError,
  nextAttemptAt: d.nextAttemptAt?.toISOString() ?? null,
  createdAt: d.createdAt.toISOString(),
});

/**
 * Outbound webhooks. Each event becomes one delivery row per matching subscription in MongoDB
 * (a durable outbox), so a crash or a slow subscriber never loses an event. A worker on every
 * API node claims due rows with a lease and retries with backoff until delivered or dead.
 */
@Injectable()
export class WebhooksService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Webhooks');
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** Tenants with message.created subscribers, cached briefly so plain chat stays cheap. */
  private messageSubs = new Map<string, { at: number; has: boolean }>();

  constructor(
    private readonly store: WorkStore,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), 2000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /* ---------- subscriptions (integrations.manage) ---------- */

  async list(ctx: TenantContext): Promise<WebhookSubscription[]> {
    const rows = await this.store
      .for(ctx.tenantId)
      .webhook_subscriptions.find({}, { sort: { createdAt: -1 } })
      .toArray();
    return rows.map(toSubscription);
  }

  async create(ctx: TenantContext, body: unknown) {
    const req = parse(CreateWebhookSubscriptionRequestSchema, body);
    const w = this.store.for(ctx.tenantId);
    if ((await w.webhook_subscriptions.countDocuments({})) >= MAX_SUBSCRIPTIONS)
      throw new AppError('VALIDATION_FAILED', `At most ${MAX_SUBSCRIPTIONS} webhook subscriptions`);
    const signingSecret = newSecret('whsec');
    const doc = await w.webhook_subscriptions.insertOne({
      url: req.url,
      description: req.description,
      events: [...new Set(req.events)],
      modules: [...new Set(req.modules)],
      secretEnc: encryptSecret(signingSecret),
      active: true,
      createdBy: ctx.userId,
      createdAt: new Date(),
      lastDeliveryAt: null,
      lastDeliveryStatus: null,
    });
    this.messageSubs.delete(ctx.tenantId);
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'webhook.created',
      target: { type: 'webhook', id: doc._id },
      metadata: { url: req.url, events: doc.events },
    });
    return { ...toSubscription(doc), signingSecret };
  }

  async setActive(ctx: TenantContext, id: string, active: boolean) {
    const w = this.store.for(ctx.tenantId);
    const doc = await w.webhook_subscriptions.findOneAndUpdate(
      { _id: id },
      { $set: { active } },
      { returnDocument: 'after' },
    );
    if (!doc) throw notFound('Webhook');
    this.messageSubs.delete(ctx.tenantId);
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: active ? 'webhook.enabled' : 'webhook.disabled',
      target: { type: 'webhook', id },
    });
    return toSubscription(doc);
  }

  async remove(ctx: TenantContext, id: string) {
    const w = this.store.for(ctx.tenantId);
    const r = await w.webhook_subscriptions.deleteMany({ _id: id });
    if (!r.deletedCount) throw notFound('Webhook');
    await w.webhook_deliveries.deleteMany({ subscriptionId: id, status: { $in: ['pending', 'failed'] } });
    this.messageSubs.delete(ctx.tenantId);
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'webhook.deleted',
      target: { type: 'webhook', id },
    });
  }

  async deliveries(ctx: TenantContext, id: string): Promise<WebhookDelivery[]> {
    const rows = await this.store
      .for(ctx.tenantId)
      .webhook_deliveries.find({ subscriptionId: id }, { sort: { _id: -1 }, limit: 50 })
      .toArray();
    return rows.map(toDelivery);
  }

  /** Sends a `ping`-style task.updated sample to one subscription, through the normal outbox. */
  async sendTest(ctx: TenantContext, id: string) {
    const w = this.store.for(ctx.tenantId);
    const sub = await w.webhook_subscriptions.findOne({ _id: id });
    if (!sub) throw notFound('Webhook');
    const env = this.envelope(ctx.tenantId, sub.events[0]!, {
      test: true,
      message: 'Test delivery from Sampledge Connect',
    });
    const d = await this.enqueueOne(ctx.tenantId, sub, env);
    void this.tick();
    return toDelivery(d);
  }

  /* ---------- emitting ---------- */

  private envelope<T>(tenantId: string, type: WebhookEventType, data: T): WebhookEnvelope<T> {
    return { id: `evt_${newId()}`, type, tenantId, createdAt: new Date().toISOString(), data };
  }

  private async enqueueOne(tenantId: string, sub: WebhookSubscriptionDoc, env: WebhookEnvelope) {
    return this.store.for(tenantId).webhook_deliveries.insertOne({
      subscriptionId: sub._id,
      event: env.type as WebhookEventType,
      eventId: env.id,
      body: JSON.stringify(env),
      status: 'pending',
      attempts: 0,
      lastStatusCode: null,
      lastError: null,
      nextAttemptAt: new Date(),
      lockedUntil: null,
      createdAt: new Date(),
    });
  }

  /** Queues `type` for every active subscription that wants it. Never throws to the caller. */
  async emit(
    tenantId: string,
    type: WebhookEventType,
    data: unknown,
    module: SampledgeModule | null,
  ): Promise<void> {
    try {
      const subs = await this.store
        .for(tenantId)
        .webhook_subscriptions.find({ active: true, events: type })
        .toArray();
      const matching = subs.filter(
        (s) => s.modules.length === 0 || (module !== null && s.modules.includes(module)),
      );
      if (!matching.length) return;
      const env = this.envelope(tenantId, type, data);
      for (const s of matching) await this.enqueueOne(tenantId, s, env);
      void this.tick();
    } catch (e) {
      this.log.warn(`webhook enqueue failed (${type}): ${(e as Error).message}`);
    }
  }

  /** message.created is sent only for conversations linked to a module record. */
  async onMessageCreated(tenantId: string, message: MessageDoc): Promise<void> {
    const cached = this.messageSubs.get(tenantId);
    let has = cached && Date.now() - cached.at < 30_000 ? cached.has : undefined;
    if (has === undefined) {
      has =
        (await this.store
          .for(tenantId)
          .webhook_subscriptions.countDocuments({ active: true, events: 'message.created' })) > 0;
      this.messageSubs.set(tenantId, { at: Date.now(), has });
    }
    if (!has) return;
    const record = await this.store
      .for(tenantId)
      .linked_records.findOne({ conversationId: message.conversationId, channelKey: null });
    if (!record) return;
    await this.emit(
      tenantId,
      'message.created',
      {
        message: toMessage(message),
        record: {
          module: record.module,
          recordType: record.recordType,
          externalId: record.externalId,
          title: record.title,
        },
      },
      record.module,
    );
  }

  /* ---------- delivery worker ---------- */

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let i = 0; i < 20; i++) {
        const now = new Date();
        const claimed = await this.store.deliveriesGlobal.findOneAndUpdate(
          {
            status: { $in: ['pending', 'failed'] },
            nextAttemptAt: { $lte: now },
            $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }],
          },
          { $set: { lockedUntil: new Date(now.getTime() + 30_000) } },
          { sort: { nextAttemptAt: 1 }, returnDocument: 'after' },
        );
        if (!claimed) break;
        await this.attempt(claimed);
      }
    } catch (e) {
      this.log.warn(`webhook worker: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async attempt(d: WebhookDeliveryDoc) {
    const w = this.store.for(d.tenantId);
    const sub = await w.webhook_subscriptions.findOne({ _id: d.subscriptionId });
    if (!sub || !sub.active) {
      await w.webhook_deliveries.updateOne(
        { _id: d._id },
        { $set: { status: 'dead', lastError: 'Subscription removed or disabled', lockedUntil: null, nextAttemptAt: null } },
      );
      return;
    }
    let statusCode: number | null = null;
    let error: string | null = null;
    try {
      const res = await fetch(sub.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'SampledgeConnect-Webhooks/1',
          'sampledge-signature': signPayload(decryptSecret(sub.secretEnc), d.body),
          'sampledge-event': d.event,
          'sampledge-delivery': d._id,
        },
        body: d.body,
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      statusCode = res.status;
      if (!res.ok) error = `HTTP ${res.status}`;
      await res.body?.cancel().catch(() => {});
    } catch (e) {
      error = (e as Error).message.slice(0, 300);
    }
    const attempts = d.attempts + 1;
    const now = new Date();
    if (!error) {
      await w.webhook_deliveries.updateOne(
        { _id: d._id },
        { $set: { status: 'delivered', attempts, lastStatusCode: statusCode, lastError: null, lockedUntil: null, nextAttemptAt: null } },
      );
      await w.webhook_subscriptions.updateOne(
        { _id: sub._id },
        { $set: { lastDeliveryAt: now, lastDeliveryStatus: 'delivered' } },
      );
      return;
    }
    const delay = WEBHOOK_BACKOFF_MS[attempts - 1];
    const dead = delay === undefined;
    await w.webhook_deliveries.updateOne(
      { _id: d._id },
      {
        $set: {
          status: dead ? 'dead' : 'failed',
          attempts,
          lastStatusCode: statusCode,
          lastError: error,
          lockedUntil: null,
          nextAttemptAt: dead ? null : new Date(now.getTime() + delay! * (0.8 + Math.random() * 0.4)),
        },
      },
    );
    await w.webhook_subscriptions.updateOne(
      { _id: sub._id },
      { $set: { lastDeliveryAt: now, lastDeliveryStatus: dead ? 'dead' : 'failed' } },
    );
  }
}
