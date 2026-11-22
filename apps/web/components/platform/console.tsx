'use client';
import * as React from 'react';
import {
  Activity,
  Building2,
  CheckCircle2,
  Cpu,
  Crown,
  Database,
  Flag,
  HardDrive,
  MessagesSquare,
  MonitorSmartphone,
  Plug,
  Server,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react';
import {
  PLATFORM_ROLE_INFO,
  formatMoney,
  platformCan,
  type PlatformMe,
  type PlatformOverview,
  type PlatformPermission,
} from '@sampledge/contracts';
import { Badge, Button, StateView, cn } from '@sampledge/ui';
import { CatalogTab, PaymentsTab } from '../workspace/billing-screen';
import { IntegrationsScreen } from '../workspace/integrations-screen';
import { PlatformModeration } from '../network/moderation';
import { errorText, usePlatformApi, usePlatformChange } from './api';
import { OrganizationsTab } from './orgs';
import { AdminsTab, AuditTab } from './people';
import { ActivityTab, PermissionsTab } from './controls';

export { usePlatformRole } from './api';

type Tab =
  | 'overview'
  | 'orgs'
  | 'activity'
  | 'permissions'
  | 'billing'
  | 'moderation'
  | 'integrations'
  | 'admins'
  | 'audit';
const TABS: { id: Tab; label: string; needs: PlatformPermission }[] = [
  { id: 'overview', label: 'Overview', needs: 'overview.view' },
  { id: 'orgs', label: 'Organizations', needs: 'orgs.view' },
  { id: 'activity', label: 'Activity', needs: 'activity.view' },
  { id: 'permissions', label: 'Permissions', needs: 'orgs.view' },
  { id: 'billing', label: 'Plans & billing', needs: 'billing.manage' },
  { id: 'moderation', label: 'Moderation', needs: 'moderation' },
  { id: 'integrations', label: 'Integrations', needs: 'integrations.manage' },
  { id: 'admins', label: 'Platform admins', needs: 'overview.view' },
  { id: 'audit', label: 'Audit log', needs: 'audit.view' },
];

export const gb = (b: number) =>
  b >= 1024 ** 4
    ? `${(b / 1024 ** 4).toFixed(1)} TB`
    : b >= 1024 ** 3
      ? `${(b / 1024 ** 3).toFixed(1)} GB`
      : `${Math.round(b / 1024 ** 2)} MB`;
export const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
export const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—';
const n = (v: number) => v.toLocaleString();

/**
 * The super admin console: everything about running SampConnect itself, for platform admins.
 * Tabs follow the person's platform role; every list updates live when another admin acts.
 */
export function PlatformConsole({ me, online }: { me: PlatformMe; online: boolean }) {
  const tabs = TABS.filter((t) => platformCan(me.role, t.needs));
  const [tab, setTab] = React.useState<Tab>('overview');
  const [orgFocus, setOrgFocus] = React.useState<string | null>(null);
  const current = tabs.some((t) => t.id === tab) ? tab : 'overview';
  return (
    <main className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0" data-testid="platform-console">
      <header className="flex min-h-[60px] shrink-0 flex-wrap items-center gap-3 border-b border-border bg-surface/40 px-4 py-2 backdrop-blur-xl sm:px-6">
        <Crown className="size-5 text-accent" aria-hidden />
        <h1 className="font-display text-h3 text-text">Super admin</h1>
        <Badge tone="accent">{PLATFORM_ROLE_INFO[me.role].label}</Badge>
        <nav className="flex gap-1 overflow-x-auto md:ml-4" aria-label="Super admin sections">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTab(t.id);
                if (t.id !== 'orgs') setOrgFocus(null);
              }}
              aria-current={current === t.id ? 'page' : undefined}
              className={cn(
                'h-8 shrink-0 rounded-md px-3 text-label',
                current === t.id
                  ? 'bg-surface-raised text-text shadow-sm'
                  : 'text-text-muted hover:text-text',
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
          {!online && current !== 'overview' ? (
            <p className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-meta text-text">
              You’re offline. The console shows what it last loaded; changes need a connection.
            </p>
          ) : null}
          {current === 'overview' ? (
            <OverviewTab
              me={me}
              online={online}
              onOpen={(t, org) => {
                setTab(t);
                setOrgFocus(org ?? null);
              }}
            />
          ) : current === 'orgs' ? (
            <OrganizationsTab me={me} online={online} focus={orgFocus} onFocus={setOrgFocus} />
          ) : current === 'activity' ? (
            <ActivityTab
              me={me}
              online={online}
              onOpenOrg={(id) => (setTab('orgs'), setOrgFocus(id))}
            />
          ) : current === 'permissions' ? (
            <PermissionsTab me={me} online={online} />
          ) : current === 'billing' ? (
            <div className="flex flex-col gap-8">
              <CatalogTab onChanged={async () => undefined} />
              <section>
                <h2 className="mb-3 text-h3 text-text">Online payments</h2>
                <PaymentsTab onChanged={async () => undefined} />
              </section>
            </div>
          ) : current === 'moderation' ? (
            <PlatformModeration online={online} />
          ) : current === 'integrations' ? (
            <div className="flex flex-col gap-3">
              <p className="text-meta text-text-muted">
                Platform defaults: every organization without its own settings uses these. Stored
                encrypted in the database; changes apply immediately.
              </p>
              <IntegrationsScreen online={online} platform />
            </div>
          ) : current === 'admins' ? (
            <AdminsTab me={me} online={online} />
          ) : (
            <AuditTab onOpenOrg={(id) => (setTab('orgs'), setOrgFocus(id))} />
          )}
        </div>
      </div>
    </main>
  );
}

// ─── overview ───────────────────────────────────────────────────────────────

function OverviewTab({
  me,
  online,
  onOpen,
}: {
  me: PlatformMe;
  online: boolean;
  onOpen: (t: Tab, org?: string) => void;
}) {
  const api = usePlatformApi();
  const [o, setO] = React.useState<PlatformOverview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const load = React.useCallback(() => {
    api
      .overview()
      .then((x) => {
        setO(x);
        setError(null);
      })
      .catch((e) => setError(errorText(e)));
  }, [api]);
  React.useEffect(load, [load]);
  usePlatformChange(['orgs', 'billing', 'admins'], () => load());
  // Health numbers move on their own: refresh every 30 seconds while open.
  React.useEffect(() => {
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  if (!o)
    return error ? (
      <StateView
        state={online ? 'error' : 'offline'}
        description={error}
        action={
          <Button variant="secondary" onClick={load}>
            Try again
          </Button>
        }
      />
    ) : (
      <StateView state="loading" title="Loading the platform" />
    );

  const mrr = o.monthlyRevenue.length
    ? o.monthlyRevenue.map((r) => formatMoney(r.amount, r.currency)).join(' · ')
    : '—';
  const maxSignup = Math.max(1, ...o.signups.map((s) => s.count));
  const maxPlan = Math.max(1, ...o.plans.map((p) => p.organizations));
  const h = o.health;
  const healthy = h.mongo.ok && h.redis.ok && h.migrations.pending.length === 0;

  return (
    <div className="flex flex-col gap-6" data-testid="platform-overview">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          icon={Building2}
          label="Organizations"
          value={n(o.organizations.total)}
          note={`${n(o.organizations.newLast30Days)} new in 30 days`}
          onClick={platformCan(me.role, 'orgs.view') ? () => onOpen('orgs') : undefined}
        />
        <Kpi
          icon={Users}
          label="Active people"
          value={n(o.people.active)}
          note={`${o.people.active ? Math.round((o.people.twoStepOn / o.people.active) * 100) : 0}% use two-step sign-in`}
        />
        <Kpi
          icon={MonitorSmartphone}
          label="Devices this week"
          value={n(o.devices.seenLast7Days)}
          note={`of ${n(o.devices.active)} signed in`}
        />
        <Kpi
          icon={Wallet}
          label="Monthly recurring revenue"
          value={mrr}
          note={`${n(o.subscriptions.active)} paying · ${n(o.subscriptions.trialing)} on trial`}
          warn={o.subscriptions.pastDue > 0 ? `${o.subscriptions.pastDue} payment due` : undefined}
        />
        <Kpi icon={MessagesSquare} label="Messages this week" value={n(o.messagesLast7Days)} />
        <Kpi icon={HardDrive} label="Files stored" value={gb(o.storageBytes)} />
        <Kpi
          icon={Activity}
          label="Suspended"
          value={n(o.organizations.suspended)}
          note={
            o.organizations.pendingDeletion
              ? `${o.organizations.pendingDeletion} waiting to be erased`
              : 'none waiting to be erased'
          }
        />
        <Kpi
          icon={Flag}
          label="Open Network reports"
          value={n(o.moderation.openReports)}
          warn={o.moderation.openReports ? 'needs review' : undefined}
          onClick={platformCan(me.role, 'moderation') ? () => onOpen('moderation') : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <section className="rounded-xl border border-border bg-surface p-5 lg:col-span-3">
          <h2 className="text-label text-text">New organizations, last 30 days</h2>
          <div
            className="mt-4 flex h-32 items-end gap-[3px]"
            role="img"
            aria-label={`${o.organizations.newLast30Days} new organizations in the last 30 days`}
          >
            {o.signups.map((s) => (
              <div
                key={s.day}
                title={`${day(s.day)}: ${s.count}`}
                className="flex-1 rounded-t-sm bg-accent/80"
                style={{
                  height: `${Math.max(3, (s.count / maxSignup) * 100)}%`,
                  opacity: s.count ? 1 : 0.25,
                }}
              />
            ))}
          </div>
          <div className="mt-2 flex justify-between text-meta text-text-subtle">
            <span>{day(o.signups[0]!.day)}</span>
            <span>Today</span>
          </div>
        </section>
        <section className="rounded-xl border border-border bg-surface p-5 lg:col-span-2">
          <h2 className="text-label text-text">Organizations by plan</h2>
          <ul className="mt-4 flex flex-col gap-3">
            {o.plans.map((p) => (
              <li key={p.planId ?? 'none'}>
                <div className="flex justify-between text-meta">
                  <span className="text-text">{p.name}</span>
                  <span className="text-text-muted">{n(p.organizations)}</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-surface-sunken">
                  <div
                    className={cn('h-2 rounded-full', p.planId ? 'bg-accent' : 'bg-border-strong')}
                    style={{ width: `${(p.organizations / maxPlan) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section
        className="rounded-xl border border-border bg-surface p-5"
        data-testid="platform-health"
      >
        <div className="flex items-center gap-2">
          <Server className="size-4 text-accent" aria-hidden />
          <h2 className="text-label text-text">Health</h2>
          <Badge tone={healthy ? 'success' : 'danger'}>
            {healthy ? 'All systems normal' : 'Attention needed'}
          </Badge>
          <span className="ml-auto text-meta text-text-subtle">
            API {h.api.version} · Node {h.api.node} · up {uptime(h.api.uptimeSeconds)}
          </span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <HealthItem
            icon={Database}
            label="Database"
            ok={h.mongo.ok}
            detail={h.mongo.ok ? `${h.mongo.latencyMs} ms` : 'unreachable'}
          />
          <HealthItem
            icon={Cpu}
            label="Cache and live updates"
            ok={h.redis.ok}
            detail={
              h.redis.ok
                ? `${h.redis.latencyMs} ms · ${n(h.realtime.sockets)} live connection${h.realtime.sockets === 1 ? '' : 's'}`
                : 'unreachable'
            }
          />
          <HealthItem
            icon={Server}
            label="Database migrations"
            ok={h.migrations.pending.length === 0}
            detail={
              h.migrations.pending.length
                ? `${h.migrations.pending.length} waiting: ${h.migrations.pending.join(', ')}`
                : `${h.migrations.applied} applied`
            }
          />
          <HealthItem
            icon={Activity}
            label="Requests since start"
            ok={h.http.requests === 0 || h.http.serverErrors / h.http.requests < 0.01}
            detail={`${n(h.http.requests)} · ${n(h.http.serverErrors)} server errors`}
          />
        </div>
        <h3 className="mt-5 flex items-center gap-2 text-meta font-medium uppercase tracking-wide text-text-subtle">
          <Plug className="size-3.5" aria-hidden /> Platform integrations
        </h3>
        <ul className="mt-2 flex flex-wrap gap-2">
          {h.integrations.map((i) => (
            <li key={i.providerId}>
              <Badge
                tone={!i.enabled ? 'neutral' : i.lastTest && !i.lastTest.ok ? 'danger' : 'success'}
                title={i.lastTest ? `Last test ${when(i.lastTest.at)}` : 'Not tested'}
              >
                {i.name}
                {!i.enabled ? ' · off' : i.lastTest && !i.lastTest.ok ? ' · failing' : ''}
              </Badge>
            </li>
          ))}
        </ul>
      </section>
      {me.bootstrap ? (
        <p className="text-meta text-text-subtle">
          You became the first super admin from the PLATFORM_ADMIN_EMAILS server setting. Add more
          platform admins in Platform admins; the setting is only used while nobody is a super
          admin.
        </p>
      ) : null}
    </div>
  );
}

const uptime = (s: number) =>
  s >= 86_400
    ? `${Math.floor(s / 86_400)}d ${Math.floor((s % 86_400) / 3600)}h`
    : s >= 3600
      ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
      : `${Math.floor(s / 60)}m`;

function Kpi({
  icon: Icon,
  label,
  value,
  note,
  warn,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  note?: string;
  warn?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="flex items-center gap-2 text-meta text-text-muted">
        <Icon className="size-4 text-accent" />
        {label}
      </span>
      <span className="mt-2 block max-w-full truncate font-display text-h2 text-text">{value}</span>
      {warn ? (
        <span className="mt-1 block text-meta text-warning">{warn}</span>
      ) : note ? (
        <span className="mt-1 block truncate text-meta text-text-subtle">{note}</span>
      ) : null}
    </>
  );
  const cls =
    'flex flex-col items-start rounded-xl border border-border bg-surface p-4 text-left shadow-sm';
  return onClick ? (
    <button onClick={onClick} className={cn(cls, 'transition-colors hover:border-border-strong')}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function HealthItem({
  icon: Icon,
  label,
  ok,
  detail,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  ok: boolean;
  detail: string;
}) {
  return (
    <div className="flex gap-3 rounded-lg border border-border bg-surface-sunken/50 p-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-text-muted" />
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-label text-text">
          {label}
          {ok ? (
            <CheckCircle2 className="size-3.5 text-success" aria-label="OK" />
          ) : (
            <XCircle className="size-3.5 text-danger" aria-label="Problem" />
          )}
        </p>
        <p className="break-words text-meta text-text-muted">{detail}</p>
      </div>
    </div>
  );
}
