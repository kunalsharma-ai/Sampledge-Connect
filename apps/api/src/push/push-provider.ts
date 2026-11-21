import { Logger } from '@nestjs/common';
import type { AppConfig } from '../config/config.js';

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

export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');

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

export function createPushProvider(cfg: AppConfig): PushProvider {
  return cfg.PUSH_PROVIDER === 'expo' ? new ExpoPushProvider(cfg) : new NoopPushProvider();
}
