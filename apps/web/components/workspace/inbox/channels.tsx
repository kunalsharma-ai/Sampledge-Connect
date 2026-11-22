'use client';
import * as React from 'react';
import { useTenantChange } from '@/lib/engine';
import {
  Activity,
  Copy,
  FlaskConical,
  KeyRound,
  Link2,
  Pause,
  Play,
  Plug,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import {
  CONNECTOR_CATALOG,
  type Connector,
  type ConnectorDescriptor,
  type ConnectorProvider,
  type InboxSettings,
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
import { API_URL } from '@/lib/config';
import type { InboxApi } from '@/lib/inbox';
import { MODE_LABEL, PROVIDER_META, ProviderMark, TestModeBadge, selectClass } from './shared';
import { FeatureHelp } from '../../feature-help';

const MODE_TONE = { two_way: 'success', limited: 'warning', handoff: 'neutral' } as const;
const webhookUrl = (path: string) => new URL(path, API_URL || window.location.origin).toString();
const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : 'never';

/**
 * Admin screen for external messaging channels. Credentials are typed here and stored
 * encrypted in the database; nothing is configured through environment variables.
 */
export function ChannelsPanel({
  api,
  online,
  settings,
  onOpenConversation,
}: {
  api: InboxApi;
  online: boolean;
  settings: InboxSettings | null;
  onOpenConversation: (id: string) => void;
}) {
  const { toast } = useToast();
  const [items, setItems] = React.useState<Connector[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState<ConnectorProvider | 'catalog' | null>(null);
  const [rotating, setRotating] = React.useState<Connector | null>(null);
  const [simulating, setSimulating] = React.useState<Connector | null>(null);

  const load = React.useCallback(
    () => api.connectors().then(setItems, (e: Error) => setError(e.message)),
    [api],
  );
  React.useEffect(() => {
    if (online) void load();
  }, [load, online]);
  // Another admin (or this admin on another device) changed a channel.
  useTenantChange('inbox', () => void load());

  const act = async (fn: () => Promise<unknown>, title: string) => {
    try {
      await fn();
      toast({ title, tone: 'success' });
      void load();
    } catch (e) {
      toast({ title: 'Action failed', description: (e as Error).message, tone: 'danger' });
    }
  };

  if (!online && !items)
    return (
      <StateView state="offline" description="Channel settings load when you're back online." />
    );
  if (error && !items)
    return (
      <StateView
        state={
          error.includes('permission') || error.includes('admin') ? 'permission-denied' : 'error'
        }
        description={error}
      />
    );
  if (!items) return <StateView state="loading" title="Loading channels" />;

  return (
    <div
      className="mx-auto w-full max-w-[1100px] space-y-6 p-5 sm:p-6"
      data-testid="channels-panel"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="font-display text-h2 text-text">Client messaging channels</h2>
            <FeatureHelp id="inbox-channels" />
          </div>
          <p className="mt-1 text-label font-normal text-text-muted">
            Connect the apps your clients already use. Credentials are entered here and stored
            encrypted in your database. Channels that fail never affect internal chat.
          </p>
        </div>
        <div className="flex-1" />
        <Button onClick={() => setAdding('catalog')} disabled={!online}>
          <Plus /> Add channel
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-strong p-8">
          <StateView
            state="empty"
            title="No channels yet"
            description="Start with any channel in test mode: the inbox generates credentials, signs simulated messages and captures replies, so nothing reaches a real provider."
            action={
              <Button onClick={() => setAdding('catalog')}>
                <Plus /> Add a channel
              </Button>
            }
          />
        </div>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {items.map((c) => {
            const d = CONNECTOR_CATALOG[c.provider];
            const circuit = c.health.circuitOpenUntil;
            return (
              <li
                key={c.connectorId}
                className="rounded-xl border border-border bg-surface/70 p-5 shadow-sm"
                data-testid="connector-card"
              >
                <div className="flex items-start gap-3">
                  <ProviderMark provider={c.provider} size="lg" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-h3 text-text">{c.name}</h3>
                      <Badge tone={MODE_TONE[d.mode]}>{MODE_LABEL[d.mode]}</Badge>
                      {c.environment === 'test' ? (
                        <TestModeBadge />
                      ) : (
                        <Badge tone="accent">Live</Badge>
                      )}
                    </div>
                    <p className="text-label font-normal text-text-muted">
                      {d.name} ·{' '}
                      <span
                        className={cn(
                          c.status === 'active'
                            ? 'text-success'
                            : c.status === 'error'
                              ? 'text-danger'
                              : 'text-warning',
                        )}
                      >
                        {c.status === 'active'
                          ? 'Active'
                          : c.status === 'error'
                            ? 'Needs attention'
                            : 'Paused'}
                      </span>
                      {c.teamId
                        ? ` · ${settings?.teams.find((t) => t.teamId === c.teamId)?.name ?? 'Team'}`
                        : ''}
                    </p>
                  </div>
                </div>

                {c.missingCredentials.length ? (
                  <div className="mt-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/8 px-3 py-2 text-label">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
                    <span className="font-normal text-text">
                      Missing:{' '}
                      {c.missingCredentials
                        .map((k) => d.credentialFields.find((f) => f.key === k)?.label ?? k)
                        .join(', ')}
                      .{' '}
                      <button
                        className="font-medium text-accent hover:underline"
                        onClick={() => setRotating(c)}
                      >
                        Add credentials
                      </button>
                    </span>
                  </div>
                ) : null}
                {c.health.lastError && c.status !== 'active' ? (
                  <p className="mt-3 text-meta text-danger">
                    Last error {when(c.health.lastErrorAt)}: {c.health.lastError}
                  </p>
                ) : null}

                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-meta">
                  <div>
                    <dt className="text-text-subtle">Last client message</dt>
                    <dd className="text-text">{when(c.health.lastInboundAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-text-subtle">Last reply sent</dt>
                    <dd className="text-text">{when(c.health.lastOutboundAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-text-subtle">Queued replies</dt>
                    <dd className="text-text">
                      {c.health.queued}
                      {circuit ? ' · paused after failures' : ''}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-text-subtle">Rejected webhooks</dt>
                    <dd className={cn(c.health.rejectedWebhooks ? 'text-warning' : 'text-text')}>
                      {c.health.rejectedWebhooks}
                    </dd>
                  </div>
                </dl>

                {Object.keys(c.credentialHints).length ? (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {d.credentialFields
                      .filter((f) => c.credentialHints[f.key])
                      .map((f) => (
                        <span
                          key={f.key}
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-sunken px-2 py-0.5 font-mono text-[11px] text-text-muted"
                        >
                          <KeyRound className="size-3" /> {f.label}: {c.credentialHints[f.key]}
                        </span>
                      ))}
                  </div>
                ) : null}

                {c.webhookPath ? (
                  <div className="mt-4">
                    <p className="mb-1 text-meta text-text-subtle">
                      Webhook URL (paste into {d.name})
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-surface-sunken px-2 py-1.5 font-mono text-[11px] text-text-muted">
                        {webhookUrl(c.webhookPath)}
                      </code>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Copy webhook URL"
                        onClick={() =>
                          void navigator.clipboard
                            .writeText(webhookUrl(c.webhookPath!))
                            .then(() => toast({ title: 'Webhook URL copied', tone: 'success' }))
                        }
                      >
                        <Copy />
                      </Button>
                    </div>
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!online}
                    onClick={() =>
                      void api.testConnector(c.connectorId).then((r) =>
                        toast({
                          title: r.ok ? 'Connection works' : 'Connection failed',
                          description: r.message,
                          tone: r.ok ? 'success' : 'danger',
                        }),
                      )
                    }
                  >
                    <Activity /> Test connection
                  </Button>
                  {c.environment === 'test' && c.webhookPath ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!online}
                      onClick={() => setSimulating(c)}
                    >
                      <Send /> Simulate client message
                    </Button>
                  ) : null}
                  {c.environment === 'live' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!online}
                      onClick={() => setRotating(c)}
                    >
                      <KeyRound />{' '}
                      {c.missingCredentials.length ? 'Credentials' : 'Rotate credentials'}
                    </Button>
                  ) : null}
                  {c.webhookPath ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!online}
                      onClick={() =>
                        void act(
                          () => api.rotateWebhookUrl(c.connectorId),
                          'New webhook URL issued. Update it in the provider.',
                        )
                      }
                    >
                      <RefreshCw /> New URL
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!online}
                    onClick={() =>
                      void act(
                        () =>
                          api.updateConnector(c.connectorId, {
                            status: c.status === 'paused' ? 'active' : 'paused',
                          }),
                        c.status === 'paused' ? 'Channel resumed' : 'Channel paused',
                      )
                    }
                  >
                    {c.status === 'paused' ? <Play /> : <Pause />}{' '}
                    {c.status === 'paused' ? 'Resume' : 'Pause'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!online}
                    onClick={() =>
                      void act(
                        () =>
                          api.updateConnector(c.connectorId, {
                            environment: c.environment === 'test' ? 'live' : 'test',
                          }),
                        c.environment === 'test'
                          ? 'Switched to live. Enter the real credentials next.'
                          : 'Switched to test mode',
                      )
                    }
                  >
                    {c.environment === 'test' ? <ShieldCheck /> : <FlaskConical />}{' '}
                    {c.environment === 'test' ? 'Go live' : 'Use test mode'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-danger"
                    disabled={!online}
                    onClick={() =>
                      void act(
                        () => api.removeConnector(c.connectorId),
                        'Channel removed. Its conversations stay in the inbox.',
                      )
                    }
                  >
                    <Trash2 /> Remove
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <CatalogDialog
        open={adding === 'catalog'}
        onClose={() => setAdding(null)}
        onPick={(p) => setAdding(p)}
      />
      {adding && adding !== 'catalog' ? (
        <ConnectDialog
          provider={adding}
          settings={settings}
          onClose={() => setAdding(null)}
          onCreate={async (body) => {
            await act(
              () => api.createConnector(body),
              `${CONNECTOR_CATALOG[body.provider].name} connected`,
            );
            setAdding(null);
          }}
        />
      ) : null}
      {rotating ? (
        <CredentialsDialog
          connector={rotating}
          onClose={() => setRotating(null)}
          onSave={async (credentials, graceHours) => {
            await act(
              () => api.rotateCredentials(rotating.connectorId, { credentials, graceHours }),
              'Credentials saved',
            );
            setRotating(null);
          }}
        />
      ) : null}
      {simulating ? (
        <SimulateDialog
          connector={simulating}
          onClose={() => setSimulating(null)}
          onSend={async (body) => {
            try {
              const r = await api.simulate(simulating.connectorId, body);
              toast({
                title: 'Signed test message delivered',
                description: 'It went through the same verification as a real webhook.',
                tone: 'success',
              });
              setSimulating(null);
              if (r.conversationIds[0]) onOpenConversation(r.conversationIds[0]);
            } catch (e) {
              toast({
                title: 'Simulation failed',
                description: (e as Error).message,
                tone: 'danger',
              });
            }
          }}
        />
      ) : null}
    </div>
  );
}

function CatalogDialog({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (p: ConnectorProvider) => void;
}) {
  const [detail, setDetail] = React.useState<ConnectorDescriptor | null>(null);
  const all = Object.values(CONNECTOR_CATALOG);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && (setDetail(null), onClose())}>
      <DialogContent
        title={detail ? detail.name : 'Add a client channel'}
        description={
          detail
            ? detail.summary
            : 'Official APIs only. Restricted platforms are labelled Limited or Handoff, never automated around.'
        }
        className="w-[min(860px,calc(100vw-2rem))]"
      >
        {detail ? (
          <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1 text-label">
            <Badge tone={MODE_TONE[detail.mode]}>{MODE_LABEL[detail.mode]}</Badge>
            {detail.limitations.map((l) => (
              <p
                key={l}
                className="flex gap-2 rounded-lg border border-warning/30 bg-warning/8 px-3 py-2 font-normal text-text"
              >
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
                {l}
              </p>
            ))}
            <dl className="grid gap-x-4 gap-y-2.5 sm:grid-cols-[170px_1fr]">
              {(
                [
                  ['Authentication', `${detail.auth.method}. ${detail.auth.authorization}`],
                  ['Inbound events', detail.inboundEvents.join(', ')],
                  ['Outbound', detail.outboundOperations.join(', ')],
                  ['Attachments', detail.attachments.note],
                  ['Webhook validation', detail.webhookValidation],
                  ['Rate limits', detail.rateLimit.note],
                  ['Retries', detail.retry],
                  ['Errors', detail.errorHandling],
                  ['Identity mapping', detail.identityMapping],
                  ['Delivery states', detail.deliveryStates],
                  ['Credential rotation', detail.credentialRotation],
                ] as const
              ).map(([k, v]) => (
                <React.Fragment key={k}>
                  <dt className="text-text-subtle">{k}</dt>
                  <dd className="font-normal text-text">{v}</dd>
                </React.Fragment>
              ))}
            </dl>
            <div className="flex gap-2 pt-2">
              <Button onClick={() => onPick(detail.provider)}>
                <Plug /> Connect {detail.name}
              </Button>
              <Button variant="ghost" onClick={() => setDetail(null)}>
                Back
              </Button>
              <a
                className="ml-auto self-center text-meta text-accent hover:underline"
                href={detail.docsUrl}
                target="_blank"
                rel="noreferrer"
              >
                Provider documentation
              </a>
            </div>
          </div>
        ) : (
          <ul className="grid max-h-[60vh] gap-2.5 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
            {all.map((d) => (
              <li key={d.provider}>
                <button
                  onClick={() => setDetail(d)}
                  className="flex h-full w-full flex-col items-start gap-2 rounded-xl border border-border bg-surface-raised/50 p-3.5 text-left transition-all hover:-translate-y-px hover:border-border-strong hover:shadow-md"
                >
                  <span className="flex w-full items-center gap-2.5">
                    <ProviderMark provider={d.provider} />
                    <span className="flex-1 text-label text-text">{d.name}</span>
                    <Badge tone={MODE_TONE[d.mode]}>{MODE_LABEL[d.mode]}</Badge>
                  </span>
                  <span className="text-meta text-text-muted">{d.summary}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CredentialInputs({
  descriptor,
  values,
  onChange,
  hints,
}: {
  descriptor: ConnectorDescriptor;
  values: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  hints?: Record<string, string>;
}) {
  return (
    <div className="space-y-3">
      {descriptor.credentialFields.map((f) => (
        <Field
          key={f.key}
          label={`${f.label}${f.required ? '' : ' (optional)'}`}
          htmlFor={`cred-${f.key}`}
          hint={
            hints?.[f.key]
              ? `Stored: ${hints[f.key]}. Leave empty to keep it.`
              : f.help || undefined
          }
        >
          {f.key === 'serviceAccountJson' ? (
            <textarea
              id={`cred-${f.key}`}
              rows={4}
              className="w-full rounded-md border border-border bg-surface-sunken px-3 py-2 font-mono text-[11px] text-text"
              value={values[f.key] ?? ''}
              onChange={(e) => onChange({ ...values, [f.key]: e.target.value })}
              placeholder='{"type":"service_account", …}'
              autoComplete="off"
            />
          ) : (
            <Input
              id={`cred-${f.key}`}
              type={f.secret ? 'password' : 'text'}
              autoComplete="off"
              value={values[f.key] ?? ''}
              placeholder={f.placeholder}
              onChange={(e) => onChange({ ...values, [f.key]: e.target.value })}
            />
          )}
        </Field>
      ))}
    </div>
  );
}

function ConnectDialog({
  provider,
  settings,
  onClose,
  onCreate,
}: {
  provider: ConnectorProvider;
  settings: InboxSettings | null;
  onClose: () => void;
  onCreate: (b: {
    provider: ConnectorProvider;
    name: string;
    environment: 'test' | 'live';
    credentials: Record<string, string>;
    teamId: string | null;
  }) => Promise<void>;
}) {
  const d = CONNECTOR_CATALOG[provider];
  const [name, setName] = React.useState(`${d.name} support`);
  const [env, setEnv] = React.useState<'test' | 'live'>('test');
  const [creds, setCreds] = React.useState<Record<string, string>>({});
  const [teamId, setTeamId] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const missing =
    env === 'live' ? d.credentialFields.filter((f) => f.required && !creds[f.key]?.trim()) : [];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`Connect ${d.name}`}
        description={d.auth.authorization}
        className="w-[min(560px,calc(100vw-2rem))]"
      >
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            await onCreate({
              provider,
              name,
              environment: env,
              credentials: env === 'live' ? creds : {},
              teamId: teamId || null,
            });
            setBusy(false);
          }}
        >
          <Field label="Name" htmlFor="conn-name">
            <Input id="conn-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div role="radiogroup" aria-label="Mode" className="grid grid-cols-2 gap-2">
            {(['test', 'live'] as const).map((m) => (
              <button
                type="button"
                key={m}
                role="radio"
                aria-checked={env === m}
                onClick={() => setEnv(m)}
                className={cn(
                  'rounded-lg border p-3 text-left transition-colors',
                  env === m
                    ? 'border-accent bg-accent-soft'
                    : 'border-border hover:border-border-strong',
                )}
              >
                <span className="flex items-center gap-1.5 text-label text-text">
                  {m === 'test' ? (
                    <FlaskConical className="size-4 text-accent-2" />
                  ) : (
                    <ShieldCheck className="size-4 text-accent" />
                  )}
                  {m === 'test' ? 'Test mode' : 'Live'}
                </span>
                <span className="mt-1 block text-meta text-text-muted">
                  {m === 'test'
                    ? 'Generated credentials. Nothing leaves the server.'
                    : `Real ${d.name} credentials and traffic.`}
                </span>
              </button>
            ))}
          </div>
          {env === 'live' ? (
            <CredentialInputs descriptor={d} values={creds} onChange={setCreds} />
          ) : null}
          {settings?.teams.length ? (
            <Field label="Owning team (optional)" htmlFor="conn-team">
              <select
                id="conn-team"
                className={cn(selectClass, 'w-full')}
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
              >
                <option value="">Everyone in the inbox</option>
                {settings.teams.map((t) => (
                  <option key={t.teamId} value={t.teamId}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          {missing.length ? (
            <p className="text-meta text-warning">
              Still missing: {missing.map((f) => f.label).join(', ')}. You can save now and add them
              later; the channel stays inactive until they're set.
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} disabled={!name.trim()}>
              <Link2 /> Connect
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CredentialsDialog({
  connector,
  onClose,
  onSave,
}: {
  connector: Connector;
  onClose: () => void;
  onSave: (c: Record<string, string>, graceHours: number) => Promise<void>;
}) {
  const d = CONNECTOR_CATALOG[connector.provider];
  const [creds, setCreds] = React.useState<Record<string, string>>({});
  const [grace, setGrace] = React.useState(24);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`${d.name} credentials`}
        description={d.credentialRotation}
        className="w-[min(560px,calc(100vw-2rem))]"
      >
        <form
          className="space-y-4"
          onSubmit={(e) => (
            e.preventDefault(),
            void onSave(
              Object.fromEntries(Object.entries(creds).filter(([, v]) => v.trim())),
              grace,
            )
          )}
        >
          <CredentialInputs
            descriptor={d}
            values={creds}
            onChange={setCreds}
            hints={connector.credentialHints}
          />
          <Field
            label="Keep accepting the old secret for"
            htmlFor="grace"
            hint="So webhooks already in flight are not rejected during the switch."
          >
            <select
              id="grace"
              className={cn(selectClass, 'w-full')}
              value={grace}
              onChange={(e) => setGrace(Number(e.target.value))}
            >
              <option value={0}>No grace period</option>
              <option value={1}>1 hour</option>
              <option value={24}>24 hours</option>
              <option value={72}>3 days</option>
            </select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!Object.values(creds).some((v) => v.trim())}>
              <KeyRound /> Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SimulateDialog({
  connector,
  onClose,
  onSend,
}: {
  connector: Connector;
  onClose: () => void;
  onSend: (b: { fromName: string; fromHandle: string; text: string }) => Promise<void>;
}) {
  const [fromName, setFromName] = React.useState('Elena Garcia');
  const [fromHandle, setFromHandle] = React.useState('@elena.garcia');
  const [text, setText] = React.useState(
    'Hi! Could you share the latest fieldwork numbers for the Q3 brand tracker?',
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Simulate a client message"
        description={`Builds a ${PROVIDER_META[connector.provider].name} webhook exactly as the provider would, signs it with this channel's test secret, and runs it through verification.`}
      >
        <form
          className="space-y-3"
          onSubmit={(e) => (e.preventDefault(), void onSend({ fromName, fromHandle, text }))}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Client name" htmlFor="sim-name">
              <Input id="sim-name" value={fromName} onChange={(e) => setFromName(e.target.value)} />
            </Field>
            <Field label="Handle" htmlFor="sim-handle">
              <Input
                id="sim-handle"
                value={fromHandle}
                onChange={(e) => setFromHandle(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Message" htmlFor="sim-text">
            <textarea
              id="sim-text"
              rows={3}
              className="w-full rounded-md border border-border bg-surface-sunken px-3 py-2 text-body text-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!text.trim() || !fromName.trim()}>
              <Send /> Send test message
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
