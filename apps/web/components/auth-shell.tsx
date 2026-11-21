'use client';
import Link from 'next/link';
import { motion } from 'motion/react';
import { CheckCheck, CloudOff, ShieldCheck, Workflow } from 'lucide-react';
import type { PublicBranding } from '@sampledge/contracts';
import { createBrandTheme, themeToCssVars } from '@sampledge/design-tokens';
import { Wordmark } from './brand';

/** The organization's name and logo in place of the product wordmark (white-label). */
function BrandMark({ brand }: { brand: PublicBranding }) {
  return (
    <span className="inline-flex items-center gap-2.5" data-testid="org-brand">
      {brand.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={brand.logo} alt="" className="size-8 rounded-lg object-contain" />
      ) : null}
      <span className="font-display text-[17px] font-bold tracking-tight text-text">
        {brand.displayName}
      </span>
    </span>
  );
}

const POINTS = [
  {
    icon: CloudOff,
    title: 'Works through outages',
    body: 'Messages are saved on your device first and sync the moment you reconnect.',
  },
  {
    icon: Workflow,
    title: 'Work-aware conversations',
    body: 'Built for projects, bids, suppliers and fieldwork across the Sampledge suite.',
  },
  {
    icon: ShieldCheck,
    title: 'Isolated by design',
    body: 'Every organization is a separate tenant, enforced on the server.',
  },
];

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  brand,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
  /** Set once the workspace is known and has its own branding. */
  brand?: PublicBranding | null;
}) {
  const style = brand
    ? (themeToCssVars(
        createBrandTheme({ primary: brand.primary, secondary: brand.secondary, mode: brand.mode }),
      ) as React.CSSProperties)
    : undefined;
  const mark = brand ? <BrandMark brand={brand} /> : <Wordmark />;
  return (
    <main
      className="grid min-h-dvh bg-bg lg:grid-cols-[1.05fr_1fr]"
      style={style}
      data-brand={brand ? 'org' : undefined}
    >
      <section className="sc-noise relative hidden overflow-hidden border-r border-border lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="pointer-events-none absolute -left-40 -top-40 size-[520px] rounded-full bg-accent/20 blur-[120px]" />
        <div className="pointer-events-none absolute -bottom-48 right-[-120px] size-[480px] rounded-full bg-accent2/20 blur-[120px]" />
        <Link href="/" className="relative">
          {mark}
        </Link>
        <div className="relative max-w-md">
          <p className="text-overline uppercase text-accent">
            One Workspace. Every Conversation. Connected.
          </p>
          <h2 className="mt-4 font-display text-display text-text">
            Communication that keeps working when the network doesn’t.
          </h2>
          <ul className="mt-10 space-y-6">
            {POINTS.map((p, i) => (
              <motion.li
                key={p.title}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 * i + 0.1, duration: 0.25 }}
                className="flex gap-4"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-surface-glass backdrop-blur">
                  <p.icon className="size-[18px] text-accent" />
                </span>
                <span>
                  <span className="block text-label text-text">{p.title}</span>
                  <span className="mt-0.5 block text-label font-normal text-text-muted">
                    {p.body}
                  </span>
                </span>
              </motion.li>
            ))}
          </ul>
        </div>
        <div className="relative flex items-center gap-2 text-meta text-text-subtle">
          <CheckCheck className="size-4 text-accent" /> Never shows a message as delivered before
          the server confirms it.
        </div>
      </section>
      <section className="flex items-center justify-center px-5 py-12 sm:px-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="w-full max-w-[420px]"
        >
          <div className="mb-8 lg:hidden">{mark}</div>
          <h1 className="font-display text-h1 text-text">{title}</h1>
          <p className="mt-2 text-body text-text-muted">{subtitle}</p>
          <div className="mt-8">{children}</div>
          <div className="mt-8 text-label font-normal text-text-muted">{footer}</div>
          {brand && !brand.hidePoweredBy && brand.displayName !== 'SampConnect' ? (
            <p className="mt-6 text-meta text-text-subtle">with SampConnect</p>
          ) : null}
        </motion.div>
      </section>
    </main>
  );
}
