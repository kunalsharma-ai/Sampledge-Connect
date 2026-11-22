import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  BillingOverview,
  BillingPlan,
  CheckoutResponse,
  IntegrationTestResult,
  Session,
  Subscription,
} from '@sampledge/contracts';
import {
  api,
  grantPlatformRole,
  inviteAndLogin,
  registerTenant,
  startHarness,
  type Harness,
} from './harness.js';

/** A Stripe-shaped fake: records requests and answers the few calls Connect makes. */
let fake: Server;
let fakeUrl: string;
const calls: { method: string; path: string; form: URLSearchParams }[] = [];
let subscriptionObj: Record<string, unknown> = {};

let h: Harness;
let owner: Session;
let ravi: Session;
let slug: string;
let team: BillingPlan;
let free: BillingPlan;
const WHSEC = 'whsec_test_secret';

const overview = (s: Session = owner) =>
  api<BillingOverview>(h, 'GET', '/v1/billing', { token: s.accessToken });
const planBody = (o: Record<string, unknown>) => ({
  description: '',
  yearlyPerSeat: null,
  limits: { seats: null, storageGb: null, recordingHours: null },
  features: [],
  trialDays: 0,
  ...o,
});
async function webhook(event: unknown, secret = WHSEC) {
  const body = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  const r = await fetch(`${h.url}/v1/billing/stripe/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${sig}` },
    body,
  });
  return r.status;
}

beforeAll(async () => {
  fake = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const url = new URL(req.url!, 'http://x');
      calls.push({ method: req.method!, path: url.pathname, form: new URLSearchParams(raw) });
      const json = (s: number, b: unknown) => {
        res.writeHead(s, { 'content-type': 'application/json' });
        res.end(JSON.stringify(b));
      };
      if (req.headers.authorization !== 'Bearer sk_test_123')
        return json(401, { error: { message: 'Invalid API Key provided' } });
      if (url.pathname === '/v1/account')
        return json(200, { id: 'acct_1', settings: { dashboard: { display_name: 'Sampledge' } } });
      if (url.pathname === '/v1/customers') return json(200, { id: 'cus_1' });
      if (url.pathname === '/v1/checkout/sessions')
        return json(200, { id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' });
      if (url.pathname.startsWith('/v1/subscriptions/')) return json(200, subscriptionObj);
      if (url.pathname.startsWith('/v1/subscription_items/')) return json(200, { id: 'si_1' });
      if (url.pathname === '/v1/billing_portal/sessions')
        return json(200, { url: 'https://billing.stripe.test/p_1' });
      json(404, { error: { message: 'no route' } });
    });
  });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
  fakeUrl = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;

  h = await startHarness();
  const t = await registerTenant(h);
  owner = t.session;
  slug = t.slug;
  ravi = await inviteAndLogin(h, owner, slug, 'Ravi Kumar');
  // The owner of this test organization is also a platform operator.
  await grantPlatformRole(h, owner);
});
afterAll(async () => {
  await h?.close();
  fake?.close();
});

describe('billing', () => {
  it('starts with no plan, an empty catalog and no payments', async () => {
    const o = await overview();
    expect(o.status).toBe(200);
    expect(o.body).toMatchObject({
      plan: null,
      plans: [],
      paymentsEnabled: false,
      canManage: true,
      canManageCatalog: true,
      subscription: { status: 'none', planId: null },
      usage: { members: 2 },
    });
    expect((await overview(ravi)).body).toMatchObject({
      canManage: false,
      canManageCatalog: false,
    });
  });

  it('only operators edit the catalog; prices are whatever they enter', async () => {
    const denied = await api(h, 'POST', '/v1/platform/billing/plans', {
      token: ravi.accessToken,
      body: planBody({ name: 'X', currency: 'usd', monthlyPerSeat: 1 }),
    });
    expect(denied.status).toBe(403);
    const bad = await api(h, 'POST', '/v1/platform/billing/plans', {
      token: owner.accessToken,
      body: planBody({ name: 'X', currency: 'dollars', monthlyPerSeat: 1.5 }),
    });
    expect(bad.status).toBe(400);
    team = (
      await api<BillingPlan>(h, 'POST', '/v1/platform/billing/plans', {
        token: owner.accessToken,
        body: planBody({
          name: 'Team',
          currency: 'INR',
          monthlyPerSeat: 49900,
          yearlyPerSeat: 499000,
          trialDays: 14,
          features: ['Unlimited history'],
          sortOrder: 2,
        }),
      })
    ).body;
    free = (
      await api<BillingPlan>(h, 'POST', '/v1/platform/billing/plans', {
        token: owner.accessToken,
        body: planBody({
          name: 'Free',
          currency: 'inr',
          monthlyPerSeat: 0,
          limits: { seats: 3, storageGb: 5, recordingHours: null },
          sortOrder: 1,
        }),
      })
    ).body;
    expect(team.currency).toBe('inr');
    await api(h, 'POST', '/v1/platform/billing/plans', {
      token: owner.accessToken,
      body: planBody({ name: 'Hidden', currency: 'inr', monthlyPerSeat: 1, public: false }),
    });
    expect((await overview()).body.plans.map((p) => p.name)).toEqual(['Free', 'Team']);
  });

  it('a free plan starts at once and enforces its member limit', async () => {
    expect(
      (
        await api(h, 'POST', '/v1/billing/checkout', {
          token: ravi.accessToken,
          body: { planId: free.planId, interval: 'month' },
        })
      ).status,
    ).toBe(403);
    const r = await api<CheckoutResponse>(h, 'POST', '/v1/billing/checkout', {
      token: owner.accessToken,
      body: { planId: free.planId, interval: 'month' },
    });
    expect(r.body.url).toBeNull();
    expect(r.body.subscription).toMatchObject({ status: 'active', planId: free.planId });
    await inviteAndLogin(h, owner, slug, 'Mia Chen');
    await expect(inviteAndLogin(h, owner, slug, 'Leo Park')).rejects.toThrow(/409/);
    // Guests don't take a seat.
    await inviteAndLogin(h, owner, slug, 'Client Guest', 'guest');
  });

  it('paid plans need the payment provider', async () => {
    const r = await api(h, 'POST', '/v1/billing/checkout', {
      token: owner.accessToken,
      body: { planId: team.planId, interval: 'month' },
    });
    expect(r.status).toBe(503);
  });

  it('checkout sends the catalog price, seats and trial to Stripe', async () => {
    const save = await api(h, 'PUT', '/v1/platform/integrations/billing.stripe', {
      token: owner.accessToken,
      body: {
        enabled: true,
        values: { secretKey: 'sk_test_123', webhookSecret: WHSEC, apiBase: fakeUrl },
      },
    });
    expect(save.status).toBe(200);
    const test = await api<IntegrationTestResult>(
      h,
      'POST',
      '/v1/platform/integrations/billing.stripe/test',
      { token: owner.accessToken, body: {} },
    );
    expect(test.body.message).toMatch(/Sampledge.*test mode/);
    expect((await overview()).body.paymentsEnabled).toBe(true);

    const r = await api<CheckoutResponse>(h, 'POST', '/v1/billing/checkout', {
      token: owner.accessToken,
      body: { planId: team.planId, interval: 'year' },
    });
    expect(r.status).toBe(200);
    expect(r.body.url).toBe('https://checkout.stripe.test/cs_1');
    const f = calls.find((c) => c.path === '/v1/checkout/sessions')!.form;
    expect(f.get('line_items[0][price_data][unit_amount]')).toBe('499000');
    expect(f.get('line_items[0][price_data][currency]')).toBe('inr');
    expect(f.get('line_items[0][price_data][recurring][interval]')).toBe('year');
    expect(f.get('line_items[0][quantity]')).toBe('3');
    expect(f.get('subscription_data[trial_period_days]')).toBe('14');
    expect(f.get('client_reference_id')).toBe(owner.tenant.tenantId);
  });

  it('applies signed webhooks only', async () => {
    const tenantId = owner.tenant.tenantId;
    subscriptionObj = {
      id: 'sub_1',
      customer: 'cus_1',
      status: 'trialing',
      trial_end: Math.floor(Date.now() / 1000) + 14 * 86400,
      cancel_at_period_end: false,
      metadata: { tenantId, planId: team.planId },
      items: {
        data: [
          {
            id: 'si_1',
            quantity: 3,
            current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
            price: { recurring: { interval: 'year' } },
          },
        ],
      },
    };
    const completed = {
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_1',
          client_reference_id: tenantId,
          customer: 'cus_1',
          subscription: 'sub_1',
        },
      },
    };
    expect(await webhook(completed, 'whsec_wrong')).toBe(401);
    expect((await overview()).body.subscription.planId).toBe(free.planId);
    expect(await webhook(completed)).toBe(200);
    const o = (await overview()).body;
    expect(o.subscription).toMatchObject({
      status: 'trialing',
      planId: team.planId,
      provider: 'stripe',
      interval: 'year',
      seats: 3,
    });
    expect(o.plan?.name).toBe('Team');

    expect(
      await webhook({
        id: 'evt_2',
        type: 'invoice.paid',
        data: {
          object: {
            id: 'in_1',
            customer: 'cus_1',
            number: 'SC-0001',
            status: 'paid',
            currency: 'inr',
            total: 1497000,
            created: Math.floor(Date.now() / 1000),
            hosted_invoice_url: 'https://invoice.stripe.test/in_1',
            invoice_pdf: 'https://invoice.stripe.test/in_1.pdf',
            lines: { data: [{ period: { start: 1, end: 2 } }] },
          },
        },
      }),
    ).toBe(200);
    expect((await overview()).body.invoices).toEqual([
      expect.objectContaining({ number: 'SC-0001', status: 'paid', total: 1497000 }),
    ]);
  });

  it('keeps billed seats in step with members', async () => {
    calls.length = 0;
    await inviteAndLogin(h, owner, slug, 'Leo Park');
    await new Promise((r) => setTimeout(r, 300));
    const sync = calls.find((c) => c.path === '/v1/subscription_items/si_1');
    expect(sync?.form.get('quantity')).toBe('4');
    expect((await overview()).body.subscription.seats).toBe(4);
  });

  it('opens the payment portal; operators see organizations but can’t override Stripe', async () => {
    const p = await api<{ url: string }>(h, 'POST', '/v1/billing/portal', {
      token: owner.accessToken,
    });
    expect(p.body.url).toBe('https://billing.stripe.test/p_1');
    const list = await api<{ slug: string; subscription: Subscription }[]>(
      h,
      'GET',
      '/v1/platform/billing/tenants',
      { token: owner.accessToken },
    );
    expect(list.body.find((x) => x.slug === slug)?.subscription.status).toBe('trialing');
    const assign = await api(h, 'PUT', `/v1/platform/billing/tenants/${owner.tenant.tenantId}`, {
      token: owner.accessToken,
      body: { planId: free.planId, status: 'active', seats: 3 },
    });
    expect(assign.status).toBe(409);
  });

  it('a canceled subscription frees the organization', async () => {
    subscriptionObj = { ...subscriptionObj, status: 'canceled' };
    expect(
      await webhook({
        id: 'evt_3',
        type: 'customer.subscription.deleted',
        data: { object: subscriptionObj },
      }),
    ).toBe(200);
    const s = (await overview()).body.subscription;
    expect(s.status).toBe('canceled');
    const other = await registerTenant(h, 'Other Org');
    const assign = await api<Subscription>(
      h,
      'PUT',
      `/v1/platform/billing/tenants/${other.session.tenant.tenantId}`,
      { token: owner.accessToken, body: { planId: team.planId, status: 'active', seats: 10 } },
    );
    expect(assign.body).toMatchObject({ provider: 'manual', status: 'active', seats: 10 });
  });
});
