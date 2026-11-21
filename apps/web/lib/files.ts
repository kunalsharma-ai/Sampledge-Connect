'use client';
import * as React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { fileKindOf, type FileItem, type FileKind, type FileList } from '@sampledge/contracts';
import { apiRequest } from './api';
import { useAuth } from './auth';
import { useEngine, useEngineChange } from './engine';

export interface FileFilters {
  q: string;
  kind: FileKind | null;
  in: string | null;
  from: string | null;
}
export const ALL_FILES: FileFilters = { q: '', kind: null, in: null, from: null };

const CACHE_KEY = 'files.firstPage';

/**
 * The Files screen's list. Online it pages through GET /v1/files. It refetches whenever a
 * message with files lands on this device (any conversation, any device that sent it) and on
 * reconnect, so it stays live. Offline it shows the last synced list plus files in messages
 * cached on this device.
 */
export function useFiles(filters: FileFilters) {
  const { db, state } = useEngine();
  const { getAccessToken } = useAuth();
  const online = state.connectivity === 'online';
  const [items, setItems] = React.useState<FileItem[] | null>(null);
  const [nextBefore, setNextBefore] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const seq = React.useRef(0);
  const isDefault = !filters.q && !filters.kind && !filters.in && !filters.from;

  const params = React.useCallback(
    (before?: string) => {
      const p = new URLSearchParams();
      if (filters.q.trim()) p.set('q', filters.q.trim());
      if (filters.kind) p.set('kind', filters.kind);
      if (filters.in) p.set('in', filters.in);
      if (filters.from) p.set('from', filters.from);
      if (before) p.set('before', before);
      return p.toString();
    },
    [filters],
  );

  // Files in messages cached on this device: the live trigger, and the offline fallback.
  const localFiles = useLiveQuery(async () => {
    const rows = await db.messages.filter((m) => (m.attachments?.length ?? 0) > 0).toArray();
    return rows.flatMap((m) =>
      (m.attachments ?? [])
        .filter((a) => !a.deletedAt && !a.recording)
        .map((a): FileItem => ({
          ...a,
          messageId: m.messageId,
          kind: fileKindOf(a.mimeType, a.fileName),
          storage: 'connect',
        })),
    );
  }, [db]);
  const localSignature = localFiles?.map((f) => f.attachmentId).join(',') ?? '';

  const refresh = React.useCallback(async () => {
    const my = ++seq.current;
    try {
      const r = await apiRequest<FileList>('GET', `/v1/files?${params()}`, {
        token: await getAccessToken(),
      });
      if (my !== seq.current) return;
      setItems(r.items);
      setNextBefore(r.nextBefore);
      setError(null);
      if (isDefault) void db.meta.put({ key: CACHE_KEY, value: r.items });
    } catch (e) {
      if (my === seq.current) setError(e instanceof Error ? e.message : 'Could not load files');
    }
  }, [db, getAccessToken, isDefault, params]);

  React.useEffect(() => {
    if (online) {
      const t = setTimeout(() => void refresh(), filters.q ? 200 : 0);
      return () => clearTimeout(t);
    }
    // Offline: last synced list, merged with files cached on this device, filtered locally.
    let live = true;
    void db.meta.get(CACHE_KEY).then((row) => {
      if (!live) return;
      const cached = (row?.value as FileItem[] | undefined) ?? [];
      const byId = new Map(cached.map((f) => [f.attachmentId, f]));
      for (const f of localFiles ?? []) if (!byId.has(f.attachmentId)) byId.set(f.attachmentId, f);
      const terms = filters.q.toLowerCase().split(/\s+/).filter(Boolean);
      setItems(
        [...byId.values()]
          .filter(
            (f) =>
              (!filters.kind || f.kind === filters.kind) &&
              (!filters.in || f.conversationId === filters.in) &&
              (!filters.from || f.uploaderId === filters.from) &&
              terms.every((t) => f.fileName.toLowerCase().includes(t)),
          )
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      );
      setNextBefore(null);
    });
    return () => {
      live = false;
    };
    // localSignature stands for localFiles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, refresh, filters, localSignature]);

  useEngineChange(['reconnected'], () => void refresh());

  const loadMore = React.useCallback(async () => {
    if (!nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await apiRequest<FileList>('GET', `/v1/files?${params(nextBefore)}`, {
        token: await getAccessToken(),
      });
      setItems((cur) => [...(cur ?? []), ...r.items]);
      setNextBefore(r.nextBefore);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load files');
    } finally {
      setLoadingMore(false);
    }
  }, [getAccessToken, loadingMore, nextBefore, params]);

  return { items, error, online, hasMore: !!nextBefore, loadingMore, loadMore };
}
