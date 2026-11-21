import { CONNECTOR_CATALOG } from '@sampledge/contracts';
import type { ConnectorAdapter } from './types.js';
import { ProviderError, WebhookRejected } from './types.js';
import {
  checkFreshness,
  expectOk,
  hmacHex,
  parseJson,
  randomSecret,
  requireHeader,
  safeEqual,
  str,
} from './util.js';

const API = 'https://slack.com/api';

interface SlackEnvelope {
  type: 'url_verification' | 'event_callback';
  challenge?: string;
  event_id?: string;
  event?: {
    type: string;
    subtype?: string;
    bot_id?: string;
    user?: string;
    text?: string;
    ts?: string;
    thread_ts?: string;
    channel?: string;
    channel_type?: string;
    files?: { id: string; name?: string; mimetype?: string; size?: number }[];
    user_profile?: { real_name?: string; display_name?: string; name?: string };
  };
}

/** Slack's Web API answers 200 with {ok:false, error}. Map those onto the retry policy. */
function slackOk(json: unknown, what: string) {
  const b = json as { ok?: boolean; error?: string };
  if (b.ok) return b;
  const e = b.error ?? 'unknown_error';
  if (
    ['invalid_auth', 'not_authed', 'account_inactive', 'token_revoked', 'missing_scope'].includes(e)
  )
    throw new ProviderError(`${what}: ${e}`, 'auth');
  if (e === 'ratelimited') throw new ProviderError(`${what}: ${e}`, 'retry');
  throw new ProviderError(`${what}: ${e}`, 'fatal');
}

export const slackAdapter: ConnectorAdapter = {
  provider: 'slack',
  descriptor: CONNECTOR_CATALOG.slack,
  testCredentials: () => ({
    botToken: `xoxb-test-${randomSecret(18)}`,
    signingSecret: randomSecret(24),
  }),

  verifyWebhook(req, c) {
    const ts = requireHeader(req.headers, 'x-slack-request-timestamp');
    const sig = requireHeader(req.headers, 'x-slack-signature');
    checkFreshness(ts);
    const expected = `v0=${hmacHex(c.signingSecret ?? '', `v0:${ts}:${req.rawBody.toString('utf8')}`)}`;
    if (!safeEqual(sig, expected)) throw new WebhookRejected('Slack signature mismatch');
  },

  parseWebhook(req) {
    const env = parseJson<SlackEnvelope>(req.rawBody);
    if (env.type === 'url_verification')
      return {
        messages: [],
        response: { status: 200, body: env.challenge ?? '', contentType: 'text/plain' },
      };
    const e = env.event;
    // Ignore bot echoes (our own replies), edits and joins.
    if (!e || e.type !== 'message' || e.bot_id || e.subtype || !e.user || !e.channel)
      return { messages: [] };
    const thread = e.channel_type === 'im' ? e.channel : `${e.channel}:${e.thread_ts ?? e.ts}`;
    const p = e.user_profile;
    return {
      messages: [
        {
          externalMessageId: env.event_id ?? `${e.channel}:${e.ts}`,
          externalThreadId: thread,
          replyContext: {
            channel: e.channel,
            ...(e.channel_type === 'im' ? {} : { threadTs: e.thread_ts ?? e.ts ?? '' }),
          },
          from: {
            externalUserId: e.user,
            displayName: p?.real_name || p?.display_name || e.user,
            handle: p?.name ? `@${p.name}` : null,
          },
          text: e.text ?? '',
          attachments: (e.files ?? []).map((f) => ({
            name: f.name ?? 'file',
            mimeType: f.mimetype ?? null,
            sizeBytes: f.size ?? null,
            externalRef: f.id,
          })),
          sentAt: new Date(Number(e.ts ?? Date.now() / 1000) * 1000),
        },
      ],
    };
  },

  buildTestWebhook(input, c) {
    const user = `U${input.fromHandle.replace(/\W/g, '').toUpperCase().slice(0, 9) || 'TEST'}`;
    const channel = input.threadId || `D${user.slice(1)}`;
    const ts = (Date.now() / 1000).toFixed(6);
    const body = JSON.stringify({
      type: 'event_callback',
      event_id: `Ev${randomSecret(8)}`,
      event: {
        type: 'message',
        channel_type: 'im',
        channel,
        user,
        text: input.text,
        ts,
        user_profile: { real_name: input.fromName, name: input.fromHandle.replace(/^@/, '') },
      },
    });
    const t = String(Math.floor(Date.now() / 1000));
    return {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-slack-request-timestamp': t,
        'x-slack-signature': `v0=${hmacHex(c.signingSecret!, `v0:${t}:${body}`)}`,
      },
      query: {},
      rawBody: Buffer.from(body),
    };
  },

  async send(text, ctx) {
    const res = await ctx.http.request({
      method: 'POST',
      url: `${API}/chat.postMessage`,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        authorization: `Bearer ${ctx.credentials.botToken}`,
      },
      secretHeaders: ['authorization'],
      body: {
        channel: ctx.replyContext.channel ?? ctx.externalThreadId,
        text,
        ...(ctx.replyContext.threadTs ? { thread_ts: ctx.replyContext.threadTs } : {}),
      },
    });
    expectOk(res, 'Slack chat.postMessage');
    const b = slackOk(res.json, 'Slack chat.postMessage') as { ts?: string; channel?: string };
    return { kind: 'sent', externalMessageId: `${str(b.channel)}:${str(b.ts)}` };
  },

  async testConnection(ctx) {
    const res = await ctx.http.request({
      method: 'POST',
      url: `${API}/auth.test`,
      headers: { authorization: `Bearer ${ctx.credentials.botToken}` },
      secretHeaders: ['authorization'],
    });
    expectOk(res, 'Slack auth.test');
    const b = slackOk(res.json, 'Slack auth.test') as { team?: string; user?: string };
    return `Connected to ${b.team ?? 'workspace'} as ${b.user ?? 'bot'}`;
  },

  sandboxResponse(req) {
    if (req.url.endsWith('/auth.test'))
      return { ok: true, team: 'Sandbox workspace', user: 'sampledge' };
    const b = req.body as { channel?: string };
    return { ok: true, channel: b.channel, ts: (Date.now() / 1000).toFixed(6) };
  },
};
