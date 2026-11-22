import type { MyNetworkProfile, StatusFeed } from '@sampledge/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { withPendingFeed, type PendingNet } from '../lib/network';
import { useApp, useWorkspace } from './AppProvider';

/**
 * A SampConnect Network list or profile: the cached copy at once (offline too), then the
 * server's. It re-reads whenever the network changes here, on another device or for the other
 * person (`network:changed`), and after a reconnect.
 */
export function useNet<T>(path: string | null): {
  data: T | undefined;
  loading: boolean;
  reload: () => Promise<void>;
} {
  const { engine } = useWorkspace();
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(!!path);
  const current = useRef(path);
  current.current = path;

  const reload = useCallback(async () => {
    if (!path) return;
    const v = await engine.netLoad<T>(path);
    if (current.current === path) {
      setData(v);
      setLoading(false);
    }
  }, [engine, path]);

  useEffect(() => {
    if (!path) return;
    let live = true;
    setLoading(true);
    void engine.netCached<T>(path).then((v) => {
      if (!live) return;
      if (v !== undefined) {
        setData(v);
        setLoading(false);
      }
      void reload();
    });
    const off = engine.events.on('network', () => {
      void engine.netCached<T>(path).then((v) => {
        if (!live) return;
        if (v === undefined) void reload();
        else setData(v);
      });
    });
    return () => {
      live = false;
      off();
    };
  }, [engine, path, reload]);

  return { data, loading: loading && data === undefined, reload };
}

/** Network changes made on this device that have not reached the server yet. */
export function useNetPending(): PendingNet[] {
  const { engine } = useWorkspace();
  const [pending, setPending] = useState<PendingNet[]>([]);
  useEffect(() => {
    let live = true;
    const read = () => void engine.netPending().then((p) => live && setPending(p));
    read();
    const offNet = engine.events.on('network', read);
    const offWork = engine.store.work.events.on('changed', (e) => e.kind === 'network' && read());
    return () => {
      live = false;
      offNet();
      offWork();
    };
  }, [engine]);
  return pending;
}

/** True when the app is showing SampConnect Network. */
export function useInNetwork(): boolean {
  return useApp().space === 'network';
}

/** The status feed with your waiting changes laid over (posted, deleted, seen). */
export function useStatusFeed(): { feed: StatusFeed | null; loading: boolean } {
  const { data, loading } = useNet<StatusFeed>('/v1/network/statuses');
  const me = useNet<MyNetworkProfile>('/v1/network/me');
  const pending = useNetPending();
  const feed = useMemo(
    () => (data ? withPendingFeed(data, pending, me.data ?? null) : null),
    [data, pending, me.data],
  );
  return { feed, loading };
}
