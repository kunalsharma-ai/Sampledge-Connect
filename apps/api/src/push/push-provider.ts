import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import webpush from 'web-push';
import type { IntegrationProviderDef, WebPushPayload } from '@sampledge/contracts';
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
  readonly name: 'expo' | 'webpush' | null;
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

/**
 * Browser push (Web Push with VAPID, RFC 8030/8291/8292). The token is the browser's
 * PushSubscription JSON. Payloads are encrypted end to end by the library.
 */
export class WebPushProvider implements PushProvider {
  readonly name = 'webpush' as const;
  private readonly log = new Logger('WebPush');
  constructor(
    private readonly vapid: { subject: string; publicKey: string; privateKey: string },
    private readonly send_: WebPushSender = (...a) => webpush.sendNotification(...a),
  ) {}

  accepts(provider: string) {
    return provider === 'webpush';
  }

  async send(messages: PushMessage[]): Promise<{ invalidTokens: string[] }> {
    const invalidTokens: string[] = [];
    await Promise.all(
      messages.map(async (m) => {
        let sub: webpush.PushSubscription;
        try {
          sub = JSON.parse(m.token) as webpush.PushSubscription;
        } catch {
          invalidTokens.push(m.token);
          return;
        }
        const payload: WebPushPayload = {
          title: m.title,
          body: m.body,
          url: webUrl(m.data),
          tag: String(m.data.conversationId ?? m.data.type ?? 'connect'),
          data: m.data,
          ...(m.badge !== undefined ? { badge: m.badge } : {}),
        };
        try {
          await this.send_(sub, JSON.stringify(payload), {
            vapidDetails: this.vapid,
            TTL: m.data.type === 'call' ? 60 : 24 * 3600,
            urgency: m.data.type === 'call' ? 'high' : 'normal',
            timeout: 10_000,
          });
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          // 404/410: the browser unsubscribed or the subscription expired.
          if (status === 404 || status === 410) invalidTokens.push(m.token);
          else this.log.warn(`Web push failed (${status ?? 'network'}): ${(e as Error).message}`);
        }
      }),
    );
    return { invalidTokens };
  }
}

export type WebPushSender = (...a: Parameters<typeof webpush.sendNotification>) => Promise<unknown>;

/** Where a click on the notification should land. */
function webUrl(data: Record<string, unknown>): string {
  const q = new URLSearchParams();
  if (typeof data.conversationId === 'string') q.set('c', data.conversationId);
  if (typeof data.messageId === 'string') q.set('m', data.messageId);
  if (data.type === 'call' && typeof data.callId === 'string') q.set('call', data.callId);
  const s = q.toString();
  return s ? `/app?${s}` : '/app';
}

export const WEB_PUSH_PROVIDER: IntegrationProviderDef = {
  id: 'push.web',
  label: 'Browser notifications',
  description:
    'Desktop and mobile browser notifications through the browsers’ own push services (Web Push). Keys are generated for you when you turn this on.',
  category: 'communication',
  scopes: ['tenant', 'platform'],
  testable: true,
  fields: [
    {
      key: 'subject',
      label: 'Contact email',
      type: 'email',
      required: true,
      help: 'Browser push services use it to reach you about problems. Not shown to people.',
    },
    {
      key: 'showPreviews',
      label: 'Show message text in notifications',
      type: 'boolean',
      default: true,
    },
    {
      key: 'publicKey',
      label: 'Public key (VAPID)',
      type: 'string',
      help: 'Leave empty to generate a key pair. Changing it signs every browser out of notifications.',
    },
    { key: 'privateKey', label: 'Private key (VAPID)', type: 'secret' },
  ],
};

function vapidSubject(subject: string) {
  return /^(mailto:|https:)/.test(subject) ? subject : `mailto:${subject}`;
}

export interface TenantPushProvider extends PushProvider {
  /** Whether message text may appear for a token from this provider. */
  showPreviewsFor(provider: string): boolean;
}

/** Sends each message through whichever configured provider accepts its token. */
class CompositePushProvider implements TenantPushProvider {
  readonly name: 'expo' | 'webpush' | null;
  constructor(private readonly parts: { p: PushProvider; showPreviews: boolean }[]) {
    this.name = parts[0]?.p.name ?? null;
  }
  accepts(provider: string) {
    return this.parts.some((x) => x.p.accepts(provider));
  }
  showPreviewsFor(provider: string) {
    return this.parts.find((x) => x.p.accepts(provider))?.showPreviews ?? true;
  }
  /** Messages carry their provider in `data.__provider` (set by the caller via tokenProvider). */
  async send(messages: PushMessage[]) {
    const invalidTokens: string[] = [];
    for (const { p } of this.parts) {
      const mine = messages.filter((m) => p.accepts(tokenProvider(m)));
      if (!mine.length) continue;
      const r = await p.send(mine.map(stripProvider));
      invalidTokens.push(...r.invalidTokens);
    }
    return { invalidTokens };
  }
}

const PROVIDER_KEY = '__provider';
/** Tag a message with the provider its token belongs to (so a composite can route it). */
export function forProvider(m: PushMessage, provider: string): PushMessage {
  return { ...m, data: { ...m.data, [PROVIDER_KEY]: provider } };
}
function tokenProvider(m: PushMessage) {
  return String(m.data[PROVIDER_KEY] ?? 'expo');
}
function stripProvider(m: PushMessage): PushMessage {
  const { [PROVIDER_KEY]: _drop, ...data } = m.data;
  return { ...m, data };
}

/**
 * Resolves push providers per tenant from the integration settings store
 * (`push.expo`, `push.web`), falling back to legacy env for Expo (PUSH_PROVIDER=expo).
 * Changes apply without a restart.
 */
@Injectable()
export class PushProviders implements OnModuleInit {
  private readonly log = new Logger('PushProviders');
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
    this.settings.register(WEB_PUSH_PROVIDER, {
      test: async (values) => {
        if (!values.publicKey || !values.privateKey)
          return {
            ok: true,
            message: 'Keys will be generated the first time a browser asks to subscribe',
          };
        // Throws on a malformed key pair or subject.
        webpush.generateRequestDetails(
          { endpoint: 'https://push.example.invalid/x', keys: TEST_KEYS },
          null,
          {
            vapidDetails: {
              subject: vapidSubject(String(values.subject)),
              publicKey: String(values.publicKey),
              privateKey: String(values.privateKey),
            },
          },
        );
        return { ok: true, message: 'The key pair is valid and ready to sign notifications' };
      },
    });
  }

  /**
   * The tenant's Web Push keys, generating and storing a pair on first use. Keys are saved
   * where the settings came from (tenant or platform), so every tenant sharing a platform
   * setting shares its keys.
   */
  async webVapid(
    tenantId: string,
  ): Promise<{
    subject: string;
    publicKey: string;
    privateKey: string;
    showPreviews: boolean;
  } | null> {
    const s = await this.settings.get(tenantId, WEB_PUSH_PROVIDER.id);
    if (!s?.enabled || !s.values.subject) return null;
    let publicKey = s.values.publicKey ? String(s.values.publicKey) : '';
    let privateKey = s.values.privateKey ? String(s.values.privateKey) : '';
    if (!publicKey || !privateKey) {
      const keys = webpush.generateVAPIDKeys();
      publicKey = keys.publicKey;
      privateKey = keys.privateKey;
      await this.settings.save(
        { tenantId: s.source === 'platform' ? null : tenantId },
        WEB_PUSH_PROVIDER.id,
        { enabled: true, values: { ...s.values, publicKey, privateKey } },
        null,
      );
      this.log.log(
        `Generated Web Push keys for ${s.source === 'platform' ? 'the platform' : tenantId}`,
      );
    }
    return {
      subject: vapidSubject(String(s.values.subject)),
      publicKey,
      privateKey,
      showPreviews: s.values.showPreviews !== false,
    };
  }

  async forTenant(tenantId: string): Promise<TenantPushProvider> {
    const parts: { p: PushProvider; showPreviews: boolean }[] = [];
    const expo = await this.settings.get(tenantId, 'push.expo');
    if (expo?.enabled)
      parts.push({
        p: new ExpoPushProvider({
          EXPO_PUSH_URL: this.cfg.EXPO_PUSH_URL,
          EXPO_ACCESS_TOKEN: (expo.values.accessToken as string | null) ?? undefined,
        }),
        showPreviews: expo.values.showPreviews !== false,
      });
    const web = await this.webVapid(tenantId).catch((e: Error) => {
      this.log.warn(`Web Push keys unavailable: ${e.message}`);
      return null;
    });
    if (web)
      parts.push({
        p: new WebPushProvider(web, this.webSender ?? undefined),
        showPreviews: web.showPreviews,
      });
    return new CompositePushProvider(parts);
  }

  /** Tests swap the network send for a recorder. */
  webSender: WebPushSender | null = null;
}

/** A syntactically valid subscription key pair, used only to check VAPID settings offline. */
const TEST_KEYS = {
  p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
  auth: 'tBHItJI5svbpez7KI4CCXg',
};
