'use client';
import * as React from 'react';
import {
  ArrowLeft,
  Ban,
  Building2,
  LifeBuoy,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import {
  ORG_DELETION_GRACE_DAYS,
  PLATFORM_ORG_FILTERS,
  SUBSCRIPTION_STATUSES,
  formatMoney,
  platformCan,
  type BillingPlan,
  type PlatformMe,
  type PlatformOrg,
  type PlatformOrgDetail,
  type PlatformOrgFilter,
  type PlatformOrgPage,
  type PlatformSupportView,
  type SubscriptionStatus,
} from '@sampledge/contracts';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  Field,
  Input,
  StateView,
  Textarea,
  cn,
  useToast,
} from '@sampledge/ui';
import { errorText, usePlatformApi, usePlatformChange, type PlatformApi } from './api';
import { day, gb, when } from './console';

const FILTER_LABEL: Record<PlatformOrgFilter, string> = {
  all: 'All',
  active: 'Active',
  suspended: 'Suspended',
  deleting: 'Being deleted',
};
const SUB: Record<
  SubscriptionStatus,
  { label: string; tone: 'success' | 'accent' | 'warning' | 'danger' | 'neutral' }
> = {
  none: { label: 'No plan', tone: 'neutral' },
  trialing: { label: 'Trial', tone: 'accent' },
  active: { label: 'Active', tone: 'success' },
  past_due: { label: 'Payment due', tone: 'warning' },
  canceled: { label: 'Canceled', tone: 'danger' },
};

export function StatusBadge({ org }: { org: PlatformOrg }) {
  if (org.deletionScheduledFor)
    return <Badge tone="danger">Erased {day(org.deletionScheduledFor)}</Badge>;
  return org.status === 'active' ? (
    <Badge tone="success">Active</Badge>
  ) : (
    <Badge tone="warning">Suspended</Badge>
  );
}

/** Every organization: search, filter, open one, create one. */
export function OrganizationsTab({
  me,
  online,
  focus,
  onFocus,
}: {
  me: PlatformMe;
  online: boolean;
  focus: string | null;
  onFocus: (id: string | null) => void;
}) {
  const api = usePlatformApi();
  const [q, setQ] = React.useState('');
  const [status, setStatus] = React.useState<PlatformOrgFilter>('all');
  const [page, setPage] = React.useState(1);
  const [data, setData] = React.useState<PlatformOrgPage | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const gen = React.useRef(0);

  const load = React.useCallback(() => {
    const mine = ++gen.current;
    api
      .orgs({ q: q.trim() || undefined, status, page, limit: 25 })
      .then((r) => {
        if (mine !== gen.current) return;
        setData(r);
        setError(null);
      })
      .catch((e) => setError(errorText(e)));
  }, [api, q, status, page]);
  React.useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);
  usePlatformChange(['orgs', 'billing'], () => load());

  if (focus) return <OrgDetail id={focus} me={me} online={online} onBack={() => onFocus(null)} />;

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <div className="flex flex-col gap-4" data-testid="platform-orgs">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[220px] flex-1">
          <span className="sr-only">Search organizations</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-subtle" />
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Search by name or address"
            className="pl-9"
          />
        </label>
        <div role="tablist" className="flex gap-1 rounded-md border border-border bg-surface p-0.5">
          {PLATFORM_ORG_FILTERS.map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={status === f}
              onClick={() => {
                setStatus(f);
                setPage(1);
              }}
              className={cn(
                'h-8 rounded-sm px-3 text-label',
                status === f
                  ? 'bg-surface-raised text-text shadow-sm'
                  : 'text-text-muted hover:text-text',
              )}
            >
              {FILTER_LABEL[f]}
            </button>
          ))}
        </div>
        {platformCan(me.role, 'orgs.manage') ? (
          <Button onClick={() => setCreating(true)} disabled={!online}>
            <Plus /> New organization
          </Button>
        ) : null}
      </div>

      {!data ? (
        error ? (
          <StateView state="error" description={error} />
        ) : (
          <StateView state="loading" title="Loading organizations" />
        )
      ) : data.items.length === 0 ? (
        <StateView state="empty" title="No organizations match" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full min-w-[760px] text-left">
            <thead className="border-b border-border text-meta text-text-subtle">
              <tr>
                <th className="px-4 py-2.5 font-medium">Organization</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Plan</th>
                <th className="px-3 py-2.5 text-right font-medium">Members</th>
                <th className="px-3 py-2.5 text-right font-medium">Storage</th>
                <th className="px-3 py-2.5 font-medium">Last active</th>
                <th className="px-4 py-2.5 font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.items.map((o) => (
                <tr
                  key={o.tenantId}
                  className="cursor-pointer hover:bg-surface-raised/60"
                  onClick={() => onFocus(o.tenantId)}
                >
                  <td className="px-4 py-3">
                    <button
                      className="text-left"
                      onClick={(e) => {
                        e.stopPropagation();
                        onFocus(o.tenantId);
                      }}
                    >
                      <span className="block text-label text-text">{o.name}</span>
                      <span className="block text-meta text-text-subtle">{o.slug}</span>
                    </button>
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge org={o} />
                  </td>
                  <td className="px-3 py-3 text-meta">
                    <span className="block text-text">{o.plan?.name ?? 'No plan'}</span>
                    <span className="text-text-subtle">{SUB[o.subscription.status].label}</span>
                  </td>
                  <td className="px-3 py-3 text-right text-label tabular-nums text-text">
                    {o.members}
                  </td>
                  <td className="px-3 py-3 text-right text-meta tabular-nums text-text-muted">
                    {gb(o.storageBytes)}
                  </td>
                  <td className="px-3 py-3 text-meta text-text-muted">{day(o.lastActiveAt)}</td>
                  <td className="px-4 py-3 text-meta text-text-muted">{day(o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && pages > 1 ? (
        <div className="flex items-center justify-end gap-2 text-meta text-text-muted">
          <span>
            Page {data.page} of {pages} · {data.total} organizations
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      ) : data ? (
        <p className="text-right text-meta text-text-subtle">{data.total} organizations</p>
      ) : null}
      <CreateOrgDialog
        open={creating}
        onClose={() => setCreating(false)}
        api={api}
        onCreated={(o) => {
          setCreating(false);
          onFocus(o.tenantId);
        }}
      />
    </div>
  );
}

// ─── one organization ───────────────────────────────────────────────────────

function OrgDetail({
  id,
  me,
  online,
  onBack,
}: {
  id: string;
  me: PlatformMe;
  online: boolean;
  onBack: () => void;
}) {
  const api = usePlatformApi();
  const { toast } = useToast();
  const [d, setD] = React.useState<PlatformOrgDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [view, setView] = React.useState<'summary' | 'support'>('summary');
  const [dialog, setDialog] = React.useState<null | 'rename' | 'suspend' | 'delete'>(null);
  const load = React.useCallback(() => {
    api
      .org(id)
      .then((x) => {
        setD(x);
        setError(null);
      })
      .catch((e) => setError(errorText(e)));
  }, [api, id]);
  React.useEffect(load, [load]);
  usePlatformChange(['orgs', 'billing'], (t) => (!t || t === id ? load() : undefined));

  const run = async (f: () => Promise<unknown>, done: string) => {
    try {
      await f();
      toast({ title: done, tone: 'success' });
      load();
    } catch (e) {
      toast({ title: 'That didn’t work', description: errorText(e), tone: 'danger' });
    }
  };

  if (!d)
    return (
      <div className="flex flex-col gap-4">
        <BackLink onBack={onBack} />
        {error ? (
          <StateView state="error" description={error} />
        ) : (
          <StateView state="loading" title="Loading organization" />
        )}
      </div>
    );
  const o = d.org;
  const manage = platformCan(me.role, 'orgs.manage') && online;
  const canDelete = platformCan(me.role, 'orgs.delete') && online;
  const ov = d.overview;
  return (
    <div className="flex flex-col gap-5" data-testid="platform-org">
      <BackLink onBack={onBack} />
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid size-11 place-items-center rounded-lg bg-accent-soft text-accent">
          <Building2 className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-center gap-2 font-display text-h2 text-text">
            {o.name} <StatusBadge org={o} />
          </h2>
          <p className="text-meta text-text-subtle">
            {o.slug} · created {day(o.createdAt)} · last active {day(o.lastActiveAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {manage ? (
            <Button size="sm" variant="secondary" onClick={() => setDialog('rename')}>
              <Pencil /> Rename
            </Button>
          ) : null}
          {manage && !o.deletionScheduledFor ? (
            o.status === 'active' ? (
              <Button size="sm" variant="secondary" onClick={() => setDialog('suspend')}>
                <Ban /> Suspend
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => run(() => api.reactivate(id), `${o.name} is active again`)}
              >
                <RotateCcw /> Reactivate
              </Button>
            )
          ) : null}
          {canDelete ? (
            o.deletionScheduledFor ? (
              <Button
                size="sm"
                onClick={() => run(() => api.cancelDeletion(id), 'Deletion cancelled')}
              >
                <RotateCcw /> Cancel deletion
              </Button>
            ) : (
              <Button size="sm" variant="danger" onClick={() => setDialog('delete')}>
                <Trash2 /> Delete
              </Button>
            )
          ) : null}
        </div>
      </div>

      {o.status === 'suspended' && o.suspension ? (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-label font-normal text-text">
          {o.deletionScheduledFor ? (
            <>
              Everything in this organization will be erased on{' '}
              <b>{when(o.deletionScheduledFor)}</b>. Nobody in it can sign in meanwhile. Cancel
              before then to keep it.
            </>
          ) : (
            <>
              Suspended {when(o.suspension.at)}
              {o.suspension.byName ? ` by ${o.suspension.byName}` : ''}: “{o.suspension.reason}”.
              Nobody in it can sign in until it’s reactivated.
            </>
          )}
        </div>
      ) : null}

      <div
        role="tablist"
        className="flex w-fit gap-1 rounded-md border border-border bg-surface p-0.5"
      >
        {(['summary', 'support'] as const).map((v) =>
          v === 'support' && !platformCan(me.role, 'support.view') ? null : (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn(
                'h-8 rounded-sm px-3 text-label',
                view === v
                  ? 'bg-surface-raised text-text shadow-sm'
                  : 'text-text-muted hover:text-text',
              )}
            >
              {v === 'summary' ? 'Summary' : 'Support view'}
            </button>
          ),
        )}
      </div>

      {view === 'support' ? (
        <SupportView id={id} api={api} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat
              label="Active members"
              value={`${ov.members.active}`}
              note={`${ov.members.deactivated} deactivated`}
            />
            <Stat
              label="Two-step sign-in"
              value={`${ov.members.active ? Math.round((ov.members.twoStepOn / ov.members.active) * 100) : 0}%`}
              note={ov.signIn.ssoEnabled ? 'Single sign-on on' : 'Email and password'}
            />
            <Stat
              label="Messages this week"
              value={`${ov.activity.messagesLast7Days}`}
              note={`${ov.activity.conversations} conversation${ov.activity.conversations === 1 ? '' : 's'}`}
            />
            <Stat
              label="Files stored"
              value={gb(ov.storageBytes)}
              note={`${ov.devices.seenLast7Days} device${ov.devices.seenLast7Days === 1 ? '' : 's'} this week`}
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <PlanCard
              org={o}
              api={api}
              canEdit={platformCan(me.role, 'billing.manage') && online}
              onSaved={load}
            />
            <section className="rounded-xl border border-border bg-surface p-5">
              <h3 className="text-label text-text">Owners and admins</h3>
              <ul className="mt-3 divide-y divide-border">
                {d.admins.map((p) => (
                  <li key={p.userId} className="flex items-center gap-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-label text-text">{p.name}</span>
                      <span className="block truncate text-meta text-text-subtle">{p.email}</span>
                    </span>
                    <Badge>{p.role === 'owner' ? 'Owner' : 'Admin'}</Badge>
                    {p.twoStep ? (
                      <ShieldCheck className="size-4 text-success" aria-label="Two-step on" />
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          </div>
          {d.invoices.length ? (
            <section className="rounded-xl border border-border bg-surface p-5">
              <h3 className="text-label text-text">Invoices</h3>
              <ul className="mt-3 divide-y divide-border text-meta">
                {d.invoices.map((i) => (
                  <li key={i.invoiceId} className="flex gap-3 py-2">
                    <span className="flex-1 text-text">{i.number ?? i.invoiceId}</span>
                    <span className="text-text-muted">{day(i.createdAt)}</span>
                    <span className="tabular-nums text-text">
                      {formatMoney(i.total, i.currency)}
                    </span>
                    <Badge
                      tone={
                        i.status === 'paid'
                          ? 'success'
                          : i.status === 'open'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {i.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section className="rounded-xl border border-border bg-surface p-5">
            <h3 className="text-label text-text">What super admins did here</h3>
            {d.history.length ? (
              <ul className="mt-3 divide-y divide-border">
                {d.history.map((h) => (
                  <li key={h.id} className="flex flex-wrap gap-x-3 py-2 text-meta">
                    <span className="flex-1 text-text">{h.label}</span>
                    <span className="text-text-muted">{h.actor?.name ?? 'SampConnect'}</span>
                    <span className="text-text-subtle">{when(h.at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-meta text-text-subtle">Nothing yet.</p>
            )}
          </section>
        </>
      )}

      <RenameDialog
        open={dialog === 'rename'}
        org={o}
        onClose={() => setDialog(null)}
        onSave={(name) => run(() => api.rename(id, name), 'Renamed')}
      />
      <SuspendDialog
        open={dialog === 'suspend'}
        org={o}
        onClose={() => setDialog(null)}
        onSuspend={(r) => run(() => api.suspend(id, r), `${o.name} is suspended`)}
      />
      <DeleteDialog
        open={dialog === 'delete'}
        org={o}
        onClose={() => setDialog(null)}
        onDelete={(slug) => run(() => api.scheduleDeletion(id, slug), 'Deletion scheduled')}
      />
    </div>
  );
}

function BackLink({ onBack }: { onBack: () => void }) {
  return (
    <button
      onClick={onBack}
      className="flex w-fit items-center gap-1.5 text-label text-text-muted hover:text-text"
    >
      <ArrowLeft className="size-4" /> All organizations
    </button>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-meta text-text-muted">{label}</p>
      <p className="mt-1 font-display text-h3 text-text">{value}</p>
      {note ? <p className="text-meta text-text-subtle">{note}</p> : null}
    </div>
  );
}

function PlanCard({
  org,
  api,
  canEdit,
  onSaved,
}: {
  org: PlatformOrg;
  api: PlatformApi;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [plans, setPlans] = React.useState<BillingPlan[] | null>(null);
  const s = org.subscription;
  const [planId, setPlanId] = React.useState(s.planId ?? '');
  const [status, setStatus] = React.useState<SubscriptionStatus>(s.status);
  const [seats, setSeats] = React.useState(String(Math.max(s.seats, org.members, 1)));
  const [until, setUntil] = React.useState(s.currentPeriodEnd?.slice(0, 10) ?? '');
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    setPlanId(s.planId ?? '');
    setStatus(s.status);
    setSeats(String(Math.max(s.seats, org.members, 1)));
    setUntil(s.currentPeriodEnd?.slice(0, 10) ?? '');
  }, [s.planId, s.status, s.seats, s.currentPeriodEnd, org.members]);
  React.useEffect(() => {
    if (canEdit)
      void api
        .plans()
        .then(setPlans)
        .catch(() => setPlans([]));
  }, [api, canEdit]);
  const online = s.provider === 'stripe';
  return (
    <section className="rounded-xl border border-border bg-surface p-5" data-testid="platform-plan">
      <div className="flex items-center gap-2">
        <h3 className="text-label text-text">Plan</h3>
        <Badge tone={SUB[s.status].tone}>{SUB[s.status].label}</Badge>
        {online ? (
          <Badge>Pays online</Badge>
        ) : s.provider === 'manual' ? (
          <Badge>By invoice</Badge>
        ) : null}
      </div>
      <p className="mt-1 text-meta text-text-muted">
        {org.plan?.name ?? 'No plan'} · {s.seats} seat{s.seats === 1 ? '' : 's'}
        {s.currentPeriodEnd ? ` · renews ${day(s.currentPeriodEnd)}` : ''}
      </p>
      {canEdit && !online && plans ? (
        <form
          className="mt-4 grid gap-3 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api.assignPlan(org.tenantId, {
                planId: planId || null,
                status: planId ? status : 'none',
                seats: Math.max(1, Number(seats) || 1),
                currentPeriodEnd: until ? new Date(`${until}T23:59:59Z`).toISOString() : null,
              });
              toast({ title: 'Plan saved', tone: 'success' });
              onSaved();
            } catch (err) {
              toast({
                title: 'Couldn’t save the plan',
                description: errorText(err),
                tone: 'danger',
              });
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Plan" htmlFor="pa-plan">
            <select
              id="pa-plan"
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              className="h-10 w-full rounded-md border border-border bg-surface-sunken px-3 text-label text-text"
            >
              <option value="">No plan</option>
              {plans.map((p) => (
                <option key={p.planId} value={p.planId}>
                  {p.name}
                  {p.active ? '' : ' (retired)'}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status" htmlFor="pa-status">
            <select
              id="pa-status"
              value={status}
              disabled={!planId}
              onChange={(e) => setStatus(e.target.value as SubscriptionStatus)}
              className="h-10 w-full rounded-md border border-border bg-surface-sunken px-3 text-label text-text disabled:opacity-50"
            >
              {SUBSCRIPTION_STATUSES.filter((x) => x !== 'none').map((x) => (
                <option key={x} value={x}>
                  {SUB[x].label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Seats" htmlFor="pa-seats">
            <Input
              id="pa-seats"
              type="number"
              min={1}
              value={seats}
              onChange={(e) => setSeats(e.target.value)}
            />
          </Field>
          <Field label="Paid until (optional)" htmlFor="pa-until">
            <Input
              id="pa-until"
              type="date"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" size="sm" loading={busy}>
              Save plan
            </Button>
          </div>
        </form>
      ) : online ? (
        <p className="mt-3 text-meta text-text-subtle">
          Managed by the payment provider; change or cancel it there so the two don’t disagree.
        </p>
      ) : null}
    </section>
  );
}

function SupportView({ id, api }: { id: string; api: PlatformApi }) {
  const [v, setV] = React.useState<PlatformSupportView | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    api
      .support(id)
      .then(setV)
      .catch((e) => setError(errorText(e)));
  }, [api, id]);
  if (!v)
    return error ? (
      <StateView state="error" description={error} />
    ) : (
      <StateView state="loading" title="Loading the support view" />
    );
  return (
    <div className="flex flex-col gap-4" data-testid="platform-support">
      <p className="flex items-start gap-2 rounded-lg border border-border bg-surface-sunken/60 px-4 py-3 text-meta text-text-muted">
        <LifeBuoy className="mt-0.5 size-4 shrink-0 text-accent" />
        What you need to help this organization, without signing in as anyone: no messages, files or
        secrets. Opening this view is recorded in the organization’s own audit log.
      </p>
      <section className="overflow-x-auto rounded-xl border border-border bg-surface">
        <h3 className="px-5 pt-4 text-label text-text">People ({v.members.length})</h3>
        <table className="mt-2 w-full min-w-[640px] text-left text-meta">
          <thead className="text-text-subtle">
            <tr>
              <th className="px-5 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Two-step</th>
              <th className="px-3 py-2 text-right font-medium">Devices</th>
              <th className="px-5 py-2 font-medium">Last seen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {v.members.map((m) => (
              <tr key={m.userId}>
                <td className="px-5 py-2">
                  <span className="block text-label text-text">{m.name}</span>
                  <span className="text-text-subtle">{m.email}</span>
                </td>
                <td className="px-3 py-2 capitalize text-text">{m.role}</td>
                <td className="px-3 py-2">
                  <Badge tone={m.status === 'active' ? 'success' : 'neutral'}>
                    {m.status === 'active' ? 'Active' : 'Deactivated'}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-text-muted">{m.twoStep ? 'On' : 'Off'}</td>
                <td className="px-3 py-2 text-right tabular-nums text-text">{m.devices}</td>
                <td className="px-5 py-2 text-text-muted">{when(m.lastSeenAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-surface p-5">
          <h3 className="text-label text-text">Sign-in and integrations</h3>
          <p className="mt-2 text-meta text-text-muted">
            {v.signIn.ssoEnabled
              ? v.signIn.passwordLogin
                ? 'Single sign-on is on; passwords still work.'
                : 'Single sign-on only.'
              : 'Email and password.'}
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {v.integrations.length ? (
              v.integrations.map((i) => (
                <li key={i.providerId} className="flex items-center gap-2 text-meta">
                  <span className="flex-1 text-text">{i.name}</span>
                  <span className="text-text-subtle">
                    {i.source === 'platform'
                      ? 'platform default'
                      : i.source === 'tenant'
                        ? 'their own'
                        : ''}
                  </span>
                  <Badge
                    tone={
                      !i.enabled ? 'neutral' : i.lastTest && !i.lastTest.ok ? 'danger' : 'success'
                    }
                    title={i.lastTest?.message}
                  >
                    {!i.enabled ? 'Off' : i.lastTest && !i.lastTest.ok ? 'Failing' : 'On'}
                  </Badge>
                </li>
              ))
            ) : (
              <li className="text-meta text-text-subtle">No integrations set up.</li>
            )}
          </ul>
        </section>
        <section className="rounded-xl border border-border bg-surface p-5">
          <h3 className="text-label text-text">Recent sign-in and security events</h3>
          <ul className="mt-3 flex max-h-72 flex-col divide-y divide-border overflow-y-auto">
            {v.events.length ? (
              v.events.map((e) => (
                <li key={e.id} className="py-2 text-meta">
                  <span className="block text-text">
                    {e.label}
                    {e.actor
                      ? ` · ${e.actor.name}`
                      : typeof e.metadata.email === 'string'
                        ? ` · ${e.metadata.email}`
                        : ''}
                  </span>
                  <span className="text-text-subtle">
                    {when(e.at)}
                    {e.ip ? ` · ${e.ip}` : ''}
                  </span>
                </li>
              ))
            ) : (
              <li className="py-2 text-meta text-text-subtle">Nothing recent.</li>
            )}
          </ul>
        </section>
      </div>
      <section className="overflow-x-auto rounded-xl border border-border bg-surface">
        <h3 className="px-5 pt-4 text-label text-text">Devices</h3>
        <ul className="mt-2 divide-y divide-border">
          {v.devices.map((d) => (
            <li
              key={d.sessionId}
              className="flex flex-wrap items-center gap-x-3 px-5 py-2 text-meta"
            >
              <span className="flex-1 text-text">
                {d.name} <span className="text-text-subtle">· {d.platform}</span>
              </span>
              <span className="text-text-muted">{d.userName}</span>
              <span className="text-text-subtle">{when(d.lastSeenAt)}</span>
              {d.revoked ? <Badge>Signed out</Badge> : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ─── dialogs ────────────────────────────────────────────────────────────────

function CreateOrgDialog({
  open,
  onClose,
  api,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  api: PlatformApi;
  onCreated: (o: PlatformOrg) => void;
}) {
  const [f, setF] = React.useState({
    name: '',
    slug: '',
    ownerName: '',
    ownerEmail: '',
    temporaryPassword: '',
    planId: '',
  });
  const [plans, setPlans] = React.useState<BillingPlan[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    setError(null);
    setF({
      name: '',
      slug: '',
      ownerName: '',
      ownerEmail: '',
      temporaryPassword: suggestPassword(),
      planId: '',
    });
    void api
      .plans()
      .then(setPlans)
      .catch(() => setPlans([]));
  }, [open, api]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((x) => ({
      ...x,
      [k]: e.target.value,
      ...(k === 'name' && (!x.slug || x.slug === slugify(x.name))
        ? { slug: slugify(e.target.value) }
        : {}),
    }));
  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent
        title="New organization"
        description="The owner signs in with the temporary password below. Share it with them securely."
        className="w-[min(600px,calc(100vw-2rem))]"
      >
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              onCreated(await api.create({ ...f, planId: f.planId || null }));
            } catch (err) {
              setError(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Organization name" htmlFor="co-name">
            <Input id="co-name" required value={f.name} onChange={set('name')} />
          </Field>
          <Field label="Workspace address" htmlFor="co-slug" hint="Used to sign in.">
            <Input id="co-slug" required value={f.slug} onChange={set('slug')} />
          </Field>
          <Field label="Owner’s name" htmlFor="co-owner">
            <Input id="co-owner" required value={f.ownerName} onChange={set('ownerName')} />
          </Field>
          <Field label="Owner’s email" htmlFor="co-email">
            <Input
              id="co-email"
              type="email"
              required
              value={f.ownerEmail}
              onChange={set('ownerEmail')}
            />
          </Field>
          <Field label="Temporary password" htmlFor="co-pw" hint="At least 12 characters.">
            <Input
              id="co-pw"
              required
              minLength={12}
              value={f.temporaryPassword}
              onChange={set('temporaryPassword')}
            />
          </Field>
          <Field label="Plan (optional)" htmlFor="co-plan">
            <select
              id="co-plan"
              value={f.planId}
              onChange={set('planId')}
              className="h-10 w-full rounded-md border border-border bg-surface-sunken px-3 text-label text-text"
            >
              <option value="">No plan yet</option>
              {plans
                .filter((p) => p.active)
                .map((p) => (
                  <option key={p.planId} value={p.planId}>
                    {p.name}
                  </option>
                ))}
            </select>
          </Field>
          {error ? (
            <p role="alert" className="text-label font-normal text-danger sm:col-span-2">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Create organization
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RenameDialog({
  open,
  org,
  onClose,
  onSave,
}: {
  open: boolean;
  org: PlatformOrg;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = React.useState(org.name);
  React.useEffect(() => setName(org.name), [open, org.name]);
  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent title="Rename organization">
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            await onSave(name.trim());
            onClose();
          }}
        >
          <Field label="Name" htmlFor="rn-name">
            <Input
              id="rn-name"
              required
              minLength={2}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SuspendDialog({
  open,
  org,
  onClose,
  onSuspend,
}: {
  open: boolean;
  org: PlatformOrg;
  onClose: () => void;
  onSuspend: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => setReason(''), [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent
        title={`Suspend ${org.name}?`}
        description="Everyone in it is signed out on every device right away and can’t sign in until you reactivate it. Nothing is deleted."
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await onSuspend(reason.trim());
              onClose();
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field
            label="Reason"
            htmlFor="sp-reason"
            hint="Kept with the organization and in both audit logs."
          >
            <Textarea
              id="sp-reason"
              required
              minLength={3}
              maxLength={500}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Unpaid invoices since September"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="danger"
              loading={busy}
              disabled={reason.trim().length < 3}
            >
              Suspend
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  open,
  org,
  onClose,
  onDelete,
}: {
  open: boolean;
  org: PlatformOrg;
  onClose: () => void;
  onDelete: (slug: string) => Promise<void>;
}) {
  const [typed, setTyped] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => setTyped(''), [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent
        title={`Delete ${org.name}?`}
        description={`It’s suspended now and everything in it (people, messages, files, recordings, billing history) is erased in ${ORG_DELETION_GRACE_DAYS} days. You can cancel until then.`}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await onDelete(typed.trim());
              onClose();
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label={`Type ${org.slug} to confirm`} htmlFor="del-slug">
            <Input
              id="del-slug"
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="danger"
              loading={busy}
              disabled={typed.trim() !== org.slug}
            >
              Schedule deletion
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

function suggestPassword() {
  const words =
    'amber,birch,cobalt,delta,ember,fjord,granite,harbor,indigo,juniper,kestrel,lumen,meadow,nimbus,orchid,prairie,quartz,raven,summit,tundra'.split(
      ',',
    );
  const r = new Uint32Array(4);
  crypto.getRandomValues(r);
  return `${words[r[0]! % 20]}-${words[r[1]! % 20]}-${words[r[2]! % 20]}-${(r[3]! % 9000) + 1000}`;
}
