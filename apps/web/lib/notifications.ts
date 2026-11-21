'use client';
import * as React from 'react';
import type {
  MarkNotificationsReadRequest,
  Notification,
  NotificationPage,
} from '@sampledge/contracts';
import { apiRequest } from './api';
import { useAuth } from './auth';
import { useEngine, useEngineChange } from './engine';

interface Snapshot {
  items: Notification[];
  unreadCount: number;
  nextBefore: string | null;
}

const CACHE_KEY = 'notifications';

/**
 * The signed-in user's notification inbox. Fetched over REST, kept live by socket events,
 * and cached in this identity's IndexedDB so it still shows while offline. Marking read
 * offline is queued and sent on reconnect.
 */
export function useNotifications() {
  const { db, engine, state } = useEngine();
  const { getAccessToken } = useAuth();
  const [snap, setSnap] = React.useState<Snapshot | null>(null);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const online = state.connectivity === 'online';

  const save = React.useCallback(
    (s: Snapshot) => {
      setSnap(s);
      void db.meta.put({ key: CACHE_KEY, value: s });
    },
    [db],
  );

  const refresh = React.useCallback(async () => {
    try {
      const page = await apiRequest<NotificationPage>('GET', '/v1/notifications?limit=50', {
        token: await getAccessToken(),
      });
      save(page);
    } catch {
      /* offline: keep the cached snapshot */
    }
  }, [getAccessToken, save]);

  React.useEffect(() => {
    void db.meta.get(CACHE_KEY).then((row) => {
      if (row) setSnap((s) => s ?? (row.value as Snapshot));
    });
  }, [db]);

  React.useEffect(() => {
    if (online) void refresh();
  }, [online, refresh]);
  useEngineChange(['action'], (e) => {
    if (e.type === 'reconnected' || (e.type === 'action' && e.key.startsWith('notif-read|')))
      void refresh();
  });

  React.useEffect(
    () =>
      engine.onNotification((e) => {
        if (e.type === 'read') {
          void refresh();
          return;
        }
        setSnap((s) => {
          const prev = s ?? { items: [], unreadCount: 0, nextBefore: null };
          if (prev.items.some((n) => n.notificationId === e.notification.notificationId))
            return prev;
          const next = {
            ...prev,
            items: [e.notification, ...prev.items],
            unreadCount: prev.unreadCount + 1,
          };
          void db.meta.put({ key: CACHE_KEY, value: next });
          return next;
        });
      }),
    [engine, db, refresh],
  );

  const markRead = React.useCallback(
    async (req: MarkNotificationsReadRequest) => {
      const now = new Date().toISOString();
      const hit = (n: Notification) =>
        'all' in req
          ? true
          : 'conversationId' in req
            ? n.conversationId === req.conversationId
            : req.notificationIds.includes(n.notificationId);
      setSnap((s) => {
        if (!s) return s;
        const changed = s.items.filter((n) => !n.readAt && hit(n)).length;
        return {
          ...s,
          items: s.items.map((n) => (!n.readAt && hit(n) ? { ...n, readAt: now } : n)),
          unreadCount: 'all' in req ? 0 : Math.max(0, s.unreadCount - changed),
        };
      });
      if (engine.getState().connectivity !== 'online') {
        await engine.queueAction({
          key: `notif-read|${JSON.stringify(req)}`,
          method: 'POST',
          path: '/v1/notifications/read',
          body: req,
          label: 'Mark notifications read',
        });
        return;
      }
      try {
        const r = await apiRequest<{ unreadCount: number }>('POST', '/v1/notifications/read', {
          token: await getAccessToken(),
          body: req,
        });
        setSnap((s) => {
          if (!s) return s;
          const next = { ...s, unreadCount: r.unreadCount };
          void db.meta.put({ key: CACHE_KEY, value: next });
          return next;
        });
      } catch {
        // Not saved on the server (offline): the next refresh restores the true state.
      }
    },
    [db, engine, getAccessToken],
  );

  const loadMore = React.useCallback(async () => {
    if (!snap?.nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await apiRequest<NotificationPage>(
        'GET',
        `/v1/notifications?limit=50&before=${snap.nextBefore}`,
        { token: await getAccessToken() },
      );
      save({
        items: [...snap.items, ...page.items],
        unreadCount: page.unreadCount,
        nextBefore: page.nextBefore,
      });
    } catch {
      /* keep what we have */
    } finally {
      setLoadingMore(false);
    }
  }, [snap, loadingMore, getAccessToken, save]);

  return {
    items: snap?.items ?? null,
    unreadCount: snap?.unreadCount ?? 0,
    hasMore: !!snap?.nextBefore,
    loadingMore,
    online,
    markRead,
    loadMore,
    refresh,
  };
}

export type NotificationsApi = ReturnType<typeof useNotifications>;
