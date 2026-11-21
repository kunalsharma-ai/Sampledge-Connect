'use client';
import Link from 'next/link';
import { motion } from 'motion/react';
import { CheckCheck, CloudOff, ShieldCheck, Workflow } from 'lucide-react';
import { Wordmark } from './brand';

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
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <section className="sc-noise relative hidden overflow-hidden border-r border-border lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="pointer-events-none absolute -left-40 -top-40 size-[520px] rounded-full bg-accent/20 blur-[120px]" />
        <div className="pointer-events-none absolute -bottom-48 right-[-120px] size-[480px] rounded-full bg-accent2/20 blur-[120px]" />
        <Link href="/" className="relative">
          <Wordmark />
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
          <div className="mb-8 lg:hidden">
            <Wordmark />
          </div>
          <h1 className="font-display text-h1 text-text">{title}</h1>
          <p className="mt-2 text-body text-text-muted">{subtitle}</p>
          <div className="mt-8">{children}</div>
          <div className="mt-8 text-label font-normal text-text-muted">{footer}</div>
        </motion.div>
      </section>
    </main>
  );
}
