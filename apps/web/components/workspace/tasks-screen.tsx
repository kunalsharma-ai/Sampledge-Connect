'use client';
import * as React from 'react';
import {
  Check,
  CheckSquare,
  CircleSlash,
  MessageSquare,
  Pencil,
  Plus,
  Stamp,
  X,
} from 'lucide-react';
import { TASK_STATUSES, type Approval, type Conversation, type Task } from '@sampledge/contracts';
import { Badge, Button, StateView, cn, useToast } from '@sampledge/ui';
import type { DirectoryEntry } from '@/lib/engine';
import { dueLabel, isActiveTask, sortTasks, useApprovals, useTasks, useWorkApi } from '@/lib/work';
import { conversationTitle, nameOf, relativeShort } from './helpers';
import { CreateTaskDialog, DecideDialog } from './work-dialogs';
import { EditApprovalDialog, EditTaskDialog, canEditApproval } from './edit-dialogs';
import {
  ApprovalStatusBadge,
  CATEGORY_LABEL,
  KIND_LABEL,
  PeopleStack,
  PriorityBadge,
  RecordChip,
  TASK_STATUS_LABEL,
  TaskStatusBadge,
  formatMoney,
} from './work-ui';
import { FeatureHelp } from '../feature-help';

type Tab = 'mine' | 'created' | 'to_decide' | 'requested';
const TABS: { id: Tab; label: string }[] = [
  { id: 'mine', label: 'My tasks' },
  { id: 'created', label: 'Created by me' },
  { id: 'to_decide', label: 'To decide' },
  { id: 'requested', label: 'My requests' },
];
const LS_TAB = 'sampledge.work.tab';

export function TasksScreen({
  me,
  directory,
  conversations,
  onOpenConversation,
}: {
  me: string;
  directory: Map<string, DirectoryEntry>;
  conversations: Conversation[];
  onOpenConversation: (id: string) => void;
}) {
  const [tab, setTabState] = React.useState<Tab>('mine');
  const [showDone, setShowDone] = React.useState(false);
  const [newTask, setNewTask] = React.useState(false);
  React.useEffect(() => {
    try {
      const t = localStorage.getItem(LS_TAB) as Tab | null;
      if (t && TABS.some((x) => x.id === t)) setTabState(t);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      localStorage.setItem(LS_TAB, t);
    } catch {
      /* ignore */
    }
  };

  const mine = useTasks('mine', me);
  const created = useTasks('created', me);
  const toDecide = useApprovals('to_decide', me);
  const requested = useApprovals('requested', me);
  const convById = React.useMemo(
    () => new Map(conversations.map((c) => [c.conversationId, c])),
    [conversations],
  );

  const pendingToDecide = (toDecide.items ?? []).filter(
    (a) => a.status === 'pending' && !a.decisions.some((d) => d.userId === me),
  ).length;
  const counts: Record<Tab, number> = {
    mine: (mine.items ?? []).filter(isActiveTask).length,
    created: (created.items ?? []).filter(isActiveTask).length,
    to_decide: pendingToDecide,
    requested: (requested.items ?? []).filter((a) => a.status === 'pending').length,
  };
  const isTaskTab = tab === 'mine' || tab === 'created';
  const list = tab === 'mine' ? mine : tab === 'created' ? created : null;
  const alist = tab === 'to_decide' ? toDecide : tab === 'requested' ? requested : null;

  const where = (conversationId: string | null) => {
    const c = conversationId ? convById.get(conversationId) : null;
    return c ? { id: c.conversationId, name: conversationTitle(c, me, directory) } : null;
  };

  return (
    <main
      className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0"
      aria-label="Tasks and approvals"
      data-testid="tasks-screen"
    >
      <header className="flex h-[60px] shrink-0 items-center gap-2 border-b border-border bg-surface/40 px-4 backdrop-blur-xl sm:px-6">
        <CheckSquare className="size-5 text-accent" />
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="mr-2 font-display text-h3 text-text">Tasks & Approvals</h1>
          <FeatureHelp id="tasks" />
        </div>
        <span className="hidden text-label font-normal text-text-muted md:inline">
          Work raised in chat, by you or by Sampledge modules.
        </span>
        <div className="flex-1" />
        <Button
          size="sm"
          onClick={() => setNewTask(true)}
          disabled={!mine.online}
          aria-label="New task"
        >
          <Plus /> <span className="hidden sm:inline">New task</span>
        </Button>
      </header>

      <div className="flex items-center gap-1.5 overflow-x-auto border-b border-border px-4 py-3 sm:px-6">
        <div role="tablist" aria-label="Work lists" className="flex shrink-0 items-center gap-1.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-label transition-colors',
                tab === t.id
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-border text-text-muted hover:border-border-strong hover:text-text',
              )}
            >
              {t.label}
              {counts[t.id] ? (
                <span
                  className={cn(
                    'min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold leading-5',
                    t.id === 'to_decide'
                      ? 'bg-warning/20 text-warning'
                      : 'bg-surface-raised text-text-muted',
                  )}
                >
                  {counts[t.id]}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <label className="flex shrink-0 items-center gap-2 text-meta text-text-muted">
          <input
            type="checkbox"
            checked={showDone}
            onChange={(e) => setShowDone(e.target.checked)}
            className="size-4 accent-[var(--sc-color-accent)]"
          />
          Show finished
        </label>
      </div>

      <section className="min-h-0 flex-1 overflow-y-auto">
        {isTaskTab && list ? (
          <TaskList
            items={list.items}
            error={list.error}
            online={list.online}
            showDone={showDone}
            me={me}
            directory={directory}
            where={where}
            conversationOf={(id) => (id ? (convById.get(id) ?? null) : null)}
            onOpenConversation={onOpenConversation}
            onChanged={(t) =>
              list.setItems((cur) => cur?.map((x) => (x.taskId === t.taskId ? t : x)) ?? cur)
            }
            empty={
              tab === 'mine'
                ? {
                    title: 'Nothing assigned to you',
                    description:
                      'Tasks you’re assigned appear here: from a message (hover it, then “Create task”), or from Samptrek, Sampcode and other modules.',
                  }
                : {
                    title: 'You haven’t created any tasks',
                    description: 'Turn a message into a task from its hover menu, or use New task.',
                  }
            }
          />
        ) : alist ? (
          <ApprovalList
            items={alist.items}
            error={alist.error}
            online={alist.online}
            showDone={showDone}
            me={me}
            directory={directory}
            where={where}
            canDecide={tab === 'to_decide'}
            onOpenConversation={onOpenConversation}
            onChanged={(a) =>
              alist.setItems(
                (cur) => cur?.map((x) => (x.approvalId === a.approvalId ? a : x)) ?? cur,
              )
            }
            empty={
              tab === 'to_decide'
                ? {
                    title: 'No approvals waiting for you',
                    description:
                      'Pricing, budget, expense, survey and leave approvals you’re asked to decide appear here.',
                  }
                : {
                    title: 'You haven’t requested any approvals',
                    description:
                      'Ask for approval from a message’s hover menu in any conversation.',
                  }
            }
          />
        ) : null}
      </section>

      <CreateTaskDialog
        open={newTask}
        onOpenChange={setNewTask}
        source={null}
        me={me}
        directory={directory}
      />
    </main>
  );
}

type Where = (conversationId: string | null) => { id: string; name: string } | null;

function ListState<T>({
  items,
  error,
  online,
  empty,
  children,
}: {
  items: T[] | null;
  error: string | null;
  online: boolean;
  empty: { title: string; description: string };
  children: (items: T[]) => React.ReactNode;
}) {
  if (items === null)
    return online ? (
      <StateView state="loading" title="Loading" />
    ) : (
      <StateView state="offline" description="This list loads when you’re back online." />
    );
  if (error && items.length === 0) return <StateView state="error" description={error} />;
  if (items.length === 0) return <StateView state="empty" {...empty} />;
  return <>{children(items)}</>;
}

function TaskList({
  items,
  error,
  online,
  showDone,
  me,
  directory,
  where,
  conversationOf,
  onOpenConversation,
  onChanged,
  empty,
}: {
  items: Task[] | null;
  error: string | null;
  online: boolean;
  showDone: boolean;
  me: string;
  directory: Map<string, DirectoryEntry>;
  where: Where;
  conversationOf: (id: string | null) => Conversation | null;
  onOpenConversation: (id: string) => void;
  onChanged: (t: Task) => void;
  empty: { title: string; description: string };
}) {
  const api = useWorkApi();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<Task | null>(null);
  const visible = items ? sortTasks(items.filter((t) => showDone || isActiveTask(t))) : null;
  const hiddenDone = items ? items.length - (visible?.length ?? 0) : 0;

  const setStatus = async (t: Task, status: Task['status']) => {
    setBusy(t.taskId);
    try {
      onChanged(await api.queueTaskUpdate(t, { status }));
    } catch (e) {
      toast({
        title: 'Couldn’t update the task',
        description: (e as Error).message,
        tone: 'danger',
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <ListState
        items={visible}
        error={error}
        online={online}
        empty={
          hiddenDone
            ? {
                title: 'All caught up',
                description: `${hiddenDone} finished task${hiddenDone === 1 ? '' : 's'} hidden. Tick “Show finished” to see them.`,
              }
            : empty
        }
      >
        {(rows) => (
          <ul className="divide-y divide-border" data-testid="task-list">
            {rows.map((t) => {
              const due = isActiveTask(t) ? dueLabel(t.dueAt) : null;
              const w = where(t.conversationId);
              const canEdit = t.createdBy === me || t.assigneeIds.includes(me);
              return (
                <li key={t.taskId} className="flex gap-3 px-4 py-3.5 sm:px-6">
                  <button
                    aria-label={t.status === 'done' ? `Reopen ${t.title}` : `Mark ${t.title} done`}
                    disabled={!canEdit || busy === t.taskId || t.status === 'cancelled'}
                    onClick={() => void setStatus(t, t.status === 'done' ? 'open' : 'done')}
                    className={cn(
                      'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors disabled:opacity-40',
                      t.status === 'done'
                        ? 'border-success bg-success text-bg'
                        : 'border-border-strong hover:border-accent hover:bg-accent-soft',
                    )}
                  >
                    {t.status === 'done' ? <Check className="size-3.5" /> : null}
                    {t.status === 'cancelled' ? (
                      <CircleSlash className="size-3.5 text-text-subtle" />
                    ) : null}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          'text-label text-text',
                          !isActiveTask(t) && 'text-text-muted line-through decoration-text-subtle',
                        )}
                      >
                        {t.title}
                      </span>
                      {t.kind !== 'task' ? (
                        <Badge tone="accent2">{KIND_LABEL[t.kind]}</Badge>
                      ) : null}
                      <PriorityBadge priority={t.priority} />
                      {due ? (
                        <Badge tone={due.overdue ? 'danger' : 'neutral'}>{due.text}</Badge>
                      ) : null}
                    </div>
                    {t.sourceExcerpt ? (
                      <p className="mt-1 line-clamp-1 border-l-2 border-border pl-2 text-meta text-text-subtle">
                        {t.sourceExcerpt}
                      </p>
                    ) : t.description ? (
                      <p className="mt-1 line-clamp-1 text-meta text-text-muted">{t.description}</p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-meta text-text-subtle">
                      <PeopleStack ids={t.assigneeIds} directory={directory} />
                      {t.record ? <RecordChip record={t.record} /> : null}
                      {w ? (
                        <button
                          onClick={() => onOpenConversation(w.id)}
                          className="inline-flex items-center gap-1 hover:text-text"
                        >
                          <MessageSquare className="size-3.5" /> {w.name}
                        </button>
                      ) : null}
                      <span>
                        {t.origin === 'module'
                          ? 'From module'
                          : `By ${t.createdBy === me ? 'you' : nameOf(t.createdBy, directory)}`}{' '}
                        · {relativeShort(t.createdAt)}
                      </span>
                      {t.moduleSync ? (
                        <span title="What happened when this task was sent to the module">
                          {t.moduleSync.status === 'test_mode'
                            ? 'Module: test mode, not sent'
                            : t.moduleSync.status === 'sent'
                              ? 'Sent to module'
                              : t.moduleSync.status === 'failed'
                                ? 'Module send failed'
                                : 'Module not configured'}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-start gap-1">
                    {canEdit && t.status !== 'cancelled' && t.origin !== 'module' ? (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Edit ${t.title}`}
                        title="Edit task"
                        onClick={() => setEditing(t)}
                      >
                        <Pencil />
                      </Button>
                    ) : null}
                    {canEdit ? (
                      <select
                        aria-label={`Status of ${t.title}`}
                        value={t.status}
                        disabled={busy === t.taskId}
                        onChange={(e) => void setStatus(t, e.target.value as Task['status'])}
                        className="h-8 rounded-sm border border-border bg-surface px-2 text-meta text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                      >
                        {TASK_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {TASK_STATUS_LABEL[s]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <TaskStatusBadge status={t.status} />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </ListState>
      {editing ? (
        <EditTaskDialog
          task={editing}
          conversation={conversationOf(editing.conversationId)}
          directory={directory}
          onOpenChange={(o) => !o && setEditing(null)}
          onSaved={onChanged}
        />
      ) : null}
    </>
  );
}

function ApprovalList({
  items,
  error,
  online,
  showDone,
  me,
  directory,
  where,
  canDecide,
  onOpenConversation,
  onChanged,
  empty,
}: {
  items: Approval[] | null;
  error: string | null;
  online: boolean;
  showDone: boolean;
  me: string;
  directory: Map<string, DirectoryEntry>;
  where: Where;
  canDecide: boolean;
  onOpenConversation: (id: string) => void;
  onChanged: (a: Approval) => void;
  empty: { title: string; description: string };
}) {
  const api = useWorkApi();
  const { toast } = useToast();
  const [deciding, setDeciding] = React.useState<{ a: Approval; d: 'approve' | 'reject' } | null>(
    null,
  );
  const [editing, setEditing] = React.useState<Approval | null>(null);
  const visible = items
    ? [...items]
        .filter((a) => showDone || a.status === 'pending')
        .sort(
          (a, b) =>
            Number(b.status === 'pending') - Number(a.status === 'pending') ||
            b.createdAt.localeCompare(a.createdAt),
        )
    : null;
  const hidden = items ? items.length - (visible?.length ?? 0) : 0;

  const cancel = async (a: Approval) => {
    try {
      onChanged(await api.cancelApproval(a.approvalId));
      toast({ title: 'Request cancelled', tone: 'success' });
    } catch (e) {
      toast({ title: 'Couldn’t cancel', description: (e as Error).message, tone: 'danger' });
    }
  };

  return (
    <>
      <ListState
        items={visible}
        error={error}
        online={online}
        empty={
          hidden
            ? {
                title: 'All caught up',
                description: `${hidden} decided request${hidden === 1 ? '' : 's'} hidden. Tick “Show finished” to see them.`,
              }
            : empty
        }
      >
        {(rows) => (
          <ul className="divide-y divide-border" data-testid="approval-list">
            {rows.map((a) => {
              const w = where(a.conversationId);
              const mine = a.decisions.find((d) => d.userId === me);
              const money = formatMoney(a.amount);
              const due = a.status === 'pending' ? dueLabel(a.dueAt) : null;
              return (
                <li key={a.approvalId} className="px-4 py-3.5 sm:px-6">
                  <div className="flex flex-wrap items-start gap-3">
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-warning/15 text-warning">
                      <Stamp className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-label text-text">{a.title}</span>
                        {money ? (
                          <span className="font-display text-label tabular-nums text-text">
                            {money}
                          </span>
                        ) : null}
                        <Badge tone="neutral">{CATEGORY_LABEL[a.category]}</Badge>
                        <ApprovalStatusBadge status={a.status} />
                        {due ? (
                          <Badge tone={due.overdue ? 'danger' : 'neutral'}>{due.text}</Badge>
                        ) : null}
                      </div>
                      {a.description && a.description !== a.title ? (
                        <p className="mt-1 line-clamp-2 text-meta text-text-muted">
                          {a.description}
                        </p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-meta text-text-subtle">
                        <span>
                          Asked by {a.requesterId === me ? 'you' : nameOf(a.requesterId, directory)}{' '}
                          · {relativeShort(a.createdAt)}
                        </span>
                        <span>
                          {a.approverIds.length > 1
                            ? `${a.policy === 'all' ? 'Everyone' : 'Any one'} of ${a.approverIds.map((id) => (id === me ? 'you' : nameOf(id, directory).split(' ')[0])).join(', ')}`
                            : `Approver: ${a.approverIds[0] === me ? 'you' : nameOf(a.approverIds[0]!, directory)}`}
                        </span>
                        {a.record ? <RecordChip record={a.record} /> : null}
                        {w ? (
                          <button
                            onClick={() => onOpenConversation(w.id)}
                            className="inline-flex items-center gap-1 hover:text-text"
                          >
                            <MessageSquare className="size-3.5" /> {w.name}
                          </button>
                        ) : null}
                      </div>
                      {a.decisions.length ? (
                        <ul className="mt-2 space-y-1">
                          {a.decisions.map((d) => (
                            <li key={d.userId + d.at} className="text-meta text-text-muted">
                              <span
                                className={
                                  d.decision === 'approve' ? 'text-success' : 'text-danger'
                                }
                              >
                                {d.decision === 'approve' ? 'Approved' : 'Rejected'}
                              </span>{' '}
                              by {d.userId === me ? 'you' : nameOf(d.userId, directory)}
                              {d.comment ? (
                                <span className="text-text-subtle">: “{d.comment}”</span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {canDecide && a.status === 'pending' && !mine ? (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setDeciding({ a, d: 'reject' })}
                          >
                            <X /> Reject
                          </Button>
                          <Button size="sm" onClick={() => setDeciding({ a, d: 'approve' })}>
                            <Check /> Approve
                          </Button>
                        </>
                      ) : null}
                      {canEditApproval(a, me) ? (
                        <Button size="sm" variant="ghost" onClick={() => setEditing(a)}>
                          <Pencil /> Edit
                        </Button>
                      ) : null}
                      {!canDecide && a.status === 'pending' && a.requesterId === me ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!online}
                          onClick={() => void cancel(a)}
                        >
                          Cancel request
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </ListState>
      <DecideDialog
        approval={deciding?.a ?? null}
        decision={deciding?.d ?? 'approve'}
        onOpenChange={(o) => !o && setDeciding(null)}
        onDecided={onChanged}
      />
      <EditApprovalDialog approval={editing} onOpenChange={(o) => !o && setEditing(null)} />
    </>
  );
}
