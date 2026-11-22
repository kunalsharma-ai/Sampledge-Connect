import { uuidv7, type SupportQuery, type SupportQueryList } from '@sampledge/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ActionInput } from '../db/work';
import { useWorkspace } from './AppProvider';

export type SupportScope = 'mine' | 'org';
export const SUPPORT_LIST_PATH: Record<SupportScope, string> = {
  mine: '/v1/support/queries',
  org: '/v1/support/admin/queries',
};

/**
 * Help center questions: the cached list at once (offline too), then the server's. Re-read on
 * `support:changed`, after each queued change is sent, and after a reconnect.
 */
export function useSupportList(scope: SupportScope, enabled = true) {
  const { engine } = useWorkspace();
  const path = SUPPORT_LIST_PATH[scope];
  const [items, setItems] = useState<SupportQuery[] | null>(null);
  const reload = useCallback(async () => {
    const v = await engine.supportLoad<SupportQueryList>(path);
    setItems(v?.items ?? []);
  }, [engine, path]);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void engine.supportCached<SupportQueryList>(path).then((v) => {
      if (live && v) setItems(v.items);
      void reload();
    });
    const off = engine.events.on('support', () => {
      void engine.supportCached<SupportQueryList>(path).then((v) => live && v && setItems(v.items));
    });
    return () => {
      live = false;
      off();
    };
  }, [engine, path, reload, enabled]);
  return { items, reload };
}

type PendingSupport = Extract<ActionInput, { kind: 'support.act' }>;

/** Questions and replies written here that have not reached the server yet. */
export function useSupportPending(): PendingSupport[] {
  const { engine } = useWorkspace();
  const [pending, setPending] = useState<PendingSupport[]>([]);
  useEffect(() => {
    let live = true;
    const read = () => void engine.supportPending().then((p) => live && setPending(p));
    read();
    const off = engine.events.on('support', read);
    const offWork = engine.store.work.events.on('changed', (e) => e.kind === 'support' && read());
    return () => {
      live = false;
      off();
      offWork();
    };
  }, [engine]);
  return pending;
}

export function useSupportActions() {
  const { engine } = useWorkspace();
  return useMemo(
    () => ({
      ask: (b: {
        subject: string;
        body: string;
        topic: string;
        route: 'org' | 'platform';
        featureId: string | null;
      }) =>
        engine.supportAct({
          method: 'POST',
          path: '/v1/support/queries',
          body: { ...b, clientId: uuidv7() },
          label: `Ask “${b.subject}”`,
        }),
      reply: (q: SupportQuery, text: string) =>
        engine.supportAct({
          method: 'POST',
          path: `/v1/support/queries/${q.queryId}/replies`,
          body: { clientId: uuidv7(), text, queryId: q.queryId },
          label: `Reply to “${q.subject}”`,
        }),
      update: (q: SupportQuery, body: { status?: string; route?: 'platform' }) =>
        engine.supportAct({
          method: 'PATCH',
          path: `/v1/support/queries/${q.queryId}`,
          body,
          label: `Update “${q.subject}”`,
        }),
    }),
    [engine],
  );
}
