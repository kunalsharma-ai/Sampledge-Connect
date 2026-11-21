import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Db } from 'mongodb';
import {
  MODULE_CATALOG,
  SAMPLEDGE_MODULES,
  type IntegrationProviderDef,
  type IntegrationValues,
  type ModuleMode,
  type SampledgeModule,
} from '@sampledge/contracts';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service.js';
import { MONGO_DB } from '../database/database.module.js';
import { signPayload } from './signing.js';

export const providerId = (m: SampledgeModule) => `sampledge.${m}`;

/** One module's effective connection settings, decrypted. Server-side only. */
export interface ModuleSettings {
  module: SampledgeModule;
  enabled: boolean;
  mode: ModuleMode;
  baseUrl: string | null;
  apiKey: string | null;
  signingSecret: string | null;
  channelVisibility: 'public' | 'private';
  widgetOrigins: string[];
}

export function moduleProviderDef(m: SampledgeModule): IntegrationProviderDef {
  const def = MODULE_CATALOG[m];
  return {
    id: providerId(m),
    label: def.name,
    description: `${def.category}: ${def.description}`,
    category: 'sampledge',
    scopes: ['tenant'],
    testable: true,
    fields: [
      {
        key: 'mode',
        label: 'Mode',
        type: 'select',
        default: 'test',
        options: [
          { value: 'test', label: 'Test: process events, send nothing to the module' },
          { value: 'live', label: 'Live: also send tasks and decisions to the module' },
        ],
        help: 'Test mode is safe: Connect never calls the module, it records what it would send.',
      },
      {
        key: 'baseUrl',
        label: `${def.name} API base URL`,
        type: 'url',
        placeholder: `https://${m}.example.com/api`,
        help: 'Needed for live mode and Test connection. Connect calls {base URL}/connect/…',
      },
      {
        key: 'apiKey',
        label: `${def.name} API key`,
        type: 'secret',
        help: `The key Connect sends to ${def.name} (Authorization: Bearer). Needed for live mode.`,
      },
      {
        key: 'signingSecret',
        label: 'Event signing secret',
        type: 'secret',
        help: `Shared with ${def.name} to sign its events (HMAC-SHA256). Generate one under Sampledge modules → Keys, or paste ${def.name}'s.`,
      },
      {
        key: 'channelVisibility',
        label: 'New record channels',
        type: 'select',
        default: 'public',
        options: [
          { value: 'public', label: 'Public channels (anyone in the workspace can read)' },
          { value: 'private', label: 'Private channels (only the people involved)' },
        ],
        help:
          def.restrictedRecordTypes.length > 0
            ? `${def.restrictedRecordTypes.join(', ')} records are always private.`
            : undefined,
      },
      {
        key: 'widgetOrigins',
        label: 'Chat widget origins',
        type: 'string',
        placeholder: `https://${m}.example.com`,
        help: `Comma-separated web origins allowed to embed the Connect chat widget (CORS).`,
      },
    ],
  };
}

function str(v: IntegrationValues[string] | undefined): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * Module connection settings, stored in the shared encrypted integration-settings store
 * (provider ids `sampledge.<module>`) and edited on the admin Integrations screen.
 */
@Injectable()
export class ModuleSettingsService implements OnModuleInit {
  private readonly log = new Logger('ModuleSettings');
  private origins: { at: number; set: Set<string> } = { at: 0, set: new Set() };

  constructor(
    private readonly settings: IntegrationSettingsService,
    @Inject(MONGO_DB) private readonly db: Db,
  ) {
    for (const m of SAMPLEDGE_MODULES)
      this.settings.register(moduleProviderDef(m), {
        test: (values) => this.testConnection(m, values),
      });
  }

  onModuleInit() {
    void this.refreshOrigins();
  }

  async get(tenantId: string, m: SampledgeModule): Promise<ModuleSettings> {
    const r = await this.settings.get(tenantId, providerId(m));
    const v = r?.values ?? {};
    return {
      module: m,
      enabled: !!r?.enabled,
      mode: v.mode === 'live' ? 'live' : 'test',
      baseUrl: str(v.baseUrl)?.replace(/\/+$/, '') ?? null,
      apiKey: str(v.apiKey),
      signingSecret: str(v.signingSecret),
      channelVisibility: v.channelVisibility === 'private' ? 'private' : 'public',
      widgetOrigins: (str(v.widgetOrigins) ?? '')
        .split(',')
        .map((s) => s.trim().replace(/\/+$/, ''))
        .filter(Boolean),
    };
  }

  /** What live mode still needs, in words an admin understands. */
  missing(s: ModuleSettings): string[] {
    const name = MODULE_CATALOG[s.module].name;
    const out: string[] = [];
    if (!s.signingSecret) out.push('Event signing secret');
    if (!s.baseUrl) out.push(`${name} API base URL`);
    if (!s.apiKey) out.push(`${name} API key`);
    return out;
  }

  /** Writes the signing secret (used by "Generate signing secret"). Audit logged by the store. */
  async setSigningSecret(tenantId: string, m: SampledgeModule, secret: string, actorId: string) {
    const r = await this.settings.get(tenantId, providerId(m));
    await this.settings.save(
      { tenantId },
      providerId(m),
      { enabled: r?.source === 'tenant' ? r.enabled : true, values: { signingSecret: secret } },
      actorId,
    );
  }

  /**
   * GET {baseUrl}/connect/health with the module API key and a signed timestamp. In test mode
   * nothing is called: the result says so instead of pretending the module answered.
   */
  private async testConnection(
    m: SampledgeModule,
    values: IntegrationValues,
  ): Promise<{ ok: boolean; message: string }> {
    const name = MODULE_CATALOG[m].name;
    const baseUrl = str(values.baseUrl)?.replace(/\/+$/, '');
    const apiKey = str(values.apiKey);
    const secret = str(values.signingSecret);
    const missing = [
      !secret && 'event signing secret',
      !baseUrl && 'API base URL',
      !apiKey && 'API key',
    ].filter(Boolean);
    if (values.mode !== 'live') {
      return {
        ok: !!secret,
        message: secret
          ? `Test mode: ${name} events are accepted and processed. Nothing is sent to ${name}.${missing.length ? ` Live mode still needs: ${missing.join(', ')}.` : ''}`
          : `Test mode needs an event signing secret so ${name} can sign its events.`,
      };
    }
    if (!baseUrl || !apiKey)
      return { ok: false, message: `Live mode needs: ${missing.join(', ')}.` };
    const started = Date.now();
    try {
      const res = await fetch(`${baseUrl}/connect/health`, {
        headers: {
          authorization: `Bearer ${apiKey}`,
          ...(secret ? { 'sampledge-signature': signPayload(secret, '') } : {}),
        },
        signal: AbortSignal.timeout(8000),
        redirect: 'error',
      });
      const ms = Date.now() - started;
      if (res.ok) return { ok: true, message: `${name} answered in ${ms} ms.` };
      if (res.status === 401 || res.status === 403)
        return { ok: false, message: `${name} rejected the API key (HTTP ${res.status}).` };
      return { ok: false, message: `${name} answered HTTP ${res.status}.` };
    } catch (e) {
      return { ok: false, message: `Could not reach ${name}: ${(e as Error).message}` };
    }
  }

  /** Web origins any tenant allowed for the chat widget (CORS). Refreshed every minute. */
  async widgetOriginAllowed(origin: string): Promise<boolean> {
    if (Date.now() - this.origins.at > 60_000) await this.refreshOrigins();
    return this.origins.set.has(origin.replace(/\/+$/, ''));
  }

  private async refreshOrigins() {
    try {
      const docs = await this.db
        .collection<{ providerId: string; enabled: boolean; values?: IntegrationValues }>(
          'integration_settings',
        )
        .find(
          { providerId: { $regex: /^sampledge\./ }, enabled: true },
          { projection: { 'values.widgetOrigins': 1 } },
        )
        .toArray();
      const set = new Set<string>();
      for (const d of docs)
        for (const o of String(d.values?.widgetOrigins ?? '').split(','))
          if (/^https?:\/\/[^/]+$/.test(o.trim().replace(/\/+$/, '')))
            set.add(o.trim().replace(/\/+$/, ''));
      this.origins = { at: Date.now(), set };
    } catch (e) {
      this.log.warn(`widget origins refresh failed: ${(e as Error).message}`);
      this.origins.at = Date.now();
    }
  }
}
