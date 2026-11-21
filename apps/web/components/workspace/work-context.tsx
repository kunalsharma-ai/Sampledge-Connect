'use client';
import * as React from 'react';
import { Briefcase, CheckSquare, ExternalLink, Lock, Plus, Send, Stamp } from 'lucide-react';
import type { Conversation } from '@sampledge/contracts';
import { Badge, Button, Dialog, DialogContent, Field, Textarea, useToast } from '@sampledge/ui';
import type { DirectoryEntry } from '@/lib/engine';
import { dueLabel, isActiveTask, sortTasks, useWorkApi, type RecordWithActions } from '@/lib/work';
import { relativeShort } from './helpers';
import { moduleName, useConversationWork } from './work-cards';
import { CreateTaskDialog, RequestApprovalDialog } from './work-dialogs';
import { ApprovalStatusBadge, PeopleStack, TaskStatusBadge, formatMoney } from './work-ui';

const FIELD_LABEL: Record<string, string> = {
  status: 'Status',
  dueAt: 'Due',
  amount: 'Amount',
  stage: 'Stage',
  owner: 'Owner',
  client: 'Client',
};
const humanize = (k: string) =>
  FIELD_LABEL[k] ??
  k
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());

function fieldValue(k: string, v: string | number | boolean | null) {
  if (v === null) return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string' && /At$/.test(k) && !Number.isNaN(Date.parse(v)))
    return new Date(v).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  return String(v);
}

/** Context panel: linked module records, record actions, and this conversation's work. */
export function WorkContextSection({
  conversation,
  me,
  directory,
}: {
  conversation: Conversation;
  me: string;
  directory: Map<string, DirectoryEntry>;
}) {
  const work = useConversationWork();
  const [dialog, setDialog] = React.useState<null | 'task' | 'approval'>(null);
  const [action, setAction] = React.useState<{
    rec: RecordWithActions;
    type: string;
    label: string;
  } | null>(null);
  const readOnly = conversation.myRole === null || !!conversation.archivedAt;
  if (!work) return null;
  const open = sortTasks((work.tasks ?? []).filter(isActiveTask));
  const pending = (work.approvals ?? []).filter((a) => a.status === 'pending');

  return (
    <>
      {work.records?.length ? (
        <section className="space-y-2" aria-label="Linked records">
          <p className="mb-2 text-overline uppercase text-text-subtle">Linked records</p>
          {[...work.records]
            .sort((a, b) => Number(!!a.parent) - Number(!!b.parent))
            .map((r, i) => {
              // The conversation's own record gets the full card; records under it stay compact.
              if (i > 0 && r.parent)
                return (
                  <div
                    key={r.linkId}
                    className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-meta"
                    data-testid="linked-record"
                  >
                    <span className="shrink-0 text-text-subtle">
                      {r.recordType.replace(/_/g, ' ')}
                    </span>
                    {r.url ? (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="min-w-0 flex-1 truncate text-text hover:text-accent"
                      >
                        {r.title}
                      </a>
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-text">{r.title}</span>
                    )}
                    {typeof r.fields.status === 'string' ? (
                      <Badge tone="neutral" className="shrink-0 px-1.5 text-[10px]">
                        {r.fields.status}
                      </Badge>
                    ) : null}
                  </div>
                );
              const fields = Object.entries(r.fields)
                .filter(([k]) => k !== 'url')
                .slice(0, 6);
              return (
                <div
                  key={r.linkId}
                  className="rounded-lg border border-border bg-surface-raised p-3"
                  data-testid="linked-record"
                >
                  <div className="flex items-start gap-2">
                    <Briefcase className="mt-0.5 size-4 shrink-0 text-accent" />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-meta text-text-subtle">
                        <span className="font-semibold text-text-muted">
                          {moduleName(r.module)}
                        </span>
                        · {r.recordType.replace(/_/g, ' ')}
                        {r.sensitivity === 'restricted' ? (
                          <Lock className="size-3" aria-label="Restricted record" />
                        ) : null}
                      </p>
                      {r.url ? (
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="flex items-center gap-1 text-label text-text hover:text-accent"
                        >
                          <span className="truncate">{r.title}</span>
                          <ExternalLink className="size-3 shrink-0" />
                        </a>
                      ) : (
                        <p className="truncate text-label text-text">{r.title}</p>
                      )}
                      {r.parent ? (
                        <p className="truncate text-meta text-text-subtle">in {r.parent.title}</p>
                      ) : null}
                    </div>
                  </div>
                  {fields.length ? (
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                      {fields.map(([k, v]) => (
                        <div key={k} className="min-w-0">
                          <dt className="text-[11px] text-text-subtle">{humanize(k)}</dt>
                          <dd className="truncate text-meta text-text">{fieldValue(k, v)}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                  {r.actions.length && !readOnly ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {r.actions.map((a) => (
                        <Button
                          key={a.type}
                          size="sm"
                          variant="secondary"
                          title={a.description}
                          disabled={!work.online}
                          onClick={() => setAction({ rec: r, type: a.type, label: a.label })}
                        >
                          <Send /> {a.label}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                  <p className="mt-2 text-[11px] text-text-subtle">
                    Updated {relativeShort(r.updatedAt)}
                  </p>
                </div>
              );
            })}
        </section>
      ) : null}

      <section aria-label="Tasks and approvals in this conversation">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-overline uppercase text-text-subtle">Tasks & approvals</p>
          {!readOnly ? (
            <div className="flex gap-1">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="New task here"
                title="New task here"
                disabled={!work.online}
                onClick={() => setDialog('task')}
              >
                <Plus />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Request approval here"
                title="Request approval here"
                disabled={!work.online}
                onClick={() => setDialog('approval')}
              >
                <Stamp />
              </Button>
            </div>
          ) : null}
        </div>
        {work.tasks === null && work.approvals === null ? (
          <p className="text-meta text-text-subtle">
            {work.online ? 'Loading…' : 'Available when you’re online.'}
          </p>
        ) : open.length === 0 && pending.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-3 text-meta text-text-subtle">
            Nothing open here. Hover any message and choose “Create task” or “Request approval”.
          </p>
        ) : (
          <ul className="space-y-1.5" data-testid="conversation-work">
            {pending.map((a) => (
              <li
                key={a.approvalId}
                className="rounded-lg border border-warning/30 bg-surface-raised p-2.5"
              >
                <p className="flex items-center gap-2 text-label text-text">
                  <Stamp className="size-3.5 shrink-0 text-warning" />
                  <span className="truncate">{a.title}</span>
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-meta text-text-subtle">
                  <ApprovalStatusBadge status={a.status} />
                  {a.amount ? <span className="tabular-nums">{formatMoney(a.amount)}</span> : null}
                  {a.approverIds.includes(me) && !a.decisions.some((d) => d.userId === me) ? (
                    <span className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2"
                        onClick={() => work.decide(a, 'reject')}
                      >
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        className="h-6 px-2"
                        onClick={() => work.decide(a, 'approve')}
                      >
                        Approve
                      </Button>
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
            {open.slice(0, 8).map((t) => {
              const due = dueLabel(t.dueAt);
              return (
                <li
                  key={t.taskId}
                  className="rounded-lg border border-border bg-surface-raised p-2.5"
                >
                  <p className="flex items-center gap-2 text-label text-text">
                    <CheckSquare className="size-3.5 shrink-0 text-accent" />
                    <span className="truncate">{t.title}</span>
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <TaskStatusBadge status={t.status} />
                    {due ? (
                      <Badge tone={due.overdue ? 'danger' : 'neutral'}>{due.text}</Badge>
                    ) : null}
                    <PeopleStack ids={t.assigneeIds} directory={directory} max={2} />
                  </div>
                </li>
              );
            })}
            {open.length > 8 ? (
              <li className="px-1 text-meta text-text-subtle">
                +{open.length - 8} more in Tasks & Approvals
              </li>
            ) : null}
          </ul>
        )}
      </section>

      <CreateTaskDialog
        open={dialog === 'task'}
        onOpenChange={(o) => setDialog(o ? 'task' : null)}
        source={{ conversation }}
        me={me}
        directory={directory}
        onCreated={work.setTask}
      />
      <RequestApprovalDialog
        open={dialog === 'approval'}
        onOpenChange={(o) => setDialog(o ? 'approval' : null)}
        source={{ conversation }}
        me={me}
        directory={directory}
        onCreated={work.setApproval}
      />
      <RecordActionDialog action={action} onOpenChange={(o) => !o && setAction(null)} />
    </>
  );
}

/** Run a module record action (e.g. "Log to SampForce") with a note. */
function RecordActionDialog({
  action,
  onOpenChange,
}: {
  action: { rec: RecordWithActions; type: string; label: string } | null;
  onOpenChange: (o: boolean) => void;
}) {
  const api = useWorkApi();
  const { toast } = useToast();
  const [note, setNote] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    setNote('');
    setError(null);
  }, [action]);

  const run = async () => {
    if (!action) return;
    setPending(true);
    setError(null);
    try {
      const r = await api.runAction(action.rec.linkId, action.type, note.trim());
      const name = moduleName(action.rec.module);
      toast({
        title:
          r.status === 'sent'
            ? `Sent to ${name}`
            : r.status === 'test_mode'
              ? `${name} is in test mode`
              : r.status === 'not_configured'
                ? `${name} isn’t configured`
                : `${name} didn’t accept it`,
        description:
          r.status === 'test_mode'
            ? 'Recorded what would be sent. Nothing was sent to the module.'
            : r.status === 'not_configured'
              ? 'An admin can finish setup under Integrations. Nothing was sent.'
              : (r.error ?? undefined),
        tone: r.status === 'sent' ? 'success' : r.status === 'failed' ? 'danger' : 'info',
      });
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={!!action} onOpenChange={onOpenChange}>
      <DialogContent
        title={action?.label ?? ''}
        description={action ? `${moduleName(action.rec.module)} · ${action.rec.title}` : undefined}
      >
        <Field
          label="Note"
          htmlFor="record-action-note"
          hint="Sent with the action, and shown in this conversation."
        >
          <Textarea
            id="record-action-note"
            rows={4}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={4000}
            autoFocus
          />
        </Field>
        {error ? (
          <p role="alert" className="mt-3 text-label font-normal text-danger">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void run()} loading={pending} disabled={pending}>
            <Send /> {action?.label ?? 'Send'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
