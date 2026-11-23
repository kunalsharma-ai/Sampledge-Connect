import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IntegrationProviderDef, IntegrationValues } from '@sampledge/contracts';
import { AppError } from '../common/errors.js';

export const STRIPE_PROVIDER: IntegrationProviderDef = {
  id: 'billing.stripe',
  label: 'Payments (Stripe)',
  description:
    'Card payments and invoices for your customers’ subscriptions. Prices come from your plan catalog, not from Stripe.',
  category: 'billing',
  scopes: ['platform'],
  testable: true,
  fields: [
    {
      key: 'secretKey',
      label: 'Secret key',
      type: 'secret',
      required: true,
      placeholder: 'sk_live_… or sk_test_…',
      help: 'Use a test key (sk_test_) first: nobody is charged.',
    },
    {
      key: 'webhookSecret',
      label: 'Webhook signing secret',
      type: 'secret',
      required: true,
      placeholder: 'whsec_…',
      help: 'Add a webhook endpoint at https://<your-domain>/api/v1/billing/stripe/webhook for checkout.session.completed, customer.subscription.*, invoice.*.',
    },
    {
      key: 'apiBase',
      label: 'API address',
      type: 'url',
      default: 'https://api.stripe.com',
      help: 'Leave as is unless you route Stripe through a proxy.',
    },
  ],
};

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  apiBase: string;
}

export function stripeConfig(v: IntegrationValues | undefined | null): StripeConfig | null {
  if (!v?.secretKey || !v.webhookSecret) return null;
  return {
    secretKey: String(v.secretKey),
    webhookSecret: String(v.webhookSecret),
    apiBase: String(v.apiBase || 'https://api.stripe.com').replace(/\/+$/, ''),
  };
}

/** Flattens nested params the way Stripe's form encoding expects: a[b][0][c]=v. */
function form(params: Record<string, unknown>, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v as Record<string, unknown>, key, out);
    else out.append(key, String(v));
  }
  return out;
}

/** A small Stripe REST client: only the calls Connect needs, no SDK. */
export class StripeClient {
  constructor(private readonly cfg: StripeConfig) {}

  async call<T = Record<string, unknown>>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    params?: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<T> {
    const body = params && method !== 'GET' ? form(params).toString() : undefined;
    const qs = params && method === 'GET' ? `?${form(params).toString()}` : '';
    const res = await fetch(`${this.cfg.apiBase}${path}${qs}`, {
      method,
      headers: {
        authorization: `Bearer ${this.cfg.secretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      body,
      signal: AbortSignal.timeout(15_000),
    }).catch((e: Error) => {
      throw new AppError('UNAVAILABLE', `Couldn’t reach Stripe: ${e.message}`);
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!res.ok)
      throw new AppError(
        res.status === 401 ? 'VALIDATION_FAILED' : 'UNAVAILABLE',
        `Stripe: ${json.error?.message ?? `HTTP ${res.status}`}`,
      );
    return json;
  }
}

/** Verifies a `Stripe-Signature` header against the exact request bytes. */
export function verifyStripeSignature(
  raw: Buffer,
  header: string | undefined,
  secret: string,
  toleranceS = 300,
  now = Date.now(),
): boolean {
  if (!header) return false;
  const parts = header.split(',').map((p) => p.split('=') as [string, string]);
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > toleranceS) return false;
  const expected = createHmac('sha256', secret).update(`${t}.`).update(raw).digest();
  return parts
    .filter(([k]) => k === 'v1')
    .some(([, sig]) => {
      const got = Buffer.from(sig ?? '', 'hex');
      return got.length === expected.length && timingSafeEqual(got, expected);
    });
}
