import { CONNECTOR_CATALOG } from '@sampledge/contracts';
import type { ConnectorAdapter } from './types.js';
import { WebhookRejected } from './types.js';
import { expectOk, randomSecret, safeEqual, str } from './util.js';

const base = (u: string | undefined) => (u ?? '').replace(/\/+$/, '');

/** Outgoing webhooks post JSON or form-encoded bodies depending on the webhook's content type. */
function body(raw: Buffer, contentType: string): Record<string, string> {
  const text = raw.toString('utf8');
  if (contentType.includes('application/x-www-form-urlencoded'))
    return Object.fromEntries(new URLSearchParams(text));
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(j).map(([k, v]) => [k, str(v)]));
  } catch {
    throw new WebhookRejected('Body is not JSON or form data');
  }
}

export const mattermostAdapter: ConnectorAdapter = {
  provider: 'mattermost',
  descriptor: CONNECTOR_CATALOG.mattermost,
  testCredentials: () => ({
    serverUrl: 'https://mattermost.sandbox.invalid',
    botToken: randomSecret(20),
    webhookToken: randomSecret(20),
  }),

  verifyWebhook(req, c) {
    const b = body(req.rawBody, req.headers['content-type'] ?? '');
    if (!b.token || !safeEqual(b.token, c.webhookToken ?? ''))
      throw new WebhookRejected('Webhook token mismatch');
  },

  parseWebhook(req) {
    const b = body(req.rawBody, req.headers['content-type'] ?? '');
    if (!b.user_id || !b.channel_id || !b.post_id) return { messages: [] };
    return {
      messages: [
        {
          externalMessageId: b.post_id,
          externalThreadId: b.channel_id,
          replyContext: { channelId: b.channel_id },
          from: {
            externalUserId: b.user_id,
            displayName: b.user_name || b.user_id,
            handle: b.user_name ? `@${b.user_name}` : null,
          },
          text: b.text ?? '',
          attachments: [],
          subject: b.channel_name ? `~${b.channel_name}` : null,
          sentAt: b.timestamp ? new Date(Number(b.timestamp)) : new Date(),
        },
      ],
      // An empty response tells Mattermost not to post anything back.
      response: { status: 200, body: {} },
    };
  },

  buildTestWebhook(input, c) {
    const user = input.fromHandle.replace(/^@/, '');
    const raw = JSON.stringify({
      token: c.webhookToken,
      team_id: 'sandboxteam',
      channel_id: input.threadId || `dm-${user}`,
      channel_name: `dm-${user}`,
      timestamp: Date.now(),
      user_id: `u-${user}`,
      user_name: user,
      post_id: randomSecret(13),
      text: input.text,
      trigger_word: '',
    });
    return {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      query: {},
      rawBody: Buffer.from(raw),
    };
  },

  async send(text, ctx) {
    const res = await ctx.http.request({
      method: 'POST',
      url: `${base(ctx.credentials.serverUrl)}/api/v4/posts`,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ctx.credentials.botToken}`,
      },
      secretHeaders: ['authorization'],
      body: { channel_id: ctx.replyContext.channelId ?? ctx.externalThreadId, message: text },
    });
    const b = expectOk(res, 'Mattermost create post') as { id?: string };
    return { kind: 'sent', externalMessageId: b.id ?? null };
  },

  async testConnection(ctx) {
    const res = await ctx.http.request({
      method: 'GET',
      url: `${base(ctx.credentials.serverUrl)}/api/v4/users/me`,
      headers: { authorization: `Bearer ${ctx.credentials.botToken}` },
      secretHeaders: ['authorization'],
    });
    const b = expectOk(res, 'Mattermost users/me') as { username?: string };
    return `Connected as @${b.username ?? 'bot'}`;
  },

  sandboxResponse(req) {
    if (req.url.endsWith('/users/me')) return { id: 'bot', username: 'sampledge-bot' };
    return { id: randomSecret(13), create_at: Date.now() };
  },
};
