'use client';
import * as React from 'react';
import { motion } from 'motion/react';
import {
  AtSign,
  CalendarClock,
  CalendarPlus,
  Check,
  CheckSquare,
  CircleCheck,
  CloudOff,
  Hash,
  Lock,
  MessageSquarePlus,
  MessagesSquare,
  Reply,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  Video,
  X,
} from 'lucide-react';
import type { Approval, Conversation, Notification, Task } from '@sampledge/contracts';
import { Avatar, Badge, Button, Skeleton, cn } from '@sampledge/ui';
import { motion as tokens } from '@sampledge/design-tokens';
import { useEngine, type DirectoryEntry } from '@/lib/engine';
import { useMeetings } from '@/lib/meetings';
import { dueLabel, isActiveTask, sortTasks, useApprovals, useTasks, useWorkApi } from '@/lib/work';
import type { NotificationsApi } from '@/lib/notifications';
import { conversationTitle, formatTime, nameOf, relativeShort } from './helpers';

function greeting(d: Date) {
  const h = d.getHours();
  return h < 5
    ? 'Good evening'
    : h < 12
      ? 'Good morning'
      : h < 18
        ? 'Good afternoon'
        : 'Good evening';
}

export interface HomeScreenProps {
  me: string;
  myName: string;
  tenantName: string;
  directory: Map<string, DirectoryEntry>;
  conversations: Conversation[];
  unread: Map<string, number>;
  notifications: NotificationsApi;
  onOpenConversation: (id: string) => void;
  onOpenNotification: (n: Notification) => void;
  onOpenMeeting: (m: { meetingId: string; startsAt: string }) => void;
  onOpenModule: (m: 'messages' | 'tasks' | 'meetings' | 'notifications' | 'search') => void;
  onNewConversation: () => void;
  onNewMeeting: () => void;
  onNewTask: () => void;
}

/**
 * Home: what needs you now. Every panel is built from the same live, cached lists as the
 * rest of the app, so it updates as things change on any device and still shows offline.
 */
export function HomeScreen(p: HomeScreenProps) {
  const { state } = useEngine();
  const offline = state.connectivity !== 'online';
  const [now] = React.useState(() => new Date());
  const [range] = React.useState(() => ({
    from: new Date(now.getTime() - 60 * 60_000),
    to: new Date(now.getTime() + 7 * 86_400_000),
  }));
  const meetings = useMeetings(range.from, range.to);
  const tasks = useTasks('mine', p.me);
  const approvals = useApprovals('to_decide', p.me);
  const work = useWorkApi();
  const [doneLocal, setDoneLocal] = React.useState<Set<string>>(new Set());
  const [decidedLocal, setDecidedLocal] = React.useState<Set<string>>(new Set());

  const byId = new Map(p.conversations.map((c) => [c.conversationId, c]));
  const unreadConvs = p.conversations
    .filter((c) => (p.unread.get(c.conversationId) ?? 0) > 0)
    .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''));
  const unreadTotal = unreadConvs.reduce((n, c) => n + (p.unread.get(c.conversationId) ?? 0), 0);
  const mentions = (p.notifications.items ?? []).filter((n) => !n.readAt);
  const myTasks = tasks.items
    ? sortTasks(tasks.items.filter((t) => isActiveTask(t) && !doneLocal.has(t.taskId)))
    : null;
  const overdue = myTasks?.filter((t) => dueLabel(t.dueAt)?.overdue).length ?? 0;
  const waiting = approvals.items
    ? approvals.items.filter(
        (a) =>
          a.status === 'pending' &&
          !decidedLocal.has(a.approvalId) &&
          !a.decisions.some((d) => d.userId === p.me),
      )
    : null;
  const upcoming = (meetings.items ?? []).filter(
    (m) => m.status === 'scheduled' && Date.parse(m.endsAt) > Date.now(),
  );
  const today = upcoming.filter((m) => new Date(m.startsAt).toDateString() === now.toDateString());

  const title = (c: Conversation) => conversationTitle(c, p.me, p.directory);
  const where = (id: string) => {
    const c = byId.get(id);
    return !c ? 'a conversation' : c.kind.startsWith('channel') ? `#${title(c)}` : title(c);
  };

  const markDone = async (t: Task) => {
    setDoneLocal((s) => new Set(s).add(t.taskId));
    await work.queueTaskUpdate(t, { status: 'done' });
  };
  const decide = async (a: Approval, decision: 'approve' | 'reject') => {
    setDecidedLocal((s) => new Set(s).add(a.approvalId));
    await work.queueDecision(a, { decision, comment: '' });
  };

  const summary = [
    unreadTotal ? `${unreadTotal} unread` : null,
    mentions.length ? `${mentions.length} new for you` : null,
    today.length ? `${today.length} meeting${today.length === 1 ? '' : 's'} today` : null,
    waiting?.length ? `${waiting.length} approval${waiting.length === 1 ? '' : 's'} waiting` : null,
  ].filter(Boolean);

  return (
    <main className="min-w-0 flex-1 overflow-y-auto pb-20 md:pb-0" data-testid="home-screen">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
        {/* Hero */}
        <motion.section
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={tokens.spring.gentle}
          className="relative overflow-hidden rounded-2xl border border-border bg-surface p-6 shadow-sm sm:p-8"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-accent/15 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-28 right-40 size-64 rounded-full bg-accent-2/10 blur-3xl"
          />
          <div className="relative flex flex-wrap items-end justify-between gap-6">
            <div className="min-w-0">
              <p className="text-meta uppercase tracking-wide text-text-subtle">
                {now.toLocaleDateString(undefined, {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}{' '}
                · {p.tenantName}
              </p>
              <h1 className="mt-2 font-display text-h1 text-text">
                {greeting(now)}, {p.myName.split(' ')[0]}
              </h1>
              <p className="mt-2 text-body text-text-muted">
                {summary.length
                  ? `You have ${summary.join(', ')}.`
                  : 'You’re all caught up. Nothing needs you right now.'}
              </p>
              {offline ? (
                <Badge tone="warning" className="mt-3 gap-1">
                  <CloudOff className="size-3.5" aria-hidden /> Offline: showing what’s saved on
                  this device
                </Badge>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={p.onNewConversation}>
                <MessageSquarePlus /> New message
              </Button>
              <Button variant="secondary" size="sm" onClick={p.onNewMeeting} disabled={offline}>
                <CalendarPlus /> Schedule
              </Button>
              <Button variant="secondary" size="sm" onClick={p.onNewTask} disabled={offline}>
                <CheckSquare /> New task
              </Button>
              <Button variant="ghost" size="sm" onClick={() => p.onOpenModule('search')}>
                <Search /> Search
              </Button>
            </div>
          </div>
        </motion.section>

        {/* Stat tiles */}
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            icon={MessagesSquare}
            label="Unread messages"
            value={unreadTotal}
            sub={
              unreadConvs.length
                ? `in ${unreadConvs.length} conversation${unreadConvs.length === 1 ? '' : 's'}`
                : 'All read'
            }
            onClick={() => p.onOpenModule('messages')}
          />
          <Stat
            icon={AtSign}
            label="For you"
            value={mentions.length}
            sub={mentions.length ? 'waiting for you' : 'None new'}
            onClick={() => p.onOpenModule('notifications')}
          />
          <Stat
            icon={CheckSquare}
            label="My open tasks"
            value={myTasks?.length ?? null}
            sub={overdue ? `${overdue} overdue` : 'None overdue'}
            tone={overdue ? 'danger' : undefined}
            onClick={() => p.onOpenModule('tasks')}
          />
          <Stat
            icon={ShieldCheck}
            label="Approvals for you"
            value={waiting?.length ?? null}
            sub={waiting?.length ? 'waiting on your decision' : 'Nothing to decide'}
            onClick={() => p.onOpenModule('tasks')}
          />
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[1.35fr_1fr]">
          <div className="flex flex-col gap-5">
            <Panel
              title="Catch up"
              icon={MessagesSquare}
              action={
                unreadConvs.length
                  ? { label: 'Open messages', run: () => p.onOpenModule('messages') }
                  : undefined
              }
            >
              {unreadConvs.length === 0 ? (
                <Empty text="No unread conversations." />
              ) : (
                <ul className="flex flex-col" data-testid="home-unread">
                  {unreadConvs.slice(0, 6).map((c) => {
                    const Icon =
                      c.kind === 'channel_private'
                        ? Lock
                        : c.kind === 'channel_public'
                          ? Hash
                          : c.kind === 'group'
                            ? Users
                            : null;
                    const other = c.memberIds.find((id) => id !== p.me);
                    return (
                      <li key={c.conversationId}>
                        <button
                          onClick={() => p.onOpenConversation(c.conversationId)}
                          className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-raised"
                        >
                          {Icon ? (
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-raised text-text-muted">
                              <Icon className="size-4" aria-hidden />
                            </span>
                          ) : (
                            <Avatar
                              name={other ? nameOf(other, p.directory) : '?'}
                              src={avatarOf(other, p.directory)}
                              size="sm"
                            />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-label text-text">{title(c)}</span>
                            <span className="block truncate text-meta text-text-subtle">
                              {c.topic ?? (c.kind === 'dm' ? 'Direct message' : 'Conversation')}
                            </span>
                          </span>
                          <span className="text-meta text-text-subtle">
                            {relativeShort(c.lastMessageAt)}
                          </span>
                          <span className="min-w-6 rounded-full bg-accent px-1.5 text-center text-meta font-medium tabular-nums text-accent-fg">
                            {p.unread.get(c.conversationId)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>

            <Panel
              title="For you"
              icon={AtSign}
              action={{ label: 'All notifications', run: () => p.onOpenModule('notifications') }}
            >
              {p.notifications.items === null ? (
                <Loading />
              ) : mentions.length === 0 ? (
                <Empty text="Nothing new for you." />
              ) : (
                <ul className="flex flex-col" data-testid="home-mentions">
                  {mentions.slice(0, 5).map((n) => (
                    <li key={n.notificationId}>
                      <button
                        onClick={() => p.onOpenNotification(n)}
                        className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-raised"
                      >
                        <Avatar
                          name={nameOf(n.actorId, p.directory)}
                          src={avatarOf(n.actorId, p.directory)}
                          size="sm"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 text-meta text-text-subtle">
                            {n.kind === 'reply' ? (
                              <Reply className="size-3" aria-hidden />
                            ) : (
                              <AtSign className="size-3" aria-hidden />
                            )}
                            <span className="text-label text-text">
                              {nameOf(n.actorId, p.directory)}
                            </span>
                            {VERB[n.kind] ?? 'notified you'} in{' '}
                            {where(n.conversationId)} · {relativeShort(n.createdAt)}
                          </span>
                          <span className="mt-0.5 line-clamp-2 block text-label font-normal text-text-muted">
                            {n.preview}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <div className="flex flex-col gap-5">
            <Panel
              title="Coming up"
              icon={CalendarClock}
              action={{ label: 'Calendar', run: () => p.onOpenModule('meetings') }}
            >
              {meetings.items === null ? (
                <Loading />
              ) : upcoming.length === 0 ? (
                <Empty text="No meetings in the next 7 days." />
              ) : (
                <ul className="flex flex-col gap-1" data-testid="home-meetings">
                  {upcoming.slice(0, 4).map((m) => {
                    const start = new Date(m.startsAt);
                    const live = start.getTime() - Date.now() < 10 * 60_000;
                    return (
                      <li key={m.meetingId}>
                        <button
                          onClick={() =>
                            p.onOpenMeeting({ meetingId: m.meetingId, startsAt: m.startsAt })
                          }
                          className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-raised"
                        >
                          <span className="flex w-11 shrink-0 flex-col items-center rounded-lg border border-border bg-surface-sunken py-1">
                            <span className="text-[10px] font-medium uppercase text-accent">
                              {start.toDateString() === now.toDateString()
                                ? 'Today'
                                : start.toLocaleDateString(undefined, { weekday: 'short' })}
                            </span>
                            <span className="font-display text-label leading-tight text-text">
                              {start.getDate()}
                            </span>
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-label text-text">{m.title}</span>
                            <span className="block truncate text-meta text-text-subtle">
                              {formatTime(m.startsAt)} to {formatTime(m.endsAt)} ·{' '}
                              {m.attendees.length} people
                            </span>
                          </span>
                          {live ? (
                            <Badge tone="success" className="gap-1">
                              <Video className="size-3" aria-hidden /> Starting
                            </Badge>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>

            <Panel
              title="My tasks"
              icon={CheckSquare}
              action={{ label: 'All tasks', run: () => p.onOpenModule('tasks') }}
            >
              {myTasks === null ? (
                <Loading />
              ) : myTasks.length === 0 ? (
                <Empty text="No open tasks assigned to you." icon={CircleCheck} />
              ) : (
                <ul className="flex flex-col" data-testid="home-tasks">
                  {myTasks.slice(0, 5).map((t) => {
                    const due = dueLabel(t.dueAt);
                    return (
                      <li
                        key={t.taskId}
                        className="group flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-raised"
                      >
                        <button
                          onClick={() => void markDone(t)}
                          aria-label={`Mark “${t.title}” done`}
                          className="flex size-5 shrink-0 items-center justify-center rounded-md border border-border-strong text-transparent transition-colors hover:border-success hover:text-success"
                        >
                          <Check className="size-3.5" />
                        </button>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-label text-text">{t.title}</span>
                          <span className="block truncate text-meta text-text-subtle">
                            {t.conversationId ? where(t.conversationId) : 'No conversation'}
                          </span>
                        </span>
                        {due ? (
                          <span
                            className={cn(
                              'text-meta',
                              due.overdue ? 'text-danger' : 'text-text-subtle',
                            )}
                          >
                            {due.text}
                          </span>
                        ) : null}
                        {t.priority === 'high' || t.priority === 'urgent' ? (
                          <Badge tone={t.priority === 'urgent' ? 'danger' : 'warning'}>
                            {t.priority === 'urgent' ? 'Urgent' : 'High'}
                          </Badge>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>

            <Panel title="Waiting on you" icon={ShieldCheck}>
              {waiting === null ? (
                <Loading />
              ) : waiting.length === 0 ? (
                <Empty text="No approvals waiting on your decision." icon={Sparkles} />
              ) : (
                <ul className="flex flex-col gap-2" data-testid="home-approvals">
                  {waiting.slice(0, 4).map((a) => (
                    <li
                      key={a.approvalId}
                      className="rounded-lg border border-border bg-surface-sunken/60 p-3"
                    >
                      <p className="truncate text-label text-text">{a.title}</p>
                      <p className="truncate text-meta text-text-subtle">
                        From {nameOf(a.requesterId, p.directory)}
                        {a.amount
                          ? ` · ${new Intl.NumberFormat(undefined, { style: 'currency', currency: a.amount.currency }).format(a.amount.amountMinor / 100)}`
                          : ''}
                        {a.conversationId ? ` · ${where(a.conversationId)}` : ''}
                      </p>
                      <div className="mt-2 flex gap-2">
                        <Button size="sm" onClick={() => void decide(a, 'approve')}>
                          <Check /> Approve
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void decide(a, 'reject')}>
                          <X /> Reject
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </main>
  );
}

const VERB: Record<string, string> = {
  mention: 'mentioned you',
  reply: 'replied',
  task: 'gave you a task',
  approval: 'asked for your approval',
  alert: 'sent an alert',
};

function avatarOf(id: string | undefined, dir: Map<string, DirectoryEntry>) {
  return id
    ? ((dir.get(id) as { avatarUrl?: string | null } | undefined)?.avatarUrl ?? undefined)
    : undefined;
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
  tone,
  onClick,
}: {
  icon: typeof Hash;
  label: string;
  value: number | null;
  sub: string;
  tone?: 'danger';
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group rounded-xl border border-border bg-surface p-4 text-left transition-[border-color,transform,box-shadow] duration-[var(--sc-duration-fast)] hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md"
    >
      <span className="flex items-center gap-2 text-meta text-text-subtle">
        <Icon className="size-4 text-accent" aria-hidden /> {label}
      </span>
      {value === null ? (
        <Skeleton className="mt-2 h-8 w-12" />
      ) : (
        <motion.span
          key={value}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-1 block font-display text-h1 tabular-nums text-text"
        >
          {value}
        </motion.span>
      )}
      <span className={cn('text-meta', tone === 'danger' ? 'text-danger' : 'text-text-subtle')}>
        {sub}
      </span>
    </button>
  );
}

function Panel({
  title,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  icon: typeof Hash;
  action?: { label: string; run: () => void };
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-2 flex items-center justify-between px-2">
        <h2 className="flex items-center gap-2 text-label text-text">
          <Icon className="size-4 text-text-subtle" aria-hidden /> {title}
        </h2>
        {action ? (
          <button onClick={action.run} className="text-meta text-accent hover:underline">
            {action.label}
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Empty({ text, icon: Icon = CircleCheck }: { text: string; icon?: typeof Hash }) {
  return (
    <p className="flex items-center gap-2 px-2 py-4 text-label font-normal text-text-subtle">
      <Icon className="size-4 text-success" aria-hidden /> {text}
    </p>
  );
}

function Loading() {
  return (
    <div className="flex flex-col gap-2 px-2 py-1">
      <Skeleton className="h-9" />
      <Skeleton className="h-9" />
    </div>
  );
}
