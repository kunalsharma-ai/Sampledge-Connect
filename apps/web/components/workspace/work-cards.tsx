'use client';
import * as React from 'react';
import {
  AlertTriangle,
  Check,
  CheckSquare,
  ExternalLink,
  Info,
  PartyPopper,
  Send,
  Stamp,
  X,
} from 'lucide-react';
import {
  MODULE_CATALOG,
  type Approval,
  type ModuleCardMetadata,
  type SampledgeModule,
  type Task,
  type WorkCardMetadata,
} from '@sampledge/contracts';
import type { LocalMessage } from '@sampledge/offline';
import { Badge, Button, cn, useToast } from '@sampledge/ui';
import { useEngineChange, type DirectoryEntry } from '@/lib/engine';
import { dueLabel, useApprovals, useTasks, useWorkApi, type RecordWithActions } from '@/lib/work';
import { formatTime, nameOf } from './helpers';
import { DecideDialog } from './work-dialogs';
import {
  ApprovalStatusBadge,
  PeopleStack,
  PriorityBadge,
  TaskStatusBadge,
  formatMoney,
} from './work-ui';

/* ---------- the active conversation's work, shared by cards and the context panel ---------- */

interface ConversationWork {
  conversationId: string | null;
  me: string;
  tasks: Task[] | null;
  approvals: Approval[] | null;
  records: RecordWithActions[] | null;
  online: boolean;
  setTask: (t: Task) => void;
  setApproval: (a: Approval) => void;
  refreshRecords: () => void;
  decide: (a: Approval, d: 'approve' | 'reject') => void;
}
const WorkContext = React.createContext<ConversationWork | null>(null);
export const useConversationWork = () => React.useContext(WorkContext);

export function ConversationWorkProvider({
  conversationId,
  me,
  children,
}: {
  conversationId: string | null;
  me: string;
  children: React.ReactNode;
}) {
  const api = useWorkApi();
  const tasks = useTasks('conversation', me, conversationId ?? undefined);
  const approvals = useApprovals('conversation', me, conversationId ?? undefined);
  const [records, setRecords] = React.useState<RecordWithActions[] | null>(null);
  const [deciding, setDeciding] = React.useState<{ a: Approval; d: 'approve' | 'reject' } | null>(
    null,
  );
  const online = tasks.online;

  const refreshRecords = React.useCallback(() => {
    if (!conversationId) return setRecords([]);
    api
      .records(conversationId)
      .then(setRecords)
      .catch(() => setRecords((r) => r ?? []));
  }, [api, conversationId]);
  React.useEffect(() => {
    setRecords(null);
    if (online) refreshRecords();
  }, [online, refreshRecords]);
  // Live: another member's event, action or new link refreshes this panel on every device;
  // after a reconnect (events may have been missed) it refetches too.
  useEngineChange(['records'], (e) => {
    if (e.type === 'reconnected' || (e.type === 'records' && e.conversationId === conversationId))
      refreshRecords();
  });

  const { setItems: setTasks } = tasks;
  const { setItems: setApprovals } = approvals;
  const value = React.useMemo<ConversationWork>(
    () => ({
      conversationId,
      me,
      tasks: tasks.items,
      approvals: approvals.items,
      records,
      online,
      setTask: (t) =>
        setTasks((cur) => (cur ? [t, ...cur.filter((x) => x.taskId !== t.taskId)] : cur)),
      setApproval: (a) =>
        setApprovals((cur) =>
          cur ? [a, ...cur.filter((x) => x.approvalId !== a.approvalId)] : cur,
        ),
      refreshRecords,
      decide: (a, d) => setDeciding({ a, d }),
    }),
    [
      conversationId,
      me,
      tasks.items,
      approvals.items,
      records,
      online,
      setTasks,
      setApprovals,
      refreshRecords,
    ],
  );

  return (
    <WorkContext.Provider value={value}>
      {children}
      <DecideDialog
        approval={deciding?.a ?? null}
        decision={deciding?.d ?? 'approve'}
        onOpenChange={(o) => !o && setDeciding(null)}
        onDecided={value.setApproval}
      />
    </WorkContext.Provider>
  );
}

/* ---------- cards ---------- */

const TONE_ICON = {
  info: Info,
  success: PartyPopper,
  warning: AlertTriangle,
  danger: AlertTriangle,
} as const;
const TONE_CLASS = {
  info: 'bg-accent-soft text-accent',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/15 text-danger',
} as const;
const TONE_BORDER = {
  info: 'border-border',
  success: 'border-success/30',
  warning: 'border-warning/40',
  danger: 'border-danger/40',
} as const;

export const moduleName = (m: SampledgeModule) => MODULE_CATALOG[m]?.name ?? m;

/** What the event said, without the "Label · Title: " prefix the plain-text fallback carries. */
function summaryOf(text: string, meta: ModuleCardMetadata) {
  const t = text.replace(/^\[Test\] /, '');
  const prefix = `${meta.eventLabel} · ${meta.record.title}: `;
  return t.startsWith(prefix) ? t.slice(prefix.length) : t;
}

/** A Sampledge module event posted in its record's conversation (metadata.module). */
export function ModuleCard({
  message,
  directory,
}: {
  message: LocalMessage;
  directory: Map<string, DirectoryEntry>;
}) {
  const meta = message.metadata?.module as ModuleCardMetadata | undefined;
  const work = useConversationWork();
  if (!meta) return null;
  const Icon = TONE_ICON[meta.tone] ?? Info;
  const task = meta.taskId ? work?.tasks?.find((t) => t.taskId === meta.taskId) : undefined;
  const approval = meta.approvalId
    ? work?.approvals?.find((a) => a.approvalId === meta.approvalId)
    : undefined;
  return (
    <div className="my-3 flex justify-center" data-testid="module-card">
      <article
        className={cn(
          'w-full max-w-xl rounded-xl border bg-surface shadow-sm',
          TONE_BORDER[meta.tone],
          meta.test && 'border-dashed',
        )}
        aria-label={`${moduleName(meta.module)}: ${meta.eventLabel}`}
      >
        <header className="flex items-center gap-3 px-4 pt-3">
          <span
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-lg',
              TONE_CLASS[meta.tone],
            )}
          >
            <Icon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-2 text-meta text-text-subtle">
              <span className="font-semibold text-text-muted">{moduleName(meta.module)}</span>
              <span>·</span>
              <span>{meta.eventLabel}</span>
              <span>·</span>
              <span>{formatTime(message.createdAt)}</span>
              {meta.test ? (
                <Badge tone="planned" className="px-1.5 text-[10px]">
                  Test event
                </Badge>
              ) : null}
            </p>
            {meta.record.url ? (
              <a
                href={meta.record.url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex max-w-full items-center gap-1 truncate text-label text-text hover:text-accent"
              >
                <span className="truncate">{meta.record.title}</span>
                <ExternalLink className="size-3 shrink-0" />
              </a>
            ) : (
              <p className="truncate text-label text-text">{meta.record.title}</p>
            )}
          </div>
        </header>
        <p className="px-4 pt-2 text-label font-normal text-text-muted">
          {summaryOf(message.content.text, meta)}
        </p>
        {meta.facts.length ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 pt-3 sm:grid-cols-3">
            {meta.facts.map((f) => (
              <div key={f.label} className="min-w-0">
                <dt className="text-meta text-text-subtle">{f.label}</dt>
                <dd className="truncate text-label text-text" title={f.value}>
                  {/^https?:\/\//.test(f.value) ? (
                    <a
                      href={f.value}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-accent hover:underline"
                    >
                      Open link
                    </a>
                  ) : (
                    f.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        <div className="px-4 pb-3 pt-3">
          {task ? <TaskLine task={task} directory={directory} /> : null}
          {approval ? <ApprovalLine approval={approval} directory={directory} /> : null}
          {meta.taskId && !task && work?.tasks ? (
            <p className="text-meta text-text-subtle">
              A task was created for the people involved.
            </p>
          ) : null}
        </div>
      </article>
    </div>
  );
}

/** A task or approval created in this conversation (metadata.work). */
export function WorkCard({
  message,
  directory,
}: {
  message: LocalMessage;
  directory: Map<string, DirectoryEntry>;
}) {
  const meta = message.metadata?.work as WorkCardMetadata | undefined;
  const work = useConversationWork();
  if (!meta) return null;
  const who = work && message.senderId === work.me ? 'You' : nameOf(message.senderId, directory);
  const task = meta.kind === 'task' ? work?.tasks?.find((t) => t.taskId === meta.id) : undefined;
  const approval =
    meta.kind === 'approval' ? work?.approvals?.find((a) => a.approvalId === meta.id) : undefined;
  const Icon = meta.kind === 'task' ? CheckSquare : Stamp;
  return (
    <div className="my-3 flex justify-center" data-testid="work-card">
      <article className="w-full max-w-xl rounded-xl border border-border bg-surface px-4 py-3 shadow-sm">
        <p className="flex items-center gap-2 text-meta text-text-subtle">
          <Icon className={cn('size-4', meta.kind === 'task' ? 'text-accent' : 'text-warning')} />
          <span>
            {who} {meta.kind === 'task' ? 'created a task' : 'asked for approval'} ·{' '}
            {formatTime(message.createdAt)}
          </span>
        </p>
        {task ? (
          <TaskLine task={task} directory={directory} showTitle />
        ) : approval ? (
          <ApprovalLine approval={approval} directory={directory} showTitle />
        ) : (
          <p className="mt-1.5 text-label text-text">
            {meta.title} <span className="text-text-subtle">· {meta.summary}</span>
          </p>
        )}
      </article>
    </div>
  );
}

/** A record action someone ran from the context panel (metadata.moduleAction). */
export function ModuleActionCard({
  message,
  directory,
}: {
  message: LocalMessage;
  directory: Map<string, DirectoryEntry>;
}) {
  const meta = message.metadata?.moduleAction as
    { module: SampledgeModule; label: string; status: string; note: string } | undefined;
  if (!meta) return null;
  return (
    <div className="my-2 flex justify-center" data-testid="module-action-card">
      <p className="flex max-w-xl items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-meta text-text-muted">
        <Send className="size-3.5 text-accent" />
        <span className="truncate">
          {message.content.text.split(':')[0] ?? nameOf(message.senderId, directory)}: {meta.label}{' '}
          in {moduleName(meta.module)}
          {meta.note ? ` · “${meta.note.slice(0, 80)}”` : ''}
        </span>
        <Badge
          tone={
            meta.status === 'sent' ? 'success' : meta.status === 'failed' ? 'danger' : 'planned'
          }
          className="shrink-0 px-1.5 text-[10px]"
        >
          {meta.status === 'test_mode'
            ? 'Test mode, not sent'
            : meta.status === 'not_configured'
              ? 'Not configured'
              : meta.status === 'sent'
                ? 'Sent'
                : 'Failed'}
        </Badge>
      </p>
    </div>
  );
}

function TaskLine({
  task: t,
  directory,
  showTitle,
}: {
  task: Task;
  directory: Map<string, DirectoryEntry>;
  showTitle?: boolean;
}) {
  const work = useConversationWork();
  const api = useWorkApi();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  const me = work?.me ?? '';
  const canEdit = t.createdBy === me || t.assigneeIds.includes(me);
  const due = t.status === 'done' || t.status === 'cancelled' ? null : dueLabel(t.dueAt);
  const toggle = async () => {
    setBusy(true);
    try {
      work?.setTask(
        await api.queueTaskUpdate(t, { status: t.status === 'done' ? 'open' : 'done' }),
      );
    } catch (e) {
      toast({
        title: 'Couldn’t update the task',
        description: (e as Error).message,
        tone: 'danger',
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2',
        showTitle ? 'mt-1.5' : 'rounded-lg bg-surface-raised px-3 py-2',
      )}
    >
      {showTitle ? (
        <span className="mr-1 text-label text-text">{t.title}</span>
      ) : (
        <CheckSquare className="size-4 text-accent" />
      )}
      <TaskStatusBadge status={t.status} />
      <PriorityBadge priority={t.priority} />
      {due ? <Badge tone={due.overdue ? 'danger' : 'neutral'}>{due.text}</Badge> : null}
      <PeopleStack ids={t.assigneeIds} directory={directory} />
      <div className="flex-1" />
      {canEdit && t.status !== 'cancelled' ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void toggle()}
          disabled={busy}
          loading={busy}
        >
          {t.status === 'done' ? (
            'Reopen'
          ) : (
            <>
              <Check /> Mark done
            </>
          )}
        </Button>
      ) : null}
    </div>
  );
}

function ApprovalLine({
  approval: a,
  directory,
  showTitle,
}: {
  approval: Approval;
  directory: Map<string, DirectoryEntry>;
  showTitle?: boolean;
}) {
  const work = useConversationWork();
  const me = work?.me ?? '';
  const canDecide =
    a.status === 'pending' &&
    a.approverIds.includes(me) &&
    !a.decisions.some((d) => d.userId === me);
  const money = formatMoney(a.amount);
  const last = a.decisions[a.decisions.length - 1];
  return (
    <div className={cn(showTitle ? 'mt-1.5' : 'rounded-lg bg-surface-raised px-3 py-2')}>
      <div className="flex flex-wrap items-center gap-2">
        {showTitle ? (
          <span className="mr-1 text-label text-text">{a.title}</span>
        ) : (
          <Stamp className="size-4 text-warning" />
        )}
        {money ? (
          <span className="font-display text-label tabular-nums text-text">{money}</span>
        ) : null}
        <ApprovalStatusBadge status={a.status} />
        <span className="text-meta text-text-subtle">
          {a.status === 'pending'
            ? `Waiting on ${a.approverIds
                .filter((id) => !a.decisions.some((d) => d.userId === id))
                .map((id) => (id === me ? 'you' : nameOf(id, directory).split(' ')[0]))
                .join(', ')}`
            : last
              ? `by ${last.userId === me ? 'you' : nameOf(last.userId, directory)}`
              : ''}
        </span>
        <div className="flex-1" />
        {canDecide ? (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => work?.decide(a, 'reject')}>
              <X /> Reject
            </Button>
            <Button size="sm" onClick={() => work?.decide(a, 'approve')}>
              <Check /> Approve
            </Button>
          </div>
        ) : null}
      </div>
      {last?.comment && a.status !== 'pending' ? (
        <p className="mt-1 text-meta text-text-muted">“{last.comment}”</p>
      ) : null}
    </div>
  );
}
