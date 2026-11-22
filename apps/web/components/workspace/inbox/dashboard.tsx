'use client';
import * as React from 'react';
import { AlarmClock, Gauge, Inbox, MessageSquareReply, Timer, UserX } from 'lucide-react';
import { INBOX_PRIORITIES, type InboxAnalytics } from '@sampledge/contracts';
import { Avatar, StateView, cn } from '@sampledge/ui';
import type { DirectoryEntry } from '@/lib/engine';
import type { InboxApi } from '@/lib/inbox';
import { nameOf } from '../helpers';
import { PRIORITY_STYLE, PROVIDER_META, ProviderMark, Segmented, minutesLabel } from './shared';

function Kpi({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: 'danger' | 'warning' | 'success';
}) {
  return (
    <div className="rounded-xl border border-border bg-surface/70 p-4 shadow-sm">
      <div className="flex items-center gap-2 text-meta font-medium uppercase tracking-wider text-text-subtle">
        <Icon className="size-3.5" /> {label}
      </div>
      <p
        className={cn(
          'mt-2 font-display text-[28px] font-semibold leading-none tabular-nums text-text',
          tone === 'danger' && 'text-danger',
          tone === 'warning' && 'text-warning',
          tone === 'success' && 'text-success',
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-1.5 text-meta text-text-muted">{hint}</p> : null}
    </div>
  );
}

function Card({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn('rounded-xl border border-border bg-surface/70 p-5 shadow-sm', className)}
    >
      <h3 className="mb-4 text-label font-semibold text-text">{title}</h3>
      {children}
    </section>
  );
}

const fmtMin = (m: number | null) => (m === null ? '–' : minutesLabel(m * 60_000));

/** Supervisor dashboard: workload, SLA health and channel volume for the last N days. */
export function InboxDashboard({
  api,
  directory,
  online,
  onOpen,
}: {
  api: InboxApi;
  directory: Map<string, DirectoryEntry>;
  online: boolean;
  onOpen: (id: string) => void;
}) {
  const [days, setDays] = React.useState<'7' | '30'>('7');
  const [data, setData] = React.useState<InboxAnalytics | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!online) return;
    api.analytics(Number(days)).then(setData, (e: Error) => setError(e.message));
  }, [api, days, online]);

  if (!data)
    return error ? (
      <StateView state="error" description={error} />
    ) : !online ? (
      <StateView state="offline" description="The dashboard loads when you're back online." />
    ) : (
      <StateView state="loading" title="Loading dashboard" />
    );

  const maxDay = Math.max(1, ...data.daily.map((d) => d.inbound + d.outbound));
  const maxProv = Math.max(1, ...data.byProvider.map((p) => p.inbound));
  const activeTotal = Math.max(
    1,
    data.byPriority.reduce((n, p) => n + p.count, 0),
  );

  return (
    <div
      className="mx-auto w-full max-w-[1200px] space-y-5 p-5 sm:p-6"
      data-testid="inbox-dashboard"
    >
      <div className="flex items-center gap-3">
        <h2 className="font-display text-h2 text-text">Supervisor dashboard</h2>
        <div className="flex-1" />
        <Segmented
          label="Period"
          value={days}
          onChange={setDays}
          options={[
            { id: '7', label: 'Last 7 days' },
            { id: '30', label: 'Last 30 days' },
          ]}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label="Open"
          value={String(data.totals.open)}
          hint={`${data.totals.conversations} new in period`}
          icon={Inbox}
        />
        <Kpi
          label="Unassigned"
          value={String(data.totals.unassigned)}
          icon={UserX}
          tone={data.totals.unassigned ? 'warning' : undefined}
        />
        <Kpi
          label="SLA breached"
          value={String(data.totals.breachedNow)}
          hint="waiting past their SLA now"
          icon={AlarmClock}
          tone={data.totals.breachedNow ? 'danger' : 'success'}
        />
        <Kpi
          label="First reply"
          value={fmtMin(data.medianFirstResponseMinutes)}
          hint="median"
          icon={Timer}
        />
        <Kpi
          label="SLA met"
          value={data.slaMetRate === null ? '–' : `${Math.round(data.slaMetRate * 100)}%`}
          hint="of first replies"
          icon={Gauge}
          tone={data.slaMetRate !== null && data.slaMetRate < 0.8 ? 'warning' : 'success'}
        />
        <Kpi
          label="Messages"
          value={String(data.totals.inbound + data.totals.outbound)}
          hint={`${data.totals.inbound} in · ${data.totals.outbound} out`}
          icon={MessageSquareReply}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <Card title="Message volume">
          <div
            className="flex h-44 items-end gap-1.5"
            role="img"
            aria-label="Messages per day, client and agent"
          >
            {data.daily.map((d) => (
              <div
                key={d.day}
                className="group flex h-full flex-1 flex-col items-center justify-end gap-1"
              >
                <div
                  className="flex w-full max-w-9 flex-col-reverse overflow-hidden rounded-t-md"
                  style={{ height: `${((d.inbound + d.outbound) / maxDay) * 100}%` }}
                  title={`${d.day}: ${d.inbound} from clients, ${d.outbound} replies`}
                >
                  <div className="bg-accent" style={{ flexGrow: d.inbound }} />
                  <div className="bg-accent-2" style={{ flexGrow: d.outbound }} />
                </div>
                <span className="text-[10px] tabular-nums text-text-subtle">{d.day.slice(8)}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-4 text-meta text-text-muted">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-sm bg-accent" /> From clients
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-sm bg-accent-2" /> Agent replies
            </span>
          </div>
        </Card>

        <Card title="By channel">
          {data.byProvider.length ? (
            <ul className="space-y-2.5">
              {data.byProvider.map((p) => (
                <li key={p.provider} className="flex items-center gap-2.5">
                  <ProviderMark provider={p.provider} size="sm" />
                  <span className="w-24 truncate text-label text-text">
                    {PROVIDER_META[p.provider].name}
                  </span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-raised">
                    <span
                      className="block h-full rounded-full bg-accent/80"
                      style={{ width: `${(p.inbound / maxProv) * 100}%` }}
                    />
                  </span>
                  <span className="w-8 text-right text-meta tabular-nums text-text-muted">
                    {p.inbound}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-label font-normal text-text-subtle">
              No client messages in this period.
            </p>
          )}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <Card title="Agents">
          {data.agents.length ? (
            <table className="w-full text-label">
              <thead>
                <tr className="text-left text-meta uppercase tracking-wider text-text-subtle">
                  <th className="pb-2 font-medium">Agent</th>
                  <th className="pb-2 text-right font-medium">Open</th>
                  <th className="pb-2 text-right font-medium">Breached</th>
                  <th className="pb-2 text-right font-medium">Replies</th>
                  <th className="pb-2 text-right font-medium">Resolved</th>
                  <th className="pb-2 text-right font-medium">First reply</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.agents.map((a) => (
                  <tr key={a.userId}>
                    <td className="py-2">
                      <span className="flex items-center gap-2">
                        <Avatar name={nameOf(a.userId, directory)} size="sm" />{' '}
                        {nameOf(a.userId, directory)}
                      </span>
                    </td>
                    <td className="py-2 text-right tabular-nums">{a.open}</td>
                    <td
                      className={cn(
                        'py-2 text-right tabular-nums',
                        a.breached && 'font-medium text-danger',
                      )}
                    >
                      {a.breached}
                    </td>
                    <td className="py-2 text-right tabular-nums">{a.replies}</td>
                    <td className="py-2 text-right tabular-nums">{a.resolved}</td>
                    <td className="py-2 text-right tabular-nums">
                      {fmtMin(a.medianFirstResponseMinutes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-label font-normal text-text-subtle">
              Nobody has been assigned a conversation yet.
            </p>
          )}
        </Card>

        <div className="space-y-5">
          <Card title="Open by priority">
            <div className="flex h-3 overflow-hidden rounded-full bg-surface-raised">
              {data.byPriority.map((p) => (
                <span
                  key={p.priority}
                  className={PRIORITY_STYLE[p.priority].dot}
                  style={{ width: `${(p.count / activeTotal) * 100}%` }}
                  title={`${PRIORITY_STYLE[p.priority].label}: ${p.count}`}
                />
              ))}
            </div>
            <ul className="mt-3 grid grid-cols-2 gap-1.5 text-meta text-text-muted">
              {INBOX_PRIORITIES.map((p) => (
                <li key={p} className="flex items-center gap-1.5">
                  <span className={cn('size-2 rounded-full', PRIORITY_STYLE[p].dot)} />{' '}
                  {PRIORITY_STYLE[p].label}
                  <span className="ml-auto tabular-nums text-text">
                    {data.byPriority.find((x) => x.priority === p)?.count ?? 0}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Breached now">
            {data.breaches.length ? (
              <ul className="space-y-1">
                {data.breaches.slice(0, 6).map((b) => (
                  <li key={b.conversationId}>
                    <button
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-raised"
                      onClick={() => onOpen(b.conversationId)}
                    >
                      <AlarmClock className="size-3.5 shrink-0 text-danger" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-label text-text">{b.clientName}</span>
                        <span className="block truncate text-meta text-text-subtle">
                          {b.subject}
                        </span>
                      </span>
                      <span className="text-meta tabular-nums text-danger">
                        {minutesLabel(Date.now() - Date.parse(b.dueAt))}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-label font-normal text-success">
                Every waiting client is within SLA.
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
