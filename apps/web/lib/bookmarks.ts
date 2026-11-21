'use client';
import * as React from 'react';
import type { Bookmark, Message } from '@sampledge/contracts';
import { apiRequest } from './api';
import { useAuth } from './auth';
import { useEngine } from './engine';

const CACHE_KEY = 'bookmarks';

export interface BookmarksApi {
  /** null until the first load (from cache or server). */
  items: Bookmark[] | null;
  ids: Set<string>;
  online: boolean;
  refresh(): Promise<void>;
  toggle(message: Message, save: boolean): Promise<void>;
}

/**
 * The signed-in user's private saved messages. Fetched over REST and cached in this
 * identity's IndexedDB so the list still opens offline. Saving needs a connection.
 */
export function useBookmarks(): BookmarksApi {
  const { db, state } = useEngine();
  const { getAccessToken } = useAuth();
  const [items, setItems] = React.useState<Bookmark[] | null>(null);
  const online = state.connectivity === 'online';

  const store = React.useCallback(
    (next: Bookmark[]) => {
      setItems(next);
      void db.meta.put({ key: CACHE_KEY, value: next });
    },
    [db],
  );

  const refresh = React.useCallback(async () => {
    try {
      const r = await apiRequest<{ items: Bookmark[] }>('GET', '/v1/bookmarks', {
        token: await getAccessToken(),
      });
      store(r.items);
    } catch {
      /* offline: keep the cached list */
    }
  }, [getAccessToken, store]);

  React.useEffect(() => {
    void db.meta.get(CACHE_KEY).then((row) => {
      if (row) setItems((s) => s ?? (row.value as Bookmark[]));
    });
  }, [db]);
  React.useEffect(() => {
    if (online) void refresh();
  }, [online, refresh]);

  const toggle = React.useCallback(
    async (message: Message, save: boolean) => {
      const prev = items ?? [];
      // Optimistic; rolled back if the server refuses.
      store(
        save
          ? [
              {
                messageId: message.messageId,
                conversationId: message.conversationId,
                createdAt: new Date().toISOString(),
                message,
              },
              ...prev.filter((b) => b.messageId !== message.messageId),
            ]
          : prev.filter((b) => b.messageId !== message.messageId),
      );
      try {
        await apiRequest(save ? 'PUT' : 'DELETE', `/v1/messages/${message.messageId}/bookmark`, {
          token: await getAccessToken(),
        });
      } catch (e) {
        store(prev);
        throw e;
      }
    },
    [items, store, getAccessToken],
  );

  const ids = React.useMemo(() => new Set((items ?? []).map((b) => b.messageId)), [items]);
  return { items, ids, online, refresh, toggle };
}

/** Pin or unpin for everyone. The server broadcasts `message:updated`, which updates the timeline. */
export async function setPinned(
  getAccessToken: () => Promise<string | null>,
  messageId: string,
  pin: boolean,
): Promise<Message> {
  return apiRequest<Message>(pin ? 'PUT' : 'DELETE', `/v1/messages/${messageId}/pin`, {
    token: await getAccessToken(),
  });
}

export { threadCounts, threadReplies } from './threads';
