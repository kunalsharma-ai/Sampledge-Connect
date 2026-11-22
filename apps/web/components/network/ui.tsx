'use client';
import * as React from 'react';
import { Building2, CloudOff, User } from 'lucide-react';
import type { FeatureHelpId, NetworkPerson } from '@sampledge/contracts';
import { Avatar, Badge, cn } from '@sampledge/ui';
import { ApiFailure } from '@/lib/api';
import { useNetworkOutbox } from '@/lib/network';
import { FeatureHelp } from '../feature-help';

export function errorText(e: unknown): string {
  if (e instanceof ApiFailure) return e.error.message;
  return (e as Error)?.message ?? 'Something went wrong';
}

export function ScreenHeader({
  title,
  subtitle,
  help,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Feature guide shown beside the title. */
  help?: FeatureHelpId;
  children?: React.ReactNode;
}) {
  return (
    <header className="flex min-h-[60px] shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-2 sm:px-6">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-h3 text-text">{title}</h1>
          {help ? <FeatureHelp id={help} /> : null}
        </div>
        {subtitle ? <p className="text-meta text-text-subtle">{subtitle}</p> : null}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
    </header>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { id: T; label: string; count?: number }[];
}) {
  return (
    <div
      role="tablist"
      className="flex flex-wrap gap-1 rounded-md border border-border bg-surface p-0.5"
    >
      {items.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            'flex items-center gap-1.5 rounded-sm px-3 py-1 text-meta transition-colors',
            value === t.id ? 'bg-accent-soft text-text' : 'text-text-muted hover:text-text',
          )}
        >
          {t.label}
          {t.count ? (
            <span className="rounded-full bg-accent px-1.5 text-[10px] font-semibold text-accent-fg">
              {t.count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/** Name, Connect ID and where they're from. */
export function PersonLine({
  person,
  size = 'md',
  extra,
}: {
  person: NetworkPerson;
  size?: 'sm' | 'md' | 'lg';
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={person.displayName} size={size} />
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 truncate text-label text-text">
          {person.displayName}
          {person.kind === 'work' ? (
            <Building2 className="size-3.5 shrink-0 text-accent" aria-label="Work account" />
          ) : (
            <User className="size-3.5 shrink-0 text-text-subtle" aria-label="Personal account" />
          )}
        </p>
        <p className="truncate text-meta text-text-subtle">
          @{person.handle}
          {person.organizationName ? ` · ${person.organizationName}` : ''}
          {person.headline ? ` · ${person.headline}` : ''}
        </p>
        {extra}
      </div>
    </div>
  );
}

/** "Queued" when an action on this path is still waiting to be sent. */
export function QueuedBadge({ match }: { match: (path: string) => boolean }) {
  const outbox = useNetworkOutbox();
  const a = outbox.find((x) => match(x.path));
  if (!a) return null;
  return a.state === 'failed' ? (
    <Badge tone="danger">Not sent</Badge>
  ) : (
    <Badge tone="warning" className="gap-1">
      <CloudOff className="size-3" /> Queued
    </Badge>
  );
}

export function Section({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-lg border border-border bg-surface shadow-sm', className)}>
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <h2 className="text-label text-text">{title}</h2>
        <div className="ml-auto">{action}</div>
      </div>
      <div className="p-2">{children}</div>
    </section>
  );
}

/** "1 member", "4 members". */
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const CIRCLE_LABEL = { business: 'Business', friends: 'Friends' } as const;
