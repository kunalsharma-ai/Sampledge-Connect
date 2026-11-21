import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Db } from 'mongodb';
import {
  AssignPlanRequestSchema,
  CheckoutRequestSchema,
  PlanInputSchema,
  tenantCan,
  type BillingOverview,
  type BillingPlan,
  type BillingUsage,
  type CheckoutResponse,
  type Invoice,
  type Subscription,
} from '@sampledge/contracts';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { AppError, forbidden, notFound, parse } from '../common/errors.js';
import { PlatformAdmins } from '../common/platform-admins.js';
import type { TenantContext } from '../common/tenant-context.js';
import { MONGO_DB } from '../database/database.module.js';
import type {
  BillingInvoiceDoc,
  BillingPlanDoc,
  BillingSubscriptionDoc,
} from '../database/documents.js';
import { newId, TenantDb } from '../database/tenant-db.js';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service.js';
import { AuditService } from '../audit/audit.service.js';
import {
  STRIPE_PROVIDER,
  StripeClient,
  stripeConfig,
  verifyStripeSignature,
  type StripeConfig,
} from './stripe.js';

type StripeObj = Record<string, unknown> & { id: string };
const s = (v: unknown) => (typeof v === 'string' ? v : null);
const n = (v: unknown) => (typeof v === 'number' ? v : null);
const fromUnix = (v: unknown) => (typeof v === 'number' ? new Date(v * 1000) : null);

/**
 * Plans, subscriptions and invoices. Prices live in the `billing_plans` catalog that
 * platform operators edit; payments go through Stripe when it's set up in Integrations,
 * otherwise operators assign plans by hand (invoice / bank transfer).
 */
@Injectable()
export class BillingService implements OnModuleInit {
  private readonly log = new Logger('Billing');

  constructor(
    private readonly db: TenantDb,
    @Inject(MONGO_DB) private readonly raw: Db,
    private readonly settings: IntegrationSettingsService,
    private readonly audit: AuditService,
    private readonly operators: PlatformAdmins,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  onModuleInit() {
    this.settings.register(STRIPE_PROVIDER, {
      test: async (v) => {
        const c = stripeConfig({ ...v, webhookSecret: v.webhookSecret || 'unused' });
        if (!c) return { ok: false, message: 'Enter the secret key' };
        const acct = await new StripeClient(c).call<{
          id: string;
          settings?: { dashboard?: { display_name?: string } };
        }>('GET', '/v1/account');
        const live = c.secretKey.startsWith('sk_live_');
        return {
          ok: true,
          message: `Connected to ${acct.settings?.dashboard?.display_name ?? acct.id} (${live ? 'live mode: real charges' : 'test mode: nobody is charged'})`,
        };
      },
    });
  }

  // ---------- tenant ----------

  async overview(ctx: TenantContext): Promise<BillingOverview> {
    const [sub, usage, plans, stripe, invoices, operator] = await Promise.all([
      this.subscription(ctx.tenantId),
      this.usage(ctx.tenantId),
      this.catalog(false),
      this.stripe(),
      this.db
        .for(ctx.tenantId)
        .billing_invoices.find({}, { sort: { createdAt: -1 }, limit: 24 })
        .toArray(),
      this.operators.is(ctx),
    ]);
    const plan = sub.planId ? await this.plan(sub.planId) : null;
    return {
      subscription: toSubscription(sub),
      plan,
      usage,
      plans: plans.filter((p) => p.public && p.active),
      paymentsEnabled: !!stripe,
      invoices: invoices.map(toInvoice),
      canManage: tenantCan(ctx.role, 'tenant.manage'),
      canManageCatalog: operator,
    };
  }

  /** Starts a plan: hosted checkout for paid plans, immediate for free ones. */
  async checkout(ctx: TenantContext, body: unknown): Promise<CheckoutResponse> {
    if (!tenantCan(ctx.role, 'tenant.manage'))
      throw forbidden('Only the organization owner can change the plan');
    const req = parse(CheckoutRequestSchema, body);
    const plan = await this.plan(req.planId);
    if (!plan || !plan.active || !plan.public) throw notFound('Plan');
    const price =
      plan.monthlyPerSeat === 0
        ? 0
        : req.interval === 'year'
          ? plan.yearlyPerSeat
          : plan.monthlyPerSeat;
    if (price === null) throw new AppError('VALIDATION_FAILED', 'This plan has no yearly option');
    const usage = await this.usage(ctx.tenantId);
    if (plan.limits.seats !== null && usage.members > plan.limits.seats)
      throw new AppError(
        'CONFLICT',
        `This plan includes ${plan.limits.seats} members and you have ${usage.members}. Remove members or pick a larger plan.`,
      );
    const t = this.db.for(ctx.tenantId);
    const sub = await this.subscription(ctx.tenantId);
    const seats = Math.max(1, usage.members);

    if (price === 0) {
      if (sub.stripeSubscriptionId)
        throw new AppError(
          'CONFLICT',
          'Cancel the paid subscription from “Manage payment” first, then pick the free plan.',
        );
      await this.write(ctx.tenantId, {
        planId: plan.planId,
        status: 'active',
        interval: req.interval,
        seats,
        provider: 'manual',
        currentPeriodEnd: null,
        trialEndsAt: null,
        cancelAtPeriodEnd: false,
      });
      await this.audit.record({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'billing.plan_changed',
        metadata: { planId: plan.planId, interval: req.interval, free: true },
      });
      return { url: null, subscription: toSubscription(await this.subscription(ctx.tenantId)) };
    }

    const cfg = await this.stripe();
    if (!cfg)
      throw new AppError(
        'UNAVAILABLE',
        'Online payment isn’t set up yet. Contact us and we’ll switch your plan by invoice.',
      );
    const stripe = new StripeClient(cfg);
    const tenant = await this.db.tenants.findOne({ _id: ctx.tenantId });
    let customer = sub.stripeCustomerId;
    if (!customer) {
      const owner = await t.users.findOne({ _id: ctx.userId });
      const c = await stripe.call<StripeObj>(
        'POST',
        '/v1/customers',
        { name: tenant?.name, email: owner?.email, metadata: { tenantId: ctx.tenantId } },
        `customer-${ctx.tenantId}`,
      );
      customer = c.id;
      await this.write(ctx.tenantId, { stripeCustomerId: customer });
    }
    if (sub.stripeSubscriptionId && sub.status !== 'canceled') {
      // Already paying: change the plan in place (prorated by Stripe).
      await stripe.call('POST', `/v1/subscriptions/${sub.stripeSubscriptionId}`, {
        items: {
          0: {
            id: sub.stripeItemId,
            price_data: this.priceData(plan, req.interval, price),
            quantity: seats,
          },
        },
        metadata: { tenantId: ctx.tenantId, planId: plan.planId },
        proration_behavior: 'create_prorations',
        cancel_at_period_end: false,
      });
      await this.audit.record({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'billing.plan_changed',
        metadata: { planId: plan.planId, interval: req.interval },
      });
      return { url: null, subscription: toSubscription(await this.subscription(ctx.tenantId)) };
    }
    const web = this.webUrl();
    const session = await stripe.call<StripeObj & { url: string }>(
      'POST',
      '/v1/checkout/sessions',
      {
        mode: 'subscription',
        customer,
        client_reference_id: ctx.tenantId,
        success_url: `${web}/app?billing=success`,
        cancel_url: `${web}/app?billing=canceled`,
        line_items: {
          0: { quantity: seats, price_data: this.priceData(plan, req.interval, price) },
        },
        subscription_data: {
          metadata: { tenantId: ctx.tenantId, planId: plan.planId },
          trial_period_days: plan.trialDays > 0 && !sub.trialUsed ? plan.trialDays : undefined,
        },
        metadata: { tenantId: ctx.tenantId, planId: plan.planId },
        allow_promotion_codes: true,
      },
    );
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'billing.checkout_started',
      metadata: { planId: plan.planId, interval: req.interval, seats },
    });
    return { url: session.url, subscription: toSubscription(sub) };
  }

  /** Stripe's customer portal: cards, invoices, cancel. */
  async portal(ctx: TenantContext): Promise<{ url: string }> {
    if (!tenantCan(ctx.role, 'tenant.manage')) throw forbidden();
    const sub = await this.subscription(ctx.tenantId);
    const cfg = await this.stripe();
    if (!cfg || !sub.stripeCustomerId)
      throw new AppError('CONFLICT', 'There’s no payment account for this organization yet');
    const r = await new StripeClient(cfg).call<{ url: string }>(
      'POST',
      '/v1/billing_portal/sessions',
      { customer: sub.stripeCustomerId, return_url: `${this.webUrl()}/app?billing=portal` },
    );
    return { url: r.url };
  }

  /** For the Administration home. */
  async summary(tenantId: string) {
    const sub = await this.subscription(tenantId);
    const plan = sub.planId ? await this.plan(sub.planId) : null;
    const usage = await this.usage(tenantId);
    return { planName: plan?.name ?? null, status: sub.status, storageBytes: usage.storageBytes };
  }

  /** Public pricing (marketing page): public, active plans only. */
  async publicPlans(): Promise<BillingPlan[]> {
    return (await this.catalog(false)).filter((p) => p.public);
  }

  /** Seat limit for adding people. Guests don't use a seat. */
  async assertSeatAvailable(tenantId: string) {
    const sub = await this.subscription(tenantId);
    if (!sub.planId || sub.status === 'none' || sub.status === 'canceled') return;
    const plan = await this.plan(sub.planId);
    if (!plan || plan.limits.seats === null) return;
    const { members } = await this.usage(tenantId);
    if (members >= plan.limits.seats)
      throw new AppError(
        'CONFLICT',
        `Your ${plan.name} plan includes ${plan.limits.seats} members. Upgrade in Billing to add more.`,
      );
  }

  /** Keeps the billed quantity equal to the number of members. Best effort. */
  async syncSeats(tenantId: string) {
    try {
      const sub = await this.subscription(tenantId);
      const { members } = await this.usage(tenantId);
      const seats = Math.max(1, members);
      if (seats === sub.seats) return;
      if (sub.provider === 'stripe' && sub.stripeItemId && sub.status !== 'canceled') {
        const cfg = await this.stripe();
        if (cfg)
          await new StripeClient(cfg).call('POST', `/v1/subscription_items/${sub.stripeItemId}`, {
            quantity: seats,
            proration_behavior: 'create_prorations',
          });
      }
      if (sub.provider === 'stripe' || sub.provider === 'manual')
        await this.write(tenantId, { seats });
    } catch (e) {
      this.log.warn(`Seat sync failed for ${tenantId}: ${(e as Error).message}`);
    }
  }

  // ---------- Stripe webhook ----------

  async webhook(raw: Buffer | undefined, signature: string | undefined) {
    const cfg = await this.stripe();
    if (!cfg) throw new AppError('UNAVAILABLE', 'Payments are not set up');
    if (!raw || !verifyStripeSignature(raw, signature, cfg.webhookSecret))
      throw new AppError('UNAUTHENTICATED', 'Bad signature');
    const event = JSON.parse(raw.toString('utf8')) as {
      id: string;
      type: string;
      data: { object: StripeObj };
    };
    const o = event.data.object;
    const stripe = new StripeClient(cfg);
    switch (event.type) {
      case 'checkout.session.completed': {
        const tenantId = s(o.client_reference_id) ?? s((o.metadata as StripeObj)?.tenantId);
        if (!tenantId || !s(o.subscription)) break;
        await this.write(tenantId, { stripeCustomerId: s(o.customer) });
        const subObj = await stripe.call<StripeObj>(
          'GET',
          `/v1/subscriptions/${s(o.subscription)}`,
        );
        await this.applySubscription(subObj, tenantId);
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await this.applySubscription(o);
        break;
      case 'invoice.created':
      case 'invoice.finalized':
      case 'invoice.paid':
      case 'invoice.payment_failed':
      case 'invoice.voided':
      case 'invoice.marked_uncollectible':
        await this.applyInvoice(o);
        break;
      default:
        break;
    }
    return { received: true };
  }

  private async applySubscription(o: StripeObj, tenantHint?: string) {
    const meta = (o.metadata ?? {}) as Record<string, string>;
    const tenantId = tenantHint ?? meta.tenantId ?? (await this.tenantForCustomer(s(o.customer)));
    if (!tenantId) return;
    const item = ((o.items as { data?: StripeObj[] })?.data ?? [])[0];
    const recurring = ((item?.price as StripeObj)?.recurring ?? {}) as { interval?: string };
    const st = s(o.status);
    const status: BillingSubscriptionDoc['status'] =
      st === 'trialing'
        ? 'trialing'
        : st === 'active'
          ? 'active'
          : st === 'past_due' || st === 'unpaid' || st === 'incomplete'
            ? 'past_due'
            : 'canceled';
    const before = await this.subscription(tenantId);
    await this.write(tenantId, {
      planId: meta.planId ?? before.planId,
      status,
      interval: recurring.interval === 'year' ? 'year' : 'month',
      seats: n(item?.quantity) ?? before.seats,
      trialEndsAt: fromUnix(o.trial_end),
      currentPeriodEnd: fromUnix(o.current_period_end ?? item?.current_period_end),
      cancelAtPeriodEnd: o.cancel_at_period_end === true,
      provider: 'stripe',
      stripeCustomerId: s(o.customer) ?? before.stripeCustomerId,
      stripeSubscriptionId: status === 'canceled' ? null : o.id,
      stripeItemId: status === 'canceled' ? null : (item?.id ?? null),
      trialUsed: before.trialUsed || status === 'trialing' || o.trial_end != null,
    });
    if (before.status !== status || before.planId !== (meta.planId ?? before.planId))
      await this.audit.record({
        tenantId,
        actorId: null,
        action: 'billing.subscription_updated',
        metadata: { from: before.status, to: status, planId: meta.planId ?? before.planId },
      });
  }

  private async applyInvoice(o: StripeObj) {
    const tenantId =
      s(((o.subscription_details as StripeObj)?.metadata as Record<string, string>)?.tenantId) ??
      (await this.tenantForCustomer(s(o.customer)));
    if (!tenantId) return;
    const st = s(o.status);
    const status = (['draft', 'open', 'paid', 'void', 'uncollectible'] as const).find(
      (x) => x === st,
    );
    if (!status) return;
    const line = ((o.lines as { data?: StripeObj[] })?.data ?? [])[0];
    const period = (line?.period ?? {}) as { start?: number; end?: number };
    const doc = {
      provider: 'stripe' as const,
      providerInvoiceId: o.id,
      number: s(o.number),
      status,
      currency: s(o.currency) ?? 'usd',
      total: n(o.total) ?? 0,
      periodStart: fromUnix(period.start ?? o.period_start),
      periodEnd: fromUnix(period.end ?? o.period_end),
      createdAt: fromUnix(o.created) ?? new Date(),
      url: s(o.hosted_invoice_url),
      pdfUrl: s(o.invoice_pdf),
    };
    await this.db
      .for(tenantId)
      .billing_invoices.updateOne(
        { provider: 'stripe', providerInvoiceId: o.id },
        { $set: doc },
        { upsert: true },
      );
    if (status === 'paid' || st === 'open')
      await this.audit.record({
        tenantId,
        actorId: null,
        action: status === 'paid' ? 'billing.invoice_paid' : 'billing.invoice_open',
        metadata: { invoice: doc.number ?? o.id, total: doc.total, currency: doc.currency },
      });
  }

  private async tenantForCustomer(customer: string | null) {
    if (!customer) return null;
    const row = await this.raw
      .collection<BillingSubscriptionDoc>('billing_subscriptions')
      .findOne({ stripeCustomerId: customer }, { projection: { tenantId: 1 } });
    return row?.tenantId ?? null;
  }

  // ---------- platform operators ----------

  async listPlans(ctx: TenantContext) {
    await this.operators.assert(ctx);
    return this.catalog(true);
  }

  async savePlan(ctx: TenantContext, planId: string | null, body: unknown): Promise<BillingPlan> {
    await this.operators.assert(ctx);
    const input = parse(PlanInputSchema, body);
    const id = planId ?? newId();
    if (planId && !(await this.db.billingPlans.findOne({ _id: planId }))) throw notFound('Plan');
    await this.db.billingPlans.updateOne(
      { _id: id },
      { $set: { ...input, updatedAt: new Date(), updatedBy: ctx.userId } },
      { upsert: true },
    );
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: planId ? 'billing.plan_updated' : 'billing.plan_created',
      target: { type: 'plan', id },
      metadata: {
        name: input.name,
        currency: input.currency,
        monthlyPerSeat: input.monthlyPerSeat,
        yearlyPerSeat: input.yearlyPerSeat,
      },
    });
    return (await this.plan(id))!;
  }

  async listTenants(ctx: TenantContext) {
    await this.operators.assert(ctx);
    const tenants = await this.db.tenants
      .find(
        {},
        { projection: { slug: 1, name: 1, status: 1, createdAt: 1 }, sort: { createdAt: -1 } },
      )
      .limit(500)
      .toArray();
    const subs = await this.raw
      .collection<BillingSubscriptionDoc>('billing_subscriptions')
      .find({ tenantId: { $in: tenants.map((t) => t._id) } })
      .toArray();
    const byTenant = new Map(subs.map((x) => [x.tenantId, x]));
    return Promise.all(
      tenants.map(async (t) => ({
        tenantId: t._id,
        slug: t.slug,
        name: t.name,
        status: t.status,
        members: (await this.usage(t._id)).members,
        subscription: toSubscription(byTenant.get(t._id) ?? emptySub(t._id)),
      })),
    );
  }

  async assign(ctx: TenantContext, tenantId: string, body: unknown) {
    await this.operators.assert(ctx);
    const req = parse(AssignPlanRequestSchema, body);
    if (!(await this.db.tenants.findOne({ _id: tenantId }))) throw notFound('Organization');
    if (req.planId && !(await this.plan(req.planId))) throw notFound('Plan');
    const before = await this.subscription(tenantId);
    if (before.provider === 'stripe' && before.stripeSubscriptionId)
      throw new AppError(
        'CONFLICT',
        'This organization pays through Stripe. Change or cancel it there so the two don’t disagree.',
      );
    await this.write(tenantId, {
      planId: req.planId,
      status: req.status,
      interval: req.interval,
      seats: req.seats,
      currentPeriodEnd: req.currentPeriodEnd ? new Date(req.currentPeriodEnd) : null,
      trialEndsAt: null,
      cancelAtPeriodEnd: false,
      provider: req.planId ? 'manual' : null,
    });
    await this.audit.record({
      tenantId,
      actorId: null,
      action: 'billing.plan_assigned_by_operator',
      metadata: { planId: req.planId, status: req.status, seats: req.seats },
    });
    return toSubscription(await this.subscription(tenantId));
  }

  // ---------- internals ----------

  async usage(tenantId: string): Promise<BillingUsage> {
    const t = this.db.for(tenantId);
    const [members, files] = await Promise.all([
      t.memberships
        .aggregate<{ n: number }>([
          { $match: { role: { $ne: 'guest' } } },
          {
            $lookup: {
              from: 'users',
              let: { u: '$userId', t: '$tenantId' },
              pipeline: [
                {
                  $match: {
                    $expr: { $and: [{ $eq: ['$_id', '$$u'] }, { $eq: ['$tenantId', '$$t'] }] },
                    status: 'active',
                  },
                },
              ],
              as: 'u',
            },
          },
          { $match: { 'u.0': { $exists: true } } },
          { $count: 'n' },
        ])
        .toArray(),
      t.attachments
        .aggregate<{ bytes: number; ms: number }>([
          { $match: { status: 'ready', deletedAt: { $in: [null] } } },
          {
            $group: {
              _id: null,
              bytes: { $sum: { $ifNull: ['$storedBytes', '$sizeBytes'] } },
              ms: {
                $sum: {
                  $cond: [{ $ifNull: ['$recording', false] }, { $ifNull: ['$durationMs', 0] }, 0],
                },
              },
            },
          },
        ])
        .toArray(),
    ]);
    return {
      members: members[0]?.n ?? 0,
      storageBytes: files[0]?.bytes ?? 0,
      recordingSeconds: Math.round((files[0]?.ms ?? 0) / 1000),
    };
  }

  private async catalog(all: boolean): Promise<BillingPlan[]> {
    const rows = await this.db.billingPlans
      .find(all ? {} : { active: true }, { sort: { sortOrder: 1, monthlyPerSeat: 1 } })
      .toArray();
    return rows.map(toPlan);
  }

  private async plan(id: string): Promise<BillingPlan | null> {
    const p = await this.db.billingPlans.findOne({ _id: id });
    return p ? toPlan(p) : null;
  }

  private async subscription(tenantId: string): Promise<BillingSubscriptionDoc> {
    return (await this.db.for(tenantId).billing_subscriptions.findOne({})) ?? emptySub(tenantId);
  }

  private async write(
    tenantId: string,
    set: Partial<Omit<BillingSubscriptionDoc, '_id' | 'tenantId'>>,
  ) {
    const base = emptySub(tenantId);
    const insert: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(base))
      if (!(k in set) && k !== '_id' && k !== 'tenantId' && k !== 'updatedAt') insert[k] = v;
    await this.db
      .for(tenantId)
      .billing_subscriptions.updateOne(
        {},
        { $set: { ...set, updatedAt: new Date() }, $setOnInsert: insert },
        { upsert: true },
      );
  }

  private async stripe(): Promise<StripeConfig | null> {
    const r = await this.settings.get(null, STRIPE_PROVIDER.id).catch(() => null);
    return r?.enabled ? stripeConfig(r.values) : null;
  }

  private priceData(plan: BillingPlan, interval: 'month' | 'year', unitAmount: number) {
    return {
      currency: plan.currency,
      unit_amount: unitAmount,
      recurring: { interval },
      product_data: { name: `Sampledge Connect ${plan.name}`, metadata: { planId: plan.planId } },
    };
  }

  private webUrl() {
    return (this.cfg.PUBLIC_WEB_URL ?? this.cfg.corsOrigins[0] ?? 'http://localhost:3000').replace(
      /\/+$/,
      '',
    );
  }
}

const emptySub = (tenantId: string): BillingSubscriptionDoc => ({
  _id: '',
  tenantId,
  planId: null,
  status: 'none',
  interval: 'month',
  seats: 1,
  trialEndsAt: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  provider: null,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  stripeItemId: null,
  trialUsed: false,
  updatedAt: new Date(0),
});

function toSubscription(d: BillingSubscriptionDoc): Subscription {
  return {
    planId: d.planId,
    status: d.status,
    interval: d.interval,
    seats: d.seats,
    trialEndsAt: d.trialEndsAt?.toISOString() ?? null,
    currentPeriodEnd: d.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: d.cancelAtPeriodEnd,
    provider: d.provider,
    updatedAt: d._id ? d.updatedAt.toISOString() : null,
  };
}

function toPlan(p: BillingPlanDoc): BillingPlan {
  return {
    planId: p._id,
    name: p.name,
    description: p.description,
    currency: p.currency,
    monthlyPerSeat: p.monthlyPerSeat,
    yearlyPerSeat: p.yearlyPerSeat,
    limits: p.limits,
    features: p.features,
    trialDays: p.trialDays,
    public: p.public,
    active: p.active,
    sortOrder: p.sortOrder,
    updatedAt: p.updatedAt.toISOString(),
  };
}

function toInvoice(d: BillingInvoiceDoc): Invoice {
  return {
    invoiceId: d._id,
    number: d.number,
    status: d.status,
    currency: d.currency,
    total: d.total,
    periodStart: d.periodStart?.toISOString() ?? null,
    periodEnd: d.periodEnd?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
    url: d.url,
    pdfUrl: d.pdfUrl,
  };
}
