'use client';
import * as React from 'react';
import {
  AlarmClock,
  Check,
  CheckCheck,
  CircleAlert,
  Clock,
  ExternalLink,
  FlaskConical,
  LoaderCircle,
} from 'lucide-react';
import type {
  ConnectorMode,
  ConnectorProvider,
  ExternalDeliveryState,
  InboxConversation,
  InboxPriority,
} from '@sampledge/contracts';
import { cn } from '@sampledge/ui';

/** Neutral two-letter marks (no third-party logos) with a stable hue per channel. */
export const PROVIDER_META: Record<ConnectorProvider, { name: string; mark: string; hue: string }> =
  {
    telegram: { name: 'Telegram', mark: 'TG', hue: '#3B9EDB' },
    slack: { name: 'Slack', mark: 'SL', hue: '#B56BD9' },
    teams: { name: 'Teams', mark: 'MT', hue: '#7B83EB' },
    google_chat: { name: 'Google Chat', mark: 'GC', hue: '#2FA572' },
    discord: { name: 'Discord', mark: 'DC', hue: '#6C7BF2' },
    line: { name: 'LINE', mark: 'LN', hue: '#22B455' },
    mattermost: { name: 'Mattermost', mark: 'MM', hue: '#3F7FD9' },
    nextcloud_talk: { name: 'Nextcloud Talk', mark: 'NC', hue: '#2A8FD6' },
    wechat: { name: 'WeChat', mark: 'WC', hue: '#34B24A' },
    qq: { name: 'QQ Bot', mark: 'QQ', hue: '#2C9CE0' },
    signal: { name: 'Signal', mark: 'SG', hue: '#4A73E8' },
    imessage: { name: 'iMessage', mark: 'iM', hue: '#3DBA5C' },
  };

export const MODE_LABEL: Record<ConnectorMode, string> = {
  two_way: 'Two-way',
  limited: 'Limited',
  handoff: 'Handoff',
};

export function ProviderMark({
  provider,
  size = 'md',
  className,
}: {
  provider: ConnectorProvider;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const m = PROVIDER_META[provider];
  return (
    <span
      aria-label={m.name}
      title={m.name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md font-semibold tracking-tight text-white shadow-sm ring-1 ring-white/10',
        size === 'sm' && 'size-5 text-[9px]',
        size === 'md' && 'size-7 text-[11px]',
        size === 'lg' && 'size-10 rounded-lg text-sm',
        className,
      )}
      style={{
        background: `linear-gradient(135deg, ${m.hue}, color-mix(in oklab, ${m.hue} 70%, black))`,
      }}
    >
      {m.mark}
    </span>
  );
}

export const PRIORITY_STYLE: Record<InboxPriority, { label: string; dot: string; text: string }> = {
  low: { label: 'Low', dot: 'bg-text-subtle', text: 'text-text-subtle' },
  normal: { label: 'Normal', dot: 'bg-accent', text: 'text-text-muted' },
  high: { label: 'High', dot: 'bg-warning', text: 'text-warning' },
  urgent: { label: 'Urgent', dot: 'bg-danger', text: 'text-danger' },
};

export function PriorityDot({ priority }: { priority: InboxPriority }) {
  return (
    <span
      className={cn('inline-block size-2 shrink-0 rounded-full', PRIORITY_STYLE[priority].dot)}
      title={`${PRIORITY_STYLE[priority].label} priority`}
    />
  );
}

export function minutesLabel(ms: number): string {
  const m = Math.round(Math.abs(ms) / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60 ? `${m % 60}m` : ''}`.trim();
  return `${Math.floor(h / 24)}d`;
}

export function SlaPill({ sla, compact }: { sla: InboxConversation['sla']; compact?: boolean }) {
  if (sla.state === 'none') return null;
  if (sla.state === 'met')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success/12 px-2 py-0.5 text-meta font-medium text-success">
        <Check className="size-3" /> {compact ? 'Met' : 'SLA met'}
      </span>
    );
  const left = sla.dueAt ? Date.parse(sla.dueAt) - Date.now() : 0;
  const tone =
    sla.state === 'breached'
      ? 'bg-danger/15 text-danger'
      : sla.state === 'due_soon'
        ? 'bg-warning/15 text-warning'
        : 'bg-surface-raised text-text-muted border border-border';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-meta font-medium tabular-nums',
        tone,
      )}
      title={sla.dueAt ? `Reply due ${new Date(sla.dueAt).toLocaleString()}` : undefined}
    >
      {sla.state === 'breached' ? <AlarmClock className="size-3" /> : <Clock className="size-3" />}
      {sla.state === 'breached' ? `${minutesLabel(left)} over` : `${minutesLabel(left)} left`}
    </span>
  );
}

export function TestModeBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-dashed border-accent-2/50 bg-accent-2-soft px-2 py-0.5 text-meta font-medium text-accent-2',
        className,
      )}
      title="Test mode: nothing is sent to the real provider"
    >
      <FlaskConical className="size-3" /> Test mode
    </span>
  );
}

export function DeliveryState({
  state,
  error,
  handoffUrl,
  provider,
}: {
  state: ExternalDeliveryState | 'pending';
  error?: string | null;
  handoffUrl?: string | null;
  provider: ConnectorProvider;
}) {
  const base = 'inline-flex items-center gap-1 text-meta';
  switch (state) {
    case 'pending':
      return (
        <span className={cn(base, 'text-text-subtle')}>
          <Clock className="size-3" /> Queued offline
        </span>
      );
    case 'queued':
    case 'sending':
      return (
        <span className={cn(base, 'text-text-subtle')} title={error ?? undefined}>
          <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" />
          {error?.startsWith('Waiting') ? error : state === 'queued' ? 'Queued' : 'Sending'}
        </span>
      );
    case 'sent':
      return (
        <span className={cn(base, 'text-text-subtle')}>
          <Check className="size-3" /> Sent to {PROVIDER_META[provider].name}
        </span>
      );
    case 'delivered':
    case 'read':
      return (
        <span className={cn(base, 'text-accent')}>
          <CheckCheck className="size-3" /> {state === 'read' ? 'Read' : 'Delivered'}
        </span>
      );
    case 'test':
      return (
        <span className={cn(base, 'text-accent-2')}>
          <FlaskConical className="size-3" /> Captured by sandbox
        </span>
      );
    case 'handoff':
      return handoffUrl ? (
        <a
          href={handoffUrl}
          target="_blank"
          rel="noreferrer"
          className={cn(base, 'font-medium text-accent hover:underline')}
        >
          <ExternalLink className="size-3" /> Send in {PROVIDER_META[provider].name}
        </a>
      ) : null;
    case 'failed':
      return (
        <span className={cn(base, 'text-danger')} title={error ?? undefined}>
          <CircleAlert className="size-3" /> Failed{error ? `: ${error}` : ''}
        </span>
      );
  }
}

export const relTime = (iso: string) => {
  const ms = Date.now() - Date.parse(iso);
  if (ms < 60_000) return 'now';
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3600_000)}h`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: React.ReactNode; count?: number; tone?: 'danger' }[];
  label: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn('flex gap-1.5 overflow-x-auto', className)}
    >
      {options.map((o) => (
        <button
          key={o.id}
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-label transition-colors duration-[var(--sc-duration-fast)]',
            value === o.id
              ? 'border-accent bg-accent-soft text-accent'
              : 'border-border text-text-muted hover:border-border-strong hover:text-text',
          )}
        >
          {o.label}
          {o.count !== undefined ? (
            <span
              className={cn(
                'rounded-full px-1.5 text-meta tabular-nums',
                o.tone === 'danger' && o.count > 0
                  ? 'bg-danger/15 text-danger'
                  : 'bg-surface-raised text-text-subtle',
              )}
            >
              {o.count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

export const selectClass =
  'h-9 rounded-md border border-border bg-surface-sunken px-2.5 text-label text-text hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';
