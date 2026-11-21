import type {
  Approval,
  ApprovalCategory,
  Money,
  Task,
  TaskKind,
  TaskPriority,
  TaskStatus,
} from '@sampledge/contracts';

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
  cancelled: 'Cancelled',
};
export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};
export const TASK_KIND_LABEL: Record<TaskKind, string> = {
  task: 'Task',
  bug: 'Bug',
  follow_up: 'Follow-up',
  escalation: 'Escalation',
};
export const APPROVAL_CATEGORY_LABEL: Record<ApprovalCategory, string> = {
  general: 'General',
  pricing: 'Pricing',
  survey: 'Survey',
  expense: 'Expense',
  budget: 'Budget',
  invoice: 'Invoice',
  leave: 'Leave',
};
export const APPROVAL_STATUS_LABEL: Record<Approval['status'], string> = {
  pending: 'Waiting',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

/** `metadata.work` on the card a task or approval posts in its conversation. */
export interface WorkCardMeta {
  kind: 'task' | 'approval';
  id: string;
  title: string;
  status: string;
  summary: string;
}

export function workMeta(metadata: Record<string, unknown>): WorkCardMeta | null {
  const w = metadata.work as Partial<WorkCardMeta> | undefined;
  if (!w || (w.kind !== 'task' && w.kind !== 'approval') || typeof w.id !== 'string') return null;
  return {
    kind: w.kind,
    id: w.id,
    title: typeof w.title === 'string' ? w.title : '',
    status: typeof w.status === 'string' ? w.status : '',
    summary: typeof w.summary === 'string' ? w.summary : '',
  };
}

/** "USD 1,250.00" from minor units. */
export function formatMoney(m: Money): string {
  const major = m.amountMinor / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: m.currency }).format(
      major,
    );
  } catch {
    return `${m.currency} ${major.toFixed(2)}`;
  }
}

/** Parses "1,250.50" into minor units; null when it is not a positive amount. */
export function parseAmount(text: string): number | null {
  const t = text.replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const minor = Math.round(Number(t) * 100);
  return minor > 0 ? minor : null;
}

/** True when you are an approver of a pending approval and have not decided yet. */
export function isMyTurn(a: Approval, selfId: string): boolean {
  return (
    a.status === 'pending' &&
    a.approverIds.includes(selfId) &&
    !a.decisions.some((d) => d.userId === selfId)
  );
}

/** "1 of 2 approved" for everyone-must-approve, "Any one approver" otherwise. */
export function approvalProgress(a: Approval): string {
  const yes = a.decisions.filter((d) => d.decision === 'approve').length;
  return a.policy === 'all'
    ? `${yes} of ${a.approverIds.length} approved`
    : a.approverIds.length > 1
      ? 'Any one approver decides'
      : 'One approver';
}

export function isOverdue(t: Pick<Task, 'dueAt' | 'status'>, now = Date.now()): boolean {
  return !!t.dueAt && Date.parse(t.dueAt) < now && t.status !== 'done' && t.status !== 'cancelled';
}

/** Due-date choices for the task form, at 5 PM local time. */
export function dueChoices(now: Date): { key: string; label: string; at: Date | null }[] {
  const at = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(17, 0, 0, 0);
    return d;
  };
  const toFriday = (5 - now.getDay() + 7) % 7;
  return [
    { key: 'none', label: 'No due date', at: null },
    { key: 'today', label: 'Today', at: at(0) },
    { key: 'tomorrow', label: 'Tomorrow', at: at(1) },
    { key: 'friday', label: toFriday === 0 ? 'Next Friday' : 'Friday', at: at(toFriday || 7) },
    { key: 'week', label: 'In a week', at: at(7) },
  ];
}

/** First line of a message, as a task or approval title. */
export function titleFrom(text: string | undefined): string {
  const line = (text ?? '').split('\n').find((l) => l.trim()) ?? '';
  return line.trim().slice(0, 200);
}
