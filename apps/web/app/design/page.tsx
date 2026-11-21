'use client';
import Link from 'next/link';
import { Plus, Send } from 'lucide-react';
import { MESSAGE_STATUSES } from '@sampledge/contracts';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ConnectivityIndicator,
  Field,
  Input,
  Kbd,
  MessageStatusIcon,
  Skeleton,
  StateView,
  ThemePicker,
  TypingIndicator,
  UnreadCounter,
  useTheme,
} from '@sampledge/ui';
import { Wordmark } from '@/components/brand';

const SWATCHES = [
  'bg',
  'surface',
  'surface-raised',
  'accent',
  'accent2',
  'success',
  'warning',
  'danger',
  'bubble-own',
  'bubble-other',
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="mb-4 text-overline uppercase text-text-subtle">{title}</h2>
      {children}
    </section>
  );
}

export default function DesignPage() {
  const { theme } = useTheme();
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="flex items-center justify-between">
        <Link href="/">
          <Wordmark />
        </Link>
        <Badge tone="accent">{theme.name}</Badge>
      </header>
      <h1 className="mt-10 font-display text-display text-text">Design system</h1>
      <p className="mt-3 max-w-2xl text-body text-text-muted">
        Every color below is a semantic token. Switching themes restyles the whole product,
        including organization brand themes.
      </p>

      <Section title="Themes">
        <ThemePicker />
      </Section>

      <Section title="Color roles">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {SWATCHES.map((s) => (
            <div key={s} className="overflow-hidden rounded-lg border border-border">
              <div className="h-14" style={{ background: `var(--sc-color-${s})` }} />
              <p className="bg-surface px-3 py-2 text-meta text-text-muted">{s}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Typography">
        <Card className="space-y-3 p-6">
          <p className="font-display text-display text-text">Display · Plus Jakarta Sans</p>
          <p className="font-display text-h1 text-text">Heading one</p>
          <p className="text-h2 text-text">Heading two</p>
          <p className="text-body text-text-muted">
            Body text in Inter, tuned for long reading in conversations and documents.
          </p>
          <p className="text-message text-text">
            Message text is slightly larger for comfortable chat reading.
          </p>
          <p className="text-meta text-text-subtle">Meta · 12:42 PM · Edited</p>
        </Card>
      </Section>

      <Section title="Buttons and inputs">
        <Card className="flex flex-wrap items-end gap-3 p-6">
          <Button>
            <Send /> Primary
          </Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="danger">Danger</Button>
          <Button loading>Saving</Button>
          <Button size="icon" aria-label="Add">
            <Plus />
          </Button>
          <div className="w-64">
            <Field label="Workspace" htmlFor="d-ws" hint="Your organization’s short name">
              <Input id="d-ws" placeholder="acme-research" />
            </Field>
          </div>
          <Kbd>⌘K</Kbd>
        </Card>
      </Section>

      <Section title="Messaging">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="space-y-4 p-6">
            <div className="flex gap-3">
              <Avatar name="Priya Raman" size="sm" presence="online" />
              <div className="rounded-xl rounded-tl-sm border border-border bg-bubble-other px-3.5 py-2.5 text-message text-text shadow-sm">
                Supplier quotes for the Pune study are in. Can you check the incidence rates?
              </div>
            </div>
            <div className="flex flex-row-reverse gap-3">
              <Avatar name="Kunal S" size="sm" />
              <div className="flex flex-col items-end">
                <div className="rounded-xl rounded-tr-sm bg-bubble-own px-3.5 py-2.5 text-message text-bubble-own-fg shadow-sm">
                  On it. I’ll compare against last quarter’s bids.
                </div>
                <span className="mt-1 flex items-center gap-1 text-meta text-text-subtle">
                  <MessageStatusIcon status="read" /> Read
                </span>
              </div>
            </div>
            <TypingIndicator names={['Priya']} />
          </Card>
          <Card className="space-y-4 p-6">
            <p className="text-label text-text">Message states</p>
            <ul className="grid grid-cols-2 gap-2">
              {MESSAGE_STATUSES.map((s) => (
                <li
                  key={s}
                  className="flex items-center gap-2 text-label font-normal capitalize text-text-muted"
                >
                  <MessageStatusIcon status={s} /> {s}
                </li>
              ))}
            </ul>
            <p className="pt-2 text-label text-text">Connectivity</p>
            <div className="flex flex-wrap gap-2">
              <ConnectivityIndicator state="online" />
              <ConnectivityIndicator state="syncing" />
              <ConnectivityIndicator state="connecting" />
              <ConnectivityIndicator state="offline" queued={3} />
            </div>
            <div className="flex items-center gap-3 pt-2">
              <span className="text-label text-text">Unread</span>
              <UnreadCounter count={4} />
              <UnreadCounter count={128} />
              <Badge tone="planned">Planned</Badge>
            </div>
          </Card>
        </div>
      </Section>

      <Section title="States">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card className="p-4">
            <StateView
              state="empty"
              title="No conversations yet"
              description="Start one with the + button."
            />
          </Card>
          <Card className="p-4">
            <StateView
              state="offline"
              title="You’re offline"
              description="Messages will send when you reconnect."
            />
          </Card>
          <Card className="p-4">
            <StateView
              state="permission-denied"
              title="Admins only"
              description="Ask an admin for access."
            />
          </Card>
          <Card className="p-4">
            <StateView state="error" title="Couldn’t load" description="Try again in a moment." />
          </Card>
          <Card className="p-4">
            <StateView state="success" title="All caught up" />
          </Card>
          <Card className="space-y-2 p-4">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-14" />
            <Skeleton className="h-14 w-3/4" />
          </Card>
        </div>
      </Section>
    </main>
  );
}
