import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConnectClient, ConnectError, verifySignature } from '@sampledge/connect-sdk';
import type { ModuleCredentials, Session } from '@sampledge/contracts';
import { api, inviteAndLogin, registerTenant, startHarness, type Harness } from './harness.js';

/** The SDK a module uses, against the real API (what a SampBidX developer would write). */
let h: Harness;
let owner: Session;
let lena: Session;
let slug: string;
let client: ConnectClient;

beforeAll(async () => {
  h = await startHarness();
  const t = await registerTenant(h);
  owner = t.session;
  slug = t.slug;
  lena = await inviteAndLogin(h, owner, slug, 'Lena Fischer');
  await api(h, 'PUT', '/v1/admin/integrations/sampledge.sampbidx', {
    token: owner.accessToken,
    body: { enabled: true, values: { mode: 'test' } },
  });
  const creds = (
    await api<ModuleCredentials>(h, 'POST', '/v1/integrations/modules/sampbidx/keys', {
      token: owner.accessToken,
      body: { generateSigningSecret: true },
    })
  ).body;
  client = new ConnectClient({
    baseUrl: h.url,
    apiKey: creds.connectApiKey,
    signingSecret: creds.signingSecret!,
  });
});
afterAll(() => h?.close());

describe('@sampledge/connect-sdk', () => {
  it('checks the connection', async () => {
    expect(await client.me()).toMatchObject({
      module: 'sampbidx',
      moduleName: 'SampBidX',
      signingSecretSet: true,
    });
  });

  it('sends signed events; a retry with the same eventId is a no-op', async () => {
    const ev = {
      eventId: 'bid-903-pricing-1',
      type: 'pricing.approval.requested',
      record: { type: 'bid', id: 'BID-903', title: 'Contoso usage & attitude study' },
      people: [{ email: `lena.fischer@${slug}.test`, externalUserId: 'bx-lena' }],
      summary: 'Approve price for Contoso U&A',
      data: { amount: { amountMinor: 4_850_000, currency: 'USD' }, margin: 34 },
    };
    const first = await client.sendEvent(ev);
    expect(first).toMatchObject({ status: 'processed', duplicate: false });
    expect(first.approvalId).toBeTruthy();
    const again = await client.sendEvent(ev);
    expect(again).toMatchObject({ duplicate: true, approvalId: first.approvalId });
  });

  it('posts into the bid conversation and reads its history', async () => {
    await client.postMessage('bid', 'BID-903', {
      text: 'Client confirmed the sample size',
      idempotencyKey: 'n-1',
    });
    const { record, messages } = await client.history('bid', 'BID-903');
    expect(record.title).toBe('Contoso usage & attitude study');
    expect(messages[0]!.content.text).toBe('Client confirmed the sample size');
  });

  it('maps identities and signs users into the widget', async () => {
    const link = await client.getIdentity('bx-lena');
    expect(link.userId).toBe(lena.user.userId);
    const s = await client.createWidgetSession({
      user: { externalUserId: 'bx-lena' },
      deviceName: 'SampBidX web',
    });
    expect(s.userId).toBe(lena.user.userId);
  });

  it('surfaces Connect errors with their code', async () => {
    const err = await client.getRecord('bid', 'NOPE').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConnectError);
    expect(err).toMatchObject({ status: 404, code: 'NOT_FOUND', retryable: false });
    const bad = new ConnectClient({ baseUrl: h.url, apiKey: 'sk_sampbidx_wrong' });
    await expect(bad.me()).rejects.toMatchObject({ status: 401 });
  });

  it('verifies what Connect signs', async () => {
    const { signPayload } = await import('../src/integrations/signing.js');
    const body = '{"type":"approval.decided"}';
    expect(await verifySignature('whsec_x', body, signPayload('whsec_x', body))).toBe('ok');
  });
});
