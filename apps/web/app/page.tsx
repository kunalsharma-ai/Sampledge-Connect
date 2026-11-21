'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import { ArrowRight, CheckCheck, CloudOff, ShieldCheck, Workflow } from 'lucide-react';
import { Button, Card } from '@sampledge/ui';
import { Wordmark } from '@/components/brand';
import { useAuth } from '@/lib/auth';

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
    icon: Workflow,
    title: 'Built for the Sampledge suite',
    body: 'Projects, bids, suppliers and fieldwork context are on the roadmap, shown as Planned until they ship.',
  },
];

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
          teams. Chat, channels and groups today, with project-aware context coming next.
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
        <div className="mt-20 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
    </main>
  );
}
