import { isIP } from 'node:net';
import type { AiModelSettings } from './model.js';

/**
 * Where model server settings come from. Settings live in the database (Administration >
 * Integrations, integration id `ai.model`), never in env vars. The integration-settings store
 * plugs in here; until a tenant configures a model server, the built-in basic engine runs.
 */
export interface AiSettingsSource {
  /** The tenant's model server, or null for the built-in engine. */
  get(tenantId: string): Promise<AiModelSettings | null>;
  /** Called with a tenantId when its settings change (engine caches are dropped). */
  onChange?(fn: (tenantId: string | null) => void): void;
}

export const AI_SETTINGS_SOURCE = Symbol('AI_SETTINGS_SOURCE');

/** Used until the integration-settings store is wired in: no model server, basic engine. */
export class NoModelSettingsSource implements AiSettingsSource {
  async get(): Promise<AiModelSettings | null> {
    return null;
  }
}

/** Fixed settings (tests and single-tenant private installs wired in code). */
export class StaticSettingsSource implements AiSettingsSource {
  constructor(private readonly settings: AiModelSettings | null) {}
  async get() {
    return this.settings;
  }
}

/**
 * Admins type the model server URL, so refuse cloud metadata and link-local addresses
 * (a classic SSRF target). Private-network hosts such as http://ollama:11434 are allowed:
 * that is where a self-hosted model server lives.
 */
export function assertSafeModelUrl(raw: string): void {
  const u = new URL(raw);
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'metadata.google.internal' || host === 'metadata' || host.endsWith('.metadata'))
    throw new Error('That address is not allowed for a model server');
  if (isIP(host) === 4 && (host.startsWith('169.254.') || host === '0.0.0.0'))
    throw new Error('Link-local addresses are not allowed for a model server');
  if (isIP(host) === 6 && (host.startsWith('fe80:') || host === '::'))
    throw new Error('Link-local addresses are not allowed for a model server');
}

/** Maps integration-store values ({ baseUrl, apiKey, chatModel, embeddingModel, timeoutMs }). */
export function settingsFromValues(values: Record<string, unknown>): AiModelSettings | null {
  const baseUrl = typeof values.baseUrl === 'string' ? values.baseUrl.trim() : '';
  const chatModel = typeof values.chatModel === 'string' ? values.chatModel.trim() : '';
  if (!baseUrl || !chatModel) return null;
  assertSafeModelUrl(baseUrl);
  const timeout = Number(values.timeoutMs);
  return {
    baseUrl,
    apiKey: typeof values.apiKey === 'string' && values.apiKey ? values.apiKey : null,
    chatModel,
    embeddingModel:
      typeof values.embeddingModel === 'string' && values.embeddingModel.trim()
        ? values.embeddingModel.trim()
        : null,
    timeoutMs: Number.isFinite(timeout) && timeout >= 1000 ? Math.min(timeout, 120_000) : 30_000,
  };
}

/**
 * The provided AI_SETTINGS_SOURCE: delegates to an inner source that can be swapped at runtime
 * (the integration-settings store on boot; fixed settings in tests).
 */
export class SwappableSettingsSource implements AiSettingsSource {
  private inner: AiSettingsSource = new NoModelSettingsSource();
  private readonly listeners: ((tenantId: string | null) => void)[] = [];

  use(inner: AiSettingsSource): void {
    this.inner = inner;
    inner.onChange?.((tenantId) => this.emit(tenantId));
    this.emit(null);
  }
  get(tenantId: string) {
    return this.inner.get(tenantId);
  }
  onChange(fn: (tenantId: string | null) => void): void {
    this.listeners.push(fn);
  }
  private emit(tenantId: string | null) {
    for (const fn of this.listeners) fn(tenantId);
  }
}
