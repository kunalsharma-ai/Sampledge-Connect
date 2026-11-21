import { CONNECTOR_CATALOG } from '@sampledge/contracts';
import type { ConnectorAdapter, OutboundContext } from './types.js';
import { ProviderError, WebhookRejected } from './types.js';
import { expectOk, parseJson, randomSecret } from './util.js';
import { signTestToken, testRsaKey, verifyBearer } from './jwt.js';

const ISSUER = 'https://api.botframework.com';
const JWKS = 'https://login.botframework.com/v1/.well-known/keys';

interface Activity {
  type: string;
  id: string;
  timestamp?: string;
  serviceUrl: string;
  channelId: string;
  from: { id: string; name?: string; aadObjectId?: string };
  conversation: { id: string; name?: string; conversationType?: string };
  text?: string;
  attachments?: { contentType: string; name?: string; contentUrl?: string }[];
}

/** Only reply to Microsoft-run Bot Connector hosts: the serviceUrl comes from the request. */
function trustedServiceUrl(u: string, test: boolean): boolean {
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:') return false;
    if (test)
      return url.hostname.endsWith('.invalid') || url.hostname.endsWith('.botframework.com');
    return (
      url.hostname.endsWith('.botframework.com') ||
      url.hostname.endsWith('.teams.microsoft.com') ||
      url.hostname.endsWith('.trafficmanager.net')
    );
  } catch {
    return false;
  }
}

async function botToken(ctx: Pick<OutboundContext, 'credentials' | 'http' | 'tokens'>) {
  const cached = await ctx.tokens.get();
  if (cached) return cached;
  const tenant = ctx.credentials.appTenantId || 'botframework.com';
  const form = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: ctx.credentials.appId ?? '',
    client_secret: ctx.credentials.appPassword ?? '',
    scope: 'https://api.botframework.com/.default',
  });
  const res = await ctx.http.request({
    method: 'POST',
    url: `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (res.status === 400 || res.status === 401)
    throw new ProviderError('Teams: app ID or client secret rejected', 'auth');
  const b = expectOk(res, 'Teams token') as { access_token?: string; expires_in?: number };
  if (!b.access_token) throw new ProviderError('Teams: no access token', 'retry');
  await ctx.tokens.set(b.access_token, (b.expires_in ?? 3600) - 300);
  return b.access_token;
}

export const teamsAdapter: ConnectorAdapter = {
  provider: 'teams',
  descriptor: CONNECTOR_CATALOG.teams,
  testCredentials: () => ({
    appId: crypto.randomUUID(),
    appPassword: randomSecret(30),
    appTenantId: '',
    testSigningKey: testRsaKey(),
  }),

  async verifyWebhook(req, c) {
    const claims = await verifyBearer(req.headers.authorization, {
      jwksUrl: JWKS,
      issuer: ISSUER,
      audience: c.appId ?? '',
      testSigningKey: c.testSigningKey,
    });
    const a = parseJson<Activity>(req.rawBody);
    // The token's serviceurl claim must match the activity, so a stolen token cannot redirect replies.
    if (claims.serviceurl && claims.serviceurl !== a.serviceUrl)
      throw new WebhookRejected('serviceUrl does not match token');
    if (!trustedServiceUrl(a.serviceUrl, !!c.testSigningKey))
      throw new WebhookRejected('Untrusted serviceUrl');
  },

  parseWebhook(req) {
    const a = parseJson<Activity>(req.rawBody);
    if (a.type !== 'message' || !a.from?.id) return { messages: [] };
    const files = (a.attachments ?? []).filter((x) => x.contentType !== 'text/html');
    return {
      messages: [
        {
          externalMessageId: `${a.conversation.id}:${a.id}`,
          externalThreadId: a.conversation.id,
          replyContext: {
            serviceUrl: a.serviceUrl,
            conversationId: a.conversation.id,
            replyToId: a.id,
          },
          from: {
            externalUserId: a.from.aadObjectId ?? a.from.id,
            displayName: a.from.name ?? a.from.id,
            handle: null,
          },
          text: (a.text ?? '').replace(/<at>[^<]*<\/at>/g, '').trim(),
          attachments: files.map((f) => ({
            name: f.name ?? 'file',
            mimeType: f.contentType,
            sizeBytes: null,
            externalRef: f.contentUrl ?? null,
          })),
          subject: a.conversation.name ?? null,
          sentAt: a.timestamp ? new Date(a.timestamp) : new Date(),
        },
      ],
    };
  },

  async buildTestWebhook(input, c) {
    const serviceUrl = 'https://smba.sandbox.invalid/teams/';
    const conversationId =
      input.threadId || `a:${Buffer.from(input.fromHandle).toString('base64url')}`;
    const raw = JSON.stringify({
      type: 'message',
      id: String(Date.now()),
      timestamp: new Date().toISOString(),
      serviceUrl,
      channelId: 'msteams',
      from: {
        id: `29:${randomSecret(12)}`,
        name: input.fromName,
        aadObjectId: `aad-${input.fromHandle.replace(/\W/g, '')}`,
      },
      conversation: { id: conversationId, conversationType: 'personal' },
      recipient: { id: `28:${c.appId}`, name: 'Sampledge' },
      text: input.text,
    });
    const token = await signTestToken(c.testSigningKey!, {
      iss: ISSUER,
      aud: c.appId!,
      serviceurl: serviceUrl,
    });
    return {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      query: {},
      rawBody: Buffer.from(raw),
    };
  },

  async send(text, ctx) {
    const token = await botToken(ctx);
    const base = (ctx.replyContext.serviceUrl ?? '').replace(/\/+$/, '');
    if (!trustedServiceUrl(base, ctx.testMode))
      throw new ProviderError('Teams: untrusted serviceUrl', 'fatal');
    const conv = ctx.replyContext.conversationId ?? ctx.externalThreadId;
    const res = await ctx.http.request({
      method: 'POST',
      url: `${base}/v3/conversations/${encodeURIComponent(conv)}/activities`,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      secretHeaders: ['authorization'],
      body: { type: 'message', text, textFormat: 'plain' },
    });
    if (res.status === 401 || res.status === 403) await ctx.tokens.set('', 0);
    const b = expectOk(res, 'Teams send activity') as { id?: string };
    return { kind: 'sent', externalMessageId: b.id ? `${conv}:${b.id}` : null };
  },

  async testConnection(ctx) {
    await botToken(ctx);
    return 'App ID and client secret accepted (Bot Framework token issued)';
  },

  sandboxResponse(req) {
    if (req.url.includes('/oauth2/v2.0/token'))
      return {
        token_type: 'Bearer',
        expires_in: 3599,
        access_token: `sandbox.${randomSecret(20)}`,
      };
    return { id: String(Date.now()) };
  },
};
