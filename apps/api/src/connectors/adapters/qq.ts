import { CONNECTOR_CATALOG } from '@sampledge/contracts';
import type { ConnectorAdapter, OutboundContext } from './types.js';
import { ProviderError, WebhookRejected } from './types.js';
import {
  ed25519PrivateFromSeed,
  ed25519Sign,
  ed25519Verify,
  expectOk,
  parseJson,
  randomSecret,
  requireHeader,
} from './util.js';
import { createPublicKey } from 'node:crypto';

const API = 'https://api.sgroup.qq.com';

/** QQ derives the bot's Ed25519 key from the AppSecret: the secret repeated to 32 bytes. */
function seedKey(secret: string) {
  if (!secret) throw new WebhookRejected('No AppSecret');
  let s = secret;
  while (s.length < 32) s += secret;
  return ed25519PrivateFromSeed(Buffer.from(s.slice(0, 32)));
}

interface QqPayload {
  id?: string;
  op: number;
  t?: string;
  d: {
    plain_token?: string;
    event_ts?: string;
    id?: string;
    content?: string;
    timestamp?: string;
    author?: { user_openid?: string; id?: string };
  };
}

async function accessToken(ctx: Pick<OutboundContext, 'credentials' | 'http' | 'tokens'>) {
  const cached = await ctx.tokens.get();
  if (cached) return cached;
  const res = await ctx.http.request({
    method: 'POST',
    url: 'https://bots.qq.com/app/getAppAccessToken',
    headers: { 'content-type': 'application/json' },
    body: { appId: ctx.credentials.appId, clientSecret: ctx.credentials.appSecret },
  });
  const b = expectOk(res, 'QQ getAppAccessToken') as {
    access_token?: string;
    expires_in?: string | number;
    message?: string;
  };
  if (!b.access_token) throw new ProviderError(`QQ token: ${b.message ?? 'rejected'}`, 'auth');
  await ctx.tokens.set(b.access_token, Number(b.expires_in ?? 7200) - 60);
  return b.access_token;
}

export const qqAdapter: ConnectorAdapter = {
  provider: 'qq',
  descriptor: CONNECTOR_CATALOG.qq,
  testCredentials: () => ({
    appId: String(102000000 + Math.floor(Math.random() * 99999)),
    appSecret: randomSecret(24),
  }),

  verifyWebhook(req, c) {
    const sig = requireHeader(req.headers, 'x-signature-ed25519');
    const ts = requireHeader(req.headers, 'x-signature-timestamp');
    const pub = createPublicKey(seedKey(c.appSecret ?? ''));
    if (!ed25519Verify(pub, Buffer.concat([Buffer.from(ts), req.rawBody]), sig))
      throw new WebhookRejected('QQ signature mismatch');
  },

  parseWebhook(req, c) {
    const p = parseJson<QqPayload>(req.rawBody);
    if (p.op === 13) {
      const msg = Buffer.from(`${p.d.event_ts ?? ''}${p.d.plain_token ?? ''}`);
      return {
        messages: [],
        response: {
          status: 200,
          body: {
            plain_token: p.d.plain_token,
            signature: ed25519Sign(seedKey(c.appSecret ?? ''), msg),
          },
        },
      };
    }
    const ack = { status: 200, body: { op: 12 } };
    const openid = p.d.author?.user_openid;
    if (p.op !== 0 || p.t !== 'C2C_MESSAGE_CREATE' || !openid || !p.d.id)
      return { messages: [], response: ack };
    return {
      messages: [
        {
          externalMessageId: p.d.id,
          externalThreadId: openid,
          replyContext: { openid, msgId: p.d.id },
          from: {
            externalUserId: openid,
            displayName: `QQ user ${openid.slice(-6)}`,
            handle: null,
          },
          text: (p.d.content ?? '').trim(),
          attachments: [],
          sentAt: p.d.timestamp ? new Date(p.d.timestamp) : new Date(),
        },
      ],
      response: ack,
    };
  },

  buildTestWebhook(input, c) {
    const openid =
      input.threadId ||
      `TEST${Buffer.from(input.fromHandle).toString('hex').toUpperCase().slice(0, 28)}`;
    const raw = JSON.stringify({
      op: 0,
      id: `C2C_MESSAGE_CREATE:${randomSecret(8)}`,
      t: 'C2C_MESSAGE_CREATE',
      d: {
        id: `ROBOT1.0_${randomSecret(12)}`,
        content: input.text,
        timestamp: new Date().toISOString(),
        author: { user_openid: openid },
      },
    });
    const ts = String(Math.floor(Date.now() / 1000));
    return {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-signature-timestamp': ts,
        'x-signature-ed25519': ed25519Sign(
          seedKey(c.appSecret!),
          Buffer.concat([Buffer.from(ts), Buffer.from(raw)]),
        ),
      },
      query: {},
      rawBody: Buffer.from(raw),
    };
  },

  async send(text, ctx) {
    const token = await accessToken(ctx);
    const res = await ctx.http.request({
      method: 'POST',
      url: `${API}/v2/users/${encodeURIComponent(ctx.replyContext.openid ?? ctx.externalThreadId)}/messages`,
      headers: { 'content-type': 'application/json', authorization: `QQBot ${token}` },
      secretHeaders: ['authorization'],
      // msg_id makes this a passive reply, the only kind QQ reliably allows.
      body: {
        content: text,
        msg_type: 0,
        ...(ctx.replyContext.msgId ? { msg_id: ctx.replyContext.msgId } : {}),
      },
    });
    const b = expectOk(res, 'QQ send') as { id?: string };
    return { kind: 'sent', externalMessageId: b.id ?? null };
  },

  async testConnection(ctx) {
    await accessToken(ctx);
    return 'AppID and AppSecret accepted (access token issued)';
  },

  sandboxResponse(req) {
    if (req.url.includes('getAppAccessToken'))
      return { access_token: `sandbox-${randomSecret(12)}`, expires_in: '7200' };
    return { id: `sbx-${randomSecret(10)}`, timestamp: new Date().toISOString() };
  },
};
