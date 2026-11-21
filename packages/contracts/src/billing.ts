import { z } from 'zod';

/**
 * Billing. Nothing about prices is hardcoded: platform operators keep the plan catalog
 * in the database (Platform → Plans), and payments go through the payment provider set
 * up in Integrations (Stripe today). Amounts are integers in the currency's minor unit
 * (cents, paise) so no rounding ever happens in Connect.
 */

export const BILLING_INTERVALS = ['month', 'year'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export const PlanLimitsSchema = z.object({
  /** null = unlimited. */
  seats: z.number().int().positive().nullable(),
  storageGb: z.number().positive().nullable(),
  recordingHours: z.number().positive().nullable(),
});
export type PlanLimits = z.infer<typeof PlanLimitsSchema>;

export const PlanInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(400).default(''),
  /** ISO 4217, lowercase as payment providers expect: `usd`, `inr`, `eur`. */
  currency: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z]{3}$/, 'a 3-letter currency code'),
  /** Per member per month, minor units. 0 = free plan. */
  monthlyPerSeat: z.number().int().min(0).max(100_000_000),
  /** Per member per year, minor units. null = no yearly option. */
  yearlyPerSeat: z.number().int().min(0).max(1_000_000_000).nullable(),
  limits: PlanLimitsSchema,
  /** Bullet points shown on the plan card. */
  features: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  trialDays: z.number().int().min(0).max(365).default(0),
  /** Hidden plans can be assigned by an operator but aren't offered to customers. */
  public: z.boolean().default(true),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});
export type PlanInput = z.input<typeof PlanInputSchema>;

export interface BillingPlan extends z.infer<typeof PlanInputSchema> {
  planId: string;
  updatedAt: string;
}

export const SUBSCRIPTION_STATUSES = [
  'none',
  'trialing',
  'active',
  'past_due',
  'canceled',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export interface Subscription {
  planId: string | null;
  status: SubscriptionStatus;
  interval: BillingInterval;
  /** Seats billed. Follows the number of active members when paid through the provider. */
  seats: number;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** `manual`: set by a platform operator (invoice, bank transfer). */
  provider: 'manual' | 'stripe' | null;
  updatedAt: string | null;
}

export interface BillingUsage {
  members: number;
  storageBytes: number;
  recordingSeconds: number;
}

export interface Invoice {
  invoiceId: string;
  number: string | null;
  status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
  currency: string;
  /** Minor units. */
  total: number;
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
  /** The provider's hosted invoice or receipt page. */
  url: string | null;
  pdfUrl: string | null;
}

/** GET /v1/billing */
export interface BillingOverview {
  subscription: Subscription;
  plan: BillingPlan | null;
  usage: BillingUsage;
  /** Public, active plans from the catalog, cheapest first. */
  plans: BillingPlan[];
  /** A payment provider is set up, so checkout works. */
  paymentsEnabled: boolean;
  invoices: Invoice[];
  /** Owner: may change the plan. */
  canManage: boolean;
  /** Operator (PLATFORM_ADMIN_EMAILS): may edit the catalog and assign plans. */
  canManageCatalog: boolean;
}

export const CheckoutRequestSchema = z.object({
  planId: z.string().min(1).max(64),
  interval: z.enum(BILLING_INTERVALS),
});
export interface CheckoutResponse {
  /** Send the browser here (the provider's hosted checkout), or null when no payment was needed. */
  url: string | null;
  subscription: Subscription;
}

/** PUT /v1/platform/billing/tenants/:tenantId — operator assigns a plan by hand. */
export const AssignPlanRequestSchema = z.object({
  planId: z.string().min(1).max(64).nullable(),
  status: z.enum(SUBSCRIPTION_STATUSES),
  interval: z.enum(BILLING_INTERVALS).default('month'),
  seats: z.number().int().min(1).max(100_000),
  currentPeriodEnd: z.string().datetime().nullable().default(null),
});

/** Formats a minor-unit amount for display. */
export function formatMoney(minor: number, currency: string, locale?: string): string {
  const cur = currency.toUpperCase();
  const digits =
    new Intl.NumberFormat('en', { style: 'currency', currency: cur }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: cur,
    minimumFractionDigits: minor % 10 ** digits === 0 ? 0 : digits,
  }).format(minor / 10 ** digits);
}
