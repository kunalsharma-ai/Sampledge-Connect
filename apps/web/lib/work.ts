'use client';
import * as React from 'react';
import type {
  Approval,
  CreateApprovalRequest,
  CreateProjectRequest,
  CreateTaskRequest,
  DecideApprovalRequest,
  LinkedRecord,
  ModuleAction,
  ModuleActionDef,
  Project,
  Task,
  UpdateTaskRequest,
} from '@sampledge/contracts';
import { apiRequest } from './api';
import { useAuth } from './auth';
import { useEngine } from './engine';

export type RecordWithActions = LinkedRecord & {
  actions: Pick<ModuleActionDef, 'type' | 'label' | 'description'>[];
};

export function useWorkApi() {
  const { getAccessToken } = useAuth();
  return React.useMemo(() => {
    const req = async <T>(method: string, path: string, body?: unknown) =>
      apiRequest<T>(method, path, { token: await getAccessToken(), body });
    return {
      tasks: (q: string) => req<Task[]>('GET', `/v1/tasks?${q}`),
      createTask: (b: CreateTaskRequest) => req<Task>('POST', '/v1/tasks', b),
      updateTask: (id: string, b: UpdateTaskRequest) => req<Task>('PATCH', `/v1/tasks/${id}`, b),
      approvals: (q: string) => req<Approval[]>('GET', `/v1/approvals?${q}`),
      createApproval: (b: CreateApprovalRequest) => req<Approval>('POST', '/v1/approvals', b),
      decide: (id: string, b: DecideApprovalRequest) =>
        req<Approval>('POST', `/v1/approvals/${id}/decision`, b),
      cancelApproval: (id: string) => req<Approval>('POST', `/v1/approvals/${id}/cancel`),
      projects: () => req<Project[]>('GET', '/v1/projects'),
      createProject: (b: CreateProjectRequest) => req<Project>('POST', '/v1/projects', b),
      records: (conversationId: string) =>
        req<RecordWithActions[]>(
          'GET',
          `/v1/integrations/records?conversationId=${conversationId}`,
        ),
      runAction: (linkId: string, action: string, note: string, messageId?: string) =>
        req<ModuleAction>('POST', `/v1/integrations/records/${linkId}/actions`, {
          action,
          note,
          messageId,
        }),
    };
  }, [getAccessToken]);
}

/**
 * A list fetched over REST, kept live by task/approval socket events, and cached in this
 * identity's IndexedDB so it still shows (read-only) offline.
 */
function useCachedList<T>(
  cacheKey: string,
  fetcher: () => Promise<T[]>,
  live: (
    prev: T[],
    e: { type: 'task'; task: Task } | { type: 'approval'; approval: Approval },
  ) => T[] | null,
) {
  const { db, engine, state } = useEngine();
  const [items, setItems] = React.useState<T[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const online = state.connectivity === 'online';
  const fetchRef = React.useRef(fetcher);
  fetchRef.current = fetcher;
  const liveRef = React.useRef(live);
  liveRef.current = live;
  const keyRef = React.useRef(cacheKey);
  keyRef.current = cacheKey;

  const refresh = React.useCallback(async () => {
    try {
      const v = await fetchRef.current();
      // The list switched (another conversation) while this was in flight.
      if (keyRef.current !== cacheKey) return;
      setItems(v);
      setError(null);
      void db.meta.put({ key: cacheKey, value: v });
    } catch (e) {
      if (keyRef.current === cacheKey) setError((e as Error).message);
    }
  }, [db, cacheKey]);

  React.useEffect(() => {
    setItems(null);
    setError(null);
    void db.meta.get(cacheKey).then((row) => {
      if (row && keyRef.current === cacheKey) setItems((s) => s ?? (row.value as T[]));
    });
  }, [db, cacheKey]);
  React.useEffect(() => {
    if (online) void refresh();
  }, [online, refresh]);
  React.useEffect(
    () =>
      engine.onWork((e) => {
        setItems((prev) => {
          if (!prev) return prev;
          const next = liveRef.current(prev, e);
          if (next === null) {
            void refresh();
            return prev;
          }
          void db.meta.put({ key: cacheKey, value: next });
          return next;
        });
      }),
    [engine, db, cacheKey, refresh],
  );
  return { items, setItems, error, refresh, online };
}

const ACTIVE = new Set(['open', 'in_progress', 'blocked']);

export function useTasks(
  scope: 'mine' | 'created' | 'conversation',
  me: string,
  conversationId?: string,
) {
  const api = useWorkApi();
  const q = `scope=${scope}&status=any${conversationId ? `&conversationId=${conversationId}` : ''}`;
  return useCachedList<Task>(
    `work.tasks.${scope}.${conversationId ?? ''}`,
    // A conversation list with no conversation open is simply empty.
    () => (scope === 'conversation' && !conversationId ? Promise.resolve([]) : api.tasks(q)),
    (prev, e) => {
      if (e.type !== 'task') return prev;
      const t = e.task;
      const belongs =
        scope === 'mine'
          ? t.assigneeIds.includes(me)
          : scope === 'created'
            ? t.createdBy === me
            : t.conversationId === conversationId;
      const rest = prev.filter((x) => x.taskId !== t.taskId);
      return belongs ? [t, ...rest] : rest;
    },
  );
}

export function useApprovals(
  scope: 'to_decide' | 'requested' | 'conversation',
  me: string,
  conversationId?: string,
) {
  const api = useWorkApi();
  const q = `scope=${scope}&status=any${conversationId ? `&conversationId=${conversationId}` : ''}`;
  return useCachedList<Approval>(
    `work.approvals.${scope}.${conversationId ?? ''}`,
    () => (scope === 'conversation' && !conversationId ? Promise.resolve([]) : api.approvals(q)),
    (prev, e) => {
      if (e.type !== 'approval') return prev;
      const a = e.approval;
      const belongs =
        scope === 'to_decide'
          ? a.approverIds.includes(me)
          : scope === 'requested'
            ? a.requesterId === me
            : a.conversationId === conversationId;
      const rest = prev.filter((x) => x.approvalId !== a.approvalId);
      return belongs ? [a, ...rest] : rest;
    },
  );
}

export function useProjects() {
  const api = useWorkApi();
  // Counts change with every task: refetch on work events rather than patching locally.
  return useCachedList<Project>(
    'work.projects',
    () => api.projects(),
    () => null,
  );
}

export const isActiveTask = (t: Task) => ACTIVE.has(t.status);

export function sortTasks(tasks: Task[]) {
  const pr = { urgent: 0, high: 1, normal: 2, low: 3 } as const;
  return [...tasks].sort((a, b) => {
    const act = Number(isActiveTask(b)) - Number(isActiveTask(a));
    if (act) return act;
    const da = a.dueAt ? Date.parse(a.dueAt) : Infinity;
    const dbb = b.dueAt ? Date.parse(b.dueAt) : Infinity;
    if (da !== dbb) return da - dbb;
    return pr[a.priority] - pr[b.priority];
  });
}

export function dueLabel(iso: string | null): { text: string; overdue: boolean } | null {
  if (!iso) return null;
  const d = new Date(iso);
  const days = Math.round((d.getTime() - Date.now()) / 86_400_000);
  const text =
    days === 0
      ? 'Due today'
      : days === 1
        ? 'Due tomorrow'
        : days === -1
          ? 'Due yesterday'
          : days < 0
            ? `${-days} days overdue`
            : `Due ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
  return { text, overdue: d.getTime() < Date.now() };
}
