'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import {
  ArrowRight,
  Bot,
  Check,
  CheckCheck,
  CloudOff,
  KeyRound,
  Palette,
  ShieldCheck,
  Video,
  Workflow,
} from 'lucide-react';
import { formatMoney, type BillingPlan } from '@sampledge/contracts';
import { Button, Card } from '@sampledge/ui';
import { Wordmark } from '@/components/brand';
import { useAuth } from '@/lib/auth';
import { API_URL } from '@/lib/config';

const FEATURES = [
  {
    icon: CloudOff,
    title: 'Offline-first by design',
    body: 'Every message is saved on the device before it is sent, then synced in order when the connection returns.',
  },
  {
    icon: CheckCheck,
    title: 'Honest delivery states',
    body: 'Queued, sending, sent, delivered and read are shown only when the server has confirmed them.',
  },
  {
    icon: ShieldCheck,
    title: 'Tenant isolation',
    body: 'Each organization’s data is scoped on the server from the signed token, never from the client.',
  },
  {
    icon: Video,
    title: 'Calls on your own servers',
    body: 'Voice and video calls, screen share, recordings and external guests, all on infrastructure you run.',
  },
  {
    icon: Bot,
    title: 'A private AI assistant',
    body: 'Summaries, search and answers with sources from a model server you choose. Nothing leaves your setup.',
  },
  {
    icon: Workflow,
    title: 'Built for the Sampledge suite',
    body: 'Samptrek, SampForce, SampBidX and the other modules post cards, tasks and approvals into chat.',
  },
  {
    icon: Palette,
    title: 'Your brand, not ours',
    body: 'Your name, logo and colors across the app, the sign-in page and guest emails.',
  },
];

const SECURITY = [
  'Two-step verification and single sign-on with any OIDC provider',
  'Every device listed, and any of them signed out in one click',
  'Integration secrets encrypted in the database with AES-256-GCM',
  'An audit log of every admin and security action, exportable to CSV',
];

function usePublicPlans() {
  const [plans, setPlans] = React.useState<BillingPlan[] | null>(null);
  React.useEffect(() => {
    let live = true;
    fetch(`${API_URL}/v1/billing/plans`)
      .then((r) => (r.ok ? (r.json() as Promise<BillingPlan[]>) : []))
      .catch(() => [] as BillingPlan[])
      .then((p) => live && setPlans(p));
    return () => {
      live = false;
    };
  }, []);
  return plans;
}

function price(plan: BillingPlan, yearly: boolean) {
  if (plan.monthlyPerSeat === 0) return { amount: 'Free', unit: '' };
  if (yearly && plan.yearlyPerSeat !== null)
    return {
      amount: formatMoney(plan.yearlyPerSeat, plan.currency),
      unit: 'per member / year',
    };
  return { amount: formatMoney(plan.monthlyPerSeat, plan.currency), unit: 'per member / month' };
}

function Pricing() {
  const plans = usePublicPlans();
  const [yearly, setYearly] = React.useState(false);
  const hasYearly = plans?.some((p) => p.yearlyPerSeat !== null && p.monthlyPerSeat > 0);
  return (
    <section id="pricing" className="relative mx-auto max-w-6xl px-6 pb-24">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-overline uppercase text-accent">Pricing</p>
          <h2 className="mt-3 font-display text-h1 text-text">Pay per member. Guests are free.</h2>
        </div>
        {hasYearly && (
          <div
            role="group"
            aria-label="Billing period"
            className="flex rounded-md border border-border bg-surface p-1"
          >
            {(['Monthly', 'Yearly'] as const).map((l) => {
              const on = (l === 'Yearly') === yearly;
              return (
                <button
                  key={l}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setYearly(l === 'Yearly')}
                  className={`rounded px-3 py-1.5 text-label ${on ? 'bg-accent text-accent-fg' : 'text-text-muted hover:text-text'}`}
                >
                  {l}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {plans === null ? (
        <p className="mt-8 text-body text-text-muted">Loading plans…</p>
      ) : plans.length === 0 ? (
        <Card className="mt-8 p-6">
          <p className="text-label text-text">Pricing on request</p>
          <p className="mt-1 text-label font-normal text-text-muted">
            Plans haven’t been published yet. Create a workspace to try it, or ask us for a quote.
          </p>
        </Card>
      ) : (
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => {
            const p = price(plan, yearly);
            return (
              <Card key={plan.planId} className="flex h-full flex-col p-6">
                <p className="text-h3 text-text">{plan.name}</p>
                {plan.description && (
                  <p className="mt-1 text-label font-normal text-text-muted">{plan.description}</p>
                )}
                <p className="mt-5">
                  <span className="font-display text-h1 text-text">{p.amount}</span>
                  {p.unit && <span className="ml-2 text-label text-text-muted">{p.unit}</span>}
                </p>
                {yearly && plan.yearlyPerSeat === null && plan.monthlyPerSeat > 0 && (
                  <p className="mt-1 text-meta text-text-muted">Monthly billing only</p>
                )}
                <p className="mt-2 text-meta text-text-muted">
                  {plan.limits.seats === null
                    ? 'Unlimited members'
                    : `Up to ${plan.limits.seats} members`}
                  {plan.trialDays > 0 && ` · ${plan.trialDays}-day free trial`}
                </p>
                <ul className="mt-5 flex-1 space-y-2">
                  {plan.features.map((f) => (
                    <li key={f} className="flex gap-2 text-label font-normal text-text">
                      <Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button asChild className="mt-6" variant="secondary">
                  <Link href="/register">Start with {plan.name}</Link>
                </Button>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function Home() {
  const auth = useAuth();
  const router = useRouter();
  React.useEffect(() => {
    if (auth.status === 'signed-in') router.replace('/app');
  }, [auth.status, router]);

  return (
    <main className="sc-noise relative min-h-dvh overflow-hidden">
      <div className="pointer-events-none absolute -left-40 -top-40 size-[620px] rounded-full bg-accent/20 blur-[140px]" />
      <div className="pointer-events-none absolute -right-40 top-40 size-[520px] rounded-full bg-accent2/15 blur-[140px]" />
      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Wordmark />
        <nav className="flex items-center gap-2">
          <a
            href="#pricing"
            className="hidden px-3 text-label text-text-muted hover:text-text sm:block"
          >
            Pricing
          </a>
          <Link
            href="/design"
            className="hidden px-3 text-label text-text-muted hover:text-text sm:block"
          >
            Design system
          </Link>
          <Button asChild variant="ghost">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild>
            <Link href="/register">Create workspace</Link>
          </Button>
        </nav>
      </header>
      <section className="relative mx-auto max-w-6xl px-6 pb-24 pt-16 sm:pt-24">
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-overline uppercase text-accent"
        >
          One Workspace. Every Conversation. Connected.
        </motion.p>
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="mt-5 max-w-3xl font-display text-display text-text"
        >
          Team and client communication that keeps working when the network doesn’t.
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mt-6 max-w-2xl text-body text-text-muted"
        >
          Sampledge Connect is the secure messaging layer for research, sourcing and fieldwork
          teams. Chat, calls, meetings and the Sampledge modules in one place, on servers you
          control.
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="mt-10 flex flex-wrap gap-3"
        >
          <Button asChild size="lg">
            <Link href="/register">
              Create your workspace <ArrowRight />
            </Link>
          </Button>
          <Button asChild size="lg" variant="secondary">
            <Link href="/login">Sign in</Link>
          </Button>
        </motion.div>
        <div className="mt-20 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + i * 0.05 }}
            >
              <Card className="h-full p-5">
                <span className="flex size-10 items-center justify-center rounded-md bg-accent-soft text-accent">
                  <f.icon className="size-[18px]" />
                </span>
                <p className="mt-4 text-label text-text">{f.title}</p>
                <p className="mt-1 text-label font-normal text-text-muted">{f.body}</p>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>
      <section className="relative mx-auto max-w-6xl px-6 pb-24">
        <Card className="grid gap-8 p-8 md:grid-cols-[1fr_1.4fr]">
          <div>
            <span className="flex size-10 items-center justify-center rounded-md bg-accent-soft text-accent">
              <KeyRound className="size-[18px]" />
            </span>
            <h2 className="mt-4 font-display text-h2 text-text">Security your admins can see</h2>
            <p className="mt-2 text-label font-normal text-text-muted">
              The Administration screen shows who has two-step on, which devices are signed in and
              every change made, in one place.
            </p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {SECURITY.map((s) => (
              <li key={s} className="flex gap-2 text-label font-normal text-text">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                {s}
              </li>
            ))}
          </ul>
        </Card>
      </section>
      <Pricing />
      <footer className="relative mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-8 text-meta text-text-muted">
        <span>© {new Date().getFullYear()} Sampledge</span>
        <span className="flex gap-4">
          <Link href="/login" className="hover:text-text">
            Sign in
          </Link>
          <Link href="/register" className="hover:text-text">
            Create workspace
          </Link>
        </span>
      </footer>
    </main>
  );
}
