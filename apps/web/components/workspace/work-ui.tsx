'use client';
import * as React from 'react';
import { Check, ExternalLink } from 'lucide-react';
import {
  MODULE_CATALOG,
  type Approval,
  type Money,
  type Task,
  type WorkRecord,
} from '@sampledge/contracts';
import { Avatar, Badge, Input, cn } from '@sampledge/ui';
import type { DirectoryEntry } from '@/lib/engine';
import { avatarOf, avatarUrl, nameOf } from './helpers';

export const TASK_STATUS_LABEL: Record<Task['status'], string> = {
  open: 'Open',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
  cancelled: 'Cancelled',
};
const TASK_TONE = {
  open: 'accent',
  in_progress: 'accent2',
  blocked: 'warning',
  done: 'success',
  cancelled: 'neutral',
} as const;

export function TaskStatusBadge({ status }: { status: Task['status'] }) {
  return <Badge tone={TASK_TONE[status]}>{TASK_STATUS_LABEL[status]}</Badge>;
}

export const PRIORITY_LABEL: Record<Task['priority'], string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};
export function PriorityBadge({ priority }: { priority: Task['priority'] }) {
  if (priority === 'normal') return null;
  return (
    <Badge tone={priority === 'urgent' ? 'danger' : priority === 'high' ? 'warning' : 'neutral'}>
      {PRIORITY_LABEL[priority]}
    </Badge>
  );
}

export const KIND_LABEL: Record<Task['kind'], string> = {
  task: 'Task',
  bug: 'Bug',
  follow_up: 'Follow-up',
  escalation: 'Escalation',
};

export const APPROVAL_STATUS_LABEL: Record<Approval['status'], string> = {
  pending: 'Waiting for decision',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};
const APPROVAL_TONE = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
} as const;
export function ApprovalStatusBadge({ status }: { status: Approval['status'] }) {
  return <Badge tone={APPROVAL_TONE[status]}>{APPROVAL_STATUS_LABEL[status]}</Badge>;
}

export const CATEGORY_LABEL: Record<Approval['category'], string> = {
  general: 'General',
  pricing: 'Pricing',
  survey: 'Survey',
  expense: 'Expense',
  budget: 'Budget',
  invoice: 'Invoice',
  leave: 'Leave',
};

export function formatMoney(m: Money | null) {
  if (!m) return null;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: m.currency }).format(
      m.amountMinor / 100,
    );
  } catch {
    return `${(m.amountMinor / 100).toFixed(2)} ${m.currency}`;
  }
}

/** "Samptrek · Project: Acme brand tracker", linking out when the module gave a URL. */
export function RecordChip({ record, className }: { record: WorkRecord; className?: string }) {
  const name = MODULE_CATALOG[record.module]?.name ?? record.module;
  const body = (
    <>
      <span className="font-semibold">{name}</span>
      <span className="truncate">{record.title}</span>
      {record.url ? <ExternalLink className="size-3 shrink-0" /> : null}
    </>
  );
  const cls = cn(
    'inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-surface-raised px-2 py-0.5 text-meta text-text-muted',
    className,
  );
  return record.url ? (
    <a
      href={record.url}
      target="_blank"
      rel="noreferrer noopener"
      className={cn(cls, 'hover:text-text')}
    >
      {body}
    </a>
  ) : (
    <span className={cls}>{body}</span>
  );
}

export function PeopleStack({
  ids,
  directory,
  max = 3,
}: {
  ids: string[];
  directory: Map<string, DirectoryEntry>;
  max?: number;
}) {
  if (!ids.length) return <span className="text-meta text-text-subtle">Unassigned</span>;
  return (
    <span
      className="flex items-center gap-1.5"
      title={ids.map((id) => nameOf(id, directory)).join(', ')}
    >
      <span className="flex -space-x-2">
        {ids.slice(0, max).map((id) => (
          <Avatar key={id} name={nameOf(id, directory)} src={avatarOf(id, directory)} size="sm" className="ring-2 ring-surface" />
        ))}
      </span>
      {ids.length === 1 ? (
        <span className="truncate text-meta text-text-muted">{nameOf(ids[0]!, directory)}</span>
      ) : ids.length > max ? (
        <span className="text-meta text-text-subtle">+{ids.length - max}</span>
      ) : null}
    </span>
  );
}

/** Module bot accounts (they post module cards) aren't people to assign or ask. */
export const isModuleBot = (u: { email: string }) => u.email.endsWith('@modules.sampledge.invalid');

/** Pick people from a candidate list (conversation members, or the directory). */
export function PeoplePicker({
  candidates,
  picked,
  onChange,
  directory,
  label,
  emptyText = 'No one to pick here.',
}: {
  candidates: string[];
  picked: string[];
  onChange: (ids: string[]) => void;
  directory: Map<string, DirectoryEntry>;
  label: string;
  emptyText?: string;
}) {
  const [q, setQ] = React.useState('');
  const people = candidates
    .map((id) => directory.get(id))
    .filter((u): u is DirectoryEntry => !!u && !isModuleBot(u))
    .filter((u) => {
      const s = q.trim().toLowerCase();
      return !s || `${u.displayName} ${u.email} ${u.title ?? ''}`.toLowerCase().includes(s);
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  return (
    <div>
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search people"
        aria-label={`${label}: search people`}
      />
      <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto" aria-label={label}>
        {people.length === 0 ? (
          <li className="py-4 text-center text-label font-normal text-text-subtle">{emptyText}</li>
        ) : null}
        {people.map((u) => {
          const on = picked.includes(u.userId);
          return (
            <li key={u.userId}>
              <button
                type="button"
                onClick={() =>
                  onChange(on ? picked.filter((x) => x !== u.userId) : [...picked, u.userId])
                }
                aria-pressed={on}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left',
                  on ? 'bg-accent-soft' : 'hover:bg-surface-raised',
                )}
              >
                <Avatar name={u.displayName} src={avatarUrl(u.avatarUrl)} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-label text-text">{u.displayName}</span>
                  <span className="block truncate text-meta text-text-subtle">
                    {u.title ?? u.email}
                  </span>
                </span>
                {on ? <Check className="size-4 text-accent" /> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export const selectClass =
  'h-10 w-full rounded-md border border-border bg-surface px-3 text-label text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50';

/** <input type="date"> value ↔ end-of-day ISO in local time. */
export const dateToIso = (d: string) => (d ? new Date(`${d}T17:00:00`).toISOString() : null);
export const isoToDate = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
