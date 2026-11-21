import {
  Inject,
  Injectable,
  Logger,
  forwardRef,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import { CONNECTOR_CATALOG, backoffDelay } from '@sampledge/contracts';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { REDIS } from '../redis/redis.module.js';
import { TenantDb } from '../database/tenant-db.js';
import type { ConnectorDoc, ExternalMessageDoc } from '../database/documents.js';
import { ADAPTERS, ProviderError } from '../connectors/adapters/index.js';
import { ConnectorsService } from '../connectors/connectors.service.js';
import { ConnectorHttp, type SandboxTransport } from '../connectors/transport.js';
import { InboxAccess } from './inbox-events.js';
import { InboxService } from './inbox.service.js';

export const MAX_ATTEMPTS = 8;
const LEASE_MS = 30_000;
const CIRCUIT_THRESHOLD = 5;
const CIRCUIT_OPEN_MS = 60_000;
const TICK_MS = 1000;
const SWEEP_MS = 30_000;

/**
 * Sends queued replies to providers. Replies are durable rows in external_messages, claimed
 * with a lease so a crashed worker's work is picked up again. A provider that is slow, down or
 * rate-limiting only delays its own queue: per-connector rate limits and a circuit breaker
 * keep one bad provider from starving the others, and internal chat never touches this path.
 */
@Injectable()
export class OutboundWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger('ConnectorWorker');
  private timer: NodeJS.Timeout | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
  private running = false;
  private again = false;
  /** Per-connector send timestamps (token bucket over one second). */
  private readonly recent = new Map<string, number[]>();

  constructor(
    private readonly db: TenantDb,
    @Inject(forwardRef(() => ConnectorsService)) private readonly connectors: ConnectorsService,
    private readonly http: ConnectorHttp,
    private readonly access: InboxAccess,
    @Inject(forwardRef(() => InboxService)) private readonly inbox: InboxService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => this.poke(), TICK_MS);
    this.timer.unref();
    const sweep = async () => {
      const ok = await this.redis.set('lock:inbox:sla-sweep', '1', 'PX', SWEEP_MS - 1000, 'NX');
      if (ok === 'OK') await this.inbox.sweep();
    };
    this.sweepTimer = setInterval(
      () => void sweep().catch((e: Error) => this.log.warn(`SLA sweep failed: ${e.message}`)),
      this.cfg.NODE_ENV === 'test' ? 2000 : SWEEP_MS,
    );
    this.sweepTimer.unref();
  }
  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }

  /** Run a pass now (after a reply is queued); coalesces concurrent calls. */
  poke() {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    void this.drain()
      .catch((e: Error) => this.log.warn(`outbound pass failed: ${e.message}`))
      .finally(() => {
        this.running = false;
        if (this.again) {
          this.again = false;
          this.poke();
        }
      });
  }

  private async claim(now: Date): Promise<ExternalMessageDoc | null> {
    return this.db.unscoped.external_messages.findOneAndUpdate(
      {
        direction: 'outbound',
        $or: [
          { deliveryState: 'queued', nextAttemptAt: { $lte: now } },
          { deliveryState: 'sending', lockedUntil: { $lte: now } },
        ],
      },
      {
        $set: { deliveryState: 'sending', lockedUntil: new Date(now.getTime() + LEASE_MS) },
        $inc: { attempts: 1 },
      },
      { sort: { nextAttemptAt: 1 }, returnDocument: 'after' },
    );
  }

  async drain(max = 50) {
    for (let i = 0; i < max; i++) {
      const m = await this.claim(new Date());
      if (!m) return;
      await this.process(m).catch((e: Error) =>
        this.log.error(`send ${m._id} crashed: ${e.message}`),
      );
    }
  }

  /** Put a claimed message back without spending an attempt. */
  private async hold(m: ExternalMessageDoc, until: Date, reason: string | null) {
    await this.db
      .for(m.tenantId)
      .external_messages.updateOne(
        { _id: m._id },
        {
          $set: { deliveryState: 'queued', nextAttemptAt: until, lockedUntil: null, error: reason },
          $inc: { attempts: -1 },
        },
      );
  }

  private rateLimited(c: ConnectorDoc): boolean {
    const perSecond = CONNECTOR_CATALOG[c.provider].rateLimit.perSecond;
    if (perSecond <= 0) return false;
    const now = Date.now();
    const list = (this.recent.get(c._id) ?? []).filter((t) => now - t < 1000);
    if (list.length >= perSecond) {
      this.recent.set(c._id, list);
      return true;
    }
    list.push(now);
    this.recent.set(c._id, list);
    return false;
  }

  private async process(m: ExternalMessageDoc) {
    const t = this.db.for(m.tenantId);
    const now = new Date();
    const [connector, conversation] = await Promise.all([
      t.connectors.findOne({ _id: m.connectorId }),
      t.external_conversations.findOne({ _id: m.conversationId }),
    ]);
    if (!connector || connector.deletedAt || !conversation) {
      await t.external_messages.updateOne(
        { _id: m._id },
        {
          $set: {
            deliveryState: 'failed',
            error: 'Channel was disconnected',
            lockedUntil: null,
            nextAttemptAt: null,
          },
        },
      );
      return;
    }
    if (connector.status !== 'active')
      return this.hold(
        m,
        new Date(now.getTime() + 15_000),
        connector.status === 'paused'
          ? 'Waiting: channel is paused'
          : 'Waiting: channel needs attention',
      );
    if (connector.health.circuitOpenUntil && connector.health.circuitOpenUntil > now)
      return this.hold(
        m,
        connector.health.circuitOpenUntil,
        'Waiting: provider is failing, retrying shortly',
      );
    if (this.rateLimited(connector)) return this.hold(m, new Date(now.getTime() + 1000), null);

    const adapter = ADAPTERS[connector.provider];
    const creds = this.connectors.credentials(connector);
    const testMode = connector.environment === 'test';
    const http = testMode ? this.http.sandbox(adapter, Object.values(creds)) : this.http.live();
    const account = conversation.accountId
      ? await t.external_accounts.findOne({ _id: conversation.accountId })
      : null;
    try {
      const result = await adapter.send(m.text, {
        credentials: creds,
        http,
        tokens: this.connectors.tokenCache(connector),
        externalThreadId: conversation.externalThreadId,
        replyContext: conversation.replyContext,
        clientHandle: account?.handle ?? null,
        testMode,
      });
      const captured = testMode ? ((http as SandboxTransport).captured.at(-1) ?? null) : null;
      await t.external_messages.updateOne(
        { _id: m._id },
        {
          $set: {
            deliveryState: result.kind === 'handoff' ? 'handoff' : testMode ? 'test' : 'sent',
            externalMessageId: result.kind === 'sent' ? result.externalMessageId : null,
            handoffUrl: result.kind === 'handoff' ? result.url : null,
            sandboxRequest: captured,
            sentAt: new Date(),
            error: null,
            lockedUntil: null,
            nextAttemptAt: null,
          },
        },
      );
      await t.connectors.updateOne(
        { _id: connector._id },
        {
          $set: {
            'health.lastOutboundAt': new Date(),
            'health.consecutiveFailures': 0,
            'health.circuitOpenUntil': null,
          },
        },
      );
    } catch (e) {
      const err = e instanceof ProviderError ? e : new ProviderError((e as Error).message, 'retry');
      const failures = connector.health.consecutiveFailures + 1;
      const giveUp = err.kind !== 'retry' || m.attempts >= MAX_ATTEMPTS;
      await t.external_messages.updateOne(
        { _id: m._id },
        {
          $set: giveUp
            ? {
                deliveryState: 'failed',
                error: err.message.slice(0, 300),
                lockedUntil: null,
                nextAttemptAt: null,
              }
            : {
                deliveryState: 'queued',
                error: err.message.slice(0, 300),
                lockedUntil: null,
                nextAttemptAt: new Date(
                  Date.now() +
                    Math.max(
                      err.retryAfterMs ?? 0,
                      backoffDelay(m.attempts, { baseMs: 1000, capMs: 5 * 60_000 }),
                    ),
                ),
              },
        },
      );
      await t.connectors.updateOne(
        { _id: connector._id },
        {
          $set: {
            'health.lastError': err.message.slice(0, 300),
            'health.lastErrorAt': new Date(),
            'health.consecutiveFailures': failures,
            ...(failures >= CIRCUIT_THRESHOLD
              ? { 'health.circuitOpenUntil': new Date(Date.now() + CIRCUIT_OPEN_MS) }
              : {}),
            ...(err.kind === 'auth' ? { status: 'error' } : {}),
          },
        },
      );
    }
    await this.access.emit(m.tenantId, conversation, 'delivery');
  }
}
