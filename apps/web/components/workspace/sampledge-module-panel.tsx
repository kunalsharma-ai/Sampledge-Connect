'use client';
import * as React from 'react';
import {
  CircleAlert,
  CircleCheck,
  Copy,
  FlaskConical,
  KeyRound,
  Link2,
  RotateCcw,
  Trash2,
  Webhook,
} from 'lucide-react';
import {
  MODULE_CATALOG,
  WEBHOOK_EVENT_TYPES,
  type IdentityLink,
  type ModuleAction,
  type ModuleCredentials,
  type ModuleEventLog,
  type ModuleEventResult,
  type ModuleIntegration,
  type SampledgeModule,
  type WebhookDelivery,
  type WebhookEventType,
  type WebhookSubscription,
} from '@sampledge/contracts';
import { Badge, Button, Field, Input, cn, useToast } from '@sampledge/ui';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { relativeShort } from './helpers';
import { selectClass } from './work-ui';

function useModulesApi() {
  const { getAccessToken } = useAuth();
  return React.useMemo(() => {
    const req = async <T,>(method: string, path: string, body?: unknown) =>
      apiRequest<T>(method, `/v1/integrations${path}`, { token: await getAccessToken(), body });
    return {
      status: () => req<ModuleIntegration[]>('GET', '/modules'),
      issueKey: (m: string, generateSigningSecret: boolean) =>
        req<ModuleCredentials>('POST', `/modules/${m}/keys`, { generateSigningSecret }),
      revokeKeys: (m: string) => req<void>('DELETE', `/modules/${m}/keys`),
      testEvent: (m: string, type: string) =>
        req<ModuleEventResult>('POST', `/modules/${m}/test-event`, { type }),
      events: (m: string) => req<ModuleEventLog[]>('GET', `/modules/${m}/events?limit=50`),
      identities: (m: string) => req<IdentityLink[]>('GET', `/modules/${m}/identities`),
      link: (m: string, externalUserId: string, email: string) =>
        req<IdentityLink>('PUT', `/modules/${m}/identities`, { externalUserId, email }),
      unlink: (m: string, ext: string) =>
        req<void>('DELETE', `/modules/${m}/identities/${encodeURIComponent(ext)}`),
      actions: (m: string) => req<ModuleAction[]>('GET', `/actions?module=${m}`),
      retry: (id: string) => req<ModuleAction>('POST', `/actions/${id}/retry`),
      webhooks: () => req<WebhookSubscription[]>('GET', '/webhooks'),
      createWebhook: (b: {
        url: string;
        description: string;
        events: WebhookEventType[];
        modules: SampledgeModule[];
      }) => req<WebhookSubscription & { signingSecret: string }>('POST', '/webhooks', b),
      setWebhookActive: (id: string, active: boolean) =>
        req<WebhookSubscription>('PATCH', `/webhooks/${id}`, { active }),
      deleteWebhook: (id: string) => req<void>('DELETE', `/webhooks/${id}`),
      deliveries: (id: string) => req<WebhookDelivery[]>('GET', `/webhooks/${id}/deliveries`),
      testWebhook: (id: string) => req<unknown>('POST', `/webhooks/${id}/test`),
    };
  }, [getAccessToken]);
}
type Api = ReturnType<typeof useModulesApi>;

type Tab = 'setup' | 'activity' | 'people' | 'outbound' | 'webhooks';
const TABS: { id: Tab; label: string }[] = [
  { id: 'setup', label: 'Keys & test' },
  { id: 'activity', label: 'Event log' },
  { id: 'people', label: 'People' },
  { id: 'outbound', label: 'Sent to module' },
  { id: 'webhooks', label: 'Webhooks' },
];

/**
 * Integrations → a Sampledge module: everything beyond the stored settings (which the shared
 * form above edits): its Connect API key, test events, the event log, identity links, outbound
 * actions and webhooks. Nothing here is simulated; test mode is labelled wherever it applies.
 */
export function SampledgeModulePanel({
  providerId,
  online,
  onSettingsChanged,
}: {
  providerId: string;
  online: boolean;
  onSettingsChanged: () => void;
}) {
  const m = providerId.replace(/^sampledge\./, '') as SampledgeModule;
  const def = MODULE_CATALOG[m];
  const api = useModulesApi();
  const [status, setStatus] = React.useState<ModuleIntegration | null>(null);
  const [tab, setTab] = React.useState<Tab>('setup');
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const all = await api.status();
      setStatus(all.find((x) => x.module === m) ?? null);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api, m]);
  React.useEffect(() => {
    if (online) void load();
  }, [load, online]);
  if (!def) return null;

  return (
    <section
      className="flex flex-col gap-4 border-t border-border pt-6"
      aria-label={`${def.name} connection`}
      data-testid="sampledge-module-panel"
    >
      <div>
        <h3 className="font-display text-h3 text-text">Connection to {def.name}</h3>
        <p className="mt-1 text-meta text-text-subtle">
          {def.category}. Events from {def.name} post as cards in record channels, notify the people
          involved, and create tasks and approvals.
        </p>
      </div>

      {status ? (
        <Readiness s={status} name={def.name} />
      ) : error ? (
        <p role="alert" className="text-label text-danger">
          {error}
        </p>
      ) : null}

      <div
        role="tablist"
        aria-label={`${def.name} tools`}
        className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-surface-sunken p-1"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'h-8 shrink-0 rounded-md px-3 text-label transition-colors',
              tab === t.id
                ? 'bg-surface-raised text-text shadow-sm'
                : 'text-text-muted hover:text-text',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'setup' ? (
        <SetupTab
          m={m}
          api={api}
          status={status}
          online={online}
          onChanged={() => void load()}
          onSettingsChanged={onSettingsChanged}
        />
      ) : tab === 'activity' ? (
        <ActivityTab m={m} api={api} online={online} />
      ) : tab === 'people' ? (
        <PeopleTab m={m} api={api} online={online} />
      ) : tab === 'outbound' ? (
        <OutboundTab m={m} api={api} online={online} mode={status?.mode ?? 'test'} />
      ) : (
        <WebhooksTab m={m} api={api} online={online} />
      )}

      <details className="rounded-lg border border-border p-3">
        <summary className="cursor-pointer text-label text-text">
          What {def.name} gets in Connect
        </summary>
        <ul className="mt-3 space-y-2">
          {def.features.map((f) => (
            <li key={f.label} className="text-meta">
              <span className="text-text">{f.label}</span>
              <span className="text-text-subtle"> · {f.how}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function Readiness({ s, name }: { s: ModuleIntegration; name: string }) {
  const rows = [
    {
      ok: s.signingSecretSet,
      label: 'Event signing secret',
      help: `${name} signs every event with it.`,
    },
    {
      ok: !!s.connectKeyPrefix,
      label: 'Connect API key issued',
      help: s.connectKeyPrefix
        ? `${s.connectKeyPrefix}… (shown in full once)`
        : `${name}'s server uses it to call Connect.`,
    },
    {
      ok: !!s.baseUrl,
      label: `${name} API base URL`,
      help: s.baseUrl ?? 'Needed for live mode only.',
    },
    { ok: s.moduleApiKeySet, label: `${name} API key`, help: 'Needed for live mode only.' },
  ];
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={s.mode === 'live' ? 'success' : 'warning'}>
          {s.mode === 'live' ? 'Live mode' : 'Test mode'}
        </Badge>
        {!s.enabled ? <Badge tone="neutral">Off</Badge> : null}
        <span className="text-meta text-text-subtle">
          {s.eventCount} event{s.eventCount === 1 ? '' : 's'} received
          {s.lastEventAt ? ` · last ${relativeShort(s.lastEventAt)}` : ''}
        </span>
      </div>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {rows.map((r) => (
          <li key={r.label} className="flex items-start gap-2">
            {r.ok ? (
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />
            ) : (
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
            )}
            <span className="min-w-0">
              <span className="block text-label text-text">{r.label}</span>
              <span className="block truncate text-meta text-text-subtle">{r.help}</span>
            </span>
          </li>
        ))}
      </ul>
      {s.missing.length ? (
        <p className="mt-3 text-meta text-warning">
          Live mode still needs: {s.missing.join(', ')}.
        </p>
      ) : null}
      {s.mode === 'test' ? (
        <p className="mt-2 text-meta text-text-subtle">
          In test mode Connect processes {name}’s events, and records what it would send back
          instead of calling {name}.
        </p>
      ) : null}
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const { toast } = useToast();
  return (
    <Field label={label} htmlFor={`copy-${label}`}>
      <div className="flex gap-2">
        <Input
          id={`copy-${label}`}
          readOnly
          value={value}
          className="font-mono text-meta"
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-label={`Copy ${label}`}
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(
              () => toast({ title: 'Copied', tone: 'success' }),
              () => toast({ title: 'Copy failed: select and copy it instead', tone: 'danger' }),
            );
          }}
        >
          <Copy />
        </Button>
      </div>
    </Field>
  );
}

function SetupTab({
  m,
  api,
  status,
  online,
  onChanged,
  onSettingsChanged,
}: {
  m: SampledgeModule;
  api: Api;
  status: ModuleIntegration | null;
  online: boolean;
  onChanged: () => void;
  onSettingsChanged: () => void;
}) {
  const def = MODULE_CATALOG[m];
  const { toast } = useToast();
  const [creds, setCreds] = React.useState<ModuleCredentials | null>(null);
  const [withSecret, setWithSecret] = React.useState(!status?.signingSecretSet);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [type, setType] = React.useState(def.events[0]?.type ?? '');
  const [result, setResult] = React.useState<ModuleEventResult | null>(null);
  React.useEffect(() => setWithSecret(!status?.signingSecretSet), [status?.signingSecretSet]);

  const issue = async () => {
    setBusy('issue');
    try {
      setCreds(await api.issueKey(m, withSecret));
      onChanged();
    } catch (e) {
      toast({ title: 'Couldn’t issue a key', description: (e as Error).message, tone: 'danger' });
    } finally {
      setBusy(null);
    }
  };
  const revoke = async () => {
    setBusy('revoke');
    try {
      await api.revokeKeys(m);
      toast({
        title: 'Key revoked',
        description: `${def.name} can no longer call Connect.`,
        tone: 'success',
      });
      onChanged();
    } catch (e) {
      toast({ title: 'Couldn’t revoke', description: (e as Error).message, tone: 'danger' });
    } finally {
      setBusy(null);
    }
  };
  const test = async () => {
    setBusy('test');
    setResult(null);
    try {
      setResult(await api.testEvent(m, type));
      onChanged();
    } catch (e) {
      toast({ title: 'Test event failed', description: (e as Error).message, tone: 'danger' });
    } finally {
      setBusy(null);
    }
  };
  const ev = def.events.find((e) => e.type === type);

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-lg border border-border p-4">
        <p className="flex items-center gap-2 text-label text-text">
          <KeyRound className="size-4 text-accent" /> Connect API key for {def.name}
        </p>
        <p className="mt-1 text-meta text-text-subtle">
          {def.name}’s server sends it as <code className="font-mono">Authorization: Bearer …</code>{' '}
          to post events, open record conversations and sign users into the chat widget. Issuing a
          new key revokes the old one.
        </p>
        {creds ? (
          <div
            className="mt-3 flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3"
            data-testid="module-credentials"
          >
            <p className="text-meta text-warning">
              Copy these now. They’re stored hashed or encrypted and won’t be shown again.
            </p>
            <CopyRow label="Connect API key" value={creds.connectApiKey} />
            {creds.signingSecret ? (
              <CopyRow label="Event signing secret" value={creds.signingSecret} />
            ) : null}
            <div>
              <Button
                size="sm"
                onClick={() => {
                  setCreds(null);
                  if (creds.signingSecret) onSettingsChanged();
                }}
              >
                I’ve copied them
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              onClick={() => void issue()}
              loading={busy === 'issue'}
              disabled={!online || !!busy}
            >
              <KeyRound /> {status?.connectKeyPrefix ? 'Issue a new key' : 'Issue key'}
            </Button>
            <label className="flex items-center gap-2 text-meta text-text-muted">
              <input
                type="checkbox"
                checked={withSecret}
                onChange={(e) => setWithSecret(e.target.checked)}
                className="size-4"
              />
              Also generate a new signing secret
            </label>
            {status?.connectKeyPrefix ? (
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={() => void revoke()}
                loading={busy === 'revoke'}
                disabled={!online || !!busy}
              >
                Revoke
              </Button>
            ) : null}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border p-4">
        <p className="flex items-center gap-2 text-label text-text">
          <FlaskConical className="size-4 text-accent" /> Send a test event
        </p>
        <p className="mt-1 text-meta text-text-subtle">
          Runs a realistic {def.name} event through the real pipeline. Its card is marked “Test
          event”, and you’re the only person on it.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <select
            aria-label="Event type"
            className={selectClass}
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            {def.events.map((e) => (
              <option key={e.type} value={e.type}>
                {e.label} ({e.type})
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            onClick={() => void test()}
            loading={busy === 'test'}
            disabled={!online || !!busy || !type}
          >
            Send test event
          </Button>
        </div>
        {ev ? <p className="mt-2 text-meta text-text-subtle">{ev.description}</p> : null}
        {result ? (
          <div
            role="status"
            data-testid="test-event-result"
            className={cn(
              'mt-3 rounded-lg border p-3 text-meta',
              result.status === 'processed'
                ? 'border-success/30 bg-success/10 text-success'
                : 'border-danger/30 bg-danger/10 text-danger',
            )}
          >
            <p className="font-medium">
              {result.status === 'processed'
                ? 'Processed'
                : result.status === 'ignored'
                  ? 'Ignored'
                  : 'Failed'}
              {result.actions.length ? `: ${result.actions.join(', ')}` : ''}
            </p>
            {result.error ? <p className="mt-1">{result.error}</p> : null}
            {result.conversationId ? (
              <p className="mt-1 text-text-muted">
                Open Messages to see the card in its record channel.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function useLoad<T>(fn: () => Promise<T>, online: boolean) {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const ref = React.useRef(fn);
  ref.current = fn;
  const reload = React.useCallback(async () => {
    try {
      setData(await ref.current());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  React.useEffect(() => {
    if (online) void reload();
  }, [online, reload]);
  return { data, setData, error, reload };
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border p-4 text-center text-meta text-text-subtle">
      {children}
    </p>
  );
}

function ActivityTab({ m, api, online }: { m: SampledgeModule; api: Api; online: boolean }) {
  const { data, error, reload } = useLoad(() => api.events(m), online);
  const name = MODULE_CATALOG[m].name;
  if (error)
    return (
      <p role="alert" className="text-label text-danger">
        {error}
      </p>
    );
  if (!data) return <p className="text-meta text-text-subtle">Loading…</p>;
  if (!data.length)
    return (
      <Empty>
        No events from {name} yet. Send a test event, or connect {name}’s server with the key above.
      </Empty>
    );
  return (
    <div>
      <div className="mb-2 flex justify-end">
        <Button size="sm" variant="ghost" onClick={() => void reload()}>
          <RotateCcw /> Refresh
        </Button>
      </div>
      <ul
        className="divide-y divide-border rounded-lg border border-border"
        data-testid="module-event-log"
      >
        {data.map((e) => (
          <li key={e.eventId + e.receivedAt} className="px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                tone={
                  e.status === 'processed'
                    ? 'success'
                    : e.status === 'failed'
                      ? 'danger'
                      : 'neutral'
                }
              >
                {e.status}
              </Badge>
              <code className="font-mono text-meta text-text">{e.type}</code>
              {e.source === 'admin_test' ? <Badge tone="planned">test</Badge> : null}
              <span className="ml-auto text-meta text-text-subtle">
                {relativeShort(e.receivedAt)}
              </span>
            </div>
            <p className="mt-1 truncate text-meta text-text-muted">{e.recordTitle}</p>
            {e.actions.length ? (
              <p className="truncate text-[11px] text-text-subtle">{e.actions.join(' · ')}</p>
            ) : null}
            {e.unmatchedPeople.length ? (
              <p className="text-[11px] text-warning">
                No Connect account for: {e.unmatchedPeople.join(', ')}
              </p>
            ) : null}
            {e.error ? <p className="text-[11px] text-danger">{e.error}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PeopleTab({ m, api, online }: { m: SampledgeModule; api: Api; online: boolean }) {
  const { toast } = useToast();
  const { data, setData, error } = useLoad(() => api.identities(m), online);
  const [ext, setExt] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const name = MODULE_CATALOG[m].name;
  const link = async () => {
    setBusy(true);
    try {
      const l = await api.link(m, ext.trim(), email.trim());
      setData((cur) => [l, ...(cur ?? []).filter((x) => x.externalUserId !== l.externalUserId)]);
      setExt('');
      setEmail('');
    } catch (e) {
      toast({ title: 'Couldn’t link', description: (e as Error).message, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };
  const unlink = async (l: IdentityLink) => {
    try {
      await api.unlink(m, l.externalUserId);
      setData((cur) => (cur ?? []).filter((x) => x.externalUserId !== l.externalUserId));
    } catch (e) {
      toast({ title: 'Couldn’t remove', description: (e as Error).message, tone: 'danger' });
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-meta text-text-subtle">
        How {name} users map to Connect people. Matching by email is automatic. Link someone by hand
        when their {name} email differs.
      </p>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          void link();
        }}
      >
        <Input
          aria-label={`${name} user id`}
          placeholder={`${name} user id`}
          value={ext}
          onChange={(e) => setExt(e.target.value)}
        />
        <Input
          aria-label="Connect email"
          type="email"
          placeholder="Their Connect email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button
          type="submit"
          variant="secondary"
          disabled={!online || busy || !ext.trim() || !email.trim()}
          loading={busy}
        >
          <Link2 /> Link
        </Button>
      </form>
      {error ? (
        <p role="alert" className="text-label text-danger">
          {error}
        </p>
      ) : !data ? null : data.length === 0 ? (
        <Empty>
          No one linked yet. People are linked automatically the first time an event names them by
          email.
        </Empty>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {data.map((l) => (
            <li key={l.externalUserId} className="flex items-center gap-3 px-3 py-2">
              <code className="min-w-0 truncate font-mono text-meta text-text">
                {l.externalUserId}
              </code>
              <span className="min-w-0 flex-1 truncate text-meta text-text-muted">{l.email}</span>
              <Badge tone={l.matchedBy === 'manual' ? 'accent' : 'neutral'}>
                {l.matchedBy === 'manual' ? 'Manual' : 'By email'}
              </Badge>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Unlink ${l.externalUserId}`}
                onClick={() => void unlink(l)}
                disabled={!online}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const ACTION_STATUS = {
  sent: { label: 'Sent', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  test_mode: { label: 'Test mode, not sent', tone: 'planned' },
  not_configured: { label: 'Not configured', tone: 'warning' },
} as const;

function OutboundTab({
  m,
  api,
  online,
  mode,
}: {
  m: SampledgeModule;
  api: Api;
  online: boolean;
  mode: 'test' | 'live';
}) {
  const { toast } = useToast();
  const { data, setData, error } = useLoad(() => api.actions(m), online);
  const name = MODULE_CATALOG[m].name;
  const retry = async (a: ModuleAction) => {
    try {
      const r = await api.retry(a.actionId);
      setData((cur) => [r, ...(cur ?? [])]);
    } catch (e) {
      toast({ title: 'Retry failed', description: (e as Error).message, tone: 'danger' });
    }
  };
  if (error)
    return (
      <p role="alert" className="text-label text-danger">
        {error}
      </p>
    );
  if (!data) return <p className="text-meta text-text-subtle">Loading…</p>;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-meta text-text-subtle">
        Tasks, decisions and CRM actions Connect sends to {name} at {'{base URL}'}/connect/actions,
        signed. {mode === 'test' ? 'In test mode they’re recorded here and not sent.' : ''}
      </p>
      {!data.length ? (
        <Empty>Nothing sent to {name} yet.</Empty>
      ) : (
        <ul
          className="divide-y divide-border rounded-lg border border-border"
          data-testid="module-actions-log"
        >
          {data.map((a) => {
            const st = ACTION_STATUS[a.status];
            return (
              <li key={a.actionId} className="px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={st.tone}>{st.label}</Badge>
                  <code className="font-mono text-meta text-text">{a.type}</code>
                  {a.statusCode ? (
                    <span className="text-meta text-text-subtle">HTTP {a.statusCode}</span>
                  ) : null}
                  <span className="ml-auto text-meta text-text-subtle">
                    {relativeShort(a.createdAt)}
                  </span>
                  {a.status === 'failed' || a.status === 'not_configured' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void retry(a)}
                      disabled={!online}
                    >
                      <RotateCcw /> Retry
                    </Button>
                  ) : null}
                </div>
                {a.record ? (
                  <p className="mt-1 truncate text-meta text-text-muted">{a.record.title}</p>
                ) : null}
                {a.error ? <p className="text-[11px] text-danger">{a.error}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function WebhooksTab({ m, api, online }: { m: SampledgeModule; api: Api; online: boolean }) {
  const { toast } = useToast();
  const { data, setData, error } = useLoad(() => api.webhooks(), online);
  const [url, setUrl] = React.useState('');
  const [events, setEvents] = React.useState<WebhookEventType[]>([
    'task.created',
    'approval.decided',
  ]);
  const [onlyThis, setOnlyThis] = React.useState(true);
  const [secret, setSecret] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [open, setOpen] = React.useState<string | null>(null);
  const [deliveries, setDeliveries] = React.useState<WebhookDelivery[] | null>(null);
  const name = MODULE_CATALOG[m].name;

  const create = async () => {
    setBusy(true);
    try {
      const w = await api.createWebhook({
        url: url.trim(),
        description: '',
        events,
        modules: onlyThis ? [m] : [],
      });
      const { signingSecret, ...sub } = w;
      setSecret(signingSecret);
      setData((cur) => [sub, ...(cur ?? [])]);
      setUrl('');
    } catch (e) {
      toast({
        title: 'Couldn’t add the webhook',
        description: (e as Error).message,
        tone: 'danger',
      });
    } finally {
      setBusy(false);
    }
  };
  const showDeliveries = async (id: string) => {
    if (open === id) return setOpen(null);
    setOpen(id);
    setDeliveries(null);
    try {
      setDeliveries(await api.deliveries(id));
    } catch {
      setDeliveries([]);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-meta text-text-subtle">
        Connect POSTs signed events (Sampledge-Signature header) to these URLs, retrying with
        backoff for about 9 hours. They’re shared across modules; “only {name}” limits one to {name}
        ’s records.
      </p>
      {secret ? (
        <div className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
          <p className="text-meta text-warning">
            Copy the signing secret now. It won’t be shown again.
          </p>
          <CopyRow label="Webhook signing secret" value={secret} />
          <div>
            <Button size="sm" onClick={() => setSecret(null)}>
              I’ve copied it
            </Button>
          </div>
        </div>
      ) : null}
      <form
        className="flex flex-col gap-2 rounded-lg border border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <Input
          aria-label="Webhook URL"
          type="url"
          placeholder="https://example.com/connect-webhook"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1.5">
          <legend className="sr-only">Events</legend>
          {WEBHOOK_EVENT_TYPES.map((t) => (
            <label key={t} className="flex items-center gap-1.5 text-meta text-text-muted">
              <input
                type="checkbox"
                className="size-4"
                checked={events.includes(t)}
                onChange={(e) =>
                  setEvents((cur) => (e.target.checked ? [...cur, t] : cur.filter((x) => x !== t)))
                }
              />
              <code className="font-mono">{t}</code>
            </label>
          ))}
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-meta text-text-muted">
            <input
              type="checkbox"
              className="size-4"
              checked={onlyThis}
              onChange={(e) => setOnlyThis(e.target.checked)}
            />
            Only {name}
          </label>
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            className="ml-auto"
            disabled={!online || busy || !url.trim() || !events.length}
            loading={busy}
          >
            <Webhook /> Add webhook
          </Button>
        </div>
      </form>
      {error ? (
        <p role="alert" className="text-label text-danger">
          {error}
        </p>
      ) : !data ? null : data.length === 0 ? (
        <Empty>No webhooks yet.</Empty>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {data.map((w) => (
            <li key={w.subscriptionId} className="px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={w.active ? 'success' : 'neutral'}>
                  {w.active ? 'Active' : 'Paused'}
                </Badge>
                <span className="min-w-0 flex-1 truncate font-mono text-meta text-text">
                  {w.url}
                </span>
                {w.lastDeliveryStatus ? (
                  <Badge tone={w.lastDeliveryStatus === 'delivered' ? 'success' : 'danger'}>
                    {w.lastDeliveryStatus}
                  </Badge>
                ) : null}
              </div>
              <p className="mt-1 truncate text-[11px] text-text-subtle">
                {w.events.join(', ')} ·{' '}
                {w.modules.length
                  ? w.modules.map((x) => MODULE_CATALOG[x]?.name ?? x).join(', ')
                  : 'all modules'}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void api.testWebhook(w.subscriptionId).then(
                      () => toast({ title: 'Test delivery queued', tone: 'success' }),
                      (e: Error) =>
                        toast({ title: 'Test failed', description: e.message, tone: 'danger' }),
                    )
                  }
                  disabled={!online}
                >
                  Send test
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void showDeliveries(w.subscriptionId)}
                >
                  {open === w.subscriptionId ? 'Hide deliveries' : 'Deliveries'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!online}
                  onClick={() =>
                    void api
                      .setWebhookActive(w.subscriptionId, !w.active)
                      .then((r) =>
                        setData(
                          (cur) =>
                            cur?.map((x) => (x.subscriptionId === r.subscriptionId ? r : x)) ?? cur,
                        ),
                      )
                  }
                >
                  {w.active ? 'Pause' : 'Resume'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!online}
                  onClick={() =>
                    void api
                      .deleteWebhook(w.subscriptionId)
                      .then(() =>
                        setData(
                          (cur) => cur?.filter((x) => x.subscriptionId !== w.subscriptionId) ?? cur,
                        ),
                      )
                  }
                >
                  <Trash2 /> Delete
                </Button>
              </div>
              {open === w.subscriptionId ? (
                deliveries === null ? (
                  <p className="mt-2 text-meta text-text-subtle">Loading…</p>
                ) : deliveries.length === 0 ? (
                  <p className="mt-2 text-meta text-text-subtle">No deliveries yet.</p>
                ) : (
                  <ul className="mt-2 space-y-1">
                    {deliveries.slice(0, 20).map((d) => (
                      <li
                        key={d.deliveryId}
                        className="flex flex-wrap items-center gap-2 text-[11px] text-text-muted"
                      >
                        <Badge
                          tone={
                            d.status === 'delivered'
                              ? 'success'
                              : d.status === 'pending'
                                ? 'neutral'
                                : 'danger'
                          }
                          className="text-[10px]"
                        >
                          {d.status}
                        </Badge>
                        <code className="font-mono">{d.event}</code>
                        <span>
                          {d.attempts} attempt{d.attempts === 1 ? '' : 's'}
                        </span>
                        {d.lastStatusCode ? <span>HTTP {d.lastStatusCode}</span> : null}
                        {d.lastError ? (
                          <span className="truncate text-danger">{d.lastError}</span>
                        ) : null}
                        <span className="ml-auto">{relativeShort(d.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
