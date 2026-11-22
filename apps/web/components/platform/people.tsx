'use client';
import * as React from 'react';
import { Search, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import {
  PLATFORM_AUDIT_AREAS,
  PLATFORM_ROLES,
  PLATFORM_ROLE_INFO,
  platformCan,
  type PlatformAccount,
  type PlatformAdmin,
  type PlatformAuditArea,
  type PlatformAuditEntry,
  type PlatformMe,
  type PlatformRole,
} from '@sampledge/contracts';
import {
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
import { errorText, usePlatformApi, usePlatformChange } from './api';
import { day, when } from './console';

// ─── platform admins ────────────────────────────────────────────────────────

export function AdminsTab({ me, online }: { me: PlatformMe; online: boolean }) {
  const api = usePlatformApi();
  const { toast } = useToast();
  const [rows, setRows] = React.useState<PlatformAdmin[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const manage = platformCan(me.role, 'admins.manage') && online;
  const load = React.useCallback(() => {
    api
      .admins()
      .then((r) => {
        setRows(r);
        setError(null);
      })
      .catch((e) => setError(errorText(e)));
  }, [api]);
  React.useEffect(load, [load]);
  usePlatformChange(['admins'], () => load());

  const run = async (f: () => Promise<unknown>, done: string) => {
    try {
      await f();
      toast({ title: done, tone: 'success' });
      load();
    } catch (e) {
      toast({ title: 'That didn’t work', description: errorText(e), tone: 'danger' });
    }
  };

  return (
    <div className="flex flex-col gap-5" data-testid="platform-admins">
      <div className="flex flex-wrap items-start gap-3">
        <p className="min-w-0 flex-1 text-meta text-text-muted">
          People who run SampConnect itself. Each is a work account in an organization, with one
          role. There is always at least one super admin.
        </p>
        {manage ? (
          <Button onClick={() => setAdding(true)}>
            <UserPlus /> Add platform admin
          </Button>
        ) : null}
      </div>
      {!rows ? (
        error ? (
          <StateView state="error" description={error} />
        ) : (
          <StateView state="loading" title="Loading platform admins" />
        )
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {rows.map((a) => (
            <li key={a.adminId} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-[200px] flex-1">
                <span className="flex items-center gap-2 text-label text-text">
                  {a.name}
                  {a.you ? <Badge>You</Badge> : null}
                  {a.twoStep ? (
                    <ShieldCheck className="size-4 text-success" aria-label="Two-step sign-in on" />
                  ) : (
                    <Badge tone="warning">No two-step sign-in</Badge>
                  )}
                </span>
                <span className="block text-meta text-text-subtle">
                  {a.email} · {a.orgName} · added {day(a.addedAt)}
                  {a.bootstrap
                    ? ' from server settings'
                    : a.addedByName
                      ? ` by ${a.addedByName}`
                      : ''}
                </span>
              </span>
              {manage ? (
                <select
                  aria-label={`Role for ${a.name}`}
                  value={a.role}
                  onChange={(e) =>
                    run(
                      () => api.setRole(a.adminId, e.target.value as PlatformRole),
                      `${a.name} is now ${PLATFORM_ROLE_INFO[e.target.value as PlatformRole].label}`,
                    )
                  }
                  className="h-8 rounded-md border border-border bg-surface-sunken px-2 text-meta text-text"
                >
                  {PLATFORM_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {PLATFORM_ROLE_INFO[r].label}
                    </option>
                  ))}
                </select>
              ) : (
                <Badge tone={a.role === 'owner' ? 'accent' : 'neutral'}>
                  {PLATFORM_ROLE_INFO[a.role].label}
                </Badge>
              )}
              {manage ? (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove ${a.name}`}
                  onClick={() =>
                    run(() => api.removeAdmin(a.adminId), `${a.name} is no longer a platform admin`)
                  }
                >
                  <Trash2 />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <section className="rounded-xl border border-border bg-surface p-5">
        <h3 className="text-label text-text">Roles</h3>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          {PLATFORM_ROLES.map((r) => (
            <div key={r}>
              <dt className="text-label text-text">{PLATFORM_ROLE_INFO[r].label}</dt>
              <dd className="text-meta text-text-muted">{PLATFORM_ROLE_INFO[r].description}</dd>
            </div>
          ))}
        </dl>
      </section>
      <AddAdminDialog
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={() => (setAdding(false), load())}
      />
    </div>
  );
}

function AddAdminDialog({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const api = usePlatformApi();
  const { toast } = useToast();
  const [q, setQ] = React.useState('');
  const [found, setFound] = React.useState<PlatformAccount[]>([]);
  const [pick, setPick] = React.useState<PlatformAccount | null>(null);
  const [role, setRole] = React.useState<PlatformRole>('support');
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    setQ('');
    setFound([]);
    setPick(null);
    setRole('support');
  }, [open]);
  React.useEffect(() => {
    if (q.trim().length < 2) return setFound([]);
    const t = setTimeout(
      () =>
        void api
          .accounts(q)
          .then(setFound)
          .catch(() => setFound([])),
      250,
    );
    return () => clearTimeout(t);
  }, [api, q]);
  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent
        title="Add a platform admin"
        description="Find their work account by email or name, in any organization."
      >
        <div className="flex flex-col gap-4">
          <label className="relative block">
            <span className="sr-only">Search accounts</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-subtle" />
            <Input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="name@company.com"
              className="pl-9"
            />
          </label>
          <ul className="max-h-56 overflow-y-auto rounded-md border border-border">
            {found.length === 0 ? (
              <li className="px-3 py-3 text-meta text-text-subtle">
                {q.trim().length < 2 ? 'Type at least two characters.' : 'No matching accounts.'}
              </li>
            ) : (
              found.map((a) => (
                <li key={`${a.tenantId}:${a.userId}`}>
                  <button
                    onClick={() => setPick(a)}
                    aria-pressed={pick?.userId === a.userId && pick.tenantId === a.tenantId}
                    className={cn(
                      'flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-raised',
                      pick?.userId === a.userId && pick.tenantId === a.tenantId && 'bg-accent-soft',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-label text-text">{a.name}</span>
                      <span className="block truncate text-meta text-text-subtle">
                        {a.email} · {a.orgName}
                      </span>
                    </span>
                    {a.role ? <Badge>{PLATFORM_ROLE_INFO[a.role].label}</Badge> : null}
                  </button>
                </li>
              ))
            )}
          </ul>
          <Field label="Role" htmlFor="aa-role" hint={PLATFORM_ROLE_INFO[role].description}>
            <select
              id="aa-role"
              value={role}
              onChange={(e) => setRole(e.target.value as PlatformRole)}
              className="h-10 w-full rounded-md border border-border bg-surface-sunken px-3 text-label text-text"
            >
              {PLATFORM_ROLES.map((r) => (
                <option key={r} value={r}>
                  {PLATFORM_ROLE_INFO[r].label}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={!pick}
              loading={busy}
              onClick={async () => {
                if (!pick) return;
                setBusy(true);
                try {
                  await api.addAdmin({ tenantId: pick.tenantId, userId: pick.userId, role });
                  toast({
                    title: `${pick.name} is now ${PLATFORM_ROLE_INFO[role].label}`,
                    tone: 'success',
                  });
                  onAdded();
                } catch (e) {
                  toast({ title: 'Couldn’t add them', description: errorText(e), tone: 'danger' });
                } finally {
                  setBusy(false);
                }
              }}
            >
              Add
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── audit log ──────────────────────────────────────────────────────────────

const AREA_LABEL: Record<PlatformAuditArea, string> = {
  organizations: 'Organizations',
  billing: 'Billing',
  moderation: 'Moderation',
  admins: 'Platform admins',
  integrations: 'Integrations',
  support: 'Support',
  permissions: 'Permissions',
  activity: 'Activity',
};

export function AuditTab({ onOpenOrg }: { onOpenOrg: (tenantId: string) => void }) {
  const api = usePlatformApi();
  const [area, setArea] = React.useState<PlatformAuditArea | null>(null);
  const [q, setQ] = React.useState('');
  const [items, setItems] = React.useState<PlatformAuditEntry[] | null>(null);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState<string | null>(null);
  const gen = React.useRef(0);
  const load = React.useCallback(
    (before?: string) => {
      const mine = before ? gen.current : ++gen.current;
      api
        .audit({ area: area ?? undefined, q: q.trim() || undefined, before, limit: 50 })
        .then((p) => {
          if (mine !== gen.current) return;
          setItems((xs) => (before ? [...(xs ?? []), ...p.items] : p.items));
          setCursor(p.nextCursor);
          setError(null);
        })
        .catch((e) => setError(errorText(e)));
    },
    [api, area, q],
  );
  React.useEffect(() => {
    const t = setTimeout(() => load(), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);
  usePlatformChange(['audit'], () => load());

  return (
    <div className="flex flex-col gap-4" data-testid="platform-audit">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[220px] flex-1">
          <span className="sr-only">Search the audit log</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-subtle" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by person, organization or action"
            className="pl-9"
          />
        </label>
        <div className="flex flex-wrap gap-1">
          {[null, ...PLATFORM_AUDIT_AREAS].map((a) => (
            <button
              key={a ?? 'all'}
              aria-pressed={area === a}
              onClick={() => setArea(a)}
              className={cn(
                'h-8 rounded-full border px-3 text-meta',
                area === a
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-border text-text-muted hover:text-text',
              )}
            >
              {a ? AREA_LABEL[a] : 'Everything'}
            </button>
          ))}
        </div>
      </div>
      {!items ? (
        error ? (
          <StateView state="error" description={error} />
        ) : (
          <StateView state="loading" title="Loading the audit log" />
        )
      ) : items.length === 0 ? (
        <StateView state="empty" title="Nothing recorded yet" />
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
          {items.map((e) => (
            <li key={e.id}>
              <button
                onClick={() => setOpen(open === e.id ? null : e.id)}
                aria-expanded={open === e.id}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-surface-raised/50"
              >
                <span className="min-w-[220px] flex-1">
                  <span className="block text-label text-text">
                    {e.label}
                    {e.target && e.target.type !== 'tenant' ? (
                      <span className="text-text-muted"> · {e.target.label}</span>
                    ) : null}
                  </span>
                  <span className="block text-meta text-text-subtle">
                    {e.actor ? `${e.actor.name} (${e.actor.email})` : 'SampConnect (automatic)'}
                  </span>
                </span>
                {e.org ? (
                  <span
                    role="link"
                    tabIndex={0}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onOpenOrg(e.org!.tenantId);
                    }}
                    onKeyDown={(ev) => ev.key === 'Enter' && onOpenOrg(e.org!.tenantId)}
                    className="text-meta text-accent hover:underline"
                  >
                    {e.org.name}
                  </span>
                ) : null}
                <Badge>{AREA_LABEL[e.area]}</Badge>
                <span className="w-40 text-right text-meta text-text-muted">{when(e.at)}</span>
              </button>
              {open === e.id ? (
                <pre className="mx-4 mb-3 overflow-x-auto rounded-md bg-surface-sunken p-3 text-meta text-text-muted">
                  {JSON.stringify({ ...e.metadata, ...(e.ip ? { ip: e.ip } : {}) }, null, 2)}
                </pre>
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
