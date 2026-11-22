'use client';
import * as React from 'react';
import { Download, KeyRound, Lock, RotateCcw, Search, ShieldCheck } from 'lucide-react';
import {
  AUDIT_CATEGORIES,
  TENANT_PERMISSIONS,
  TENANT_PERMISSION_INFO,
  TENANT_ROLES,
  platformCan,
  type ActivityRetention,
  type AuditCategory,
  type PlatformActivityEntry,
  type PlatformMe,
  type PlatformOrgPermissions,
  type PlatformPermissionDefaults,
  type TenantPermission,
  type TenantPermissionPolicy,
  type TenantRole,
} from '@sampledge/contracts';
import { Badge, Button, Input, StateView, cn, useToast } from '@sampledge/ui';
import { errorText, usePlatformApi, usePlatformChange } from './api';
import { when } from './console';

const ROLE_LABEL: Record<TenantRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  guest: 'Guest',
};

const GROUPS = [...new Set(TENANT_PERMISSIONS.map((p) => TENANT_PERMISSION_INFO[p].group))];

const samePolicy = (a: TenantPermissionPolicy, b: TenantPermissionPolicy) =>
  TENANT_ROLES.every((r) => a[r].length === b[r].length && a[r].every((p) => b[r].includes(p)));

/** Rows are permissions, columns are roles. Cells differing from `base` are marked. */
export function PermissionMatrix({
  value,
  onChange,
  base,
  disabled,
}: {
  value: TenantPermissionPolicy;
  onChange?: (v: TenantPermissionPolicy) => void;
  base?: TenantPermissionPolicy;
  disabled?: boolean;
}) {
  const toggle = (r: TenantRole, p: TenantPermission, on: boolean) =>
    onChange?.({
      ...value,
      [r]: on
        ? TENANT_PERMISSIONS.filter((x) => x === p || value[r].includes(x))
        : value[r].filter((x) => x !== p),
    });
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-[620px] text-left text-meta" data-testid="permission-matrix">
        <thead className="sticky top-0 bg-surface text-text-subtle">
          <tr>
            <th className="px-5 py-3 font-medium">What people may do</th>
            {TENANT_ROLES.map((r) => (
              <th key={r} className="w-24 px-3 py-3 text-center font-medium">
                {ROLE_LABEL[r]}
              </th>
            ))}
          </tr>
        </thead>
        {GROUPS.map((g) => (
          <tbody key={g} className="border-t border-border">
            <tr>
              <th
                colSpan={5}
                className="px-5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-text-subtle"
              >
                {g}
              </th>
            </tr>
            {TENANT_PERMISSIONS.filter((p) => TENANT_PERMISSION_INFO[p].group === g).map((p) => (
              <tr key={p} className="hover:bg-surface-raised/40">
                <td className="px-5 py-1.5 text-text">{TENANT_PERMISSION_INFO[p].label}</td>
                {TENANT_ROLES.map((r) => {
                  const on = value[r].includes(p);
                  const changed = base ? on !== base[r].includes(p) : false;
                  return (
                    <td key={r} className="px-3 py-1.5 text-center">
                      <label
                        className={cn(
                          'inline-flex size-7 items-center justify-center rounded-md',
                          changed && 'bg-warning/15 ring-1 ring-warning/50',
                        )}
                      >
                        <input
                          type="checkbox"
                          className="size-4 accent-[var(--sc-color-accent)]"
                          checked={on}
                          disabled={disabled || !onChange}
                          onChange={(e) => toggle(r, p, e.target.checked)}
                          aria-label={`${ROLE_LABEL[r]}: ${TENANT_PERMISSION_INFO[p].label}`}
                        />
                      </label>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

/** The default for every organization that has no rules of its own. */
export function PermissionsTab({ me, online }: { me: PlatformMe; online: boolean }) {
  const api = usePlatformApi();
  const { toast } = useToast();
  const [d, setD] = React.useState<PlatformPermissionDefaults | null>(null);
  const [draft, setDraft] = React.useState<TenantPermissionPolicy | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const canEdit = platformCan(me.role, 'permissions.manage');
  const load = React.useCallback(() => {
    api
      .permissions()
      .then((x) => {
        setD(x);
        setDraft(x.policy);
        setError(null);
      })
      .catch((e) => setError(errorText(e)));
  }, [api]);
  React.useEffect(load, [load]);
  usePlatformChange(['permissions'], (t) => (t ? undefined : load()));

  const save = async (policy: TenantPermissionPolicy | null) => {
    setBusy(true);
    try {
      const x = await api.setPermissions(policy);
      setD(x);
      setDraft(x.policy);
      toast({
        title: 'Saved. It applies in every organization within 30 seconds.',
        tone: 'success',
      });
    } catch (e) {
      toast({ title: 'That didn’t work', description: errorText(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  if (!d || !draft)
    return error ? (
      <StateView state="error" description={error} />
    ) : (
      <StateView state="loading" title="Loading permissions" />
    );
  const dirty = !samePolicy(draft, d.policy);
  return (
    <div className="flex flex-col gap-4" data-testid="platform-permissions">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-[260px] flex-1">
          <h2 className="text-h3 text-text">What people may do</h2>
          <p className="mt-1 text-meta text-text-muted">
            The default for every organization. Organization owners can’t change it; you can give
            one organization its own rules from its page. {d.customOrganizations} organization
            {d.customOrganizations === 1 ? ' has' : 's have'} their own rules.
          </p>
        </div>
        <Badge tone={d.customized ? 'warning' : 'neutral'}>
          {d.customized ? 'Changed from SampConnect’s standard' : 'SampConnect’s standard'}
        </Badge>
      </div>
      {!canEdit ? (
        <p className="flex items-center gap-2 text-meta text-text-muted">
          <Lock className="size-4" /> Only super admins change permissions.
        </p>
      ) : null}
      <PermissionMatrix
        value={draft}
        base={d.builtIn}
        onChange={canEdit ? setDraft : undefined}
        disabled={!online || busy}
      />
      {canEdit ? (
        <div className="flex flex-wrap justify-end gap-2">
          {d.customized ? (
            <Button variant="ghost" disabled={!online || busy} onClick={() => void save(null)}>
              <RotateCcw /> Back to SampConnect’s standard
            </Button>
          ) : null}
          <Button variant="secondary" disabled={!dirty || busy} onClick={() => setDraft(d.policy)}>
            Undo changes
          </Button>
          <Button disabled={!online || !dirty || busy} onClick={() => void save(draft)}>
            <ShieldCheck /> Save for every organization
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** One organization: follow the default, or its own rules. */
export function OrgPermissions({
  id,
  me,
  online,
}: {
  id: string;
  me: PlatformMe;
  online: boolean;
}) {
  const api = usePlatformApi();
  const { toast } = useToast();
  const [d, setD] = React.useState<PlatformOrgPermissions | null>(null);
  const [own, setOwn] = React.useState(false);
  const [draft, setDraft] = React.useState<TenantPermissionPolicy | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const canEdit = platformCan(me.role, 'permissions.manage');
  const load = React.useCallback(() => {
    api
      .orgPermissions(id)
      .then((x) => {
        setD(x);
        setOwn(!x.inherits);
        setDraft(x.policy);
        setError(null);
      })
      .catch((e) => setError(errorText(e)));
  }, [api, id]);
  React.useEffect(load, [load]);
  usePlatformChange(['permissions'], (t) => (!t || t === id ? load() : undefined));

  if (!d || !draft)
    return error ? (
      <StateView state="error" description={error} />
    ) : (
      <StateView state="loading" title="Loading permissions" />
    );
  const dirty = own !== !d.inherits || (own && !samePolicy(draft, d.policy));
  const save = async () => {
    setBusy(true);
    try {
      const x = await api.setOrgPermissions(id, own ? draft : null);
      setD(x);
      setDraft(x.policy);
      setOwn(!x.inherits);
      toast({
        title: own
          ? 'Saved. People in it see the change within 30 seconds.'
          : 'Back to the default.',
        tone: 'success',
      });
    } catch (e) {
      toast({ title: 'That didn’t work', description: errorText(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-4" data-testid="org-permissions">
      <div
        role="radiogroup"
        aria-label="Rules for this organization"
        className="flex w-fit gap-1 rounded-md border border-border bg-surface p-0.5"
      >
        {[false, true].map((v) => (
          <button
            key={String(v)}
            role="radio"
            aria-checked={own === v}
            disabled={!canEdit || !online}
            onClick={() => {
              setOwn(v);
              if (!v) setDraft(d.platformDefault);
            }}
            className={cn(
              'h-8 rounded-sm px-3 text-label disabled:opacity-60',
              own === v ? 'bg-surface-raised text-text shadow-sm' : 'text-text-muted',
            )}
          >
            {v ? 'Its own rules' : 'Use the default for every organization'}
          </button>
        ))}
      </div>
      <p className="text-meta text-text-muted">
        {own
          ? 'Highlighted boxes differ from the default. The organization’s owners can’t change these.'
          : 'This organization follows the default set in Super admin → Permissions.'}
      </p>
      <PermissionMatrix
        value={own ? draft : d.platformDefault}
        base={d.platformDefault}
        onChange={own && canEdit ? setDraft : undefined}
        disabled={!online || busy}
      />
      {canEdit ? (
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            disabled={!dirty || busy}
            onClick={() => {
              setOwn(!d.inherits);
              setDraft(d.policy);
            }}
          >
            Undo changes
          </Button>
          <Button disabled={!online || !dirty || busy} onClick={() => void save()}>
            <ShieldCheck /> Save for this organization
          </Button>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-meta text-text-muted">
          <Lock className="size-4" /> Only super admins change permissions.
        </p>
      )}
    </div>
  );
}

// ─── activity ───────────────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<AuditCategory, string> = {
  'sign-in': 'Sign-ins',
  members: 'People',
  security: 'Passwords & security',
  conversations: 'Conversations',
  integrations: 'Integrations',
  billing: 'Billing',
  organization: 'Organization',
  other: 'Other',
};

const RETENTION: { days: number | null; label: string }[] = [
  { days: null, label: 'Forever' },
  { days: 1825, label: '5 years' },
  { days: 730, label: '2 years' },
  { days: 365, label: '1 year' },
  { days: 180, label: '6 months' },
  { days: 90, label: '90 days' },
];

const isPassword = (a: string) => a.startsWith('auth.password');

/**
 * Everything every organization's people and admins do, in one place: sign-ins, password
 * changes and resets, member and role changes, devices, exports, integrations, billing.
 * Never message contents or passwords. Updates live.
 */
export function ActivityTab({
  me,
  online,
  tenantId,
  onOpenOrg,
}: {
  me: PlatformMe;
  online: boolean;
  /** Only this organization (on an organization's page). */
  tenantId?: string;
  onOpenOrg?: (tenantId: string) => void;
}) {
  const api = usePlatformApi();
  const { toast } = useToast();
  const [category, setCategory] = React.useState<AuditCategory | null>(null);
  const [q, setQ] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [items, setItems] = React.useState<PlatformActivityEntry[] | null>(null);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState<string | null>(null);
  const [retention, setRetention] = React.useState<ActivityRetention | null>(null);
  const gen = React.useRef(0);
  const query = React.useMemo(
    () => ({
      category: category ?? undefined,
      q: q.trim() || undefined,
      from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
      tenantId,
    }),
    [category, q, from, tenantId],
  );
  const load = React.useCallback(
    (before?: string) => {
      const mine = before ? gen.current : ++gen.current;
      api
        .activity({ ...query, before, limit: 50 })
        .then((p) => {
          if (mine !== gen.current) return;
          setItems((xs) => (before ? [...(xs ?? []), ...p.items] : p.items));
          setCursor(p.nextCursor);
          setError(null);
        })
        .catch((e) => setError(errorText(e)));
    },
    [api, query],
  );
  React.useEffect(() => {
    const t = setTimeout(() => load(), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);
  React.useEffect(() => {
    if (!tenantId)
      api
        .retention()
        .then(setRetention)
        .catch(() => undefined);
  }, [api, tenantId]);
  usePlatformChange(['activity'], () => load());

  const setKeep = async (days: number | null) => {
    try {
      setRetention(await api.setRetention(days));
      toast({ title: 'Saved', tone: 'success' });
    } catch (e) {
      toast({ title: 'That didn’t work', description: errorText(e), tone: 'danger' });
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="platform-activity">
      {!tenantId ? (
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-[260px] flex-1">
            <h2 className="text-h3 text-text">Activity in every organization</h2>
            <p className="mt-1 text-meta text-text-muted">
              Sign-ins, password changes and resets, people and role changes, devices, exports,
              integrations and billing, from every organization. Message contents and passwords are
              never recorded.
            </p>
          </div>
          {retention ? (
            <label className="flex items-center gap-2 text-meta text-text-muted">
              Keep for
              <select
                className="h-8 rounded-md border border-border bg-surface px-2 text-label text-text"
                value={retention.days ?? ''}
                disabled={!online || !platformCan(me.role, 'permissions.manage')}
                onChange={(e) => void setKeep(e.target.value ? Number(e.target.value) : null)}
                aria-label="Keep activity for"
              >
                {RETENTION.map((r) => (
                  <option key={r.label} value={r.days ?? ''}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[220px] flex-1">
          <span className="sr-only">Search activity</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-subtle" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search actions, IP addresses or ids"
            className="pl-9"
          />
        </label>
        <label className="flex items-center gap-2 text-meta text-text-muted">
          Since
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-40"
            aria-label="Since"
          />
        </label>
        <Button
          variant="secondary"
          disabled={!online}
          onClick={() =>
            void api
              .exportActivity(query)
              .catch((e) =>
                toast({ title: 'Export failed', description: errorText(e), tone: 'danger' }),
              )
          }
        >
          <Download /> Export CSV
        </Button>
      </div>
      <div className="flex flex-wrap gap-1">
        {[null, ...AUDIT_CATEGORIES].map((c) => (
          <button
            key={c ?? 'all'}
            aria-pressed={category === c}
            onClick={() => setCategory(c)}
            className={cn(
              'h-8 rounded-full border px-3 text-meta',
              category === c
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-border text-text-muted hover:text-text',
            )}
          >
            {c ? CATEGORY_LABEL[c] : 'Everything'}
          </button>
        ))}
      </div>
      {!items ? (
        error ? (
          <StateView state="error" description={error} />
        ) : (
          <StateView state="loading" title="Loading activity" />
        )
      ) : items.length === 0 ? (
        <StateView state="empty" title="Nothing matches" />
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {items.map((e) => (
            <li key={e.id}>
              <button
                onClick={() => setOpen(open === e.id ? null : e.id)}
                aria-expanded={open === e.id}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-surface-raised/50"
              >
                {isPassword(e.action) ? (
                  <KeyRound className="size-4 shrink-0 text-warning" aria-hidden />
                ) : null}
                <span className="min-w-[220px] flex-1">
                  <span className="block text-label text-text">
                    {e.label}
                    {e.target?.type === 'user' &&
                    e.target.name &&
                    e.target.id !== e.actor?.userId ? (
                      <span className="text-text-muted"> · {e.target.name}</span>
                    ) : null}
                  </span>
                  <span className="block text-meta text-text-subtle">
                    {e.actor?.name ??
                      (typeof e.metadata.by === 'string' ? e.metadata.by : 'Someone not signed in')}
                    {e.ip ? ` · ${e.ip}` : ''}
                  </span>
                </span>
                {!tenantId ? (
                  <span
                    role="link"
                    tabIndex={0}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onOpenOrg?.(e.org.tenantId);
                    }}
                    onKeyDown={(ev) => ev.key === 'Enter' && onOpenOrg?.(e.org.tenantId)}
                    className="text-meta text-accent hover:underline"
                  >
                    {e.org.name}
                  </span>
                ) : null}
                <Badge tone={e.category === 'security' ? 'warning' : 'neutral'}>
                  {CATEGORY_LABEL[e.category]}
                </Badge>
                <span className="w-40 text-right text-meta text-text-muted">{when(e.at)}</span>
              </button>
              {open === e.id ? (
                <dl className="mx-4 mb-3 grid gap-x-4 gap-y-1 rounded-md bg-surface-sunken p-3 text-meta sm:grid-cols-[140px_1fr]">
                  <dt className="text-text-subtle">Device</dt>
                  <dd className="break-all text-text-muted">{e.userAgent ?? '—'}</dd>
                  <dt className="text-text-subtle">IP address</dt>
                  <dd className="text-text-muted">{e.ip ?? '—'}</dd>
                  <dt className="text-text-subtle">Details</dt>
                  <dd className="break-all font-mono text-text-muted">
                    {JSON.stringify(e.metadata)}
                  </dd>
                </dl>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {cursor ? (
        <Button variant="secondary" className="self-center" onClick={() => load(cursor)}>
          Load more
        </Button>
      ) : null}
    </div>
  );
}
