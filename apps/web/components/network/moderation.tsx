'use client';
import * as React from 'react';
import {
  Ban,
  CheckCircle2,
  Flag,
  MessageSquare,
  MessageSquareText,
  ShieldAlert,
  Trash2,
  Undo2,
  Users,
  UserX,
  XCircle,
} from 'lucide-react';
import type {
  Community,
  IntegrationView,
  ModerationActionKind,
  ModerationQueue,
  ModerationReport,
  NetworkSuspensions,
  ReportStatus,
} from '@sampledge/contracts';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  Field,
  StateView,
  Textarea,
  cn,
  useToast,
} from '@sampledge/ui';
import { apiRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useEngineChange } from '@/lib/engine';
import { newActionId, useNet, useNetwork } from '@/lib/network';
import {
  IntegrationDetail,
  StatusBadge,
  useIntegrationsApi,
} from '@/components/workspace/integrations-screen';
import { PersonLine, Section, Tabs, errorText, plural } from './ui';

const REASON: Record<ModerationReport['reason'], string> = {
  spam: 'Spam',
  harassment: 'Harassment',
  impersonation: 'Impersonation',
  inappropriate: 'Inappropriate',
  other: 'Other',
};
const TARGET: Record<ModerationReport['targetType'], string> = {
  user: 'Person',
  status: 'Status update',
  community: 'Community',
  message: 'Message',
};
const ACTION: Record<
  ModerationActionKind,
  { label: string; done: string; confirm: string; icon: React.ReactNode; danger: boolean }
> = {
  dismiss: {
    label: 'Dismiss',
    done: 'Dismissed',
    confirm: 'Close this report without action. The reporter isn’t told who reviewed it.',
    icon: <XCircle />,
    danger: false,
  },
  remove_content: {
    label: 'Remove content',
    done: 'Content removed',
    confirm: 'It disappears for everyone, on every device. Moderators keep the snapshot.',
    icon: <Trash2 />,
    danger: true,
  },
  suspend_user: {
    label: 'Suspend person',
    done: 'Person suspended',
    confirm:
      'They’re signed out of SampConnect Network everywhere and hidden from search, lists and statuses until you restore them. Their organization workspace isn’t affected.',
    icon: <UserX />,
    danger: true,
  },
  suspend_community: {
    label: 'Suspend community',
    done: 'Community suspended',
    confirm:
      'The community and its public page disappear and its groups are archived until you restore it.',
    icon: <Ban />,
    danger: true,
  },
  ban_from_community: {
    label: 'Ban from community',
    done: 'Banned from community',
    confirm: 'They’re removed from the community and its groups and can’t rejoin.',
    icon: <Ban />,
    danger: true,
  },
};

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Which actions make sense for this report, for platform operators or community moderators. */
function actionsFor(r: ModerationReport, kind: 'platform' | 'community'): ModerationActionKind[] {
  const out: ModerationActionKind[] = [];
  if (r.targetState === 'active') {
    if (r.targetType === 'message' || (kind === 'platform' && r.targetType === 'status'))
      out.push('remove_content');
  }
  if (kind === 'platform') {
    if (r.subject && r.targetType !== 'community' && r.targetState !== 'suspended')
      out.push('suspend_user');
    if (r.community && r.targetType === 'community' && r.targetState !== 'suspended')
      out.push('suspend_community');
  } else if (r.subject && r.targetType === 'message') out.push('ban_from_community');
  out.push('dismiss');
  return out;
}

export function ReportCard({
  report: r,
  kind,
  onAct,
}: {
  report: ModerationReport;
  kind: 'platform' | 'community';
  onAct: (r: ModerationReport, a: ModerationActionKind) => void;
}) {
  const Icon =
    r.targetType === 'message'
      ? MessageSquare
      : r.targetType === 'status'
        ? MessageSquareText
        : r.targetType === 'community'
          ? Users
          : UserX;
  return (
    <article
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      data-testid="report-card"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid size-8 place-items-center rounded-md bg-danger/10 text-danger">
          <Icon className="size-4" aria-hidden />
        </span>
        <p className="text-label text-text">{TARGET[r.targetType]}</p>
        <Badge tone="danger">{REASON[r.reason]}</Badge>
        {r.alsoReported ? (
          <Badge tone="warning">{`+${plural(r.alsoReported, 'more report')}`}</Badge>
        ) : null}
        {r.targetState === 'removed' ? (
          <Badge>Removed</Badge>
        ) : r.targetState === 'suspended' ? (
          <Badge tone="warning">Suspended</Badge>
        ) : null}
        <span className="ml-auto text-meta text-text-subtle">{when(r.createdAt)}</span>
      </div>
      {r.snapshot ? (
        <blockquote
          className={cn(
            'whitespace-pre-wrap break-words rounded-md border-l-2 border-danger/60 bg-surface-raised px-3 py-2 text-body text-text',
            r.targetState === 'removed' && 'text-text-muted line-through decoration-text-subtle/50',
          )}
        >
          {r.snapshot}
        </blockquote>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {r.subject ? (
          <div>
            <p className="mb-1 text-meta text-text-subtle">
              {r.targetType === 'community'
                ? 'Owner'
                : r.targetType === 'user'
                  ? 'Reported'
                  : 'Posted by'}
            </p>
            <PersonLine person={r.subject} size="sm" />
          </div>
        ) : null}
        {r.reporter ? (
          <div>
            <p className="mb-1 text-meta text-text-subtle">Reported by</p>
            <PersonLine person={r.reporter} size="sm" />
          </div>
        ) : null}
      </div>
      {r.community ? (
        <p className="text-meta text-text-muted">
          In <span className="text-text">{r.community.name}</span>
        </p>
      ) : null}
      {r.details ? (
        <p className="text-meta text-text-muted">
          <span className="text-text-subtle">Their note: </span>
          {r.details}
        </p>
      ) : null}
      {r.resolution ? (
        <p className="flex items-center gap-1.5 text-meta text-text-muted">
          <CheckCircle2 className="size-3.5 text-success" aria-hidden />
          {ACTION[r.resolution.action].done} by {r.resolution.by} · {when(r.resolution.at)}
          {r.resolution.note ? ` · “${r.resolution.note}”` : ''}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          {actionsFor(r, kind).map((a) => (
            <Button
              key={a}
              size="sm"
              variant={a === 'dismiss' ? 'ghost' : ACTION[a].danger ? 'outline' : 'secondary'}
              className={cn(ACTION[a].danger && 'text-danger')}
              onClick={() => onAct(r, a)}
            >
              {ACTION[a].icon} {ACTION[a].label}
            </Button>
          ))}
        </div>
      )}
    </article>
  );
}

function ConfirmAction({
  pending,
  onClose,
  onConfirm,
}: {
  pending: { report: ModerationReport; action: ModerationActionKind } | null;
  onClose: () => void;
  onConfirm: (note: string) => Promise<void>;
}) {
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => setNote(''), [pending]);
  const a = pending ? ACTION[pending.action] : null;
  return (
    <Dialog open={!!pending} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      {pending && a ? (
        <DialogContent title={`${a.label}?`} description={a.confirm}>
          <div className="mt-4 flex flex-col gap-4">
            <Field
              label="Note for other moderators (optional)"
              htmlFor="mod-note"
              hint="Kept with the report and in the audit log."
            >
              <Textarea
                id="mod-note"
                rows={3}
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  pending.action === 'dismiss' ? 'Not against the rules' : 'Repeated spam'
                }
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant={a.danger ? 'danger' : 'primary'}
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onConfirm(note.trim());
                    onClose();
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {a.label}
              </Button>
            </div>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function QueueView({
  data,
  status,
  onStatus,
  kind,
  onAct,
  empty,
}: {
  data: ModerationQueue | undefined;
  status: ReportStatus;
  onStatus: (s: ReportStatus) => void;
  kind: 'platform' | 'community';
  onAct: (r: ModerationReport, a: ModerationActionKind) => void;
  empty: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Tabs
        value={status}
        onChange={onStatus}
        items={[
          { id: 'open', label: 'Open', count: data?.counts.open },
          { id: 'actioned', label: 'Actioned' },
          { id: 'dismissed', label: 'Dismissed' },
        ]}
      />
      {!data ? (
        <StateView state="loading" title="Loading reports" />
      ) : data.reports.length === 0 ? (
        <StateView
          state="empty"
          title={status === 'open' ? 'Nothing to review' : `No ${status} reports`}
          description={status === 'open' ? empty : undefined}
        />
      ) : (
        data.reports.map((r) => (
          <ReportCard key={r.reportId} report={r} kind={kind} onAct={onAct} />
        ))
      )}
    </div>
  );
}

// ─── platform operators (Administration → SampConnect Network) ─────────────

/**
 * Every report across SampConnect Network, suspensions, and the platform text-message
 * provider. Only shown to platform operators; updates live on all their devices.
 */
export function PlatformModeration({ online }: { online: boolean }) {
  const { getAccessToken } = useAuth();
  const { toast } = useToast();
  const [status, setStatus] = React.useState<ReportStatus>('open');
  const [queue, setQueue] = React.useState<ModerationQueue | undefined>();
  const [susp, setSusp] = React.useState<NetworkSuspensions | undefined>();
  const [pending, setPending] = React.useState<{
    report: ModerationReport;
    action: ModerationActionKind;
  } | null>(null);
  const req = React.useCallback(
    async <T,>(method: string, path: string, body?: unknown) =>
      apiRequest<T>(method, path, { token: await getAccessToken(), body }),
    [getAccessToken],
  );
  const loadQueue = React.useCallback(
    () =>
      req<ModerationQueue>('GET', `/v1/platform/network/reports?status=${status}`)
        .then(setQueue)
        .catch(() => undefined),
    [req, status],
  );
  const loadSusp = React.useCallback(
    () =>
      req<NetworkSuspensions>('GET', '/v1/platform/network/suspensions')
        .then(setSusp)
        .catch(() => undefined),
    [req],
  );
  React.useEffect(() => {
    setQueue(undefined);
    void loadQueue();
  }, [loadQueue]);
  React.useEffect(() => void loadSusp(), [loadSusp]);
  useEngineChange(['moderation'], (e) => {
    if (e.type === 'reconnected' || (e.type === 'moderation' && e.scope === 'reports'))
      void loadQueue();
    if (e.type === 'reconnected' || (e.type === 'moderation' && e.scope === 'suspensions'))
      void loadSusp();
  });

  const act = async (note: string) => {
    if (!pending) return;
    try {
      await req('POST', `/v1/platform/network/reports/${pending.report.reportId}/action`, {
        clientActionId: newActionId(),
        action: pending.action,
        note,
      });
      toast({ title: ACTION[pending.action].done, tone: 'success' });
      await Promise.all([loadQueue(), loadSusp()]);
    } catch (e) {
      toast({ title: 'Couldn’t do that', description: errorText(e), tone: 'danger' });
      throw e;
    }
  };
  const restore = async (path: string, label: string) => {
    try {
      await req('DELETE', path);
      toast({ title: `${label} restored`, tone: 'success' });
      await Promise.all([loadQueue(), loadSusp()]);
    } catch (e) {
      toast({ title: 'Couldn’t restore', description: errorText(e), tone: 'danger' });
    }
  };

  return (
    <div className="flex flex-col gap-5" data-testid="platform-moderation">
      <header className="flex items-center gap-2">
        <ShieldAlert className="size-5 text-danger" aria-hidden />
        <div>
          <h2 className="text-h3 text-text">Reported content</h2>
          <p className="text-meta text-text-muted">
            Platform operators review reports from everyone on SampConnect Network.
          </p>
        </div>
      </header>
      <QueueView
        data={queue}
        status={status}
        onStatus={setStatus}
        kind="platform"
        onAct={(report, action) =>
          online
            ? setPending({ report, action })
            : toast({ title: 'You’re offline', description: 'Reconnect to review reports.' })
        }
        empty="Reports from people on SampConnect Network appear here as they come in."
      />
      <Section title="Suspended">
        {!susp ? (
          <StateView state="loading" title="Loading" />
        ) : susp.users.length + susp.communities.length === 0 ? (
          <p className="px-2 py-3 text-meta text-text-muted">No one is suspended.</p>
        ) : (
          <div className="flex flex-col">
            {susp.users.map((u) => (
              <div
                key={u.person.userId}
                className="flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-surface-raised"
              >
                <div className="min-w-0 flex-1">
                  <PersonLine
                    person={u.person}
                    size="sm"
                    extra={
                      <p className="truncate text-meta text-text-subtle">
                        {when(u.suspendedAt)}
                        {u.reason ? ` · ${u.reason}` : ''}
                      </p>
                    }
                  />
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    void restore(
                      `/v1/platform/network/suspensions/users/${u.person.userId}`,
                      u.person.displayName,
                    )
                  }
                >
                  <Undo2 /> Restore
                </Button>
              </div>
            ))}
            {susp.communities.map((c) => (
              <div
                key={c.communityId}
                className="flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-surface-raised"
              >
                <span className="grid size-8 place-items-center rounded-md bg-accent-soft text-accent">
                  <Users className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-label text-text">{c.name}</p>
                  <p className="truncate text-meta text-text-subtle">
                    Community · {when(c.suspendedAt)}
                    {c.reason ? ` · ${c.reason}` : ''}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    void restore(
                      `/v1/platform/network/suspensions/communities/${c.communityId}`,
                      c.name,
                    )
                  }
                >
                  <Undo2 /> Restore
                </Button>
              </div>
            ))}
          </div>
        )}
      </Section>
      <PlatformSms online={online} />
      <ConfirmAction pending={pending} onClose={() => setPending(null)} onConfirm={act} />
    </div>
  );
}

/** The text-message provider every organization without its own falls back to. */
function PlatformSms({ online }: { online: boolean }) {
  const api = useIntegrationsApi('/v1/platform/integrations');
  const [view, setView] = React.useState<IntegrationView | null>(null);
  const [open, setOpen] = React.useState(false);
  const load = React.useCallback(
    () =>
      api
        .list()
        .then((l) => setView(l.find((v) => v.provider.id === 'sms') ?? null))
        .catch(() => undefined),
    [api],
  );
  React.useEffect(() => void load(), [load]);
  if (!view) return null;
  if (open)
    return (
      <div className="rounded-xl border border-border bg-surface p-4">
        <IntegrationDetail
          view={view}
          api={api}
          online={online}
          onBack={() => setOpen(false)}
          onSaved={(v) => setView(v)}
          onReload={() => void load()}
        />
      </div>
    );
  return (
    <section className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4">
      <span className="grid size-9 place-items-center rounded-md bg-accent-soft text-accent">
        <MessageSquareText className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-label text-text">
          Text message invites for everyone <StatusBadge view={view} />
        </p>
        <p className="text-meta text-text-muted">
          Used for SampConnect Network SMS invites when an organization hasn’t set up its own
          provider (Twilio, Vonage or your own gateway). Stored encrypted.
        </p>
      </div>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {view.saved ? 'Edit' : 'Set up'}
      </Button>
    </section>
  );
}

// ─── community moderators (community page → Reports) ──────────────────────

export function CommunityReports({ c }: { c: Community }) {
  const net = useNetwork();
  const { toast } = useToast();
  const [status, setStatus] = React.useState<ReportStatus>('open');
  const base = `/v1/network/communities/${c.communityId}/reports`;
  const { data } = useNet<ModerationQueue>(`${base}?status=${status}`, ['reports']);
  const [pending, setPending] = React.useState<{
    report: ModerationReport;
    action: ModerationActionKind;
  } | null>(null);
  const act = async (note: string) => {
    if (!pending) return;
    try {
      const r = await net.act({
        method: 'POST',
        path: `${base}/${pending.report.reportId}/action`,
        body: { clientActionId: newActionId(), action: pending.action, note },
        label: ACTION[pending.action].label,
        scopes: ['reports', 'communities'],
      });
      toast(
        r === null
          ? {
              title: `${ACTION[pending.action].label} queued`,
              description: 'It will happen when you’re back online.',
            }
          : { title: ACTION[pending.action].done, tone: 'success' },
      );
    } catch (e) {
      toast({ title: 'Couldn’t do that', description: errorText(e), tone: 'danger' });
      throw e;
    }
  };
  return (
    <>
      <div className="flex items-center gap-2 text-meta text-text-muted">
        <Flag className="size-4 text-danger" aria-hidden />
        Reports about messages in this community’s groups. Platform operators see them too.
      </div>
      <QueueView
        data={data}
        status={status}
        onStatus={setStatus}
        kind="community"
        onAct={(report, action) => setPending({ report, action })}
        empty="When someone reports a message in one of your groups, it shows up here."
      />
      <ConfirmAction pending={pending} onClose={() => setPending(null)} onConfirm={act} />
    </>
  );
}
