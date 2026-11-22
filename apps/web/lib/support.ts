'use client';
import * as React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  uuidv7,
  type CreateSupportQueryRequest,
  type SupportQuery,
  type SupportQueryList,
  type UpdateSupportQueryRequest,
} from '@sampledge/contracts';
import { apiRequest } from './api';
import { useAuth } from './auth';
import { useEngine, useEngineChange } from './engine';

export type SupportScope = 'mine' | 'org' | 'platform';

const listPath: Record<SupportScope, string> = {
  mine: '/v1/support/queries',
  org: '/v1/support/admin/queries',
  platform: '/v1/platform/support/queries',
};

/**
 * Help center queries for one scope: the cached list at once (offline too), then the server's,
 * kept live by `support:changed` and refetched after a reconnect.
 */
export function useSupportQueries(scope: SupportScope, enabled = true) {
  const { getAccessToken } = useAuth();
  const { db } = useEngine();
  const [items, setItems] = React.useState<SupportQuery[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const cacheKey = `support:${scope}`;

  const refresh = React.useCallback(async () => {
    if (!enabled) return;
    try {
      const r = await apiRequest<SupportQueryList>('GET', listPath[scope], {
        token: await getAccessToken(),
      });
      setItems(r.items);
      setError(null);
      void db.meta.put({ key: cacheKey, value: r.items });
    } catch (e) {
      setError((e as Error).message);
    }
  }, [enabled, scope, getAccessToken, db, cacheKey]);

  React.useEffect(() => {
    if (!enabled) return;
    let live = true;
    void db.meta.get(cacheKey).then((row) => {
      if (live && row?.value) setItems((cur) => cur ?? (row.value as SupportQuery[]));
    });
    void refresh();
    return () => {
      live = false;
    };
  }, [enabled, db, cacheKey, refresh]);

  useEngineChange(['support'], () => void refresh());

  return { items, error, refresh };
}

/** Questions and replies written on this device that have not reached the server yet. */
export function usePendingSupport() {
  const { db } = useEngine();
  return (
    useLiveQuery(() => db.actions.filter((a) => a.key.startsWith('support|')).toArray(), [db]) ?? []
  );
}

/** Writes go through the device's action queue: they work offline and send in order. */
export function useSupportActions() {
  const { engine } = useEngine();
  return React.useMemo(
    () => ({
      ask: (b: Omit<CreateSupportQueryRequest, 'clientId'>) => {
        const clientId = uuidv7();
        return engine.queueAction({
          key: `support|new|${clientId}`,
          method: 'POST',
          path: '/v1/support/queries',
          body: { ...b, clientId },
          label: `Ask “${b.subject}”`,
        });
      },
      reply: (q: SupportQuery, text: string, scope: SupportScope) => {
        const clientId = uuidv7();
        return engine.queueAction({
          key: `support|reply|${q.queryId}|${clientId}`,
          method: 'POST',
          path:
            scope === 'platform'
              ? `/v1/platform/support/queries/${q.tenantId}/${q.queryId}/replies`
              : `/v1/support/queries/${q.queryId}/replies`,
          body: { clientId, text },
          label: `Reply to “${q.subject}”`,
        });
      },
      update: (q: SupportQuery, b: UpdateSupportQueryRequest, scope: SupportScope) =>
        engine.queueAction({
          key: `support|update|${q.queryId}`,
          method: 'PATCH',
          path:
            scope === 'platform'
              ? `/v1/platform/support/queries/${q.tenantId}/${q.queryId}`
              : `/v1/support/queries/${q.queryId}`,
          body: b,
          label: `Update “${q.subject}”`,
        }),
    }),
    [engine],
  );
}
