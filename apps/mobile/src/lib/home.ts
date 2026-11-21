import type { Approval, Task } from '@sampledge/contracts';
import { isOverdue, isMyTurn } from './work';

/** Your open tasks, overdue first, then by due date, then newest. */
export function sortMyTasks<T extends Pick<Task, 'dueAt' | 'status' | 'createdAt'>>(
  tasks: readonly T[],
  now = Date.now(),
): T[] {
  return tasks
    .filter((t) => t.status !== 'done' && t.status !== 'cancelled')
    .sort((a, b) => {
      const ao = isOverdue(a, now) ? 0 : 1;
      const bo = isOverdue(b, now) ? 0 : 1;
      if (ao !== bo) return ao - bo;
      if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
      if (a.dueAt || b.dueAt) return a.dueAt ? -1 : 1;
      return b.createdAt.localeCompare(a.createdAt);
    });
}

/** Approvals that need your decision now. */
export function waitingOnMe<T extends Approval>(approvals: readonly T[], selfId: string): T[] {
  return approvals.filter((a) => isMyTurn(a, selfId));
}

/** "You have 3 unread, 1 new for you and 2 meetings today." or the all-caught-up line. */
export function homeSummary(n: {
  unread: number;
  forYou: number;
  meetingsToday: number;
  approvals: number;
}): string {
  const parts = [
    n.unread ? `${n.unread} unread` : null,
    n.forYou ? `${n.forYou} new for you` : null,
    n.meetingsToday ? `${n.meetingsToday} meeting${n.meetingsToday === 1 ? '' : 's'} today` : null,
    n.approvals ? `${n.approvals} approval${n.approvals === 1 ? '' : 's'} waiting` : null,
  ].filter((x): x is string => !!x);
  if (!parts.length) return 'You’re all caught up. Nothing needs you right now.';
  const list =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  return `You have ${list}.`;
}
