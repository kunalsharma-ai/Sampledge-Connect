import { generateKeyPairSync } from 'node:crypto';
import { CONNECTOR_CATALOG } from '@sampledge/contracts';
import { createPrivateKey } from 'node:crypto';
import type { ConnectorAdapter } from './types.js';
import { WebhookRejected } from './types.js';
import {
  ed25519PublicFromHex,
  ed25519PublicHex,
  ed25519Sign,
  ed25519Verify,
  expectOk,
  parseJson,
  randomSecret,
  requireHeader,
} from './util.js';

const API = 'https://discord.com/api/v10';

interface Interaction {
  id: string;
  type: number;
  channel_id?: string;
  guild_id?: string;
  data?: { name?: string; options?: { name: string; value: string }[] };
  member?: { user: DiscordUser };
  user?: DiscordUser;
}
interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
}

export const discordAdapter: ConnectorAdapter = {
  provider: 'discord',
  descriptor: CONNECTOR_CATALOG.discord,
  testCredentials: () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    return {
      applicationId: String(1e17 + Math.floor(Math.random() * 1e16)),
      publicKey: ed25519PublicHex(privateKey),
      botToken: `test.${randomSecret(30)}`,
      testSigningKey: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    };
  },

  verifyWebhook(req, c) {
    const sig = requireHeader(req.headers, 'x-signature-ed25519');
    const ts = requireHeader(req.headers, 'x-signature-timestamp');
    let ok = false;
    try {
      ok = ed25519Verify(
        ed25519PublicFromHex(c.publicKey ?? ''),
        Buffer.concat([Buffer.from(ts), req.rawBody]),
        sig,
      );
    } catch {
      ok = false;
    }
    if (!ok) throw new WebhookRejected('Discord signature mismatch');
  },

  parseWebhook(req) {
    const i = parseJson<Interaction>(req.rawBody);
    if (i.type === 1) return { messages: [], response: { status: 200, body: { type: 1 } } };
    const user = i.member?.user ?? i.user;
    const text = i.data?.options?.find((o) => o.name === 'message')?.value ?? '';
    if (i.type !== 2 || i.data?.name !== 'support' || !user || !i.channel_id || !text) {
      return {
        messages: [],
        response: {
          status: 200,
          body: { type: 4, data: { content: 'Use /support followed by your message.', flags: 64 } },
        },
      };
    }
    return {
      messages: [
        {
          externalMessageId: i.id,
          externalThreadId: `${i.channel_id}:${user.id}`,
          replyContext: { channelId: i.channel_id, userId: user.id },
          from: {
            externalUserId: user.id,
            displayName: user.global_name || user.username,
            handle: `@${user.username}`,
          },
          text,
          attachments: [],
          sentAt: new Date(),
        },
      ],
      // Ephemeral acknowledgement shown only to the client.
      response: {
        status: 200,
        body: {
          type: 4,
          data: { content: 'Thanks. Our team will reply in this channel shortly.', flags: 64 },
        },
      },
    };
  },

  buildTestWebhook(input, c) {
    const uid = String(4e17 + (Buffer.from(input.fromHandle).readUInt32BE(0) % 1e9));
    const raw = JSON.stringify({
      id: String(1e18 + Math.floor(Math.random() * 1e17)),
      application_id: c.applicationId,
      type: 2,
      channel_id: input.threadId?.split(':')[0] || '900000000000000001',
      guild_id: '800000000000000001',
      data: {
        name: 'support',
        type: 1,
        options: [{ name: 'message', type: 3, value: input.text }],
      },
      member: {
        user: {
          id: uid,
          username: input.fromHandle.replace(/^@/, ''),
          global_name: input.fromName,
        },
      },
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const key = createPrivateKey(c.testSigningKey!);
    return {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-signature-timestamp': ts,
        'x-signature-ed25519': ed25519Sign(key, Buffer.concat([Buffer.from(ts), Buffer.from(raw)])),
      },
      query: {},
      rawBody: Buffer.from(raw),
    };
  },

  async send(text, ctx) {
    const channel = ctx.replyContext.channelId ?? ctx.externalThreadId.split(':')[0];
    const mention = ctx.replyContext.userId ? `<@${ctx.replyContext.userId}> ` : '';
    const res = await ctx.http.request({
      method: 'POST',
      url: `${API}/channels/${channel}/messages`,
      headers: {
        'content-type': 'application/json',
        authorization: `Bot ${ctx.credentials.botToken}`,
      },
      secretHeaders: ['authorization'],
      body: {
        content: `${mention}${text}`.slice(0, 2000),
        allowed_mentions: { users: ctx.replyContext.userId ? [ctx.replyContext.userId] : [] },
      },
    });
    const b = expectOk(res, 'Discord create message') as { id?: string };
    return { kind: 'sent', externalMessageId: b.id ?? null };
  },

  async testConnection(ctx) {
    const res = await ctx.http.request({
      method: 'GET',
      url: `${API}/users/@me`,
      headers: { authorization: `Bot ${ctx.credentials.botToken}` },
      secretHeaders: ['authorization'],
    });
    const b = expectOk(res, 'Discord users/@me') as { username?: string };
    return `Connected as ${b.username ?? 'bot'}`;
  },

  sandboxResponse(req) {
    if (req.url.endsWith('/users/@me'))
      return { id: '1', username: 'Sampledge Support', bot: true };
    return { id: String(1e18 + Math.floor(Math.random() * 1e17)) };
  },
};
