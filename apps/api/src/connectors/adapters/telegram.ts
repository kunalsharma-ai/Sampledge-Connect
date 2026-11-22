import { CONNECTOR_CATALOG } from '@sampledge/contracts';
import type { ConnectorAdapter, InboundMessage } from './types.js';
import { ProviderError, WebhookRejected } from './types.js';
import { expectOk, parseJson, randomSecret, requireHeader, safeEqual, str } from './util.js';

const API = 'https://api.telegram.org';

interface TgMessage {
  message_id: number;
  date: number;
  edit_date?: number;
  chat: { id: number; type: string; title?: string };
  from?: { id: number; first_name?: string; last_name?: string; username?: string };
  text?: string;
  caption?: string;
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
  photo?: { file_id: string; file_size?: number }[];
}

export const telegramAdapter: ConnectorAdapter = {
  provider: 'telegram',
  descriptor: CONNECTOR_CATALOG.telegram,
  testCredentials: () => ({
    botToken: `100000${Math.floor(Math.random() * 1000)}:TEST-${randomSecret(16)}`,
    webhookSecret: randomSecret(32),
  }),

  verifyWebhook(req, c) {
    const got = requireHeader(req.headers, 'x-telegram-bot-api-secret-token');
    if (!safeEqual(got, c.webhookSecret ?? '')) throw new WebhookRejected('Secret token mismatch');
  },

  parseWebhook(req) {
    const u = parseJson<{ update_id: number; message?: TgMessage; edited_message?: TgMessage }>(
      req.rawBody,
    );
    const m = u.message ?? u.edited_message;
    if (!m || !m.from) return { messages: [] };
    const attachments: InboundMessage['attachments'] = [];
    if (m.document)
      attachments.push({
        name: m.document.file_name ?? 'file',
        mimeType: m.document.mime_type ?? null,
        sizeBytes: m.document.file_size ?? null,
        externalRef: m.document.file_id,
      });
    if (m.photo?.length) {
      const p = m.photo[m.photo.length - 1]!;
      attachments.push({
        name: 'photo.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: p.file_size ?? null,
        externalRef: p.file_id,
      });
    }
    const text = m.text ?? m.caption ?? '';
    if (!text && !attachments.length) return { messages: [] };
    const name =
      [m.from.first_name, m.from.last_name].filter(Boolean).join(' ') ||
      m.from.username ||
      String(m.from.id);
    return {
      messages: [
        {
          externalMessageId: `${m.chat.id}:${m.message_id}${m.edit_date ? `:e${m.edit_date}` : ''}`,
          externalThreadId: String(m.chat.id),
          replyContext: {},
          from: {
            externalUserId: String(m.from.id),
            displayName: name,
            handle: m.from.username ? `@${m.from.username}` : null,
          },
          text: m.edit_date ? `${text} (edited)` : text,
          attachments,
          subject: m.chat.title ?? null,
          sentAt: new Date(m.date * 1000),
        },
      ],
    };
  },

  buildTestWebhook(input, c) {
    const id =
      Number(input.threadId) ||
      700000 + Buffer.from(input.fromHandle).reduce((a, b) => (a * 31 + b) % 9_000_000, 7);
    const [first, ...rest] = input.fromName.split(' ');
    const body = {
      update_id: Math.floor(Math.random() * 1e9),
      message: {
        message_id: Math.floor(Math.random() * 1e6),
        date: Math.floor(Date.now() / 1000),
        chat: { id, type: 'private' },
        from: {
          id,
          is_bot: false,
          first_name: first,
          last_name: rest.join(' ') || undefined,
          username: input.fromHandle.replace(/^@/, ''),
        },
        text: input.text,
      },
    };
    return {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-telegram-bot-api-secret-token': c.webhookSecret!,
      },
      query: {},
      rawBody: Buffer.from(JSON.stringify(body)),
    };
  },

  async send(text, ctx) {
    const res = await ctx.http.request({
      method: 'POST',
      url: `${API}/bot${ctx.credentials.botToken}/sendMessage`,
      headers: { 'content-type': 'application/json' },
      body: { chat_id: ctx.externalThreadId, text },
    });
    const body = res.json as {
      ok?: boolean;
      result?: { message_id?: number };
      parameters?: { retry_after?: number };
      description?: string;
    };
    if (res.status === 429)
      throw new ProviderError(
        `Telegram: ${body.description ?? 'rate limited'}`,
        'retry',
        (body.parameters?.retry_after ?? 1) * 1000,
      );
    expectOk(res, 'Telegram sendMessage');
    return {
      kind: 'sent',
      externalMessageId: `${ctx.externalThreadId}:${str(body.result?.message_id)}`,
    };
  },

  async testConnection(ctx) {
    const res = await ctx.http.request({
      method: 'GET',
      url: `${API}/bot${ctx.credentials.botToken}/getMe`,
      headers: {},
    });
    const b = expectOk(res, 'Telegram getMe') as { result?: { username?: string } };
    return `Connected as @${b.result?.username ?? 'bot'}`;
  },

  sandboxResponse(req) {
    if (req.url.endsWith('/getMe'))
      return { ok: true, result: { id: 1, is_bot: true, username: 'sampledge_test_bot' } };
    return {
      ok: true,
      result: { message_id: Math.floor(Math.random() * 1e6), date: Math.floor(Date.now() / 1000) },
    };
  },
};
