import { randomBytes } from 'node:crypto';
import { CONNECTOR_CATALOG } from '@sampledge/contracts';
import type { ConnectorAdapter } from './types.js';
import { WebhookRejected } from './types.js';
import { expectOk, hmacHex, parseJson, randomSecret, requireHeader, safeEqual } from './util.js';

const base = (u: string | undefined) => (u ?? '').replace(/\/+$/, '');

interface TalkActivity {
  type: string;
  actor: { type: string; id: string; name?: string };
  object: {
    type: string;
    id: string | number;
    name?: string;
    content?: string;
    mediaType?: string;
  };
  target: { type: string; id: string; name?: string };
}

export const nextcloudTalkAdapter: ConnectorAdapter = {
  provider: 'nextcloud_talk',
  descriptor: CONNECTOR_CATALOG.nextcloud_talk,
  testCredentials: () => ({
    serverUrl: 'https://cloud.sandbox.invalid',
    botSecret: randomSecret(40),
  }),

  verifyWebhook(req, c) {
    const random = requireHeader(req.headers, 'x-nextcloud-talk-random');
    const sig = requireHeader(req.headers, 'x-nextcloud-talk-signature');
    const expected = hmacHex(c.botSecret ?? '', Buffer.concat([Buffer.from(random), req.rawBody]));
    if (!safeEqual(sig.toLowerCase(), expected))
      throw new WebhookRejected('Talk signature mismatch');
  },

  parseWebhook(req) {
    const a = parseJson<TalkActivity>(req.rawBody);
    if (a.type !== 'Create' || a.object?.type !== 'Note' || a.actor?.type !== 'Person')
      return { messages: [] };
    let text = '';
    try {
      text = (JSON.parse(a.object.content ?? '{}') as { message?: string }).message ?? '';
    } catch {
      text = a.object.content ?? '';
    }
    return {
      messages: [
        {
          externalMessageId: `${a.target.id}:${a.object.id}`,
          externalThreadId: a.target.id,
          replyContext: { token: a.target.id, replyTo: String(a.object.id) },
          from: {
            externalUserId: a.actor.id,
            displayName: a.actor.name ?? a.actor.id,
            handle: a.actor.id.replace(/^users\//, ''),
          },
          text,
          attachments: [],
          subject: a.target.name ?? null,
          sentAt: new Date(),
        },
      ],
    };
  },

  buildTestWebhook(input, c) {
    const token =
      input.threadId || `room${Buffer.from(input.fromHandle).toString('hex').slice(0, 10)}`;
    const raw = JSON.stringify({
      type: 'Create',
      actor: {
        type: 'Person',
        id: `users/${input.fromHandle.replace(/^@/, '')}`,
        name: input.fromName,
      },
      object: {
        type: 'Note',
        id: String(Math.floor(Math.random() * 1e6)),
        name: 'message',
        content: JSON.stringify({ message: input.text, parameters: [] }),
        mediaType: 'text/markdown',
      },
      target: { type: 'Collection', id: token, name: `${input.fromName} (client)` },
    });
    const random = randomBytes(32).toString('hex');
    return {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-nextcloud-talk-random': random,
        'x-nextcloud-talk-signature': hmacHex(c.botSecret!, random + raw),
        'x-nextcloud-talk-backend': c.serverUrl!,
      },
      query: {},
      rawBody: Buffer.from(raw),
    };
  },

  async send(text, ctx) {
    const random = randomBytes(32).toString('hex');
    const token = ctx.replyContext.token ?? ctx.externalThreadId;
    const res = await ctx.http.request({
      method: 'POST',
      url: `${base(ctx.credentials.serverUrl)}/ocs/v2.php/apps/spreed/api/v1/bot/${encodeURIComponent(token)}/message`,
      headers: {
        'content-type': 'application/json',
        'ocs-apirequest': 'true',
        'x-nextcloud-talk-bot-random': random,
        // Outbound signatures cover random + the message text, per the Talk bot spec.
        'x-nextcloud-talk-bot-signature': hmacHex(ctx.credentials.botSecret ?? '', random + text),
      },
      body: { message: text, referenceId: randomBytes(32).toString('hex') },
    });
    expectOk(res, 'Nextcloud Talk bot message');
    return { kind: 'sent', externalMessageId: null };
  },

  async testConnection(ctx) {
    const res = await ctx.http.request({
      method: 'GET',
      url: `${base(ctx.credentials.serverUrl)}/status.php`,
      headers: {},
    });
    const b = expectOk(res, 'Nextcloud status') as { productname?: string; versionstring?: string };
    return `Reached ${b.productname ?? 'Nextcloud'} ${b.versionstring ?? ''}. The bot secret is checked on the first message.`.trim();
  },

  sandboxResponse(req) {
    if (req.url.endsWith('/status.php'))
      return { installed: true, productname: 'Nextcloud', versionstring: '31.0.0' };
    return { ocs: { meta: { status: 'ok', statuscode: 201 }, data: [] } };
  },
};
