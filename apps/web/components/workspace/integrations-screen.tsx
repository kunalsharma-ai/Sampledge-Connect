'use client';
import * as React from 'react';
import {
  ArrowLeft,
  CircleCheck,
  CircleX,
  KeyRound,
  Lock,
  Plug,
  RotateCcw,
  Search,
  Zap,
} from 'lucide-react';
import {
  INTEGRATION_CATEGORIES,
  INTEGRATION_CATEGORY_LABELS,
  type IntegrationFieldDef,
  type IntegrationTestResult,
  type IntegrationView,
} from '@sampledge/contracts';
import { Badge, Button, Field, Input, StateView, cn, useToast } from '@sampledge/ui';
import { ApiFailure, apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { SampledgeModulePanel } from './sampledge-module-panel';
import { useTenantChange } from '@/lib/engine';

type Draft = Record<string, string | number | boolean | null>;
/** Secret edits: a string replaces, null clears, absent keeps what is stored. */
type SecretEdits = Record<string, string | null>;

const SOURCE_LABEL = {
  tenant: 'Your organization',
  platform: 'Platform default',
  env: 'Server environment',
} as const;

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
function ago(iso: string) {
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  if (Math.abs(s) < 60) return relative.format(Math.round(s), 'second');
  if (Math.abs(s) < 3600) return relative.format(Math.round(s / 60), 'minute');
  if (Math.abs(s) < 86400) return relative.format(Math.round(s / 3600), 'hour');
  return relative.format(Math.round(s / 86400), 'day');
}

/** `base` is the organization's settings, or `/v1/platform/integrations` for platform operators. */
export function useIntegrationsApi(base = '/v1/admin/integrations') {
  const { getAccessToken } = useAuth();
  return React.useMemo(() => {
    const req = async <T,>(method: string, path: string, body?: unknown) =>
      apiRequest<T>(method, path, { token: await getAccessToken(), body });
    return {
      list: () => req<IntegrationView[]>('GET', base),
      save: (id: string, enabled: boolean, values: Draft) =>
        req<IntegrationView>('PUT', `${base}/${encodeURIComponent(id)}`, { enabled, values }),
      test: (id: string, values?: Draft) =>
        req<IntegrationTestResult>('POST', `${base}/${encodeURIComponent(id)}/test`, { values }),
      reset: (id: string) => req<IntegrationView>('DELETE', `${base}/${encodeURIComponent(id)}`),
    };
  }, [getAccessToken]);
}

export function StatusBadge({ view }: { view: IntegrationView }) {
  if (view.provider.planned) return <Badge tone="planned">Planned</Badge>;
  if (!view.source) return <Badge tone="neutral">Not connected</Badge>;
  if (!view.enabled) return <Badge tone="neutral">Off</Badge>;
  if (view.lastTest && !view.lastTest.ok) return <Badge tone="danger">Check failed</Badge>;
  if (view.lastTest?.ok) return <Badge tone="success">Connected</Badge>;
  return <Badge tone="accent">On · not tested</Badge>;
}

/** Administration → Integrations. Every third-party connection is configured here, not in env. */
export function IntegrationsScreen({ online }: { online: boolean }) {
  const api = useIntegrationsApi();
  const [views, setViews] = React.useState<IntegrationView[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState('');

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const v = await api.list();
      setViews(v);
      setSelected((cur) => cur ?? (window.innerWidth >= 1024 ? (v[0]?.provider.id ?? null) : null));
    } catch (e) {
      setError(e instanceof ApiFailure && e.status === 403 ? 'forbidden' : (e as Error).message);
    }
  }, [api]);
  React.useEffect(() => {
    void load();
  }, [load]);
  useTenantChange('integrations', () => void load());

  const replace = (v: IntegrationView) =>
    setViews((cur) => cur?.map((x) => (x.provider.id === v.provider.id ? v : x)) ?? cur);

  const filtered = (views ?? []).filter((v) => {
    const q = query.trim().toLowerCase();
    return !q || `${v.provider.label} ${v.provider.description}`.toLowerCase().includes(q);
  });
  const current = views?.find((v) => v.provider.id === selected) ?? null;

  if (error === 'forbidden')
    return (
      <main className="flex flex-1 items-center justify-center pb-16 md:pb-0">
        <StateView
          state="permission-denied"
          description="Only organization owners and admins can manage integrations."
        />
      </main>
    );

  return (
    <main className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0" data-testid="integrations-screen">
      <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-border bg-surface/40 px-4 backdrop-blur-xl sm:px-6">
        <Plug className="size-5 text-accent" aria-hidden />
        <h1 className="font-display text-h3 text-text">Integrations</h1>
        <p className="hidden text-meta text-text-subtle md:block">
          Connect services here. Settings are stored encrypted in your workspace database and apply
          immediately, with no server restart.
        </p>
      </header>

      {!views && !error ? (
        <StateView state="loading" className="flex-1" />
      ) : error ? (
        <StateView
          state={online ? 'error' : 'offline'}
          description={error}
          className="flex-1"
          action={
            <Button variant="secondary" onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      ) : (
        <div className="flex min-h-0 flex-1">
          <nav
            aria-label="Integrations"
            className={cn(
              'min-h-0 w-full shrink-0 overflow-y-auto border-r border-border lg:block lg:w-[340px]',
              current ? 'hidden' : 'block',
            )}
          >
            <div className="sticky top-0 z-10 border-b border-border bg-bg/80 p-3 backdrop-blur-xl">
              <label className="relative block">
                <span className="sr-only">Search integrations</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-subtle" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search integrations"
                  className="pl-9"
                />
              </label>
            </div>
            {INTEGRATION_CATEGORIES.map((cat) => {
              const items = filtered.filter((v) => v.provider.category === cat);
              if (!items.length) return null;
              return (
                <section key={cat} aria-labelledby={`cat-${cat}`} className="px-2 py-3">
                  <h2
                    id={`cat-${cat}`}
                    className="px-2 pb-1.5 text-meta font-medium uppercase tracking-wide text-text-subtle"
                  >
                    {INTEGRATION_CATEGORY_LABELS[cat]}
                  </h2>
                  <ul className="flex flex-col gap-0.5">
                    {items.map((v) => (
                      <li key={v.provider.id}>
                        <button
                          onClick={() => setSelected(v.provider.id)}
                          aria-current={selected === v.provider.id ? 'true' : undefined}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors',
                            selected === v.provider.id
                              ? 'bg-accent-soft'
                              : 'hover:bg-surface-raised',
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-label text-text">
                              {v.provider.label}
                            </span>
                            <span className="block truncate text-meta text-text-subtle">
                              {v.source ? SOURCE_LABEL[v.source] : v.provider.description}
                            </span>
                          </span>
                          <StatusBadge view={v} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
            {!filtered.length ? <StateView state="empty" title="No matching integrations" /> : null}
          </nav>

          <section
            className={cn('min-w-0 flex-1 overflow-y-auto', current ? 'block' : 'hidden lg:block')}
          >
            {current ? (
              <IntegrationDetail
                key={current.provider.id + (current.saved?.updatedAt ?? '')}
                view={current}
                api={api}
                online={online}
                onBack={() => setSelected(null)}
                onSaved={replace}
                onReload={() => void load()}
              />
            ) : (
              <StateView state="empty" title="Choose an integration" className="h-full" />
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function initialDraft(view: IntegrationView): Draft {
  const out: Draft = {};
  for (const f of view.provider.fields) {
    if (f.type === 'secret') continue;
    out[f.key] = view.saved?.values[f.key] ?? f.default ?? (f.type === 'boolean' ? false : '');
  }
  return out;
}

export function IntegrationDetail({
  view,
  api,
  online,
  onBack,
  onSaved,
  onReload,
}: {
  view: IntegrationView;
  api: ReturnType<typeof useIntegrationsApi>;
  online: boolean;
  onBack: () => void;
  onSaved: (v: IntegrationView) => void;
  onReload: () => void;
}) {
  const { toast } = useToast();
  const p = view.provider;
  const [draft, setDraft] = React.useState<Draft>(() => initialDraft(view));
  const [secrets, setSecrets] = React.useState<SecretEdits>({});
  const [enabled, setEnabled] = React.useState(view.saved?.enabled ?? view.enabled);
  const [busy, setBusy] = React.useState<'save' | 'test' | 'reset' | null>(null);
  const [result, setResult] = React.useState<IntegrationTestResult | null>(view.lastTest);
  const [formError, setFormError] = React.useState<string | null>(null);

  // An empty "Replace" box means keep the stored secret; only real edits are sent.
  const values = (): Draft => ({
    ...draft,
    ...Object.fromEntries(Object.entries(secrets).filter(([, v]) => v !== '')),
  });
  const dirty =
    Object.values(secrets).some((v) => v !== '') ||
    enabled !== (view.saved?.enabled ?? view.enabled) ||
    JSON.stringify(draft) !== JSON.stringify(initialDraft(view));

  const run = async <T,>(kind: 'save' | 'test' | 'reset', fn: () => Promise<T>) => {
    setBusy(kind);
    setFormError(null);
    try {
      return await fn();
    } catch (e) {
      setFormError((e as Error).message);
      return null;
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    run('save', async () => {
      const v = await api.save(p.id, enabled, values());
      toast({ title: `${p.label} saved`, description: 'Applied immediately.', tone: 'success' });
      onSaved(v);
    });
  const test = () =>
    run('test', async () => {
      const r = await api.test(p.id, values());
      setResult(r);
    });
  const reset = () =>
    run('reset', async () => {
      const v = await api.reset(p.id);
      toast({ title: `${p.label} reset`, tone: 'success' });
      onSaved(v);
    });

  const inherited = !view.saved && view.source && view.source !== 'tenant';

  return (
    <div
      className="mx-auto flex max-w-2xl flex-col gap-6 p-4 sm:p-8"
      data-testid="integration-detail"
    >
      <div className="flex items-start gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          className="lg:hidden"
          onClick={onBack}
          aria-label="Back to integrations"
        >
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-h2 text-text">{p.label}</h2>
            <StatusBadge view={view} />
          </div>
          <p className="mt-1 text-label font-normal text-text-muted">{p.description}</p>
        </div>
      </div>

      {p.planned ? (
        <p className="rounded-lg border border-dashed border-border-strong p-4 text-label font-normal text-text-muted">
          This integration is planned and can’t be connected yet. Nothing here is simulated.
        </p>
      ) : (
        <>
          {inherited ? (
            <p className="flex items-start gap-2 rounded-lg border border-border bg-surface-raised p-3 text-meta text-text-muted">
              <Lock className="mt-0.5 size-4 shrink-0 text-text-subtle" />
              {view.source === 'env'
                ? 'Currently using values from the server environment. Save settings here to manage it from the admin screen instead.'
                : 'Currently using the platform default. Save settings here to override it for your organization.'}
            </p>
          ) : null}

          <label className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface p-4">
            <span>
              <span className="block text-label text-text">Enabled</span>
              <span className="block text-meta text-text-subtle">
                When off, Connect won’t use this service for your organization.
              </span>
            </span>
            <Switch checked={enabled} onChange={setEnabled} label={`Enable ${p.label}`} />
          </label>

          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            {p.fields.map((f) => (
              <FieldInput
                key={f.key}
                field={f}
                idPrefix={p.id}
                value={draft[f.key] ?? null}
                stored={view.saved?.secretsSet.includes(f.key) ?? false}
                secretEdit={secrets[f.key]}
                onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))}
                onSecret={(v) =>
                  setSecrets((s) => {
                    const next = { ...s };
                    if (v === undefined) delete next[f.key];
                    else next[f.key] = v;
                    return next;
                  })
                }
              />
            ))}

            {formError ? (
              <p role="alert" className="flex items-center gap-2 text-label text-danger">
                <CircleX className="size-4" /> {formError}
              </p>
            ) : null}

            {result ? (
              <div
                role="status"
                data-testid="test-result"
                className={cn(
                  'flex items-start gap-2 rounded-lg border p-3 text-label',
                  result.ok
                    ? 'border-success/30 bg-success/10 text-success'
                    : 'border-danger/30 bg-danger/10 text-danger',
                )}
              >
                {result.ok ? (
                  <CircleCheck className="mt-0.5 size-4" />
                ) : (
                  <CircleX className="mt-0.5 size-4" />
                )}
                <span className="min-w-0">
                  <span className="block font-medium">
                    {result.ok ? 'Connection works' : 'Connection failed'}
                  </span>
                  <span className="block break-words font-normal opacity-90">
                    {result.message}
                    {result.latencyMs !== null ? ` · ${result.latencyMs} ms` : ''} ·{' '}
                    {ago(result.testedAt)}
                  </span>
                </span>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
              <Button
                type="submit"
                loading={busy === 'save'}
                disabled={!online || !!busy || !dirty}
              >
                Save
              </Button>
              {p.testable ? (
                <Button
                  type="button"
                  variant="secondary"
                  loading={busy === 'test'}
                  disabled={!online || !!busy}
                  onClick={() => void test()}
                >
                  <Zap /> Test connection
                </Button>
              ) : null}
              {view.saved ? (
                <Button
                  type="button"
                  variant="ghost"
                  loading={busy === 'reset'}
                  disabled={!online || !!busy}
                  onClick={() => void reset()}
                  className="ml-auto"
                >
                  <RotateCcw /> Remove saved settings
                </Button>
              ) : null}
            </div>
            {view.saved ? (
              <p className="text-meta text-text-subtle">
                Last saved {ago(view.saved.updatedAt)}. Secrets are encrypted at rest and are never
                shown again after saving.
              </p>
            ) : null}
          </form>
          {p.category === 'sampledge' ? (
            <SampledgeModulePanel providerId={p.id} online={online} onSettingsChanged={onReload} />
          ) : null}
        </>
      )}
    </div>
  );
}

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        checked ? 'border-accent bg-accent' : 'border-border-strong bg-surface-raised',
      )}
    >
      <span
        className={cn(
          'inline-block size-4 rounded-full bg-text shadow transition-transform motion-reduce:transition-none',
          checked ? 'translate-x-6 bg-accent-fg' : 'translate-x-1',
        )}
      />
    </button>
  );
}

function FieldInput({
  field: f,
  idPrefix,
  value,
  stored,
  secretEdit,
  onChange,
  onSecret,
}: {
  field: IntegrationFieldDef;
  idPrefix: string;
  value: string | number | boolean | null;
  stored: boolean;
  secretEdit: string | null | undefined;
  onChange: (v: string | number | boolean | null) => void;
  onSecret: (v: string | null | undefined) => void;
}) {
  const id = `${idPrefix}-${f.key}`;
  const label = f.required ? `${f.label} *` : f.label;

  if (f.type === 'boolean')
    return (
      <label className="flex items-center justify-between gap-4">
        <span>
          <span className="block text-label text-text">{f.label}</span>
          {f.help ? <span className="block text-meta text-text-subtle">{f.help}</span> : null}
        </span>
        <Switch checked={value === true} onChange={onChange} label={f.label} />
      </label>
    );

  if (f.type === 'select')
    return (
      <Field label={label} htmlFor={id} hint={f.help}>
        <select
          id={id}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-full rounded-md border border-border bg-surface px-3 text-label text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <option value="" disabled>
            Choose…
          </option>
          {f.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
    );

  if (f.type === 'secret') {
    const editing = typeof secretEdit === 'string';
    const cleared = secretEdit === null;
    if (stored && !editing)
      return (
        <Field label={label} htmlFor={id} hint={f.help}>
          <div className="flex items-center gap-2">
            <span
              id={id}
              className={cn(
                'flex h-10 flex-1 items-center gap-2 rounded-md border border-border bg-surface-raised px-3 text-label',
                cleared ? 'text-text-subtle line-through' : 'text-text-muted',
              )}
            >
              <KeyRound className="size-4 text-text-subtle" />
              {cleared ? 'Will be removed on save' : 'Stored securely'}
            </span>
            <Button type="button" variant="secondary" size="sm" onClick={() => onSecret('')}>
              Replace
            </Button>
            {cleared ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => onSecret(undefined)}>
                Undo
              </Button>
            ) : (
              <Button type="button" variant="ghost" size="sm" onClick={() => onSecret(null)}>
                Remove
              </Button>
            )}
          </div>
        </Field>
      );
    return (
      <Field label={label} htmlFor={id} hint={f.help}>
        <div className="flex items-center gap-2">
          <Input
            id={id}
            type="password"
            autoComplete="new-password"
            placeholder={f.placeholder ?? 'Paste the secret'}
            value={secretEdit ?? ''}
            onChange={(e) =>
              onSecret(e.target.value === '' && !stored ? undefined : e.target.value)
            }
          />
          {stored ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => onSecret(undefined)}>
              Cancel
            </Button>
          ) : null}
        </div>
      </Field>
    );
  }

  return (
    <Field label={label} htmlFor={id} hint={f.help}>
      <Input
        id={id}
        type={f.type === 'number' ? 'number' : f.type === 'url' ? 'url' : 'text'}
        inputMode={f.type === 'number' ? 'numeric' : undefined}
        min={f.min}
        max={f.max}
        placeholder={f.placeholder}
        value={value === null ? '' : String(value)}
        onChange={(e) =>
          onChange(
            f.type === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value,
          )
        }
      />
    </Field>
  );
}
