'use client';
import * as React from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CloudOff,
  Hash,
  Lock,
  MessagesSquare,
  RefreshCw,
  Users,
} from 'lucide-react';
import {
  ANALYTICS_RANGES,
  trend,
  type AnalyticsRange,
  type AnalyticsResponse,
} from '@sampledge/contracts';
import { Avatar, Badge, Card, Skeleton, StateView, cn } from '@sampledge/ui';
import { useAnalytics } from '@/lib/analytics';
import type { DirectoryEntry } from '@/lib/engine';
import { avatarOf, nameOf } from './helpers';
import { FeatureHelp } from '../feature-help';

const RANGE_LABEL: Record<AnalyticsRange, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
};
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const nf = new Intl.NumberFormat();

const dayLabel = (d: string, long = false) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    ...(long ? { weekday: 'short' } : {}),
    timeZone: 'UTC',
  });

function hours(min: number) {
  if (min < 60) return `${min} min`;
  const h = min / 60;
  return `${h < 10 ? h.toFixed(1) : Math.round(h)} h`;
}

/**
 * Analytics: activity over 7, 30 or 90 days. Owners and admins switch between the whole
 * organization and their own activity; everyone else sees their own.
 */
export function AnalyticsScreen({
  me,
  isAdmin,
  directory,
  onOpenConversation,
}: {
  me: string;
  isAdmin: boolean;
  directory: Map<string, DirectoryEntry>;
  onOpenConversation: (id: string) => void;
}) {
  const [range, setRange] = React.useState<AnalyticsRange>('30d');
  const [scope, setScope] = React.useState<'org' | 'me'>(isAdmin ? 'org' : 'me');
  const { data, error, loading, online, refresh } = useAnalytics(range, scope);
  const t = data?.totals;
  const p = data?.previous;

  return (
    <main
      className="flex min-w-0 flex-1 flex-col overflow-y-auto pb-16 md:pb-0"
      data-testid="analytics-screen"
    >
      <header className="shrink-0 border-b border-border bg-surface/40 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3 px-4 py-5 sm:px-6">
          <span className="flex size-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <BarChart3 className="size-[18px]" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="font-display text-h3 text-text">Analytics</h1>
              <FeatureHelp id="analytics" />
            </div>
            <p className="text-meta text-text-subtle">
              {scope === 'org' ? 'How your organization uses SampConnect' : 'Your own activity'}
              {data
                ? ` · updated ${new Date(data.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                : ''}
            </p>
          </div>
          {!online ? (
            <Badge tone="warning" className="gap-1">
              <CloudOff className="size-3.5" aria-hidden /> Offline: last synced
            </Badge>
          ) : null}
          {isAdmin ? (
            <Segmented
              label="Whose activity"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'org', label: 'Organization' },
                { value: 'me', label: 'Just me' },
              ]}
            />
          ) : null}
          <Segmented
            label="Period"
            value={range}
            onChange={setRange}
            options={ANALYTICS_RANGES.map((r) => ({ value: r, label: r.replace('d', ' days') }))}
          />
          <button
            onClick={() => void refresh()}
            disabled={!online || loading}
            aria-label="Refresh"
            className="rounded-md p-2 text-text-muted hover:bg-surface-raised hover:text-text disabled:opacity-50"
          >
            <RefreshCw className={cn('size-4', loading && online && 'animate-spin')} />
          </button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        {!data && error ? (
          <StateView
            state={online ? 'error' : 'offline'}
            title="Analytics need a connection the first time"
            description={error}
            className="py-16"
          />
        ) : null}
        {!data && !error ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        ) : null}
        {data && t && p ? (
          <>
            <section
              aria-label="Totals"
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
              data-testid="analytics-tiles"
            >
              <Tile
                label="Messages"
                value={nf.format(t.messages)}
                now={t.messages}
                before={p.messages}
              />
              <Tile
                label={scope === 'org' ? 'Active people' : 'Conversations you posted in'}
                value={nf.format(t.activePeople)}
                now={t.activePeople}
                before={p.activePeople}
              />
              <Tile
                label="Time in calls"
                value={hours(t.callMinutes)}
                now={t.callMinutes}
                before={p.callMinutes}
              />
              <Tile
                label="Meetings"
                value={nf.format(t.meetings)}
                now={t.meetings}
                before={p.meetings}
              />
              <Tile
                label="Files shared"
                value={nf.format(t.filesShared)}
                now={t.filesShared}
                before={p.filesShared}
              />
              <Tile
                label="Tasks completed"
                value={nf.format(t.tasksCompleted)}
                now={t.tasksCompleted}
                before={p.tasksCompleted}
                hint={`${nf.format(t.tasksCreated)} created`}
              />
              <Tile
                label="Approvals decided"
                value={nf.format(t.approvalsDecided)}
                now={t.approvalsDecided}
                before={p.approvalsDecided}
              />
              <Tile
                label="Median time to decide"
                value={t.medianApprovalHours === null ? '–' : `${t.medianApprovalHours} h`}
                hint="From request to approval or rejection"
              />
            </section>

            <DailyChart data={data} rangeLabel={RANGE_LABEL[range]} scope={scope} />

            <div className="grid gap-6 lg:grid-cols-5">
              <Heatmap data={data} mine={scope === 'me'} className="lg:col-span-3" />
              <KindSplit data={data} className="lg:col-span-2" />
            </div>

            <div className={cn('grid gap-6', scope === 'org' && 'lg:grid-cols-2')}>
              <TopConversations data={data} onOpen={onOpenConversation} />
              {scope === 'org' ? <TopPeople data={data} directory={directory} me={me} /> : null}
            </div>
            <p className="text-meta text-text-subtle">
              Deleted messages, system notices and recordings aren’t counted. Direct messages are
              only ever counted together, never named. Times are in your time zone ({data.tz}).
            </p>
          </>
        ) : null}
      </div>
    </main>
  );
}

function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex rounded-lg border border-border p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-md px-3 py-1.5 text-meta font-medium',
            value === o.value
              ? 'bg-accent-soft text-text'
              : 'text-text-muted hover:bg-surface-raised hover:text-text',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Tile({
  label,
  value,
  now,
  before,
  hint,
}: {
  label: string;
  value: string;
  now?: number;
  before?: number;
  hint?: string;
}) {
  const pct = now !== undefined && before !== undefined ? trend(now, before) : null;
  return (
    <Card className="p-4">
      <p className="text-meta text-text-subtle">{label}</p>
      <p className="mt-1 font-display text-h2 tabular-nums text-text">{value}</p>
      <p className="mt-1 flex items-center gap-1 text-meta text-text-muted">
        {pct !== null ? (
          <>
            {pct >= 0 ? (
              <ArrowUpRight className="size-3.5" aria-hidden />
            ) : (
              <ArrowDownRight className="size-3.5" aria-hidden />
            )}
            {pct >= 0 ? '+' : ''}
            {pct}% vs previous period
          </>
        ) : (
          (hint ?? (before === 0 && now ? 'New this period' : ' '))
        )}
      </p>
    </Card>
  );
}

function DailyChart({
  data,
  rangeLabel,
  scope,
}: {
  data: AnalyticsResponse;
  rangeLabel: string;
  scope: 'org' | 'me';
}) {
  const [hover, setHover] = React.useState<number | null>(null);
  const [table, setTable] = React.useState(false);
  const days = data.daily;
  const max = Math.max(1, ...days.map((d) => d.messages));
  const nice = niceMax(max);
  const ticks = [0, nice / 2, nice];
  const labelEvery = Math.ceil(days.length / 8);
  const h = hover !== null ? days[hover] : null;

  return (
    <Card className="p-5" data-testid="analytics-daily">
      <div className="mb-4 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-label text-text">Messages per day</h2>
          <p className="text-meta text-text-subtle">{rangeLabel}</p>
        </div>
        <button
          onClick={() => setTable((v) => !v)}
          aria-pressed={table}
          className="rounded-md px-2.5 py-1 text-meta font-medium text-accent hover:bg-surface-raised"
        >
          {table ? 'Show chart' : 'Show table'}
        </button>
      </div>
      {table ? (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-left text-meta">
            <thead className="sticky top-0 bg-surface text-text-subtle">
              <tr>
                <th className="py-1.5 font-medium">Day</th>
                <th className="py-1.5 text-right font-medium">Messages</th>
                <th className="py-1.5 text-right font-medium">
                  {scope === 'org' ? 'People' : 'Conversations'}
                </th>
                <th className="py-1.5 text-right font-medium">Call time</th>
              </tr>
            </thead>
            <tbody className="tabular-nums text-text">
              {[...days].reverse().map((d) => (
                <tr key={d.date} className="border-t border-border">
                  <td className="py-1.5">{dayLabel(d.date, true)}</td>
                  <td className="py-1.5 text-right">{nf.format(d.messages)}</td>
                  <td className="py-1.5 text-right">{d.activePeople}</td>
                  <td className="py-1.5 text-right">{hours(d.callMinutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <div className="flex h-56 gap-2">
            <div
              className="flex w-8 shrink-0 flex-col-reverse justify-between text-right text-meta tabular-nums text-text-subtle"
              aria-hidden
            >
              {ticks.map((v) => (
                <span key={v} className="-my-2 leading-4">
                  {nf.format(v)}
                </span>
              ))}
            </div>
            <div
              className="relative flex flex-1 items-end border-b border-border"
              role="img"
              aria-label={`Messages per day, ${rangeLabel}. Busiest day ${dayLabel(
                days.reduce((a, b) => (b.messages > a.messages ? b : a)).date,
                true,
              )} with ${nf.format(max)}. Use Show table for every value.`}
              onMouseLeave={() => setHover(null)}
            >
              {[0.5, 1].map((f) => (
                <span
                  key={f}
                  className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border"
                  style={{ bottom: `${f * 100}%` }}
                  aria-hidden
                />
              ))}
              {days.map((d, i) => (
                <div
                  key={d.date}
                  className="group relative flex h-full flex-1 items-end justify-center px-px"
                  onMouseEnter={() => setHover(i)}
                >
                  <div
                    className={cn(
                      'w-full max-w-6 rounded-t-[4px] bg-accent transition-opacity',
                      hover !== null && hover !== i && 'opacity-50',
                    )}
                    style={{
                      height: d.messages ? `max(2px, ${(d.messages / nice) * 100}%)` : 0,
                    }}
                  />
                </div>
              ))}
              {h ? (
                <div
                  className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-meta shadow-lg"
                  style={{
                    left: `${((hover! + 0.5) / days.length) * 100}%`,
                  }}
                >
                  <p className="font-medium text-text">{dayLabel(h.date, true)}</p>
                  <p className="tabular-nums text-text-muted">
                    {nf.format(h.messages)} messages · {h.activePeople}{' '}
                    {scope === 'org' ? 'people' : 'conversations'}
                  </p>
                  {h.callMinutes ? (
                    <p className="tabular-nums text-text-muted">{hours(h.callMinutes)} in calls</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
          <div className="relative ml-10 mt-1.5 h-4 text-meta text-text-subtle" aria-hidden>
            {days.map((d, i) =>
              (days.length - 1 - i) % labelEvery === 0 ? (
                <span
                  key={d.date}
                  className="absolute -translate-x-1/2 whitespace-nowrap"
                  style={{ left: `${((i + 0.5) / days.length) * 100}%` }}
                >
                  {dayLabel(d.date)}
                </span>
              ) : null,
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function niceMax(n: number) {
  const p = 10 ** Math.floor(Math.log10(n));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= n) return Math.max(2, m * p);
  return n;
}

function Heatmap({
  data,
  mine,
  className,
}: {
  data: AnalyticsResponse;
  mine: boolean;
  className?: string;
}) {
  const max = Math.max(1, ...data.heatmap.flat());
  const [hover, setHover] = React.useState<{ d: number; h: number } | null>(null);
  // Monday first reads better for work weeks.
  const order = [1, 2, 3, 4, 5, 6, 0];
  const busiest = data.heatmap
    .flatMap((row, d) => row.map((n, h) => ({ d, h, n })))
    .reduce((a, b) => (b.n > a.n ? b : a));
  const hourLabel = (h: number) =>
    new Date(2026, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' });
  return (
    <Card className={cn('p-5', className)} data-testid="analytics-heatmap">
      <h2 className="text-label text-text">{mine ? 'When you message' : 'When people message'}</h2>
      <p className="mb-4 text-meta text-text-subtle">
        {busiest.n
          ? `Busiest: ${WEEKDAYS[busiest.d]} around ${hourLabel(busiest.h)}`
          : 'No messages in this period'}
      </p>
      <div
        role="img"
        aria-label={`Messages by weekday and hour. ${busiest.n ? `Busiest ${WEEKDAYS[busiest.d]} at ${hourLabel(busiest.h)} with ${busiest.n}.` : ''}`}
        className="relative"
        onMouseLeave={() => setHover(null)}
      >
        <div className="grid grid-cols-[2.5rem_repeat(24,minmax(0,1fr))] gap-[2px]">
          {order.map((d) => (
            <React.Fragment key={d}>
              <span className="pr-1 text-meta leading-4 text-text-subtle" aria-hidden>
                {WEEKDAYS[d]}
              </span>
              {data.heatmap[d]!.map((n, h) => (
                <span
                  key={h}
                  onMouseEnter={() => setHover({ d, h })}
                  className={cn(
                    'aspect-square min-h-3 rounded-[3px]',
                    n ? 'bg-accent' : 'bg-surface-sunken',
                    hover?.d === d && hover.h === h && 'ring-2 ring-text',
                  )}
                  style={n ? { opacity: 0.18 + 0.82 * (n / max) } : undefined}
                />
              ))}
            </React.Fragment>
          ))}
          <span />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="text-center text-[10px] text-text-subtle" aria-hidden>
              {h % 6 === 0 ? h : ''}
            </span>
          ))}
        </div>
        <p className="mt-3 h-4 text-meta tabular-nums text-text-muted" aria-live="polite">
          {hover
            ? `${WEEKDAYS[hover.d]} ${hourLabel(hover.h)}: ${nf.format(data.heatmap[hover.d]![hover.h]!)} messages`
            : 'Darker means more messages. Hover a square for the count.'}
        </p>
      </div>
    </Card>
  );
}

function KindSplit({ data, className }: { data: AnalyticsResponse; className?: string }) {
  const rows = [
    { label: 'Channels', n: data.byKind.channel, icon: Hash },
    { label: 'Groups', n: data.byKind.group, icon: Users },
    { label: 'Direct messages', n: data.byKind.dm, icon: MessagesSquare },
  ];
  const total = rows.reduce((s, r) => s + r.n, 0);
  return (
    <Card className={cn('p-5', className)} data-testid="analytics-kinds">
      <h2 className="text-label text-text">Where conversations happen</h2>
      <p className="mb-4 text-meta text-text-subtle">Share of messages</p>
      <ul className="space-y-4">
        {rows.map((r) => {
          const pct = total ? Math.round((r.n / total) * 100) : 0;
          return (
            <li key={r.label}>
              <div className="mb-1.5 flex items-center gap-2 text-label text-text">
                <r.icon className="size-4 text-text-muted" aria-hidden />
                <span className="flex-1">{r.label}</span>
                <span className="tabular-nums text-text-muted">
                  {nf.format(r.n)} · {pct}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-sunken">
                <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function TopConversations({
  data,
  onOpen,
}: {
  data: AnalyticsResponse;
  onOpen: (id: string) => void;
}) {
  const max = Math.max(1, ...data.topConversations.map((c) => c.messages));
  return (
    <Card className="p-5" data-testid="analytics-conversations">
      <h2 className="mb-4 text-label text-text">Busiest conversations</h2>
      {data.topConversations.length === 0 ? (
        <p className="text-meta text-text-muted">No messages in this period.</p>
      ) : (
        <ul className="space-y-3">
          {data.topConversations.map((c) => {
            const Icon =
              c.kind === 'channel_private'
                ? Lock
                : c.kind === 'channel_public'
                  ? Hash
                  : c.kind === 'group'
                    ? Users
                    : MessagesSquare;
            const body = (
              <>
                <div className="mb-1 flex items-center gap-2">
                  <Icon className="size-4 shrink-0 text-text-muted" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-label text-text">{c.name}</span>
                  <span className="text-meta tabular-nums text-text-muted">
                    {nf.format(c.messages)} · {c.people} {c.people === 1 ? 'person' : 'people'}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${(c.messages / max) * 100}%` }}
                  />
                </div>
              </>
            );
            return (
              <li key={c.conversationId ?? 'dm'}>
                {c.conversationId ? (
                  <button
                    onClick={() => onOpen(c.conversationId!)}
                    className="-mx-2 block w-[calc(100%+1rem)] rounded-md px-2 py-1 text-left hover:bg-surface-raised"
                  >
                    {body}
                  </button>
                ) : (
                  <div className="py-1">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function TopPeople({
  data,
  directory,
  me,
}: {
  data: AnalyticsResponse;
  directory: Map<string, DirectoryEntry>;
  me: string;
}) {
  return (
    <Card className="p-5" data-testid="analytics-people">
      <h2 className="mb-4 text-label text-text">Most active people</h2>
      {data.topPeople.length === 0 ? (
        <p className="text-meta text-text-muted">No messages in this period.</p>
      ) : (
        <ol className="space-y-2">
          {data.topPeople.map((p, i) => (
            <li key={p.userId} className="flex items-center gap-3">
              <span className="w-4 text-meta tabular-nums text-text-subtle">{i + 1}</span>
              <Avatar
                name={nameOf(p.userId, directory)}
                src={avatarOf(p.userId, directory)}
                size="sm"
              />
              <span className="min-w-0 flex-1 truncate text-label text-text">
                {nameOf(p.userId, directory)}
                {p.userId === me ? <span className="text-text-subtle"> (you)</span> : null}
              </span>
              <span className="text-meta tabular-nums text-text-muted">
                {nf.format(p.messages)} messages
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
