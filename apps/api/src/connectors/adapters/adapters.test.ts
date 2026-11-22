import { describe, expect, it } from 'vitest';
import { CONNECTOR_CATALOG, CONNECTOR_PROVIDERS } from '@sampledge/contracts';
import { ADAPTERS, WebhookRejected } from './index.js';
import { redact } from '../transport.js';

const input = { fromName: 'Ana Lima', fromHandle: '@ana', text: 'Olá, any update?', threadId: '' };
const webhookProviders = CONNECTOR_PROVIDERS.filter((p) => ADAPTERS[p].verifyWebhook);

describe('connector adapters', () => {
  it('registers an adapter and a catalog entry for every provider', () => {
    for (const p of CONNECTOR_PROVIDERS) {
      expect(ADAPTERS[p].provider).toBe(p);
      expect(ADAPTERS[p].descriptor).toBe(CONNECTOR_CATALOG[p]);
    }
    expect(webhookProviders).toHaveLength(10);
  });

  for (const p of webhookProviders) {
    describe(p, () => {
      const a = ADAPTERS[p];
      it('accepts its own signed request and parses the message', async () => {
        const creds = a.testCredentials();
        const req = await a.buildTestWebhook!(input, creds, '/hook');
        await a.verifyWebhook!(req, creds);
        const parsed = a.parseWebhook!(req, creds);
        expect(parsed.messages).toHaveLength(1);
        expect(parsed.messages[0]!.text).toBe(input.text);
        expect(parsed.messages[0]!.externalThreadId).toBeTruthy();
        expect(parsed.messages[0]!.externalMessageId).toBeTruthy();
      });

      it('rejects a tampered body', async () => {
        const creds = a.testCredentials();
        const req = await a.buildTestWebhook!(input, creds, '/hook');
        const tampered = {
          ...req,
          rawBody: Buffer.from(req.rawBody.toString().replace('any update', 'send money')),
        };
        if (p === 'telegram' || p === 'mattermost' || p === 'wechat') {
          // Token-based providers (and WeChat plain mode) authenticate the sender, not the body; a wrong token must fail.
          await expect(async () =>
            a.verifyWebhook!(req, { ...creds, webhookSecret: 'x', webhookToken: 'x', token: 'x' }),
          ).rejects.toBeInstanceOf(WebhookRejected);
          return;
        }
        if (p === 'teams' || p === 'google_chat') {
          // Bearer-token providers: a token for another audience must fail.
          await expect(async () =>
            a.verifyWebhook!(req, { ...creds, appId: 'other', projectNumber: 'other' }),
          ).rejects.toBeInstanceOf(WebhookRejected);
          return;
        }
        await expect(async () => a.verifyWebhook!(tampered, creds)).rejects.toBeInstanceOf(
          WebhookRejected,
        );
      });

      it('rejects credentials from another connector', async () => {
        const req = await a.buildTestWebhook!(input, a.testCredentials(), '/hook');
        await expect(async () => a.verifyWebhook!(req, a.testCredentials())).rejects.toBeInstanceOf(
          WebhookRejected,
        );
      });
    });
  }

  it('handoff adapters build deep links and never call the network', async () => {
    const ctx = {
      credentials: {},
      http: {
        sandbox: true,
        request: async () => {
          throw new Error('no network');
        },
      },
      tokens: { get: async () => null, set: async () => undefined },
      externalThreadId: '+44 7700 900123',
      replyContext: {},
      clientHandle: '+44 7700 900123',
      testMode: false,
    };
    expect(await ADAPTERS.signal.send('hi', ctx)).toEqual({
      kind: 'handoff',
      url: 'https://signal.me/#p/%2B447700900123',
    });
    expect(await ADAPTERS.imessage.send('see you', ctx)).toEqual({
      kind: 'handoff',
      url: 'sms:%2B447700900123&body=see%20you',
    });
  });

  it('redacts secrets from captured requests', () => {
    const r = redact(
      {
        method: 'POST',
        url: 'https://api.telegram.org/bot123:SECRET-TOKEN/sendMessage',
        headers: { authorization: 'Bearer abc', x: 'SECRET-TOKEN' },
        secretHeaders: ['authorization'],
        body: { t: 'SECRET-TOKEN' },
      },
      ['123:SECRET-TOKEN', 'SECRET-TOKEN'],
    );
    expect(JSON.stringify(r)).not.toContain('SECRET');
    expect(r.headers.authorization).toBe('••••');
  });
});
