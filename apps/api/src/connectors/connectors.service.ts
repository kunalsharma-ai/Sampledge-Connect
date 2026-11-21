import { randomBytes } from 'node:crypto';
import { forwardRef, Inject, Injectable } from '@nestjs/common';
import {
  CONNECTOR_CATALOG,
  CreateConnectorRequestSchema,
  RotateCredentialsRequestSchema,
  SimulateInboundRequestSchema,
  UpdateConnectorRequestSchema,
  tenantCan,
  type Connector,
  type TestConnectorResult,
} from '@sampledge/contracts';
import { AppError, forbidden, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import type { ConnectorDoc } from '../database/documents.js';
import { TenantDb } from '../database/tenant-db.js';
import { AuditService } from '../audit/audit.service.js';
import { ADAPTERS, ProviderError, type Credentials, type TokenCache } from './adapters/index.js';
import { CredentialVault, hint } from './credential-vault.js';
import { ConnectorHttp } from './transport.js';
import { WebhookService } from './webhook.service.js';

export const newWebhookKey = () => randomBytes(24).toString('base64url');

/** Credential keys an admin may set for a provider. Test-only keys are never accepted from input. */
const allowedKeys = (provider: ConnectorDoc['provider']) =>
  new Set(CONNECTOR_CATALOG[provider].credentialFields.map((f) => f.key));

export function missingCredentials(
  doc: Pick<ConnectorDoc, 'provider' | 'credentialHints'>,
): string[] {
  return CONNECTOR_CATALOG[doc.provider].credentialFields
    .filter((f) => f.required && !doc.credentialHints[f.key])
    .map((f) => f.key);
}

function hints(provider: ConnectorDoc['provider'], creds: Credentials): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of CONNECTOR_CATALOG[provider].credentialFields) {
    const v = creds[f.key];
    if (v) out[f.key] = hint(v, f.secret);
  }
  return out;
}

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

@Injectable()
export class ConnectorsService {
  constructor(
    private readonly db: TenantDb,
    private readonly vault: CredentialVault,
    private readonly http: ConnectorHttp,
    private readonly audit: AuditService,
    @Inject(forwardRef(() => WebhookService)) private readonly webhooks: WebhookService,
  ) {}

  private requireManage(ctx: TenantContext) {
    if (!tenantCan(ctx.role, 'connectors.manage'))
      throw forbidden('Only admins can manage connectors');
  }

  credentials(doc: ConnectorDoc): Credentials {
    return doc.credentials ? this.vault.open<Credentials>(doc.tenantId, doc.credentials) : {};
  }
  previousCredentials(doc: ConnectorDoc): Credentials | null {
    if (!doc.previousCredentials || !doc.previousValidUntil || doc.previousValidUntil < new Date())
      return null;
    return this.vault.open<Credentials>(doc.tenantId, doc.previousCredentials);
  }

  /** Provider access tokens (WeChat, QQ, Teams, Google) cached sealed on the connector. */
  tokenCache(doc: ConnectorDoc): TokenCache {
    const t = this.db.for(doc.tenantId);
    let current = doc;
    return {
      get: async () => {
        if (
          !current.accessToken ||
          !current.accessTokenExpiresAt ||
          current.accessTokenExpiresAt < new Date()
        )
          return null;
        return this.vault.open<string>(doc.tenantId, current.accessToken) || null;
      },
      set: async (token, expiresIn) => {
        const accessToken = token ? this.vault.seal(doc.tenantId, token) : null;
        const accessTokenExpiresAt = token
          ? new Date(Date.now() + Math.max(0, expiresIn) * 1000)
          : null;
        current = { ...current, accessToken, accessTokenExpiresAt };
        await t.connectors.updateOne(
          { _id: doc._id },
          { $set: { accessToken, accessTokenExpiresAt } },
        );
      },
    };
  }

  async toConnector(doc: ConnectorDoc): Promise<Connector> {
    const queued = await this.db
      .for(doc.tenantId)
      .external_messages.countDocuments({
        connectorId: doc._id,
        deliveryState: { $in: ['queued', 'sending'] },
      });
    const handoff = CONNECTOR_CATALOG[doc.provider].mode === 'handoff';
    return {
      connectorId: doc._id,
      provider: doc.provider,
      name: doc.name,
      environment: doc.environment,
      status: doc.status,
      credentialHints: doc.credentialHints,
      missingCredentials: missingCredentials(doc),
      webhookPath: handoff ? null : `/v1/connectors/webhooks/${doc.webhookKey}`,
      teamId: doc.teamId,
      credentialsRotatedAt: iso(doc.credentialsRotatedAt),
      previousCredentialsValidUntil:
        doc.previousValidUntil && doc.previousValidUntil > new Date()
          ? doc.previousValidUntil.toISOString()
          : null,
      health: {
        lastInboundAt: iso(doc.health.lastInboundAt),
        lastOutboundAt: iso(doc.health.lastOutboundAt),
        lastError: doc.health.lastError,
        lastErrorAt: iso(doc.health.lastErrorAt),
        consecutiveFailures: doc.health.consecutiveFailures,
        circuitOpenUntil:
          doc.health.circuitOpenUntil && doc.health.circuitOpenUntil > new Date()
            ? doc.health.circuitOpenUntil.toISOString()
            : null,
        rejectedWebhooks: doc.health.rejectedWebhooks,
        queued,
      },
      createdAt: doc.createdAt.toISOString(),
    };
  }

  async find(tenantId: string, id: string): Promise<ConnectorDoc> {
    const doc = await this.db.for(tenantId).connectors.findOne({ _id: id, deletedAt: null });
    if (!doc) throw notFound('Connector');
    return doc;
  }

  async list(ctx: TenantContext): Promise<Connector[]> {
    if (!tenantCan(ctx.role, 'connectors.manage') && !tenantCan(ctx.role, 'inbox.access'))
      throw forbidden();
    const docs = await this.db
      .for(ctx.tenantId)
      .connectors.find({ deletedAt: null }, { sort: { createdAt: 1 } })
      .toArray();
    const all = await Promise.all(docs.map((d) => this.toConnector(d)));
    // Agents see which channels exist, never credential hints.
    return tenantCan(ctx.role, 'connectors.manage')
      ? all
      : all.map((c) => ({ ...c, credentialHints: {}, webhookPath: null }));
  }

  async get(ctx: TenantContext, id: string): Promise<Connector> {
    this.requireManage(ctx);
    return this.toConnector(await this.find(ctx.tenantId, id));
  }

  private async checkTeam(tenantId: string, teamId: string | null | undefined) {
    if (!teamId) return;
    const s = await this.db.for(tenantId).inbox_settings.findOne({});
    if (!s?.teams.some((t) => t.teamId === teamId))
      throw new AppError('VALIDATION_FAILED', 'Unknown inbox team');
  }

  private liveCredentials(
    provider: ConnectorDoc['provider'],
    input: Record<string, string>,
  ): Credentials {
    const allowed = allowedKeys(provider);
    const out: Credentials = {};
    for (const [k, v] of Object.entries(input)) {
      if (!allowed.has(k))
        throw new AppError(
          'VALIDATION_FAILED',
          `Unknown credential field "${k}" for ${CONNECTOR_CATALOG[provider].name}`,
        );
      if (v.trim()) out[k] = v.trim();
    }
    return out;
  }

  async create(ctx: TenantContext, input: unknown): Promise<Connector> {
    this.requireManage(ctx);
    const req = parse(CreateConnectorRequestSchema, input);
    await this.checkTeam(ctx.tenantId, req.teamId);
    const adapter = ADAPTERS[req.provider];
    const creds =
      req.environment === 'test'
        ? adapter.testCredentials()
        : this.liveCredentials(req.provider, req.credentials);
    const now = new Date();
    const doc = await this.db.for(ctx.tenantId).connectors.insertOne({
      provider: req.provider,
      name: req.name,
      environment: req.environment,
      status: 'active',
      credentials: this.vault.seal(ctx.tenantId, creds),
      previousCredentials: null,
      previousValidUntil: null,
      credentialHints: hints(req.provider, creds),
      credentialsRotatedAt: null,
      webhookKey: newWebhookKey(),
      teamId: req.teamId,
      health: {
        lastInboundAt: null,
        lastOutboundAt: null,
        lastError: null,
        lastErrorAt: null,
        consecutiveFailures: 0,
        circuitOpenUntil: null,
        rejectedWebhooks: 0,
      },
      createdBy: ctx.userId,
      createdAt: now,
      deletedAt: null,
    });
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'connector.created',
      target: { type: 'connector', id: doc._id },
      metadata: { provider: req.provider, environment: req.environment },
    });
    return this.toConnector(doc);
  }

  async update(ctx: TenantContext, id: string, input: unknown): Promise<Connector> {
    this.requireManage(ctx);
    const req = parse(UpdateConnectorRequestSchema, input);
    const doc = await this.find(ctx.tenantId, id);
    await this.checkTeam(ctx.tenantId, req.teamId);
    const set: Partial<ConnectorDoc> = {};
    if (req.name !== undefined) set.name = req.name;
    if (req.teamId !== undefined) set.teamId = req.teamId;
    if (req.status !== undefined) set.status = req.status;
    if (req.environment && req.environment !== doc.environment) {
      // Never carry generated test secrets into live, or live secrets into the sandbox.
      const creds = req.environment === 'test' ? ADAPTERS[doc.provider].testCredentials() : {};
      Object.assign(set, {
        environment: req.environment,
        credentials: this.vault.seal(ctx.tenantId, creds),
        credentialHints: hints(doc.provider, creds),
        previousCredentials: null,
        previousValidUntil: null,
        accessToken: null,
        accessTokenExpiresAt: null,
        webhookKey: newWebhookKey(),
      });
    }
    if (set.status === 'active') {
      set.health = { ...doc.health, consecutiveFailures: 0, circuitOpenUntil: null };
    }
    const updated = await this.db
      .for(ctx.tenantId)
      .connectors.findOneAndUpdate({ _id: id }, { $set: set }, { returnDocument: 'after' });
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'connector.updated',
      target: { type: 'connector', id },
      metadata: { fields: Object.keys(req) },
    });
    return this.toConnector(updated!);
  }

  /** Replace some or all credential values; the old ones keep verifying webhooks for the grace window. */
  async rotateCredentials(ctx: TenantContext, id: string, input: unknown): Promise<Connector> {
    this.requireManage(ctx);
    const req = parse(RotateCredentialsRequestSchema, input);
    const doc = await this.find(ctx.tenantId, id);
    if (doc.environment === 'test')
      throw new AppError(
        'VALIDATION_FAILED',
        'Test connectors use generated credentials. Switch to live first.',
      );
    const next = {
      ...this.credentials(doc),
      ...this.liveCredentials(doc.provider, req.credentials),
    };
    const now = new Date();
    const updated = await this.db.for(ctx.tenantId).connectors.findOneAndUpdate(
      { _id: id },
      {
        $set: {
          credentials: this.vault.seal(ctx.tenantId, next),
          credentialHints: hints(doc.provider, next),
          previousCredentials: req.graceHours > 0 ? doc.credentials : null,
          previousValidUntil:
            req.graceHours > 0 ? new Date(now.getTime() + req.graceHours * 3600_000) : null,
          credentialsRotatedAt: now,
          accessToken: null,
          accessTokenExpiresAt: null,
          status: doc.status === 'error' ? 'active' : doc.status,
          health: { ...doc.health, consecutiveFailures: 0, circuitOpenUntil: null },
        },
      },
      { returnDocument: 'after' },
    );
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'connector.credentials_rotated',
      target: { type: 'connector', id },
      // Field names only, never values.
      metadata: { fields: Object.keys(req.credentials), graceHours: req.graceHours },
    });
    return this.toConnector(updated!);
  }

  async rotateWebhookUrl(ctx: TenantContext, id: string): Promise<Connector> {
    this.requireManage(ctx);
    await this.find(ctx.tenantId, id);
    const updated = await this.db
      .for(ctx.tenantId)
      .connectors.findOneAndUpdate(
        { _id: id },
        { $set: { webhookKey: newWebhookKey() } },
        { returnDocument: 'after' },
      );
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'connector.webhook_url_rotated',
      target: { type: 'connector', id },
    });
    return this.toConnector(updated!);
  }

  /** Soft delete: credentials are wiped at once; conversations and history stay in the inbox. */
  async remove(ctx: TenantContext, id: string) {
    this.requireManage(ctx);
    await this.find(ctx.tenantId, id);
    const t = this.db.for(ctx.tenantId);
    await t.connectors.updateOne(
      { _id: id },
      {
        $set: {
          deletedAt: new Date(),
          status: 'paused',
          credentials: null,
          previousCredentials: null,
          accessToken: null,
          credentialHints: {},
          webhookKey: newWebhookKey(),
        },
      },
    );
    await t.external_messages.updateMany(
      { connectorId: id, deliveryState: { $in: ['queued', 'sending'] } },
      {
        $set: {
          deliveryState: 'failed',
          error: 'Connector was removed',
          nextAttemptAt: null,
          lockedUntil: null,
        },
      },
    );
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'connector.deleted',
      target: { type: 'connector', id },
    });
    return { deleted: true as const };
  }

  async test(ctx: TenantContext, id: string): Promise<TestConnectorResult> {
    this.requireManage(ctx);
    const doc = await this.find(ctx.tenantId, id);
    const missing = missingCredentials(doc);
    if (missing.length)
      return {
        ok: false,
        message: `Missing: ${missing.join(', ')}`,
        sandbox: doc.environment === 'test',
      };
    const adapter = ADAPTERS[doc.provider];
    const creds = this.credentials(doc);
    const http =
      doc.environment === 'test'
        ? this.http.sandbox(adapter, Object.values(creds))
        : this.http.live();
    try {
      const message = await adapter.testConnection({
        credentials: creds,
        http,
        tokens: this.tokenCache(doc),
        testMode: doc.environment === 'test',
      });
      if (doc.status === 'error')
        await this.db
          .for(ctx.tenantId)
          .connectors.updateOne({ _id: id }, { $set: { status: 'active' } });
      return {
        ok: true,
        message: http.sandbox ? `Test mode: ${message}` : message,
        sandbox: http.sandbox,
      };
    } catch (e) {
      const message =
        e instanceof ProviderError ? e.message : `Check failed: ${(e as Error).message}`;
      return { ok: false, message, sandbox: http.sandbox };
    }
  }

  /** Test mode: build the provider's own signed webhook and run it through the real inbound path. */
  async simulateInbound(ctx: TenantContext, id: string, input: unknown) {
    this.requireManage(ctx);
    const req = parse(SimulateInboundRequestSchema, input);
    const doc = await this.find(ctx.tenantId, id);
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
      this.credentials(doc),
      `/v1/connectors/webhooks/${doc.webhookKey}`,
    );
    const result = await this.webhooks.handle(doc.webhookKey, wh);
    return { accepted: result.status < 400, conversationIds: result.conversationIds };
  }
}
