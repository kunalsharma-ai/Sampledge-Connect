'use client';
import * as React from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckSquare,
  ExternalLink,
  FolderKanban,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Stamp,
} from 'lucide-react';
import type { Milestone, Project } from '@sampledge/contracts';
import { Badge, Button, Input, StateView, cn } from '@sampledge/ui';
import type { DirectoryEntry } from '@/lib/engine';
import { dueLabel, useProjects } from '@/lib/work';
import { relativeShort } from './helpers';
import { NewProjectDialog } from './work-dialogs';
import { EditProjectDialog, canEditProject } from './edit-dialogs';
import { useAuth } from '@/lib/auth';
import { PeopleStack } from './work-ui';

const STATUS: Record<
  Project['status'],
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'accent' }
> = {
  active: { label: 'Active', tone: 'success' },
  on_hold: { label: 'On hold', tone: 'neutral' },
  at_risk: { label: 'At risk', tone: 'danger' },
  completed: { label: 'Completed', tone: 'accent' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};
const MS_TONE: Record<Milestone['status'], string> = {
  upcoming: 'bg-surface-raised border-border-strong',
  due: 'bg-warning border-warning',
  reached: 'bg-success border-success',
  missed: 'bg-danger border-danger',
};
const MS_LABEL: Record<Milestone['status'], string> = {
  upcoming: 'Upcoming',
  due: 'Due',
  reached: 'Reached',
  missed: 'Missed',
};

type Filter = 'open' | 'samptrek' | 'connect' | 'all';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'open', label: 'In progress' },
  { id: 'samptrek', label: 'From Samptrek' },
  { id: 'connect', label: 'Made in Connect' },
  { id: 'all', label: 'All' },
];

export function ProjectsScreen({
  me,
  directory,
  onOpenConversation,
}: {
  me: string;
  directory: Map<string, DirectoryEntry>;
  onOpenConversation: (id: string) => void;
}) {
  const { items, error, online, refresh } = useProjects();
  const [filter, setFilter] = React.useState<Filter>('open');
  const [q, setQ] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<Project | null>(null);
  const { session } = useAuth();
  const isAdmin = session?.user.role === 'owner' || session?.user.role === 'admin';

  const shown = (items ?? []).filter((p) => {
    if (filter === 'open' && (p.status === 'completed' || p.status === 'cancelled')) return false;
    if (filter === 'samptrek' && p.source !== 'samptrek') return false;
    if (filter === 'connect' && p.source !== 'connect') return false;
    const s = q.trim().toLowerCase();
    return !s || `${p.name} ${p.description}`.toLowerCase().includes(s);
  });
  const totals = (items ?? []).reduce(
    (t, p) => ({
      open: t.open + p.openTasks,
      overdue: t.overdue + p.overdueTasks,
      approvals: t.approvals + p.pendingApprovals,
      risk: t.risk + Number(p.status === 'at_risk'),
    }),
    { open: 0, overdue: 0, approvals: 0, risk: 0 },
  );

  return (
    <main
      className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0"
      aria-label="Projects"
      data-testid="projects-screen"
    >
      <header className="flex h-[60px] shrink-0 items-center gap-2 border-b border-border bg-surface/40 px-4 backdrop-blur-xl sm:px-6">
        <FolderKanban className="size-5 text-accent" />
        <h1 className="mr-2 font-display text-h3 text-text">Projects</h1>
        <span className="hidden text-label font-normal text-text-muted md:inline">
          Samptrek projects and projects made here, each with its own channel.
        </span>
        <div className="flex-1" />
        <Button
          size="sm"
          onClick={() => setCreating(true)}
          disabled={!online}
          aria-label="New project"
        >
          <Plus /> <span className="hidden sm:inline">New project</span>
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {items?.length ? (
          <div className="grid grid-cols-2 gap-3 px-4 pt-4 sm:px-6 lg:grid-cols-4">
            <Stat icon={CheckSquare} label="Open tasks" value={totals.open} />
            <Stat
              icon={CalendarClock}
              label="Overdue tasks"
              value={totals.overdue}
              tone={totals.overdue ? 'danger' : undefined}
            />
            <Stat
              icon={Stamp}
              label="Approvals waiting"
              value={totals.approvals}
              tone={totals.approvals ? 'warning' : undefined}
            />
            <Stat
              icon={AlertTriangle}
              label="Projects at risk"
              value={totals.risk}
              tone={totals.risk ? 'danger' : undefined}
            />
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 px-4 py-4 sm:px-6">
          <div role="tablist" aria-label="Filter projects" className="flex gap-1.5 overflow-x-auto">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  'shrink-0 rounded-full border px-3 py-1 text-label transition-colors',
                  filter === f.id
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-border text-text-muted hover:border-border-strong hover:text-text',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <label className="relative ml-auto w-full sm:w-64">
            <span className="sr-only">Search projects</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-subtle" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search projects"
              className="pl-9"
            />
          </label>
        </div>

        {items === null ? (
          online ? (
            <StateView state="loading" title="Loading projects" />
          ) : (
            <StateView state="offline" description="Projects load when you’re back online." />
          )
        ) : error && items.length === 0 ? (
          <StateView
            state="error"
            description={error}
            action={
              <Button variant="secondary" onClick={() => void refresh()}>
                Try again
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <StateView
            state="empty"
            title="No projects yet"
            description="Create one here, or connect Samptrek under Integrations so its projects, milestones and deadlines appear automatically."
            action={
              <Button onClick={() => setCreating(true)} disabled={!online}>
                <Plus /> New project
              </Button>
            }
          />
        ) : shown.length === 0 ? (
          <StateView state="empty" title="No matching projects" />
        ) : (
          <ul className="grid gap-3 px-4 pb-6 sm:px-6 xl:grid-cols-2" data-testid="project-list">
            {shown.map((p) => (
              <ProjectCard
                key={p.projectId}
                p={p}
                directory={directory}
                onEdit={canEditProject(p, me, isAdmin) ? () => setEditing(p) : undefined}
                onOpen={() => p.conversationId && onOpenConversation(p.conversationId)}
              />
            ))}
          </ul>
        )}
      </div>

      <EditProjectDialog project={editing} onOpenChange={(o) => !o && setEditing(null)} />
      <NewProjectDialog
        open={creating}
        onOpenChange={setCreating}
        me={me}
        directory={directory}
        onCreated={(p) => {
          void refresh();
          if (p.conversationId) onOpenConversation(p.conversationId);
        }}
      />
    </main>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone?: 'danger' | 'warning';
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <p className="flex items-center gap-2 text-meta text-text-subtle">
        <Icon className="size-4" /> {label}
      </p>
      <p
        className={cn(
          'mt-1 font-display text-h2 tabular-nums text-text',
          tone === 'danger' && 'text-danger',
          tone === 'warning' && 'text-warning',
        )}
      >
        {value}
      </p>
    </div>
  );
}

function ProjectCard({
  p,
  directory,
  onOpen,
  onEdit,
}: {
  p: Project;
  directory: Map<string, DirectoryEntry>;
  onOpen: () => void;
  onEdit?: () => void;
}) {
  const s = STATUS[p.status];
  const due = p.status === 'completed' || p.status === 'cancelled' ? null : dueLabel(p.dueAt);
  const reached = p.milestones.filter((m) => m.status === 'reached').length;
  const nextMs = p.milestones.find((m) => m.status === 'due' || m.status === 'upcoming');
  return (
    <li className="flex flex-col rounded-xl border border-border bg-surface p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <FolderKanban className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate font-display text-h3 text-text">{p.name}</h2>
            <Badge tone={s.tone}>{s.label}</Badge>
            <Badge tone="neutral">{p.source === 'samptrek' ? 'Samptrek' : 'Connect'}</Badge>
          </div>
          {p.description ? (
            <p className="mt-1 line-clamp-2 text-meta text-text-muted">{p.description}</p>
          ) : null}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2 text-meta">
        <div className="rounded-md bg-surface-raised px-3 py-2">
          <dt className="text-text-subtle">Open tasks</dt>
          <dd className="text-label tabular-nums text-text">{p.openTasks}</dd>
        </div>
        <div className="rounded-md bg-surface-raised px-3 py-2">
          <dt className="text-text-subtle">Overdue</dt>
          <dd
            className={cn('text-label tabular-nums', p.overdueTasks ? 'text-danger' : 'text-text')}
          >
            {p.overdueTasks}
          </dd>
        </div>
        <div className="rounded-md bg-surface-raised px-3 py-2">
          <dt className="text-text-subtle">Approvals</dt>
          <dd
            className={cn(
              'text-label tabular-nums',
              p.pendingApprovals ? 'text-warning' : 'text-text',
            )}
          >
            {p.pendingApprovals}
          </dd>
        </div>
      </dl>

      {p.milestones.length ? (
        <div className="mt-4">
          <div className="flex items-center justify-between text-meta text-text-subtle">
            <span>
              Milestones · {reached} of {p.milestones.length} reached
            </span>
            {nextMs ? (
              <span className="truncate pl-2">
                Next: <span className="text-text-muted">{nextMs.title}</span>
                {nextMs.dueAt ? ` · ${dueLabel(nextMs.dueAt)?.text.replace('Due ', '')}` : ''}
              </span>
            ) : null}
          </div>
          <ol className="mt-2 flex items-center" aria-label="Milestones">
            {p.milestones.slice(0, 12).map((m, i) => (
              <li
                key={m.milestoneId}
                className="flex flex-1 items-center last:flex-none"
                title={`${m.title}: ${MS_LABEL[m.status]}${m.dueAt ? `, ${new Date(m.dueAt).toLocaleDateString()}` : ''}`}
              >
                <span className={cn('size-3 shrink-0 rounded-full border-2', MS_TONE[m.status])}>
                  <span className="sr-only">
                    {m.title}: {MS_LABEL[m.status]}
                  </span>
                </span>
                {i < Math.min(p.milestones.length, 12) - 1 ? (
                  <span
                    className={cn(
                      'h-0.5 flex-1',
                      m.status === 'reached' ? 'bg-success/60' : 'bg-border',
                    )}
                  />
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-3 text-meta text-text-subtle">
        <PeopleStack ids={p.ownerIds.filter((id) => directory.has(id))} directory={directory} />
        {due ? <Badge tone={due.overdue ? 'danger' : 'neutral'}>{due.text}</Badge> : null}
        <span>Updated {relativeShort(p.updatedAt)}</span>
        <div className="flex-1" />
        {p.url ? (
          <Button asChild variant="ghost" size="sm">
            <a href={p.url} target="_blank" rel="noreferrer noopener">
              <ExternalLink /> Samptrek
            </a>
          </Button>
        ) : null}
        {onEdit ? (
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Pencil /> Edit
          </Button>
        ) : null}
        {p.conversationId ? (
          <Button variant="secondary" size="sm" onClick={onOpen}>
            <MessageSquare /> Open channel
          </Button>
        ) : null}
      </div>
    </li>
  );
}
