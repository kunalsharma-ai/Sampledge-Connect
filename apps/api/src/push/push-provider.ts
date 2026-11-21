import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service.js';

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  badge?: number;
}

export interface PushProvider {
  readonly name: 'expo' | null;
  /** Which token providers this sender can deliver to. */
  accepts(provider: string): boolean;
  /** Returns tokens the provider reported as permanently invalid (to be cleared). */
  send(messages: PushMessage[]): Promise<{ invalidTokens: string[] }>;
}

/** Stores tokens, sends nothing. Used until a provider is configured. */
export class NoopPushProvider implements PushProvider {
  readonly name = null;
  accepts() {
    return false;
  }
  async send() {
    return { invalidTokens: [] };
  }
}

/** Expo Push API (https://docs.expo.dev/push-notifications/sending-notifications/). */
export class ExpoPushProvider implements PushProvider {
  readonly name = 'expo' as const;
  private readonly log = new Logger('ExpoPush');
  constructor(private readonly cfg: Pick<AppConfig, 'EXPO_PUSH_URL' | 'EXPO_ACCESS_TOKEN'>) {}

  accepts(provider: string) {
    return provider === 'expo';
  }

  async send(messages: PushMessage[]): Promise<{ invalidTokens: string[] }> {
    const invalidTokens: string[] = [];
    // Expo accepts up to 100 messages per request.
    for (let i = 0; i < messages.length; i += 100) {
      const batch = messages.slice(i, i + 100);
      const res = await fetch(this.cfg.EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(this.cfg.EXPO_ACCESS_TOKEN
            ? { authorization: `Bearer ${this.cfg.EXPO_ACCESS_TOKEN}` }
            : {}),
        },
        body: JSON.stringify(
          batch.map((m) => ({
            to: m.token,
            title: m.title,
            body: m.body,
            data: m.data,
            sound: 'default',
            ...(m.badge !== undefined ? { badge: m.badge } : {}),
          })),
        ),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        this.log.warn(`Expo push request failed: HTTP ${res.status}`);
        continue;
      }
      const json = (await res.json()) as {
        data?: { status: string; details?: { error?: string } }[];
      };
      json.data?.forEach((t, j) => {
        if (t.status === 'error' && t.details?.error === 'DeviceNotRegistered')
          invalidTokens.push(batch[j]!.token);
      });
    }
    return { invalidTokens };
  }
}

export interface TenantPushProvider extends PushProvider {
  showPreviews: boolean;
}

/**
 * Resolves the push provider per tenant from the integration settings store
 * (`push.expo`), falling back to legacy env (PUSH_PROVIDER=expo). Changes apply
 * without a restart.
 */
@Injectable()
export class PushProviders implements OnModuleInit {
  constructor(
    private readonly settings: IntegrationSettingsService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  onModuleInit() {
    this.settings.attach('push.expo', {
      envFallback: (cfg) =>
        cfg.PUSH_PROVIDER === 'expo'
          ? { accessToken: cfg.EXPO_ACCESS_TOKEN ?? null, showPreviews: cfg.PUSH_SHOW_PREVIEWS }
          : null,
      // Valid credentials can read (empty) receipts; a bad access token gets 401.
      test: async (values) => {
        const url = this.cfg.EXPO_PUSH_URL.replace(/\/send$/, '/getReceipts');
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(values.accessToken
              ? { authorization: `Bearer ${String(values.accessToken)}` }
              : {}),
          },
          body: JSON.stringify({ ids: [] }),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) return { ok: true, message: 'Expo Push accepted the credentials' };
        return { ok: false, message: `Expo Push answered HTTP ${res.status}` };
      },
    });
  }

  async forTenant(tenantId: string): Promise<TenantPushProvider> {
    const s = await this.settings.get(tenantId, 'push.expo');
    if (!s?.enabled) return Object.assign(new NoopPushProvider(), { showPreviews: true });
    const p = new ExpoPushProvider({
      EXPO_PUSH_URL: this.cfg.EXPO_PUSH_URL,
      EXPO_ACCESS_TOKEN: (s.values.accessToken as string | null) ?? undefined,
    });
    return Object.assign(p, { showPreviews: s.values.showPreviews !== false });
  }
}
