import {
  createParamDecorator,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  MODULE_CATALOG,
  SAMPLEDGE_MODULES,
  SampledgeModuleSchema,
  type ModuleCredentials,
  type ModuleIntegration,
  type SampledgeModule,
} from '@sampledge/contracts';
import { AppError, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { AuditService } from '../audit/audit.service.js';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service.js';
import { WorkStore } from './collections.js';
import { ModuleSettingsService, providerId } from './module-settings.service.js';
import { hashKey, newApiKey, newSecret } from './signing.js';

export interface ModulePrincipal {
  tenantId: string;
  module: SampledgeModule;
  keyId: string;
}

type ModuleRequest = Request & { modulePrincipal?: ModulePrincipal; rawBody?: Buffer };

@Injectable()
export class ModuleKeysService {
  constructor(
    private readonly store: WorkStore,
    private readonly settings: ModuleSettingsService,
    private readonly integrationSettings: IntegrationSettingsService,
    private readonly audit: AuditService,
  ) {}

  /** Issues a new Connect API key for a module (revoking older ones). Returned once. */
  async issue(
    ctx: TenantContext,
    moduleParam: string,
    opts: { generateSigningSecret?: boolean },
  ): Promise<ModuleCredentials> {
    const m = parse(SampledgeModuleSchema, moduleParam);
    const w = this.store.for(ctx.tenantId);
    const k = newApiKey(m);
    const now = new Date();
    await w.module_keys.updateMany({ module: m, revokedAt: null }, { $set: { revokedAt: now } });
    await w.module_keys.insertOne({
      module: m,
      prefix: k.prefix,
      hash: k.hash,
      createdAt: now,
      createdBy: ctx.userId,
      revokedAt: null,
      lastUsedAt: null,
    });
    let signingSecret: string | null = null;
    if (opts.generateSigningSecret) {
      signingSecret = newSecret('sdsig');
      await this.settings.setSigningSecret(ctx.tenantId, m, signingSecret, ctx.userId);
    }
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'integration.key_issued',
      target: { type: 'integration', id: providerId(m) },
      metadata: { prefix: k.prefix, signingSecretRotated: !!signingSecret },
    });
    return { module: m, connectApiKey: k.key, signingSecret };
  }

  async revoke(ctx: TenantContext, moduleParam: string) {
    const m = parse(SampledgeModuleSchema, moduleParam);
    await this.store
      .for(ctx.tenantId)
      .module_keys.updateMany({ module: m, revokedAt: null }, { $set: { revokedAt: new Date() } });
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'integration.key_revoked',
      target: { type: 'integration', id: providerId(m) },
    });
  }

  /** Read model for the Sampledge modules section of the Integrations screen. */
  async status(ctx: TenantContext): Promise<ModuleIntegration[]> {
    const w = this.store.for(ctx.tenantId);
    const views = new Map(
      (await this.integrationSettings.list({ tenantId: ctx.tenantId })).map((v) => [v.provider.id, v]),
    );
    return Promise.all(
      SAMPLEDGE_MODULES.map(async (m) => {
        const s = await this.settings.get(ctx.tenantId, m);
        const [key, last, count] = await Promise.all([
          w.module_keys.findOne({ module: m, revokedAt: null }),
          w.integration_events.findOne({ module: m }, { sort: { _id: -1 } }),
          w.integration_events.countDocuments({ module: m }),
        ]);
        const view = views.get(providerId(m));
        const missing = this.settings.missing(s);
        if (!key) missing.unshift('Connect API key (generate one)');
        return {
          module: m,
          enabled: s.enabled,
          mode: s.mode,
          baseUrl: s.baseUrl,
          moduleApiKeySet: !!s.apiKey,
          connectKeyPrefix: key?.prefix ?? null,
          signingSecretSet: !!s.signingSecret,
          missing,
          channelVisibility: s.channelVisibility,
          lastEventAt: last?.receivedAt.toISOString() ?? null,
          eventCount: count,
          lastTestedAt: view?.lastTest?.testedAt ?? null,
          lastTestResult: view?.lastTest ? `${view.lastTest.ok ? 'OK' : 'Failed'}: ${view.lastTest.message}` : null,
          updatedAt: view?.saved?.updatedAt ?? null,
        } satisfies ModuleIntegration;
      }),
    );
  }

  /** Resolves `Authorization: Bearer sk_<module>_...` to a tenant and module. */
  async authenticate(authorization: string | undefined): Promise<ModulePrincipal> {
    if (!authorization?.startsWith('Bearer sk_'))
      throw new AppError('UNAUTHENTICATED', 'Missing Connect API key');
    const key = authorization.slice(7).trim();
    const doc = await this.store.keysGlobal.findOne({ hash: hashKey(key), revokedAt: null });
    if (!doc) throw new AppError('UNAUTHENTICATED', 'Invalid or revoked Connect API key');
    const s = await this.settings.get(doc.tenantId, doc.module);
    if (!s.enabled)
      throw new AppError('FORBIDDEN', `${MODULE_CATALOG[doc.module].name} is not enabled in Connect`);
    if (!doc.lastUsedAt || Date.now() - doc.lastUsedAt.getTime() > 60_000)
      void this.store.keysGlobal.updateOne({ _id: doc._id }, { $set: { lastUsedAt: new Date() } });
    return { tenantId: doc.tenantId, module: doc.module, keyId: doc._id };
  }

  async signingSecret(p: ModulePrincipal): Promise<string | null> {
    return (await this.settings.get(p.tenantId, p.module)).signingSecret;
  }
}

/** Guards the module-server API (/v1/integration/*) with a Connect API key. */
@Injectable()
export class ModuleKeyGuard implements CanActivate {
  constructor(private readonly keys: ModuleKeysService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ModuleRequest>();
    req.modulePrincipal = await this.keys.authenticate(req.headers.authorization);
    return true;
  }
}

export const ModuleCaller = createParamDecorator((_d: unknown, context: ExecutionContext) => {
  const req = context.switchToHttp().getRequest<ModuleRequest>();
  if (!req.modulePrincipal) throw new AppError('UNAUTHENTICATED', 'Not authenticated');
  return req.modulePrincipal;
});

export const RawBody = createParamDecorator((_d: unknown, context: ExecutionContext) => {
  const req = context.switchToHttp().getRequest<ModuleRequest>();
  return req.rawBody?.toString('utf8') ?? '';
});
