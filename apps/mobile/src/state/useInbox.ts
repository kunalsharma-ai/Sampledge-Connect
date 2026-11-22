import type {
  Connector,
  InboxConversationDetail,
  InboxList,
  InboxSettings,
  InboxTemplate,
} from '@sampledge/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  inboxListPath,
  inboxQuery,
  NO_PENDING,
  overlayDetail,
  overlayList,
  timelineWithPending,
  type InboxListFilter,
  type LocalTimelineItem,
  type PendingInbox,
} from '../lib/inbox';
import { useApp, useWorkspace } from './AppProvider';

/**
 * One Client Inbox path: the copy on this phone at once (offline too), then the server's.
 * Re-reads on `inbox:changed` (here, on your other devices or from other agents) and after a
 * reconnect. `error` is the server's refusal (no access), not a dropped connection.
 */
export function useInboxPath<T>(path: string | null): {
  data: T | undefined;
  loading: boolean;
  error: { code?: string; message: string } | null;
  reload: () => Promise<void>;
} {
  const { engine } = useWorkspace();
  const { engineState } = useApp();
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const current = useRef(path);
  current.current = path;

  const reload = useCallback(async () => {
    if (!path) return;
    try {
      const v = await engine.inboxLoad<T>(path);
      if (current.current !== path) return;
      if (v !== undefined) setData(v);
      setError(null);
    } catch (e) {
      if (current.current !== path) return;
      const err = e as { code?: string; message?: string };
      setError({ code: err.code, message: err.message ?? String(e) });
    } finally {
      if (current.current === path) setLoading(false);
    }
  }, [engine, path]);

  useEffect(() => {
    if (!path) return;
    let live = true;
    setLoading(true);
    void engine.inboxCached<T>(path).then((v) => {
      if (!live) return;
      setData(v);
      if (v !== undefined) setLoading(false);
      void reload();
    });
    const off = engine.events.on('inbox', () => {
      void engine.inboxCached<T>(path).then((v) => {
        if (!live) return;
        if (v === undefined) void reload();
        else setData(v);
      });
    });
    return () => {
      live = false;
      off();
    };
  }, [engine, path, reload, engineState?.networkUp]);

  return { data, loading: loading && data === undefined, error, reload };
}

/** Inbox changes made on this phone that have not reached the server yet. */
export function useInboxPending(): PendingInbox {
  const { engine } = useWorkspace();
  const [p, setP] = useState<PendingInbox>(NO_PENDING);
  useEffect(() => {
    let live = true;
    const read = () => void engine.inboxPending().then((x) => live && setP(x));
    read();
    const offInbox = engine.events.on('inbox', read);
    const offWork = engine.store.work.events.on('changed', (e) => e.kind === 'inbox' && read());
    return () => {
      live = false;
      offInbox();
      offWork();
    };
  }, [engine]);
  return p;
}

/** A view of the inbox with this phone's waiting changes laid over. */
export function useInboxList(filter: InboxListFilter) {
  const { selfId } = useWorkspace();
  const path = inboxListPath(inboxQuery(filter));
  const r = useInboxPath<InboxList>(path);
  const pending = useInboxPending();
  const items = useMemo(
    () => (r.data ? overlayList(r.data.items, pending, filter.view, selfId) : null),
    [r.data, pending, filter.view, selfId],
  );
  return { ...r, items, counts: r.data?.counts ?? null };
}

/** One conversation, with waiting replies, notes and changes from this phone. */
export function useInboxConversation(id: string): {
  detail: InboxConversationDetail | null;
  timeline: LocalTimelineItem[];
  loading: boolean;
  error: { code?: string; message: string } | null;
  reload: () => Promise<void>;
} {
  const { selfId } = useWorkspace();
  const r = useInboxPath<InboxConversationDetail>(
    `/v1/inbox/conversations/${encodeURIComponent(id)}`,
  );
  const pending = useInboxPending();
  const detail = useMemo(() => (r.data ? overlayDetail(r.data, pending) : null), [r.data, pending]);
  const timeline = useMemo(
    () => (r.data ? timelineWithPending(r.data, pending, selfId) : []),
    [r.data, pending, selfId],
  );
  return { detail, timeline, loading: r.loading, error: r.error, reload: r.reload };
}

/** Reply templates (typed after "/"), cached for offline use. */
export function useInboxTemplates(): InboxTemplate[] {
  return useInboxPath<InboxTemplate[]>('/v1/inbox/templates').data ?? [];
}

/** Teams, SLA and escalation contacts (names for the details screen). */
export function useInboxSettings(): InboxSettings | null {
  return useInboxPath<InboxSettings>('/v1/inbox/settings').data ?? null;
}

/** The organization's channels (for the channel filter and handoff conversations). */
export function useInboxChannels(enabled = true): Connector[] {
  return useInboxPath<Connector[]>(enabled ? '/v1/connectors' : null).data ?? [];
}
