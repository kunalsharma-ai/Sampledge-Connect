import { createECDH, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as webpush from 'web-push';
import {
  uuidv7,
  type Conversation,
  type IntegrationTestResult,
  type IntegrationView,
  type PushStatus,
  type SendMessageAck,
  type Session,
  type WebPushConfig,
  type WebPushPayload,
} from '@sampledge/contracts';
import { PushProviders } from '../src/push/push-provider.js';
import { api, inviteAndLogin, registerTenant, startHarness, type Harness } from './harness.js';

let h: Harness;
let owner: Session;
let ravi: Session;
let dm: Conversation;

/** What the server handed to the Web Push library, before encryption. */
let sent: { sub: webpush.PushSubscription; payload: WebPushPayload; publicKey: string }[] = [];
let failWith: number | null = null;

/** A subscription shaped like a browser's, with real P-256 keys so encryption works. */
function browserSubscription() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint: `https://push.example.test/send/${randomBytes(8).toString('hex')}`,
    expirationTime: null,
    keys: {
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
  };
}

const webConfig = (s: Session) =>
  api<WebPushConfig>(h, 'GET', '/v1/push/web', { token: s.accessToken });
const subscribe = (s: Session, sub: unknown) =>
  api<PushStatus>(h, 'POST', '/v1/push/token', {
    token: s.accessToken,
    body: { provider: 'webpush', token: JSON.stringify(sub), platform: 'web' },
  });
const send = async (s: Session, text: string) =>
  (
    await api<SendMessageAck>(h, 'POST', `/v1/conversations/${dm.conversationId}/messages`, {
      token: s.accessToken,
      body: { clientMessageId: uuidv7(), content: { text, mentions: [] }, replyToMessageId: null },
    })
  ).body.message;
const settle = () => new Promise((r) => setTimeout(r, 300));

beforeAll(async () => {
  h = await startHarness({ SETTINGS_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString('base64') });
  h.app.get(PushProviders).webSender = async (sub, payload, opts) => {
    // Encrypting for real proves the stored keys and subscription are usable.
    webpush.generateRequestDetails(sub, payload ?? undefined, opts);
    if (failWith) throw Object.assign(new Error('gone'), { statusCode: failWith });
    sent.push({
      sub,
      payload: JSON.parse(String(payload)) as WebPushPayload,
      publicKey: opts!.vapidDetails!.publicKey,
    });
    return {};
  };
  const t = await registerTenant(h);
  owner = t.session;
  ravi = await inviteAndLogin(h, owner, t.slug, 'Ravi Kumar');
  dm = (
    await api<Conversation>(h, 'POST', '/v1/conversations', {
      token: owner.accessToken,
      body: { kind: 'dm', memberIds: [ravi.user.userId] },
    })
  ).body;
});

afterAll(async () => {
  await h?.close();
});

describe('browser notifications (Web Push)', () => {
  it('is off until an admin turns it on, and refuses subscriptions meanwhile', async () => {
    expect((await webConfig(ravi)).body).toEqual({
      enabled: false,
      publicKey: null,
      subscribed: false,
    });
    const r = await subscribe(ravi, browserSubscription());
    expect(r.status).toBe(409);
  });

  it('generates a VAPID key pair once when turned on, stored encrypted', async () => {
    const saved = await api<IntegrationView>(h, 'PUT', '/v1/admin/integrations/push.web', {
      token: owner.accessToken,
      body: { enabled: true, values: { subject: 'ops@acme.example' } },
    });
    expect(saved.status).toBe(200);
    const a = (await webConfig(ravi)).body;
    expect(a.enabled).toBe(true);
    expect(a.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect((await webConfig(owner)).body.publicKey).toBe(a.publicKey);

    const view = (
      await api<IntegrationView[]>(h, 'GET', '/v1/admin/integrations', {
        token: owner.accessToken,
      })
    ).body.find((v) => v.provider.id === 'push.web')!;
    expect(view.saved?.values.publicKey).toBe(a.publicKey);
    // The private key is a secret: stored, never returned.
    expect(view.saved?.secretsSet).toContain('privateKey');
    expect(view.saved?.values.privateKey).toBeUndefined();

    const test = await api<IntegrationTestResult>(
      h,
      'POST',
      '/v1/admin/integrations/push.web/test',
      { token: owner.accessToken, body: {} },
    );
    expect(test.body.ok).toBe(true);
  });

  it('validates subscriptions', async () => {
    expect((await subscribe(ravi, { endpoint: 'not a url' })).status).toBe(400);
    expect(
      (await subscribe(ravi, { ...browserSubscription(), endpoint: 'http://insecure.test/x' }))
        .status,
    ).toBe(400);
    const ok = await subscribe(ravi, browserSubscription());
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ enabled: true, provider: 'webpush', tokenRegistered: true });
    expect((await webConfig(ravi)).body.subscribed).toBe(true);
  });

  it('sends an encrypted notification with a link to the message', async () => {
    sent = [];
    const m = await send(owner, 'Can you review the Mexico quotas?');
    await settle();
    expect(sent).toHaveLength(1);
    const p = sent[0]!.payload;
    expect(p.title).toBe(owner.user.displayName);
    expect(p.body).toBe('Can you review the Mexico quotas?');
    expect(p.url).toBe(`/app?c=${dm.conversationId}&m=${m.messageId}`);
    expect(p.data).toMatchObject({ type: 'message', kind: 'dm' });
    expect(p.data).not.toHaveProperty('__provider');
    expect(sent[0]!.publicKey).toBe((await webConfig(ravi)).body.publicKey);
  });

  it('hides message text when previews are off', async () => {
    await api(h, 'PUT', '/v1/admin/integrations/push.web', {
      token: owner.accessToken,
      body: { enabled: true, values: { subject: 'ops@acme.example', showPreviews: false } },
    });
    sent = [];
    await send(owner, 'Confidential pricing');
    await settle();
    expect(sent[0]!.payload.body).toBe('New message');
  });

  it('forgets a subscription the browser has dropped (410)', async () => {
    failWith = 410;
    await send(owner, 'Are you there?');
    await settle();
    failWith = null;
    expect((await webConfig(ravi)).body.subscribed).toBe(false);
  });
});
