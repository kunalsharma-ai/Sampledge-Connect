'use client';
import * as React from 'react';
import type { Bookmark, Message } from '@sampledge/contracts';
import { apiRequest } from './api';
import { useAuth } from './auth';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEngine, useEngineChange } from './engine';

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
 * identity's IndexedDB so the list still opens offline. Saving works offline too: the change
 * goes through the engine's action queue, and other devices refresh on `bookmark:updated`.
 */
export function useBookmarks(): BookmarksApi {
  const { db, engine, state } = useEngine();
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
  // Saved or removed on another device, or a queued change of ours went through.
  useEngineChange(['bookmark', 'action'], (e) => {
    if (e.type !== 'action' || e.key.startsWith('bookmark|')) void refresh();
  });
  /** Queued saves and removals not yet confirmed, so the button doesn't flick back. */
  const pending = useLiveQuery(
    () =>
      db.actions
        .where('key')
        .startsWith('bookmark|')
        .filter((a) => a.state === 'queued')
        .toArray(),
    [db],
  );

  const toggle = React.useCallback(
    async (message: Message, save: boolean) => {
      const prev = items ?? [];
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
      await engine.queueAction({
        key: `bookmark|${message.messageId}`,
        method: save ? 'PUT' : 'DELETE',
        path: `/v1/messages/${message.messageId}/bookmark`,
        label: save ? 'Save message' : 'Remove saved message',
        conversationId: message.conversationId,
        messageId: message.messageId,
      });
    },
    [items, store, engine],
  );

  const ids = React.useMemo(() => {
    const out = new Set((items ?? []).map((b) => b.messageId));
    for (const a of pending ?? [])
      if (a.messageId) a.method === 'PUT' ? out.add(a.messageId) : out.delete(a.messageId);
    return out;
  }, [items, pending]);
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
