import { CONNECTOR_CATALOG } from '@sampledge/contracts';
import type { ConnectorAdapter, InboundMessage } from './types.js';
import { WebhookRejected } from './types.js';
import { expectOk, hmacBase64, parseJson, randomSecret, requireHeader, safeEqual } from './util.js';

const API = 'https://api.line.me';

interface LineEvent {
  type: string;
  webhookEventId?: string;
  timestamp: number;
  source: { type: 'user' | 'group' | 'room'; userId?: string; groupId?: string; roomId?: string };
  message?: { id: string; type: string; text?: string; fileName?: string; fileSize?: number };
}

export const lineAdapter: ConnectorAdapter = {
  provider: 'line',
  descriptor: CONNECTOR_CATALOG.line,
  testCredentials: () => ({
    channelSecret: randomSecret(16),
    channelAccessToken: `test-${randomSecret(40)}`,
  }),

  verifyWebhook(req, c) {
    const sig = requireHeader(req.headers, 'x-line-signature');
    if (!safeEqual(sig, hmacBase64(c.channelSecret ?? '', req.rawBody)))
      throw new WebhookRejected('LINE signature mismatch');
  },

  parseWebhook(req) {
    const body = parseJson<{ events?: LineEvent[] }>(req.rawBody);
    const messages: InboundMessage[] = [];
    for (const e of body.events ?? []) {
      if (e.type !== 'message' || !e.message || !e.source.userId) continue;
      const m = e.message;
      const thread = e.source.groupId ?? e.source.roomId ?? e.source.userId;
      const attachments: InboundMessage['attachments'] =
        m.type === 'text' || m.type === 'sticker'
          ? []
          : [
              {
                name: m.fileName ?? `${m.type}`,
                mimeType: null,
                sizeBytes: m.fileSize ?? null,
                externalRef: m.id,
              },
            ];
      messages.push({
        externalMessageId: e.webhookEventId ?? m.id,
        externalThreadId: thread,
        replyContext: { to: thread },
        // LINE does not include names in webhooks; the profile API is a follow-up call (planned).
        from: {
          externalUserId: e.source.userId,
          displayName: `LINE user ${e.source.userId.slice(-6)}`,
          handle: null,
        },
        text: m.type === 'text' ? (m.text ?? '') : m.type === 'sticker' ? '(sticker)' : '',
        attachments,
        sentAt: new Date(e.timestamp),
      });
    }
    return { messages };
  },

  buildTestWebhook(input, c) {
    const userId =
      input.threadId ||
      `U${Buffer.from(input.fromHandle).toString('hex').padEnd(32, '0').slice(0, 32)}`;
    const body = JSON.stringify({
      destination: 'Utest',
      events: [
        {
          type: 'message',
          mode: 'active',
          webhookEventId: `01${randomSecret(12)}`,
          timestamp: Date.now(),
          source: { type: 'user', userId },
          message: { id: String(Math.floor(Math.random() * 1e12)), type: 'text', text: input.text },
        },
      ],
    });
    return {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-line-signature': hmacBase64(c.channelSecret!, body),
      },
      query: {},
      rawBody: Buffer.from(body),
    };
  },

  async send(text, ctx) {
    const res = await ctx.http.request({
      method: 'POST',
      url: `${API}/v2/bot/message/push`,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ctx.credentials.channelAccessToken}`,
      },
      secretHeaders: ['authorization'],
      body: { to: ctx.replyContext.to ?? ctx.externalThreadId, messages: [{ type: 'text', text }] },
    });
    const b = expectOk(res, 'LINE push') as { sentMessages?: { id: string }[] };
    return { kind: 'sent', externalMessageId: b.sentMessages?.[0]?.id ?? null };
  },

  async testConnection(ctx) {
    const res = await ctx.http.request({
      method: 'GET',
      url: `${API}/v2/bot/info`,
      headers: { authorization: `Bearer ${ctx.credentials.channelAccessToken}` },
      secretHeaders: ['authorization'],
    });
    const b = expectOk(res, 'LINE bot info') as { displayName?: string };
    return `Connected as ${b.displayName ?? 'LINE Official Account'}`;
  },

  sandboxResponse(req) {
    if (req.url.endsWith('/v2/bot/info'))
      return { displayName: 'Sandbox Official Account', userId: 'Utest' };
    return { sentMessages: [{ id: String(Math.floor(Math.random() * 1e12)), quoteToken: 'q' }] };
  },
};
