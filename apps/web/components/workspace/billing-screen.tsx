'use client';
import * as React from 'react';
import { CreditCard, ExternalLink, Pencil, Plus, Receipt } from 'lucide-react';
import {
  formatMoney,
  type BillingInterval,
  type BillingOverview,
  type BillingPlan,
  type CheckoutResponse,
  type IntegrationTestResult,
  type IntegrationView,
  type PlanInput,
  type Subscription,
  type SubscriptionStatus,
} from '@sampledge/contracts';
import { Badge, Button, Field, Input, StateView, cn, useToast } from '@sampledge/ui';
import { ApiFailure, apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useTenantChange } from '@/lib/engine';
import { FeatureHelp } from '../feature-help';

type Tab = 'plan' | 'catalog' | 'organizations' | 'payments';
interface OrgRow {
  tenantId: string;
  slug: string;
  name: string;
  members: number;
  subscription: Subscription;
}

const STATUS: Record<
  SubscriptionStatus,
  { label: string; tone: 'success' | 'accent' | 'warning' | 'danger' | 'neutral' }
> = {
  none: { label: 'No plan', tone: 'neutral' },
  trialing: { label: 'Trial', tone: 'accent' },
  active: { label: 'Active', tone: 'success' },
  past_due: { label: 'Payment due', tone: 'warning' },
  canceled: { label: 'Canceled', tone: 'danger' },
};
const date = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '';
const errorText = (e: unknown) =>
  e instanceof ApiFailure ? e.error.message : (e as Error).message;
/** Fraction digits of a currency (2 for USD/INR, 0 for JPY). */
const digits = (currency: string) => {
  try {
    return (
      new Intl.NumberFormat('en', {
        style: 'currency',
        currency: currency.toUpperCase(),
      }).resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
};
const price = (p: BillingPlan, interval: BillingInterval) => {
  if (p.monthlyPerSeat === 0) return 'Free';
  const v = interval === 'year' ? p.yearlyPerSeat : p.monthlyPerSeat;
  return v === null ? null : v === 0 ? 'Free' : formatMoney(v, p.currency);
};

function useBillingApi() {
  const { getAccessToken } = useAuth();
  return React.useMemo(() => {
    const req = async <T,>(method: string, path: string, body?: unknown) =>
      apiRequest<T>(method, path, { token: await getAccessToken(), body });
    return {
      overview: () => req<BillingOverview>('GET', '/v1/billing'),
      checkout: (planId: string, interval: BillingInterval) =>
        req<CheckoutResponse>('POST', '/v1/billing/checkout', { planId, interval }),
      portal: () => req<{ url: string }>('POST', '/v1/billing/portal'),
      plans: () => req<BillingPlan[]>('GET', '/v1/platform/billing/plans'),
      savePlan: (id: string | null, body: PlanInput) =>
        id
          ? req<BillingPlan>('PUT', `/v1/platform/billing/plans/${id}`, body)
          : req<BillingPlan>('POST', '/v1/platform/billing/plans', body),
      orgs: () => req<OrgRow[]>('GET', '/v1/platform/billing/tenants'),
      assign: (tenantId: string, body: unknown) =>
        req<Subscription>('PUT', `/v1/platform/billing/tenants/${tenantId}`, body),
      payments: async () =>
        (await req<IntegrationView[]>('GET', '/v1/platform/integrations')).find(
          (v) => v.provider.id === 'billing.stripe',
        ) ?? null,
      savePayments: (enabled: boolean, values: Record<string, unknown>) =>
        req<IntegrationView>('PUT', '/v1/platform/integrations/billing.stripe', {
          enabled,
          values,
        }),
      testPayments: (values: Record<string, unknown>) =>
        req<IntegrationTestResult>('POST', '/v1/platform/integrations/billing.stripe/test', {
          values,
        }),
    };
  }, [getAccessToken]);
}

/** Administration → Billing. Prices come from the operator's plan catalog, never from code. */
export function BillingScreen() {
  const api = useBillingApi();
  const { toast } = useToast();
  const [data, setData] = React.useState<BillingOverview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<Tab>('plan');

  const load = React.useCallback(async () => {
    try {
      setData(await api.overview());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiFailure && e.status === 403 ? 'forbidden' : errorText(e));
    }
  }, [api]);
  React.useEffect(() => {
    void load();
  }, [load]);
  useTenantChange('billing', () => void load());

  // Back from the payment page.
  React.useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const r = q.get('billing');
    if (!r) return;
    window.history.replaceState(null, '', window.location.pathname);
    if (r === 'success')
      toast({
        title: 'Thanks, your plan is being set up',
        description: 'It shows here as soon as the payment provider confirms it.',
        tone: 'success',
      });
    const t = setTimeout(() => void load(), 2500);
    return () => clearTimeout(t);
  }, [toast, load]);

  if (error === 'forbidden')
    return (
      <main className="flex flex-1 items-center justify-center pb-16 md:pb-0">
        <StateView
          state="permission-denied"
          description="Only owners and admins can see billing."
        />
      </main>
    );

  const tabs: { id: Tab; label: string }[] = [
    { id: 'plan', label: 'Your plan' },
    ...(data?.canManageCatalog
      ? ([
          { id: 'catalog', label: 'Plan catalog' },
          { id: 'organizations', label: 'Organizations' },
          { id: 'payments', label: 'Payments' },
        ] as const)
      : []),
  ];

  return (
    <main className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0" data-testid="billing-screen">
      <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-border bg-surface/40 px-4 backdrop-blur-xl sm:px-6">
        <CreditCard className="size-5 text-accent" aria-hidden />
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="font-display text-h3 text-text">Billing</h1>
          <FeatureHelp id="billing" />
        </div>
        {tabs.length > 1 ? (
          <nav className="ml-4 flex gap-1" aria-label="Billing sections">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? 'page' : undefined}
                className={cn(
                  'h-8 rounded-md px-3 text-label',
                  tab === t.id
                    ? 'bg-surface-raised text-text shadow-sm'
                    : 'text-text-muted hover:text-text',
                )}
              >
                {t.label}
              </button>
            ))}
          </nav>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
          {!data ? (
            error ? (
              <StateView state="error" description={error} />
            ) : (
              <StateView state="loading" title="Loading billing" />
            )
          ) : tab === 'plan' ? (
            <PlanTab data={data} onChanged={load} />
          ) : tab === 'catalog' ? (
            <CatalogTab onChanged={load} />
          ) : tab === 'organizations' ? (
            <OrganizationsTab />
          ) : (
            <PaymentsTab onChanged={load} />
          )}
        </div>
      </div>
    </main>
  );
}

// ---------- the organization's plan ----------

function Meter({
  label,
  used,
  limit,
  unit,
}: {
  label: string;
  used: number;
  limit: number | null;
  unit?: string;
}) {
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
  const fmt = (v: number) => `${Number.isInteger(v) ? v : v.toFixed(1)}${unit ? ` ${unit}` : ''}`;
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-meta text-text-subtle">{label}</p>
      <p className="mt-1 text-label text-text">
        {fmt(used)}
        <span className="text-text-subtle">
          {' '}
          {limit === null ? '· unlimited' : `of ${fmt(limit)}`}
        </span>
      </p>
      {limit !== null ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
          <div
            className={cn('h-full rounded-full', pct >= 90 ? 'bg-warning' : 'bg-accent')}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

function PlanTab({ data, onChanged }: { data: BillingOverview; onChanged: () => Promise<void> }) {
  const api = useBillingApi();
  const [interval, setInterval] = React.useState<BillingInterval>(data.subscription.interval);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const { subscription: sub, plan, usage } = data;
  const st = STATUS[sub.status];
  const hasYearly = data.plans.some((p) => p.yearlyPerSeat !== null);

  async function choose(p: BillingPlan) {
    setBusy(p.planId);
    setError(null);
    try {
      const r = await api.checkout(p.planId, interval);
      if (r.url) return window.location.assign(r.url);
      await onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section
        className="rounded-xl border border-border bg-surface p-5"
        data-testid="current-plan"
      >
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-h3 text-text">{plan?.name ?? 'No plan yet'}</h2>
              <Badge tone={st.tone}>{st.label}</Badge>
              {sub.cancelAtPeriodEnd ? <Badge tone="warning">Ends at period end</Badge> : null}
            </div>
            <p className="mt-1 text-meta text-text-muted">
              {plan
                ? [
                    price(plan, sub.interval) === 'Free'
                      ? 'Free'
                      : `${price(plan, sub.interval)} per member per ${sub.interval} · ${sub.seats} member${sub.seats === 1 ? '' : 's'} billed`,
                    sub.status === 'trialing' && sub.trialEndsAt
                      ? `trial ends ${date(sub.trialEndsAt)}`
                      : sub.currentPeriodEnd
                        ? `${sub.cancelAtPeriodEnd ? 'ends' : 'renews'} ${date(sub.currentPeriodEnd)}`
                        : null,
                    sub.provider === 'manual' ? 'billed by invoice' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : data.plans.length
                  ? 'Pick a plan below.'
                  : 'Plans haven’t been published yet. Your provider will set them up.'}
            </p>
          </div>
          {sub.provider === 'stripe' && data.canManage ? (
            <Button
              variant="secondary"
              size="sm"
              loading={busy === 'portal'}
              onClick={async () => {
                setBusy('portal');
                try {
                  window.location.assign((await api.portal()).url);
                } catch (e) {
                  setError(errorText(e));
                  setBusy(null);
                }
              }}
            >
              <ExternalLink /> Manage payment
            </Button>
          ) : null}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Meter label="Members" used={usage.members} limit={plan?.limits.seats ?? null} />
          <Meter
            label="File storage"
            used={usage.storageBytes / 1024 ** 3}
            limit={plan?.limits.storageGb ?? null}
            unit="GB"
          />
          <Meter
            label="Recordings"
            used={usage.recordingSeconds / 3600}
            limit={plan?.limits.recordingHours ?? null}
            unit="h"
          />
        </div>
      </section>

      {data.plans.length ? (
        <section>
          <div className="mb-3 flex items-center gap-3">
            <h2 className="text-label text-text">Plans</h2>
            {hasYearly ? (
              <div
                className="ml-auto flex gap-1 rounded-lg border border-border bg-surface-sunken p-1"
                role="group"
                aria-label="Billing period"
              >
                {(['month', 'year'] as const).map((i) => (
                  <button
                    key={i}
                    onClick={() => setInterval(i)}
                    aria-pressed={interval === i}
                    className={cn(
                      'h-7 rounded-md px-3 text-meta',
                      interval === i ? 'bg-surface-raised text-text shadow-sm' : 'text-text-muted',
                    )}
                  >
                    {i === 'month' ? 'Monthly' : 'Yearly'}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {data.plans.map((p) => {
              const amount = price(p, interval);
              const current =
                sub.planId === p.planId && sub.status !== 'canceled' && sub.interval === interval;
              return (
                <article
                  key={p.planId}
                  className={cn(
                    'flex flex-col rounded-xl border bg-surface p-5',
                    current ? 'border-accent shadow-md' : 'border-border',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <h3 className="text-label text-text">{p.name}</h3>
                    {current ? <Badge tone="accent">Current</Badge> : null}
                    {p.trialDays && !current ? <Badge>{p.trialDays}-day trial</Badge> : null}
                  </div>
                  <p className="mt-3 font-display text-h2 text-text">
                    {amount ?? '—'}
                    {amount && amount !== 'Free' ? (
                      <span className="text-meta font-normal text-text-subtle">
                        {' '}
                        / member / {interval}
                      </span>
                    ) : null}
                  </p>
                  {p.description ? (
                    <p className="mt-2 text-meta text-text-muted">{p.description}</p>
                  ) : null}
                  <ul className="mt-3 flex-1 space-y-1 text-meta text-text-muted">
                    <li>
                      {p.limits.seats ? `Up to ${p.limits.seats} members` : 'Unlimited members'}
                    </li>
                    <li>
                      {p.limits.storageGb ? `${p.limits.storageGb} GB files` : 'Unlimited files'}
                    </li>
                    {p.limits.recordingHours ? (
                      <li>{p.limits.recordingHours} h of recordings</li>
                    ) : null}
                    {p.features.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                  <Button
                    className="mt-4"
                    variant={current ? 'secondary' : 'primary'}
                    disabled={!data.canManage || current || amount === null}
                    loading={busy === p.planId}
                    onClick={() => void choose(p)}
                    title={
                      data.canManage ? undefined : 'Only the organization owner can change the plan'
                    }
                  >
                    {current ? 'Your plan' : amount === null ? 'Monthly only' : `Choose ${p.name}`}
                  </Button>
                </article>
              );
            })}
          </div>
          {!data.canManage ? (
            <p className="mt-3 text-meta text-text-subtle">
              Only the organization owner can change the plan.
            </p>
          ) : !data.paymentsEnabled ? (
            <p className="mt-3 text-meta text-text-subtle">
              Online payment isn’t set up yet: paid plans are switched by invoice. Free plans start
              right away.
            </p>
          ) : null}
        </section>
      ) : null}
      {error ? (
        <p role="alert" className="text-label font-normal text-danger">
          {error}
        </p>
      ) : null}

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-label text-text">
          <Receipt className="size-4 text-text-subtle" aria-hidden /> Invoices
        </h2>
        {data.invoices.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-meta text-text-subtle">
            No invoices yet.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {data.invoices.map((i) => (
              <li key={i.invoiceId} className="flex items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-label text-text">{i.number ?? 'Invoice'}</span>
                  <span className="block text-meta text-text-subtle">{date(i.createdAt)}</span>
                </span>
                <Badge
                  tone={
                    i.status === 'paid' ? 'success' : i.status === 'open' ? 'warning' : 'neutral'
                  }
                  className="capitalize"
                >
                  {i.status}
                </Badge>
                <span className="w-28 text-right text-label tabular-nums text-text">
                  {formatMoney(i.total, i.currency)}
                </span>
                {i.url ? (
                  <a
                    href={i.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-meta text-accent hover:underline"
                  >
                    View
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---------- operator: plan catalog ----------

const EMPTY: PlanInput = {
  name: '',
  description: '',
  currency: 'usd',
  monthlyPerSeat: 0,
  yearlyPerSeat: null,
  limits: { seats: null, storageGb: null, recordingHours: null },
  features: [],
  trialDays: 0,
  public: true,
  active: true,
  sortOrder: 0,
};

export function CatalogTab({ onChanged }: { onChanged: () => Promise<void> }) {
  const api = useBillingApi();
  const [plans, setPlans] = React.useState<BillingPlan[] | null>(null);
  const [editing, setEditing] = React.useState<BillingPlan | 'new' | null>(null);
  const load = React.useCallback(async () => setPlans(await api.plans()), [api]);
  React.useEffect(() => {
    void load();
  }, [load]);

  if (!plans) return <StateView state="loading" title="Loading plans" />;
  if (editing)
    return (
      <PlanForm
        plan={editing === 'new' ? null : editing}
        onDone={async () => {
          setEditing(null);
          await Promise.all([load(), onChanged()]);
        }}
        onCancel={() => setEditing(null)}
      />
    );
  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <p className="flex-1 text-meta text-text-muted">
          Prices are what you enter here. Every organization on this server sees the public, active
          plans.
        </p>
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus /> New plan
        </Button>
      </div>
      {plans.length === 0 ? (
        <StateView
          state="empty"
          title="No plans yet"
          description="Create the plans your customers can choose."
        />
      ) : (
        <ul
          className="divide-y divide-border rounded-lg border border-border"
          data-testid="plan-catalog"
        >
          {plans.map((p) => (
            <li key={p.planId} className="flex items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-label text-text">
                  {p.name}
                  {!p.active ? <Badge>Inactive</Badge> : !p.public ? <Badge>Hidden</Badge> : null}
                </span>
                <span className="block text-meta text-text-subtle">
                  {price(p, 'month')}
                  {p.monthlyPerSeat ? ' / member / month' : ''}
                  {p.yearlyPerSeat !== null ? ` · ${price(p, 'year')} / year` : ''}
                  {p.limits.seats ? ` · up to ${p.limits.seats} members` : ''}
                  {p.trialDays ? ` · ${p.trialDays}-day trial` : ''}
                </span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(p)}
                aria-label={`Edit ${p.name}`}
              >
                <Pencil /> Edit
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PlanForm({
  plan,
  onDone,
  onCancel,
}: {
  plan: BillingPlan | null;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const api = useBillingApi();
  const init = plan ?? EMPTY;
  const [currency, setCurrency] = React.useState(init.currency);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const d = digits(currency);
  const major = (minor: number | null | undefined) =>
    minor == null ? '' : String(minor / 10 ** d);
  const toMinor = (v: FormDataEntryValue | null) =>
    v === null || String(v).trim() === '' ? null : Math.round(Number(v) * 10 ** d);
  const num = (v: FormDataEntryValue | null) =>
    v === null || String(v).trim() === '' ? null : Number(v);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api.savePlan(plan?.planId ?? null, {
        name: String(f.get('name')),
        description: String(f.get('description') ?? ''),
        currency,
        monthlyPerSeat: toMinor(f.get('monthly')) ?? 0,
        yearlyPerSeat: toMinor(f.get('yearly')),
        limits: {
          seats: num(f.get('seats')),
          storageGb: num(f.get('storage')),
          recordingHours: num(f.get('recording')),
        },
        features: String(f.get('features') ?? '')
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean),
        trialDays: num(f.get('trial')) ?? 0,
        public: f.get('public') === 'on',
        active: f.get('active') === 'on',
        sortOrder: num(f.get('sort')) ?? 0,
      });
      await onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="grid gap-4 rounded-xl border border-border bg-surface p-5"
      data-testid="plan-form"
    >
      <h2 className="font-display text-h3 text-text">{plan ? `Edit ${plan.name}` : 'New plan'}</h2>
      <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
        <Field label="Name" htmlFor="pf-name">
          <Input id="pf-name" name="name" defaultValue={init.name} required maxLength={60} />
        </Field>
        <Field label="Currency" htmlFor="pf-cur" hint="ISO code: usd, inr, eur">
          <Input
            id="pf-cur"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toLowerCase())}
            maxLength={3}
            required
          />
        </Field>
      </div>
      <Field label="Description" htmlFor="pf-desc">
        <Input
          id="pf-desc"
          name="description"
          defaultValue={init.description ?? ''}
          maxLength={400}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={`Per member per month (${currency.toUpperCase()})`}
          htmlFor="pf-m"
          hint="0 makes it a free plan"
        >
          <Input
            id="pf-m"
            name="monthly"
            type="number"
            min={0}
            step="any"
            defaultValue={major(init.monthlyPerSeat)}
            required
          />
        </Field>
        <Field
          label={`Per member per year (${currency.toUpperCase()})`}
          htmlFor="pf-y"
          hint="Leave empty for monthly only"
        >
          <Input
            id="pf-y"
            name="yearly"
            type="number"
            min={0}
            step="any"
            defaultValue={major(init.yearlyPerSeat)}
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Members" htmlFor="pf-s" hint="Empty: unlimited">
          <Input
            id="pf-s"
            name="seats"
            type="number"
            min={1}
            defaultValue={init.limits.seats ?? ''}
          />
        </Field>
        <Field label="Files (GB)" htmlFor="pf-g" hint="Empty: unlimited">
          <Input
            id="pf-g"
            name="storage"
            type="number"
            min={0}
            step="any"
            defaultValue={init.limits.storageGb ?? ''}
          />
        </Field>
        <Field label="Recordings (h)" htmlFor="pf-r" hint="Empty: unlimited">
          <Input
            id="pf-r"
            name="recording"
            type="number"
            min={0}
            step="any"
            defaultValue={init.limits.recordingHours ?? ''}
          />
        </Field>
        <Field label="Trial days" htmlFor="pf-t">
          <Input
            id="pf-t"
            name="trial"
            type="number"
            min={0}
            max={365}
            defaultValue={init.trialDays ?? 0}
          />
        </Field>
      </div>
      <Field label="Features, one per line" htmlFor="pf-f">
        <textarea
          id="pf-f"
          name="features"
          rows={3}
          defaultValue={(init.features ?? []).join('\n')}
          className="rounded-md border border-border bg-surface-sunken px-3 py-2 text-label text-text"
        />
      </Field>
      <div className="flex flex-wrap items-center gap-5 text-label text-text">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="public" defaultChecked={init.public ?? true} /> Offered to
          customers
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="active" defaultChecked={init.active ?? true} /> Active
        </label>
        <label className="flex items-center gap-2">
          Order{' '}
          <Input
            name="sort"
            type="number"
            defaultValue={init.sortOrder ?? 0}
            className="h-8 w-20"
            aria-label="Order"
          />
        </label>
      </div>
      {error ? (
        <p role="alert" className="text-label font-normal text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" loading={busy}>
          Save plan
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ---------- operator: organizations ----------

function OrganizationsTab() {
  const api = useBillingApi();
  const [rows, setRows] = React.useState<OrgRow[] | null>(null);
  const [plans, setPlans] = React.useState<BillingPlan[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const load = React.useCallback(async () => {
    const [r, p] = await Promise.all([api.orgs(), api.plans()]);
    setRows(r);
    setPlans(p);
  }, [api]);
  React.useEffect(() => {
    void load();
  }, [load]);
  if (!rows) return <StateView state="loading" title="Loading organizations" />;
  const names = new Map(plans.map((p) => [p.planId, p.name]));
  return (
    <div>
      <p className="mb-3 text-meta text-text-muted">
        Assign a plan by hand for customers who pay by invoice. Organizations paying online are
        managed by the payment provider.
      </p>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {rows.map((r) => (
          <li key={r.tenantId} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span className="min-w-0 flex-1">
              <span className="block text-label text-text">{r.name}</span>
              <span className="block text-meta text-text-subtle">
                {r.slug} · {r.members} member{r.members === 1 ? '' : 's'}
              </span>
            </span>
            <span className="text-meta text-text-muted">
              {r.subscription.planId
                ? (names.get(r.subscription.planId) ?? 'Unknown plan')
                : 'No plan'}
            </span>
            <Badge tone={STATUS[r.subscription.status].tone}>
              {STATUS[r.subscription.status].label}
            </Badge>
            {r.subscription.provider === 'stripe' ? (
              <Badge>Online</Badge>
            ) : (
              <select
                aria-label={`Plan for ${r.name}`}
                value={r.subscription.planId ?? ''}
                onChange={async (e) => {
                  setError(null);
                  try {
                    const planId = e.target.value || null;
                    await api.assign(r.tenantId, {
                      planId,
                      status: planId ? 'active' : 'none',
                      seats: Math.max(1, r.members),
                    });
                    await load();
                  } catch (err) {
                    setError(errorText(err));
                  }
                }}
                className="h-8 rounded-md border border-border bg-surface-sunken px-2 text-meta text-text"
              >
                <option value="">No plan</option>
                {plans.map((p) => (
                  <option key={p.planId} value={p.planId}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="mt-3 text-label font-normal text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ---------- operator: payment provider ----------

export function PaymentsTab({ onChanged }: { onChanged: () => Promise<void> }) {
  const api = useBillingApi();
  const [view, setView] = React.useState<IntegrationView | null | undefined>(undefined);
  const [key, setKey] = React.useState('');
  const [hook, setHook] = React.useState('');
  const [enabled, setEnabled] = React.useState(false);
  const [busy, setBusy] = React.useState<'save' | 'test' | null>(null);
  const [result, setResult] = React.useState<{ ok: boolean; message: string } | null>(null);
  React.useEffect(() => {
    void api.payments().then((v) => {
      setView(v);
      setEnabled(!!v?.saved?.enabled);
    });
  }, [api]);
  if (view === undefined) return <StateView state="loading" title="Loading" />;
  const set = new Set(view?.saved?.secretsSet ?? []);
  const values = () => ({
    ...(key ? { secretKey: key } : {}),
    ...(hook ? { webhookSecret: hook } : {}),
  });
  return (
    <form
      className="grid max-w-2xl gap-4 rounded-xl border border-border bg-surface p-5"
      data-testid="payments-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy('save');
        setResult(null);
        try {
          setView(await api.savePayments(enabled, values()));
          setKey('');
          setHook('');
          await onChanged();
          setResult({ ok: true, message: 'Saved. Settings are stored encrypted in the database.' });
        } catch (err) {
          setResult({ ok: false, message: errorText(err) });
        } finally {
          setBusy(null);
        }
      }}
    >
      <div>
        <h2 className="font-display text-h3 text-text">Payments (Stripe)</h2>
        <p className="mt-1 text-meta text-text-muted">{view?.provider.description}</p>
      </div>
      <label className="flex items-center gap-2 text-label text-text">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />{' '}
        Take payments online
      </label>
      <Field
        label="Secret key"
        htmlFor="st-key"
        hint={
          set.has('secretKey')
            ? 'Stored securely. Enter a new one to replace it.'
            : 'Use a test key (sk_test_) first: nobody is charged.'
        }
      >
        <Input
          id="st-key"
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={set.has('secretKey') ? '••••••••' : 'sk_test_…'}
          autoComplete="off"
        />
      </Field>
      <Field
        label="Webhook signing secret"
        htmlFor="st-hook"
        hint="Add a webhook endpoint at https://<your-api-host>/v1/billing/stripe/webhook for checkout, subscription and invoice events."
      >
        <Input
          id="st-hook"
          type="password"
          value={hook}
          onChange={(e) => setHook(e.target.value)}
          placeholder={set.has('webhookSecret') ? '••••••••' : 'whsec_…'}
          autoComplete="off"
        />
      </Field>
      {result ? (
        <p
          role="status"
          className={cn(
            'rounded-md px-3 py-2 text-label font-normal',
            result.ok ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger',
          )}
        >
          {result.message}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" loading={busy === 'save'}>
          Save
        </Button>
        <Button
          type="button"
          variant="secondary"
          loading={busy === 'test'}
          onClick={async () => {
            setBusy('test');
            try {
              setResult(await api.testPayments(values()));
            } catch (err) {
              setResult({ ok: false, message: errorText(err) });
            } finally {
              setBusy(null);
            }
          }}
        >
          Test connection
        </Button>
      </div>
    </form>
  );
}
