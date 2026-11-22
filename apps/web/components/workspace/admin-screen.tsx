'use client';
import * as React from 'react';
import {
  Activity,
  Download,
  KeyRound,
  Laptop,
  MonitorSmartphone,
  Search,
  ShieldAlert,
  ShieldCheck,
  Users,
} from 'lucide-react';
import {
  AUDIT_CATEGORIES,
  type AdminOverview,
  type AuditCategory,
  type AuditEntry,
  type AuditPage,
  type TenantRole,
  type UserSummary,
} from '@sampledge/contracts';
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  DialogContent,
  Field,
  Input,
  StateView,
  cn,
  useToast,
} from '@sampledge/ui';
import { ApiFailure, apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { API_URL } from '@/lib/config';
import { avatarUrl, relativeShort } from './helpers';
import { CallBackgroundsAdmin } from './call-backgrounds-admin';
import { MessageEditingAdmin } from './message-editing-admin';
import type { ModuleId } from './modules';
import { NetworkPolicyTab } from '../network/admin-policy';
import { GreetingsAdmin } from './greetings';
import { FeatureHelp } from '../feature-help';

type Tab =
  'overview' | 'members' | 'devices' | 'messages' | 'calls' | 'audit' | 'network' | 'greetings';
interface Device {
  sessionId: string;
  userId: string;
  name: string;
  platform: string;
  lastSeenAt: string;
  revokedAt: string | null;
  current: boolean;
}
const errorText = (e: unknown) =>
  e instanceof ApiFailure ? e.error.message : (e as Error).message;
const CATEGORY_LABEL: Record<AuditCategory, string> = {
  'sign-in': 'Sign-in',
  members: 'Members',
  security: 'Security',
  conversations: 'Conversations',
  integrations: 'Integrations',
  billing: 'Billing',
  organization: 'Organization',
  other: 'Other',
};
const gb = (b: number) =>
  b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.round(b / 1024 ** 2)} MB`;
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function useAdminApi() {
  const { getAccessToken } = useAuth();
  return React.useMemo(() => {
    const req = async <T,>(method: string, path: string, body?: unknown) =>
      apiRequest<T>(method, path, { token: await getAccessToken(), body });
    return {
      overview: () => req<AdminOverview>('GET', '/v1/admin/overview'),
      users: () => req<(UserSummary & { presence: string })[]>('GET', '/v1/users'),
      updateUser: (id: string, body: { role?: TenantRole; status?: 'active' | 'deactivated' }) =>
        req<UserSummary>('PATCH', `/v1/users/${id}`, body),
      invite: (body: unknown) => req<UserSummary>('POST', '/v1/users', body),
      resetTwoStep: (id: string) => req('POST', `/v1/users/${id}/mfa/reset`),
      resetPassword: (id: string, temporaryPassword: string) =>
        req<{ signedOutDevices: number }>('POST', `/v1/users/${id}/password`, {
          temporaryPassword,
        }),
      devices: () => req<Device[]>('GET', '/v1/devices?all=true'),
      revoke: (id: string) => req('DELETE', `/v1/devices/${id}`),
      audit: (q: URLSearchParams) => req<AuditPage>('GET', `/v1/admin/audit?${q}`),
      exportAudit: async (q: URLSearchParams) => {
        const res = await fetch(`${API_URL}/v1/admin/audit/export?${q}`, {
          headers: { authorization: `Bearer ${await getAccessToken()}` },
        });
        if (!res.ok) throw new Error(`Export failed (HTTP ${res.status})`);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(await res.blob());
        a.download =
          /filename="?([^";]+)/.exec(res.headers.get('content-disposition') ?? '')?.[1] ??
          'audit-log.csv';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      },
    };
  }, [getAccessToken]);
}

/** Administration: overview, members, devices, call backgrounds and the audit log for owners and admins. */
export function AdminScreen({ onOpenModule }: { onOpenModule: (m: ModuleId) => void }) {
  const [tab, setTab] = React.useState<Tab>('overview');
  const [auditActor, setAuditActor] = React.useState<string | null>(null);
  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'members', label: 'Members' },
    { id: 'devices', label: 'Devices' },
    { id: 'messages', label: 'Messages' },
    { id: 'calls', label: 'Calls' },
    { id: 'audit', label: 'Audit log' },
    { id: 'network', label: 'SampConnect Network' },
    { id: 'greetings', label: 'Greeting cards' },
  ];
  return (
    <main className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0" data-testid="admin-screen">
      <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-border bg-surface/40 px-4 backdrop-blur-xl sm:px-6">
        <ShieldCheck className="size-5 text-accent" aria-hidden />
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="font-display text-h3 text-text">Administration</h1>
          <FeatureHelp id="admin" />
        </div>
        <nav className="ml-4 flex gap-1 overflow-x-auto" aria-label="Administration sections">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
              className={cn(
                'h-8 shrink-0 rounded-md px-3 text-label',
                tab === t.id
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
          {tab === 'overview' ? (
            <OverviewTab onOpenModule={onOpenModule} onOpenTab={setTab} />
          ) : tab === 'members' ? (
            <MembersTab
              onShowActivity={(id) => {
                setAuditActor(id);
                setTab('audit');
              }}
            />
          ) : tab === 'devices' ? (
            <DevicesTab />
          ) : tab === 'messages' ? (
            <MessageEditingAdmin />
          ) : tab === 'calls' ? (
            <CallBackgroundsAdmin />
          ) : tab === 'network' ? (
            <NetworkPolicyTab />
          ) : tab === 'greetings' ? (
            <GreetingsAdmin />
          ) : (
            <AuditTab actorId={auditActor} onClearActor={() => setAuditActor(null)} />
          )}
        </div>
      </div>
    </main>
  );
}

// ---------- overview ----------

function Stat({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  sub?: string;
  tone?: 'warning';
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="flex items-center gap-2 text-meta text-text-subtle">
        <Icon className={cn('size-4', tone === 'warning' ? 'text-warning' : 'text-accent')} />
        {label}
      </p>
      <p className="mt-2 font-display text-h2 tabular-nums text-text">{value}</p>
      {sub ? <p className="mt-0.5 text-meta text-text-muted">{sub}</p> : null}
    </div>
  );
}

function OverviewTab({
  onOpenModule,
  onOpenTab,
}: {
  onOpenModule: (m: ModuleId) => void;
  onOpenTab: (t: Tab) => void;
}) {
  const api = useAdminApi();
  const [o, setO] = React.useState<AdminOverview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    api.overview().then(setO, (e) => setError(errorText(e)));
  }, [api]);
  if (!o)
    return error ? (
      <StateView state="error" description={error} />
    ) : (
      <StateView state="loading" title="Loading overview" />
    );
  const pct = o.members.active ? Math.round((o.members.twoStepOn / o.members.active) * 100) : 0;
  const shortcuts: { id: ModuleId; label: string; detail: string }[] = [
    {
      id: 'integrations',
      label: 'Integrations',
      detail: `${o.integrations.connected} connected${o.integrations.failing ? ` · ${o.integrations.failing} failing` : ''}`,
    },
    {
      id: 'billing',
      label: 'Billing',
      detail: o.plan.name ? `${o.plan.name} · ${o.plan.status.replace('_', ' ')}` : 'No plan yet',
    },
    { id: 'branding', label: 'Branding', detail: 'Name, logo, colors and sign-in page' },
    { id: 'recordings', label: 'Recordings', detail: 'Retention and exports' },
  ];
  return (
    <div className="grid gap-6">
      <div>
        <h2 className="font-display text-h3 text-text">{o.organization.name}</h2>
        <p className="text-meta text-text-subtle">
          {o.organization.slug} · since {new Date(o.organization.createdAt).toLocaleDateString()}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={Users}
          label="Members"
          value={o.members.active}
          sub={`${o.members.byRole.owner + o.members.byRole.admin} admins · ${o.members.byRole.guest} guests${o.members.deactivated ? ` · ${o.members.deactivated} deactivated` : ''}`}
        />
        <Stat
          icon={KeyRound}
          label="Two-step verification"
          value={`${pct}%`}
          sub={`${o.members.twoStepOn} of ${o.members.active} people`}
          tone={pct < 50 ? 'warning' : undefined}
        />
        <Stat
          icon={MonitorSmartphone}
          label="Signed-in devices"
          value={o.devices.active}
          sub={`${o.devices.seenLast7Days} used this week`}
        />
        <Stat
          icon={Activity}
          label="Messages this week"
          value={o.activity.messagesLast7Days}
          sub={`${o.activity.conversations} conversations · ${gb(o.storageBytes)} files`}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <section className="rounded-xl border border-border bg-surface p-5">
          <div className="mb-3 flex items-center gap-2">
            <ShieldAlert className="size-4 text-warning" aria-hidden />
            <h3 className="flex-1 text-label text-text">Recent security events</h3>
            <Button size="sm" variant="ghost" onClick={() => onOpenTab('audit')}>
              Full audit log
            </Button>
          </div>
          {o.security.length === 0 ? (
            <p className="text-meta text-text-subtle">Nothing unusual recently.</p>
          ) : (
            <ul className="divide-y divide-border">
              {o.security.map((e) => (
                <AuditRow key={e.id} e={e} compact />
              ))}
            </ul>
          )}
        </section>
        <section className="grid content-start gap-2">
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="text-label text-text">Sign-in</p>
            <p className="mt-1 text-meta text-text-muted">
              {o.signIn.ssoEnabled
                ? `Single sign-on is on${o.signIn.passwordLogin ? '; passwords still work' : ' and required (owner excepted)'}.`
                : 'Passwords, with optional two-step verification. Single sign-on is off.'}
            </p>
          </div>
          {shortcuts.map((s) => (
            <button
              key={s.id}
              onClick={() => onOpenModule(s.id)}
              className="rounded-xl border border-border bg-surface p-4 text-left hover:border-border-strong"
            >
              <span className="block text-label text-text">{s.label}</span>
              <span className="block text-meta text-text-muted">{s.detail}</span>
            </button>
          ))}
        </section>
      </div>
    </div>
  );
}

// ---------- members ----------

function MembersTab({ onShowActivity }: { onShowActivity: (userId: string) => void }) {
  const api = useAdminApi();
  const { session } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = React.useState<(UserSummary & { presence: string })[] | null>(null);
  const [query, setQuery] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [pwFor, setPwFor] = React.useState<UserSummary | null>(null);
  const formRef = React.useRef<HTMLFormElement>(null);
  const isOwner = session?.user.role === 'owner';

  const load = React.useCallback(
    async () => setUsers(await api.users().catch((e) => (setError(errorText(e)), [] as never))),
    [api],
  );
  React.useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setError(null);
    try {
      await fn();
      if (done) toast({ title: done, tone: 'success' });
      await load();
    } catch (e) {
      setError(errorText(e));
    }
  };

  if (!users) return <StateView state="loading" title="Loading members" />;
  const q = query.trim().toLowerCase();
  const shown = users
    .filter((u) => !q || `${u.displayName} ${u.email} ${u.role}`.toLowerCase().includes(q))
    .sort(
      (a, b) =>
        Number(a.status !== 'active') - Number(b.status !== 'active') ||
        a.displayName.localeCompare(b.displayName),
    );
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-subtle" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people"
            aria-label="Search people"
            className="pl-9"
          />
        </div>
        <p className="text-meta text-text-subtle">
          {users.filter((u) => u.status === 'active').length} active
        </p>
        <Button size="sm" onClick={() => setAdding(!adding)}>
          {adding ? 'Close' : 'Add member'}
        </Button>
      </div>
      {adding ? (
        <form
          ref={formRef}
          className="grid gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-[1fr_1fr_140px_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void act(async () => {
              await api.invite({
                displayName: f.get('displayName'),
                email: f.get('email'),
                role: f.get('role'),
                temporaryPassword: f.get('password'),
              });
              formRef.current?.reset();
            }, 'Member added. Share the temporary password with them securely.');
          }}
        >
          <Input name="displayName" placeholder="Full name" required aria-label="Full name" />
          <Input
            name="email"
            type="email"
            placeholder="Work email"
            required
            aria-label="Work email"
          />
          <select
            name="role"
            defaultValue="member"
            aria-label="Role"
            className="h-10 rounded-md border border-border bg-surface-sunken px-3 text-label text-text"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
            <option value="guest">Guest</option>
          </select>
          <Input
            name="password"
            type="password"
            minLength={12}
            placeholder="Temporary password (12+)"
            required
            aria-label="Temporary password"
          />
          <Button type="submit">Add</Button>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="text-label font-normal text-danger">
          {error}
        </p>
      ) : null}
      <Dialog open={!!pwFor} onOpenChange={(o) => !o && setPwFor(null)}>
        <DialogContent
          title={`Reset ${pwFor?.displayName ?? ''}’s password`}
          description="Give them this temporary password. They are signed out everywhere now and choose their own password at their next sign-in."
        >
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const pw = String(new FormData(e.currentTarget).get('temp') ?? '');
              const who = pwFor!;
              void act(
                () => api.resetPassword(who.userId, pw),
                `${who.displayName} must choose a new password at their next sign-in`,
              ).then(() => setPwFor(null));
            }}
          >
            <Field label="Temporary password" htmlFor="temp-pw" hint="At least 12 characters.">
              <Input
                id="temp-pw"
                name="temp"
                type="text"
                minLength={12}
                required
                autoComplete="off"
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setPwFor(null)}>
                Cancel
              </Button>
              <Button type="submit">Reset password</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <ul
        className="divide-y divide-border rounded-xl border border-border bg-surface"
        data-testid="members-list"
      >
        {shown.map((u) => {
          const me = u.userId === session?.user.userId;
          const locked = me || u.role === 'owner' || (u.role === 'admin' && !isOwner);
          return (
            <li
              key={u.userId}
              className={cn(
                'flex flex-wrap items-center gap-3 px-4 py-3',
                u.status !== 'active' && 'opacity-60',
              )}
            >
              <Avatar name={u.displayName} src={avatarUrl(u.avatarUrl)} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-label text-text">
                  {u.displayName} {me ? <span className="text-text-subtle">(you)</span> : null}
                </span>
                <span className="block truncate text-meta text-text-subtle">{u.email}</span>
              </span>
              {u.status !== 'active' ? <Badge tone="warning">Deactivated</Badge> : null}
              {locked ? (
                <Badge
                  tone={u.role === 'owner' || u.role === 'admin' ? 'accent' : 'neutral'}
                  className="capitalize"
                >
                  {u.role}
                </Badge>
              ) : (
                <select
                  aria-label={`Role for ${u.displayName}`}
                  value={u.role}
                  onChange={(e) =>
                    void act(
                      () => api.updateUser(u.userId, { role: e.target.value as TenantRole }),
                      'Role changed',
                    )
                  }
                  className="h-8 rounded-md border border-border bg-surface-sunken px-2 text-meta text-text"
                >
                  <option value="admin">Admin</option>
                  <option value="member">Member</option>
                  <option value="guest">Guest</option>
                </select>
              )}
              <Button size="sm" variant="ghost" onClick={() => onShowActivity(u.userId)}>
                Activity
              </Button>
              {!locked ? (
                <>
                  <Button
                    size="sm"
                    variant={confirm === `mfa:${u.userId}` ? 'danger' : 'ghost'}
                    onBlur={() => setConfirm(null)}
                    title="For someone who lost their authenticator app and recovery codes"
                    onClick={() =>
                      confirm === `mfa:${u.userId}`
                        ? void act(
                            () => api.resetTwoStep(u.userId),
                            `Two-step verification reset for ${u.displayName}`,
                          ).then(() => setConfirm(null))
                        : setConfirm(`mfa:${u.userId}`)
                    }
                  >
                    {confirm === `mfa:${u.userId}` ? 'Confirm reset' : 'Reset 2-step'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPwFor(u)}>
                    Reset password
                  </Button>
                  {u.status === 'active' ? (
                    <Button
                      size="sm"
                      variant={confirm === `off:${u.userId}` ? 'danger' : 'secondary'}
                      onBlur={() => setConfirm(null)}
                      onClick={() =>
                        confirm === `off:${u.userId}`
                          ? void act(
                              () => api.updateUser(u.userId, { status: 'deactivated' }),
                              `${u.displayName} was deactivated and signed out everywhere`,
                            ).then(() => setConfirm(null))
                          : setConfirm(`off:${u.userId}`)
                      }
                    >
                      {confirm === `off:${u.userId}` ? 'Confirm' : 'Deactivate'}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        void act(
                          () => api.updateUser(u.userId, { status: 'active' }),
                          `${u.displayName} can sign in again`,
                        )
                      }
                    >
                      Reactivate
                    </Button>
                  )}
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------- devices ----------

function DevicesTab() {
  const api = useAdminApi();
  const [devices, setDevices] = React.useState<Device[] | null>(null);
  const [names, setNames] = React.useState<Map<string, string>>(new Map());
  const [error, setError] = React.useState<string | null>(null);
  const load = React.useCallback(async () => {
    try {
      const [d, u] = await Promise.all([api.devices(), api.users()]);
      setDevices(d);
      setNames(new Map(u.map((x) => [x.userId, x.displayName])));
    } catch (e) {
      setError(errorText(e));
    }
  }, [api]);
  React.useEffect(() => {
    void load();
  }, [load]);
  if (!devices)
    return error ? (
      <StateView state="error" description={error} />
    ) : (
      <StateView state="loading" title="Loading devices" />
    );
  const active = devices.filter((d) => !d.revokedAt);
  return (
    <div className="grid gap-3">
      <p className="text-meta text-text-muted">
        {active.length} signed-in device{active.length === 1 ? '' : 's'}. Signing a device out ends
        its session at once; messages already on it stay there until the app next opens.
      </p>
      {error ? (
        <p role="alert" className="text-label font-normal text-danger">
          {error}
        </p>
      ) : null}
      <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
        {active.map((d) => (
          <li key={d.sessionId} className="flex items-center gap-3 px-4 py-3">
            <Laptop className="size-4 text-text-subtle" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-label text-text">
                {d.name}{' '}
                {d.current ? (
                  <Badge tone="success" className="ml-1">
                    This device
                  </Badge>
                ) : null}
              </span>
              <span className="block truncate text-meta text-text-subtle">
                {names.get(d.userId) ?? 'Member'} · {d.platform} · seen{' '}
                {relativeShort(d.lastSeenAt)}
              </span>
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={d.current}
              onClick={async () => {
                try {
                  await api.revoke(d.sessionId);
                  await load();
                } catch (e) {
                  setError(errorText(e));
                }
              }}
            >
              Sign out
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- audit log ----------

function AuditRow({ e, compact }: { e: AuditEntry; compact?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const details = Object.entries(e.metadata).filter(([, v]) => v !== null && v !== undefined);
  return (
    <li className="py-2.5">
      <button
        className="flex w-full items-start gap-3 text-left"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="w-36 shrink-0 text-meta tabular-nums text-text-subtle">{when(e.at)}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-label text-text">
            {e.label}
            {e.target?.name ? <span className="text-text-muted"> · {e.target.name}</span> : null}
          </span>
          <span className="block truncate text-meta text-text-subtle">
            {e.actor?.name ?? 'System'}
            {e.ip ? ` · ${e.ip}` : ''}
          </span>
        </span>
        {!compact ? <Badge>{CATEGORY_LABEL[e.category]}</Badge> : null}
      </button>
      {open ? (
        <dl className="ml-[9.75rem] mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md bg-surface-sunken p-3 text-meta">
          <dt className="text-text-subtle">Action</dt>
          <dd className="font-mono text-text">{e.action}</dd>
          {e.target ? (
            <>
              <dt className="text-text-subtle">Target</dt>
              <dd className="break-all font-mono text-text">
                {e.target.type} {e.target.id}
              </dd>
            </>
          ) : null}
          {e.userAgent ? (
            <>
              <dt className="text-text-subtle">Device</dt>
              <dd className="break-all text-text">{e.userAgent}</dd>
            </>
          ) : null}
          {details.map(([k, v]) => (
            <React.Fragment key={k}>
              <dt className="text-text-subtle">{k}</dt>
              <dd className="break-all font-mono text-text">
                {typeof v === 'string' ? v : JSON.stringify(v)}
              </dd>
            </React.Fragment>
          ))}
        </dl>
      ) : null}
    </li>
  );
}

function AuditTab({ actorId, onClearActor }: { actorId: string | null; onClearActor: () => void }) {
  const api = useAdminApi();
  const [category, setCategory] = React.useState<AuditCategory | ''>('');
  const [text, setText] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [items, setItems] = React.useState<AuditEntry[] | null>(null);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<'more' | 'export' | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const params = React.useCallback(() => {
    const q = new URLSearchParams();
    if (category) q.set('category', category);
    if (text.trim()) q.set('q', text.trim());
    if (actorId) q.set('actorId', actorId);
    if (from) q.set('from', new Date(`${from}T00:00:00`).toISOString());
    if (to) q.set('to', new Date(`${to}T23:59:59`).toISOString());
    return q;
  }, [category, text, actorId, from, to]);

  React.useEffect(() => {
    const t = setTimeout(() => {
      setError(null);
      api.audit(params()).then(
        (p) => {
          setItems(p.items);
          setCursor(p.nextCursor);
        },
        (e) => setError(errorText(e)),
      );
    }, 250);
    return () => clearTimeout(t);
  }, [api, params]);

  return (
    <div className="grid gap-4" data-testid="audit-log">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-subtle" />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search actions, IPs, ids"
            aria-label="Search the audit log"
            className="pl-9"
          />
        </div>
        <select
          aria-label="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value as AuditCategory | '')}
          className="h-10 rounded-md border border-border bg-surface-sunken px-3 text-label text-text"
        >
          <option value="">All events</option>
          {AUDIT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <Input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          aria-label="From"
          className="w-40"
        />
        <Input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          aria-label="To"
          className="w-40"
        />
        <Button
          variant="secondary"
          loading={busy === 'export'}
          onClick={async () => {
            setBusy('export');
            try {
              await api.exportAudit(params());
            } catch (e) {
              setError(errorText(e));
            } finally {
              setBusy(null);
            }
          }}
        >
          <Download /> Export CSV
        </Button>
      </div>
      {actorId ? (
        <p className="flex items-center gap-2 text-meta text-text-muted">
          Showing one person’s activity.
          <button className="text-accent hover:underline" onClick={onClearActor}>
            Show everyone
          </button>
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-label font-normal text-danger">
          {error}
        </p>
      ) : null}
      {!items ? (
        <StateView state="loading" title="Loading the audit log" />
      ) : items.length === 0 ? (
        <StateView state="empty" title="No matching events" />
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface px-4">
          {items.map((e) => (
            <AuditRow key={e.id} e={e} />
          ))}
        </ul>
      )}
      {cursor ? (
        <Button
          variant="ghost"
          loading={busy === 'more'}
          onClick={async () => {
            setBusy('more');
            try {
              const q = params();
              q.set('before', cursor);
              const p = await api.audit(q);
              setItems((cur) => [...(cur ?? []), ...p.items]);
              setCursor(p.nextCursor);
            } catch (e) {
              setError(errorText(e));
            } finally {
              setBusy(null);
            }
          }}
        >
          Load older events
        </Button>
      ) : null}
      <p className="text-meta text-text-subtle">
        The audit log can’t be edited or deleted from the app. Exports are recorded too.
      </p>
    </div>
  );
}
