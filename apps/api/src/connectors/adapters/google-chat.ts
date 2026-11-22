import { CONNECTOR_CATALOG } from '@sampledge/contracts';
import type { ConnectorAdapter, OutboundContext } from './types.js';
import { ProviderError, WebhookRejected } from './types.js';
import { expectOk, parseJson, randomSecret } from './util.js';
import { signAssertion, signTestToken, testRsaKey, verifyBearer } from './jwt.js';

const ISSUER = 'chat@system.gserviceaccount.com';
const JWKS = 'https://www.googleapis.com/service_accounts/v1/jwk/chat@system.gserviceaccount.com';

interface ChatEvent {
  type: string;
  eventTime?: string;
  message?: {
    name: string;
    text?: string;
    argumentText?: string;
    thread?: { name: string };
    sender: { name: string; displayName?: string; email?: string; type?: string };
    attachment?: { name: string; contentName?: string; contentType?: string }[];
  };
  space?: { name: string; displayName?: string; type?: string; spaceType?: string };
}

function serviceAccount(json: string | undefined): { client_email: string; private_key: string } {
  try {
    const sa = JSON.parse(json ?? '') as { client_email?: string; private_key?: string };
    if (sa.client_email && sa.private_key)
      return { client_email: sa.client_email, private_key: sa.private_key };
  } catch {
    /* fall through */
  }
  throw new ProviderError('Google Chat: service account JSON is invalid', 'auth');
}

async function accessToken(ctx: Pick<OutboundContext, 'credentials' | 'http' | 'tokens'>) {
  const cached = await ctx.tokens.get();
  if (cached) return cached;
  const sa = serviceAccount(ctx.credentials.serviceAccountJson);
  const assertion = await signAssertion(sa.private_key, {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/chat.bot',
    aud: 'https://oauth2.googleapis.com/token',
  });
  const res = await ctx.http.request({
    method: 'POST',
    url: 'https://oauth2.googleapis.com/token',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });
  if (res.status === 400 || res.status === 401)
    throw new ProviderError('Google Chat: service account rejected', 'auth');
  const b = expectOk(res, 'Google token') as { access_token?: string; expires_in?: number };
  if (!b.access_token) throw new ProviderError('Google Chat: no access token', 'retry');
  await ctx.tokens.set(b.access_token, (b.expires_in ?? 3600) - 300);
  return b.access_token;
}

export const googleChatAdapter: ConnectorAdapter = {
  provider: 'google_chat',
  descriptor: CONNECTOR_CATALOG.google_chat,
  testCredentials: () => {
    const key = testRsaKey();
    return {
      projectNumber: String(100000000000 + Math.floor(Math.random() * 1e9)),
      serviceAccountJson: JSON.stringify({
        type: 'service_account',
        client_email: 'sandbox@sampledge-test.iam.gserviceaccount.com',
        private_key: key,
      }),
      testSigningKey: key,
    };
  },

  async verifyWebhook(req, c) {
    await verifyBearer(req.headers.authorization, {
      jwksUrl: JWKS,
      issuer: ISSUER,
      audience: c.projectNumber ?? '',
      testSigningKey: c.testSigningKey,
    });
  },

  parseWebhook(req) {
    const e = parseJson<ChatEvent>(req.rawBody);
    const m = e.message;
    if (e.type !== 'MESSAGE' || !m || !e.space || m.sender.type === 'BOT')
      return { messages: [], response: { status: 200, body: {} } };
    if (!m.name) throw new WebhookRejected('Message without name');
    const dm = e.space.type === 'DM' || e.space.spaceType === 'DIRECT_MESSAGE';
    return {
      messages: [
        {
          externalMessageId: m.name,
          externalThreadId: dm ? e.space.name : `${e.space.name}:${m.thread?.name ?? m.name}`,
          replyContext: {
            space: e.space.name,
            ...(m.thread && !dm ? { thread: m.thread.name } : {}),
          },
          from: {
            externalUserId: m.sender.name,
            displayName: m.sender.displayName ?? m.sender.name,
            handle: m.sender.email ?? null,
            email: m.sender.email ?? null,
          },
          text: (m.argumentText ?? m.text ?? '').trim(),
          attachments: (m.attachment ?? []).map((a) => ({
            name: a.contentName ?? 'file',
            mimeType: a.contentType ?? null,
            sizeBytes: null,
            externalRef: a.name,
          })),
          subject: e.space.displayName ?? null,
          sentAt: e.eventTime ? new Date(e.eventTime) : new Date(),
        },
      ],
      // Reply asynchronously from the inbox; an empty body posts nothing now.
      response: { status: 200, body: {} },
    };
  },

  async buildTestWebhook(input, c) {
    const space =
      input.threadId || `spaces/${Buffer.from(input.fromHandle).toString('hex').slice(0, 12)}`;
    const raw = JSON.stringify({
      type: 'MESSAGE',
      eventTime: new Date().toISOString(),
      space: { name: space, type: 'DM', spaceType: 'DIRECT_MESSAGE' },
      message: {
        name: `${space}/messages/${randomSecret(10)}`,
        text: input.text,
        sender: {
          name: `users/${Buffer.from(input.fromHandle).toString('hex').slice(0, 16)}`,
          displayName: input.fromName,
          email: input.email ?? null,
          type: 'HUMAN',
        },
      },
    });
    const token = await signTestToken(c.testSigningKey!, { iss: ISSUER, aud: c.projectNumber! });
    return {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      query: {},
      rawBody: Buffer.from(raw),
    };
  },

  async send(text, ctx) {
    const token = await accessToken(ctx);
    const space = ctx.replyContext.space ?? ctx.externalThreadId;
    if (!/^spaces\/[\w-]+$/.test(space))
      throw new ProviderError('Google Chat: invalid space', 'fatal');
    const res = await ctx.http.request({
      method: 'POST',
      url: `https://chat.googleapis.com/v1/${space}/messages${ctx.replyContext.thread ? '?messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD' : ''}`,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      secretHeaders: ['authorization'],
      body: {
        text,
        ...(ctx.replyContext.thread ? { thread: { name: ctx.replyContext.thread } } : {}),
      },
    });
    if (res.status === 401) await ctx.tokens.set('', 0);
    const b = expectOk(res, 'Google Chat create message') as { name?: string };
    return { kind: 'sent', externalMessageId: b.name ?? null };
  },

  async testConnection(ctx) {
    await accessToken(ctx);
    return 'Service account accepted (access token issued)';
  },

  sandboxResponse(req) {
    if (req.url.includes('oauth2.googleapis.com/token'))
      return {
        access_token: `sandbox.${randomSecret(20)}`,
        expires_in: 3599,
        token_type: 'Bearer',
      };
    return { name: `spaces/sandbox/messages/${randomSecret(10)}` };
  },
};
