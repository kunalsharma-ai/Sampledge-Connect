import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import type { Collection, Db } from 'mongodb';
import {
  CORE_INTEGRATION_PROVIDERS,
  SaveIntegrationRequestSchema,
  type IntegrationProviderDef,
  type IntegrationSource,
  type IntegrationTestResult,
  type IntegrationValues,
  type IntegrationView,
} from '@sampledge/contracts';
import { AppError, notFound, parse } from '../common/errors.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { MONGO_DB } from '../database/database.module.js';
import { REDIS } from '../redis/redis.module.js';
import { AuditService } from '../audit/audit.service.js';
import { createCipher, initSharedCipher, type SecretCipher } from './cipher.js';

export interface IntegrationSettingsDoc {
  _id?: unknown;
  /** null = platform-wide default. */
  tenantId: string | null;
  providerId: string;
  enabled: boolean;
  values: IntegrationValues;
  secrets: Record<string, string>;
  updatedAt: Date;
  updatedBy: string | null;
  lastTest: IntegrationTestResult | null;
}

export interface ResolvedIntegration {
  enabled: boolean;
  /** Plain and decrypted secret values, defaults applied. Server-side only. */
  values: IntegrationValues;
  source: IntegrationSource;
}

export interface ProviderHooks {
  /** Check that the values work (connect, authenticate). Throw or return ok:false with a reason. */
  test?: (
    values: IntegrationValues,
    tenantId: string | null,
  ) => Promise<{ ok: boolean; message: string }>;
  /** Legacy env configuration, used when neither the tenant nor the platform has settings. */
  envFallback?: (cfg: AppConfig) => IntegrationValues | null;
}

type Scope = { tenantId: string | null };
const CHANNEL = 'integration-settings:changed';
const TTL_MS = 60_000;

/**
 * The one place integrations read their configuration from. Settings live in MongoDB
 * (tenant, then platform), with legacy env as the last fallback. Secrets are AES-256-GCM
 * encrypted at rest and only ever decrypted in this process. Saves publish over Redis so
 * every API node drops its cache and onChange listeners hot-reload without a restart.
 */
@Injectable()
export class IntegrationSettingsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('IntegrationSettings');
  private readonly providers = new Map<
    string,
    { def: IntegrationProviderDef; hooks: ProviderHooks }
  >();
  private readonly cache = new Map<string, { at: number; value: ResolvedIntegration | null }>();
  private readonly listeners = new Map<string, Set<(tenantId: string | null) => void>>();
  private readonly cipher: SecretCipher;
  private readonly col: Collection<IntegrationSettingsDoc>;
  private sub: Redis | null = null;

  constructor(
    @Inject(MONGO_DB) db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly audit: AuditService,
  ) {
    if (!cfg.SETTINGS_ENCRYPTION_KEY && cfg.NODE_ENV !== 'test') {
      this.log.warn(
        'SETTINGS_ENCRYPTION_KEY is not set; using the development key. Never do this in production.',
      );
    }
    this.cipher = createCipher(cfg.SETTINGS_ENCRYPTION_KEY);
    initSharedCipher(this.cipher);
    this.col = db.collection<IntegrationSettingsDoc>('integration_settings');
    for (const def of CORE_INTEGRATION_PROVIDERS) this.register(def);
  }

  async onModuleInit() {
    this.sub = this.redis.duplicate();
    await this.sub.subscribe(CHANNEL);
    this.sub.on('message', (_ch, raw) => {
      try {
        const { tenantId, providerId } = JSON.parse(raw) as {
          tenantId: string | null;
          providerId: string;
        };
        this.invalidate(tenantId, providerId);
      } catch {
        /* ignore malformed */
      }
    });
  }

  async onModuleDestroy() {
    await this.sub?.quit().catch(() => undefined);
  }

  // ---------- registry ----------

  /** Declare a provider (or attach hooks to a core one). Call from a module's onModuleInit. */
  register(def: IntegrationProviderDef, hooks: ProviderHooks = {}) {
    const prev = this.providers.get(def.id);
    this.providers.set(def.id, { def, hooks: { ...prev?.hooks, ...hooks } });
  }

  /** Attach a test or env fallback to an already-declared provider. */
  attach(providerId: string, hooks: ProviderHooks) {
    const p = this.providers.get(providerId);
    if (!p) throw new Error(`Unknown integration provider ${providerId}`);
    p.hooks = { ...p.hooks, ...hooks };
  }

  definitions(): IntegrationProviderDef[] {
    return [...this.providers.values()].map((p) => p.def);
  }

  private def(providerId: string) {
    const p = this.providers.get(providerId);
    if (!p) throw notFound('Integration');
    return p;
  }

  // ---------- reading ----------

  /** Effective settings for a tenant (or the platform when tenantId is null). null when unconfigured. */
  async get(tenantId: string | null, providerId: string): Promise<ResolvedIntegration | null> {
    const key = `${tenantId ?? '*'}|${providerId}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    const value = await this.resolve(tenantId, providerId);
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  private async resolve(
    tenantId: string | null,
    providerId: string,
  ): Promise<ResolvedIntegration | null> {
    const p = this.providers.get(providerId);
    if (!p) return null;
    const docs = await this.col
      .find({ providerId, tenantId: { $in: tenantId ? [tenantId, null] : [null] } })
      .toArray();
    const doc = docs.find((d) => d.tenantId === tenantId) ?? docs.find((d) => d.tenantId === null);
    if (doc) {
      return {
        enabled: doc.enabled,
        values: this.withDefaults(p.def, { ...doc.values, ...this.open(doc) }),
        source: doc.tenantId === null ? 'platform' : 'tenant',
      };
    }
    const env = p.hooks.envFallback?.(this.cfg);
    return env ? { enabled: true, values: this.withDefaults(p.def, env), source: 'env' } : null;
  }

  private open(doc: IntegrationSettingsDoc): IntegrationValues {
    const out: IntegrationValues = {};
    for (const [k, sealed] of Object.entries(doc.secrets ?? {})) {
      try {
        out[k] = this.cipher.decrypt(sealed);
      } catch (e) {
        this.log.error(`Cannot decrypt ${doc.providerId}.${k}: ${(e as Error).message}`);
        out[k] = null;
      }
    }
    return out;
  }

  private withDefaults(def: IntegrationProviderDef, values: IntegrationValues): IntegrationValues {
    const out: IntegrationValues = {};
    for (const f of def.fields) out[f.key] = values[f.key] ?? f.default ?? null;
    return out;
  }

  /** Hot reload: called with the tenant (null = platform) whose settings changed. */
  onChange(providerId: string, fn: (tenantId: string | null) => void): () => void {
    const set = this.listeners.get(providerId) ?? new Set();
    set.add(fn);
    this.listeners.set(providerId, set);
    return () => set.delete(fn);
  }

  private invalidate(tenantId: string | null, providerId: string) {
    // A platform change affects every tenant that inherits it.
    for (const k of [...this.cache.keys()]) {
      if (k.endsWith(`|${providerId}`) && (tenantId === null || k.startsWith(`${tenantId}|`)))
        this.cache.delete(k);
    }
    for (const fn of this.listeners.get(providerId) ?? []) {
      try {
        fn(tenantId);
      } catch (e) {
        this.log.warn(`onChange listener for ${providerId} failed: ${(e as Error).message}`);
      }
    }
  }

  private async changed(scope: Scope, providerId: string) {
    this.invalidate(scope.tenantId, providerId);
    await this.redis
      .publish(CHANNEL, JSON.stringify({ tenantId: scope.tenantId, providerId }))
      .catch(() => undefined);
  }

  // ---------- admin views ----------

  async list(scope: Scope): Promise<IntegrationView[]> {
    const ids = [...this.providers.keys()];
    const own = await this.col
      .find({ tenantId: scope.tenantId, providerId: { $in: ids } })
      .toArray();
    const byId = new Map(own.map((d) => [d.providerId, d]));
    return Promise.all(
      [...this.providers.values()]
        .filter((p) => p.def.scopes.includes(scope.tenantId === null ? 'platform' : 'tenant'))
        .map(async (p) => this.view(scope, p.def, byId.get(p.def.id) ?? null)),
    );
  }

  private async view(
    scope: Scope,
    def: IntegrationProviderDef,
    doc: IntegrationSettingsDoc | null,
  ): Promise<IntegrationView> {
    const eff = await this.get(scope.tenantId, def.id);
    return {
      provider: def,
      enabled: eff?.enabled ?? false,
      source: eff?.source ?? null,
      saved: doc
        ? {
            enabled: doc.enabled,
            values: doc.values,
            secretsSet: Object.keys(doc.secrets ?? {}),
            updatedAt: doc.updatedAt.toISOString(),
            updatedBy: doc.updatedBy,
          }
        : null,
      lastTest: doc?.lastTest ?? null,
    };
  }

  // ---------- writing ----------

  /**
   * Validate and store. Secret fields: a string sets, null clears, omitted keeps.
   * Also usable server-side (e.g. "generate signing secret"); always audit logged.
   */
  async save(
    scope: Scope,
    providerId: string,
    body: unknown,
    actorId: string | null,
  ): Promise<IntegrationView> {
    const { def } = this.def(providerId);
    if (def.planned)
      throw new AppError(
        'VALIDATION_FAILED',
        `${def.label} is planned and cannot be configured yet`,
      );
    if (!def.scopes.includes(scope.tenantId === null ? 'platform' : 'tenant'))
      throw new AppError('VALIDATION_FAILED', `${def.label} cannot be configured at this level`);
    const req = parse(SaveIntegrationRequestSchema, body);
    const existing = await this.col.findOne({ tenantId: scope.tenantId, providerId });
    const { values, secrets } = this.merge(def, existing, req.values);
    if (req.enabled) this.requireComplete(def, values, secrets);

    const now = new Date();
    await this.col.updateOne(
      { tenantId: scope.tenantId, providerId },
      {
        $set: { enabled: req.enabled, values, secrets, updatedAt: now, updatedBy: actorId },
        $setOnInsert: { lastTest: null },
      },
      { upsert: true },
    );
    await this.changed(scope, providerId);
    if (scope.tenantId) {
      await this.audit.record({
        tenantId: scope.tenantId,
        actorId,
        action: 'integration.updated',
        target: { type: 'integration', id: providerId },
        metadata: { enabled: req.enabled, fields: Object.keys(req.values) },
      });
    } else {
      this.log.log(`platform integration ${providerId} updated by ${actorId ?? 'system'}`);
    }
    return this.view(scope, def, await this.col.findOne({ tenantId: scope.tenantId, providerId }));
  }

  /** Remove this scope's settings, falling back to platform or env. */
  async reset(scope: Scope, providerId: string, actorId: string | null): Promise<IntegrationView> {
    const { def } = this.def(providerId);
    await this.col.deleteOne({ tenantId: scope.tenantId, providerId });
    await this.changed(scope, providerId);
    if (scope.tenantId)
      await this.audit.record({
        tenantId: scope.tenantId,
        actorId,
        action: 'integration.reset',
        target: { type: 'integration', id: providerId },
      });
    return this.view(scope, def, null);
  }

  private merge(
    def: IntegrationProviderDef,
    existing: IntegrationSettingsDoc | null,
    incoming: Record<string, string | number | boolean | null>,
  ) {
    const values: IntegrationValues = {};
    const secrets: Record<string, string> = { ...(existing?.secrets ?? {}) };
    for (const f of def.fields) {
      const has = Object.prototype.hasOwnProperty.call(incoming, f.key);
      const v = incoming[f.key];
      if (f.type === 'secret') {
        if (!has) continue;
        if (v === null || v === '') delete secrets[f.key];
        else secrets[f.key] = this.cipher.encrypt(String(v));
        continue;
      }
      const raw = has ? v : (existing?.values[f.key] ?? null);
      values[f.key] = this.coerce(f, raw ?? null);
    }
    return { values, secrets };
  }

  private coerce(f: IntegrationProviderDef['fields'][number], v: string | number | boolean | null) {
    if (v === null || v === '') return null;
    const bad = (why: string) => new AppError('VALIDATION_FAILED', `${f.label}: ${why}`);
    switch (f.type) {
      case 'number': {
        const n = typeof v === 'number' ? v : Number(v);
        if (!Number.isFinite(n)) throw bad('must be a number');
        if ((f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max))
          throw bad('out of range');
        return n;
      }
      case 'boolean':
        return v === true || v === 'true';
      case 'url': {
        try {
          const u = new URL(String(v));
          if (!['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol)) throw new Error();
        } catch {
          throw bad('must be a valid URL');
        }
        return String(v).trim();
      }
      case 'email': {
        // Accepts "addr@host" or "Display Name <addr@host>".
        const text = String(v).trim();
        const addr = /<([^<>]+)>$/.exec(text)?.[1] ?? text;
        if (!/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(addr)) throw bad('must be an email address');
        return text.slice(0, 320);
      }
      case 'select':
        if (!f.options?.some((o) => o.value === v)) throw bad('is not one of the options');
        return String(v);
      default:
        return String(v).trim().slice(0, 4096);
    }
  }

  private requireComplete(
    def: IntegrationProviderDef,
    values: IntegrationValues,
    secrets: Record<string, string>,
  ) {
    const missing = def.fields.filter(
      (f) =>
        f.required &&
        (f.type === 'secret' ? !secrets[f.key] : values[f.key] == null && f.default === undefined),
    );
    if (missing.length)
      throw new AppError(
        'VALIDATION_FAILED',
        `Fill in ${missing.map((f) => f.label).join(', ')} before enabling`,
      );
  }

  // ---------- testing ----------

  async test(
    scope: Scope,
    providerId: string,
    draft: Record<string, string | number | boolean | null> | undefined,
    actorId: string | null,
  ): Promise<IntegrationTestResult> {
    const { def, hooks } = this.def(providerId);
    if (!def.testable || !hooks.test)
      throw new AppError('VALIDATION_FAILED', `${def.label} has no connection test`);
    let values: IntegrationValues;
    if (draft) {
      const existing = await this.col.findOne({ tenantId: scope.tenantId, providerId });
      const merged = this.merge(def, existing, draft);
      values = this.withDefaults(def, {
        ...merged.values,
        ...this.open({
          ...(existing ?? ({} as IntegrationSettingsDoc)),
          secrets: merged.secrets,
          providerId,
        }),
      });
    } else {
      const eff = await this.get(scope.tenantId, providerId);
      if (!eff) throw new AppError('VALIDATION_FAILED', `${def.label} is not configured`);
      values = eff.values;
    }
    const started = Date.now();
    let result: IntegrationTestResult;
    try {
      const r = await Promise.race([
        hooks.test(values, scope.tenantId),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error('Timed out after 15 seconds')), 15_000),
        ),
      ]);
      result = {
        ok: r.ok,
        message: r.message,
        testedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
      };
    } catch (e) {
      result = {
        ok: false,
        message: describeFailure(e),
        testedAt: new Date().toISOString(),
        latencyMs: null,
      };
    }
    if (!draft)
      await this.col.updateOne(
        { tenantId: scope.tenantId, providerId },
        { $set: { lastTest: result } },
      );
    if (scope.tenantId)
      await this.audit.record({
        tenantId: scope.tenantId,
        actorId,
        action: 'integration.tested',
        target: { type: 'integration', id: providerId },
        metadata: { ok: result.ok },
      });
    return result;
  }
}

/** Turn low-level errors ("fetch failed") into something an admin can act on. */
function describeFailure(e: unknown): string {
  const err = e as Error & { cause?: { code?: string; hostname?: string; message?: string } };
  const code = err.cause?.code ?? (err as { code?: string }).code;
  const host = err.cause?.hostname;
  const reason: Record<string, string> = {
    ENOTFOUND: `Could not find the server${host ? ` ${host}` : ''}. Check the address.`,
    ECONNREFUSED: 'The server refused the connection. Check the host and port.',
    ETIMEDOUT: 'The server did not answer in time. Check the address and firewall.',
    ECONNRESET: 'The connection was dropped. Check TLS settings and the port.',
    EAI_AGAIN: 'DNS lookup failed. Check the address and the server network.',
    CERT_HAS_EXPIRED: 'The server TLS certificate has expired.',
  };
  if (code && reason[code]) return reason[code];
  if (err.message === 'fetch failed')
    return `Could not reach the service${err.cause?.message ? `: ${err.cause.message}` : ''}`;
  return err.message || 'Connection failed';
}
