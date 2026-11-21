import { CONNECTOR_CATALOG } from '@sampledge/contracts';
import type { ConnectorAdapter, OutboundContext } from './types.js';
import { ProviderError, WebhookRejected } from './types.js';
import { expectOk, randomSecret, safeEqual, sha1Hex } from './util.js';

const API = 'https://api.weixin.qq.com';

const signature = (token: string, timestamp: string, nonce: string) =>
  sha1Hex([token, timestamp, nonce].sort().join(''));

/** Reads one tag from WeChat's flat XML (CDATA or plain). WeChat messages are never nested. */
function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))</${name}>`).exec(xml);
  return m ? (m[1] ?? m[2] ?? '') : null;
}

/** WeChat errcodes that mean the access token or AppSecret is wrong. */
const AUTH_ERRORS = new Set([40001, 40125, 40164, 42001, 41001]);

async function accessToken(
  ctx: Pick<OutboundContext, 'credentials' | 'http' | 'tokens'>,
): Promise<string> {
  const cached = await ctx.tokens.get();
  if (cached) return cached;
  const q = new URLSearchParams({
    grant_type: 'client_credential',
    appid: ctx.credentials.appId ?? '',
    secret: ctx.credentials.appSecret ?? '',
  });
  const res = await ctx.http.request({
    method: 'GET',
    url: `${API}/cgi-bin/token?${q}`,
    headers: {},
  });
  const b = expectOk(res, 'WeChat token') as {
    access_token?: string;
    expires_in?: number;
    errcode?: number;
    errmsg?: string;
  };
  if (!b.access_token)
    throw new ProviderError(
      `WeChat token: ${b.errmsg ?? b.errcode}`,
      AUTH_ERRORS.has(b.errcode ?? 0) || b.errcode === 40013 ? 'auth' : 'retry',
    );
  await ctx.tokens.set(b.access_token, (b.expires_in ?? 7200) - 300);
  return b.access_token;
}

export const wechatAdapter: ConnectorAdapter = {
  provider: 'wechat',
  descriptor: CONNECTOR_CATALOG.wechat,
  testCredentials: () => ({
    appId: `wxtest${randomSecret(6)}`,
    appSecret: randomSecret(24),
    token: randomSecret(16),
  }),

  verifyWebhook(req, c) {
    const { signature: sig = '', timestamp = '', nonce = '' } = req.query;
    if (!sig || !safeEqual(sig, signature(c.token ?? '', timestamp, nonce)))
      throw new WebhookRejected('WeChat signature mismatch');
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300)
      throw new WebhookRejected('WeChat timestamp too old');
  },

  parseWebhook(req) {
    // URL verification: echo echostr back as plain text.
    if (req.method === 'GET')
      return {
        messages: [],
        response: { status: 200, body: req.query.echostr ?? '', contentType: 'text/plain' },
      };
    const xml = req.rawBody.toString('utf8');
    const ok = { status: 200, body: 'success', contentType: 'text/plain' };
    const type = tag(xml, 'MsgType');
    const from = tag(xml, 'FromUserName');
    if (!from || (type !== 'text' && type !== 'image')) return { messages: [], response: ok };
    return {
      messages: [
        {
          externalMessageId: tag(xml, 'MsgId') ?? `${from}:${tag(xml, 'CreateTime')}`,
          externalThreadId: from,
          replyContext: { openId: from },
          from: {
            externalUserId: from,
            displayName: `WeChat user ${from.slice(-6)}`,
            handle: null,
          },
          text: type === 'text' ? (tag(xml, 'Content') ?? '') : '',
          attachments:
            type === 'image'
              ? [
                  {
                    name: 'image.jpg',
                    mimeType: 'image/jpeg',
                    sizeBytes: null,
                    externalRef: tag(xml, 'MediaId'),
                  },
                ]
              : [],
          sentAt: new Date(Number(tag(xml, 'CreateTime') ?? Date.now() / 1000) * 1000),
        },
      ],
      response: ok,
    };
  },

  buildTestWebhook(input, c) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = String(Math.floor(Math.random() * 1e9));
    const openId =
      input.threadId || `oTest${Buffer.from(input.fromHandle).toString('hex').slice(0, 20)}`;
    const xml = `<xml><ToUserName><![CDATA[gh_test]]></ToUserName><FromUserName><![CDATA[${openId}]]></FromUserName><CreateTime>${timestamp}</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[${input.text.replace(/]]>/g, ']]]]><![CDATA[>')}]]></Content><MsgId>${Math.floor(Math.random() * 1e15)}</MsgId></xml>`;
    return {
      method: 'POST',
      headers: { 'content-type': 'text/xml' },
      query: { signature: signature(c.token!, timestamp, nonce), timestamp, nonce },
      rawBody: Buffer.from(xml),
    };
  },

  async send(text, ctx) {
    const token = await accessToken(ctx);
    const res = await ctx.http.request({
      method: 'POST',
      url: `${API}/cgi-bin/message/custom/send?access_token=${encodeURIComponent(token)}`,
      headers: { 'content-type': 'application/json' },
      body: {
        touser: ctx.replyContext.openId ?? ctx.externalThreadId,
        msgtype: 'text',
        text: { content: text },
      },
    });
    const b = expectOk(res, 'WeChat custom/send') as { errcode?: number; errmsg?: string };
    if (b.errcode) {
      if (AUTH_ERRORS.has(b.errcode)) {
        await ctx.tokens.set('', 0);
        throw new ProviderError(`WeChat: ${b.errmsg}`, 'retry');
      }
      if (b.errcode === 45015)
        throw new ProviderError('WeChat: the 48-hour reply window has closed', 'fatal');
      if (b.errcode === 45047 || b.errcode === -1)
        throw new ProviderError(`WeChat: ${b.errmsg}`, 'retry');
      throw new ProviderError(`WeChat: ${b.errmsg ?? b.errcode}`, 'fatal');
    }
    return { kind: 'sent', externalMessageId: null };
  },

  async testConnection(ctx) {
    await accessToken(ctx);
    return 'AppID and AppSecret accepted (access token issued)';
  },

  sandboxResponse(req) {
    if (req.url.includes('/cgi-bin/token'))
      return { access_token: `sandbox-${randomSecret(12)}`, expires_in: 7200 };
    return { errcode: 0, errmsg: 'ok' };
  },
};
