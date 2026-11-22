'use client';
import * as React from 'react';
import {
  MAX_RECENT_SEARCHES,
  parseSearchOperators,
  searchTerms,
  type Conversation,
  type SearchResponse,
  type SearchType,
} from '@sampledge/contracts';
import { searchLocalMessages, type LocalMessageHit } from '@sampledge/offline';
import { apiRequest } from './api';
import { useAuth } from './auth';
import { useEngine, useEngineChange, type DirectoryEntry } from './engine';

const RECENT_KEY = 'search.recent';

export type DateRange = 'any' | 'day' | 'week' | 'month' | 'year';
const RANGE_MS: Record<Exclude<DateRange, 'any'>, number> = {
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 31 * 86_400_000,
  year: 366 * 86_400_000,
};

export interface SearchFilters {
  from: string | null;
  in: string | null;
  hasFile: boolean;
  range: DateRange;
  /** From typed operators (YYYY-MM-DD). */
  before: string | null;
  after: string | null;
}
export const NO_FILTERS: SearchFilters = {
  from: null,
  in: null,
  hasFile: false,
  range: 'any',
  before: null,
  after: null,
};

export type SearchTab = 'all' | SearchType;

export interface SearchResult {
  /** The text part of the query, after operators were pulled out. */
  text: string;
  terms: string[];
  filters: SearchFilters;
  /** Server results; null while offline (see `local`). */
  server: SearchResponse | null;
  /** Messages found in this device's cache (always computed, shown alone when offline). */
  local: LocalMessageHit[];
  /** Operator values that matched nothing, e.g. "from:zed". */
  unresolved: string[];
}

/** Resolves a typed name (from:ravi, in:fieldwork) to a person or conversation. */
function resolvePerson(name: string, directory: Map<string, DirectoryEntry>): string | null {
  const n = name.toLowerCase();
  const people = [...directory.values()];
  return (
    people.find((p) => p.userId === name)?.userId ??
    people.find((p) => p.displayName.toLowerCase() === n)?.userId ??
    people.find((p) => p.email.toLowerCase().startsWith(n))?.userId ??
    people.find((p) =>
      p.displayName
        .toLowerCase()
        .split(/\s+/)
        .some((w) => w.startsWith(n)),
    )?.userId ??
    null
  );
}
function resolveConversation(
  name: string,
  conversations: Conversation[],
  title: (c: Conversation) => string,
): string | null {
  const n = name.toLowerCase().replace(/^#/, '');
  return (
    conversations.find((c) => c.conversationId === name)?.conversationId ??
    conversations.find((c) => title(c).toLowerCase().replace(/^#/, '') === n)?.conversationId ??
    conversations.find((c) => title(c).toLowerCase().replace(/^#/, '').startsWith(n))
      ?.conversationId ??
    null
  );
}

function window(f: SearchFilters, now: number): { after: number | null; before: number | null } {
  const after = f.after
    ? Date.parse(`${f.after}T00:00:00`)
    : f.range !== 'any'
      ? now - RANGE_MS[f.range]
      : null;
  const before = f.before ? Date.parse(`${f.before}T00:00:00`) : null;
  return { after, before };
}

export interface SearchApi {
  online: boolean;
  loading: boolean;
  error: string | null;
  result: SearchResult | null;
  recent: string[];
  run(raw: string, filters: SearchFilters, opts?: { remember?: boolean }): Promise<void>;
  /** Loads the next page of one type and appends it. */
  more(type: SearchType): Promise<void>;
  removeRecent(q: string): void;
  clearRecent(): void;
}

/**
 * Universal Search. Online, the server searches everything you can open. Offline (or while
 * the server answers), this device's cached messages are searched locally, so search never
 * goes blank. Recent searches are kept on the server and reach all your devices live
 * (`search:recent`); changes to them queue offline like every other action.
 */
export function useSearch(
  conversations: Conversation[],
  title: (c: Conversation) => string,
): SearchApi {
  const { db, engine, state, directory } = useEngine();
  const { getAccessToken } = useAuth();
  const online = state.connectivity === 'online';
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<SearchResult | null>(null);
  const [recent, setRecentState] = React.useState<string[]>([]);
  const seq = React.useRef(0);
  const last = React.useRef<{ raw: string; filters: SearchFilters } | null>(null);

  const storeRecent = React.useCallback(
    (next: string[]) => {
      setRecentState(next);
      void db.meta.put({ key: RECENT_KEY, value: next });
    },
    [db],
  );
  const refreshRecent = React.useCallback(async () => {
    try {
      const r = await apiRequest<{ recent: string[] }>('GET', '/v1/search/recent', {
        token: await getAccessToken(),
      });
      // A change queued on this device but not sent yet wins over the server copy.
      const queued = await db.actions.get('search-recent');
      if (!queued || queued.state !== 'queued') storeRecent(r.recent);
    } catch {
      /* offline: keep the cached list */
    }
  }, [db, getAccessToken, storeRecent]);
  React.useEffect(() => {
    void db.meta.get(RECENT_KEY).then((row) => {
      if (row) setRecentState(row.value as string[]);
    });
  }, [db]);
  React.useEffect(() => {
    if (online) void refreshRecent();
  }, [online, refreshRecent]);
  useEngineChange(['searchRecent', 'reconnected'], (e) => {
    if (e.type === 'searchRecent') storeRecent(e.recent);
    else void refreshRecent();
  });

  const saveRecent = React.useCallback(
    (next: string[]) => {
      storeRecent(next);
      void engine.queueAction({
        key: 'search-recent',
        method: 'PUT',
        path: '/v1/search/recent',
        body: { recent: next },
        label: 'Update recent searches',
      });
    },
    [engine, storeRecent],
  );

  const resolve = React.useCallback(
    (raw: string, base: SearchFilters) => {
      const ops = parseSearchOperators(raw);
      const unresolved: string[] = [];
      const filters: SearchFilters = { ...base };
      if (ops.from) {
        const id = resolvePerson(ops.from, directory);
        if (id) filters.from = id;
        else unresolved.push(`from:${ops.from}`);
      }
      if (ops.in) {
        const id = resolveConversation(ops.in, conversations, title);
        if (id) filters.in = id;
        else unresolved.push(`in:${ops.in}`);
      }
      if (ops.hasFile) filters.hasFile = true;
      if (ops.before) filters.before = ops.before;
      if (ops.after) filters.after = ops.after;
      return { text: ops.text.trim(), filters, unresolved };
    },
    [conversations, directory, title],
  );

  const query = React.useCallback(
    async (
      text: string,
      filters: SearchFilters,
      extra: { types?: SearchType[]; offset?: number; limit?: number } = {},
    ) => {
      const { after, before } = window(filters, Date.now());
      const p = new URLSearchParams();
      if (text) p.set('q', text);
      if (filters.from) p.set('from', filters.from);
      if (filters.in) p.set('in', filters.in);
      if (filters.hasFile) p.set('hasFile', 'true');
      if (after) p.set('after', new Date(after).toISOString());
      if (before) p.set('before', new Date(before).toISOString());
      if (extra.types) p.set('types', extra.types.join(','));
      if (extra.offset) p.set('offset', String(extra.offset));
      p.set('limit', String(extra.limit ?? 8));
      return apiRequest<SearchResponse>('GET', `/v1/search?${p}`, {
        token: await getAccessToken(),
      });
    },
    [getAccessToken],
  );

  const run = React.useCallback(
    async (raw: string, base: SearchFilters, opts: { remember?: boolean } = {}) => {
      const my = ++seq.current;
      last.current = { raw, filters: base };
      const { text, filters, unresolved } = resolve(raw, base);
      const terms = searchTerms(text);
      const hasFilter =
        !!filters.from ||
        !!filters.in ||
        filters.hasFile ||
        filters.range !== 'any' ||
        !!filters.before ||
        !!filters.after;
      if (!terms.length && !hasFilter) {
        setResult(null);
        setError(null);
        setLoading(false);
        return;
      }
      const { after, before } = window(filters, Date.now());
      const local = await searchLocalMessages(db, terms, {
        conversationIds: filters.in ? new Set([filters.in]) : undefined,
        from: filters.from,
        hasFile: filters.hasFile,
        after,
        before,
        limit: 30,
      });
      if (my !== seq.current) return;
      setResult((prev) => ({
        text,
        terms,
        filters,
        unresolved,
        local,
        // Keep the previous server answer on screen until the new one lands (no flicker).
        server: prev && prev.text === text && online ? prev.server : null,
      }));
      if (opts.remember && raw.trim()) {
        const r = raw.trim();
        saveRecent(
          [r, ...recent.filter((x) => x.toLowerCase() !== r.toLowerCase())].slice(
            0,
            MAX_RECENT_SEARCHES,
          ),
        );
      }
      if (!online) {
        setLoading(false);
        setError(null);
        return;
      }
      setLoading(true);
      try {
        const server = await query(text, filters);
        if (my !== seq.current) return;
        setResult({ text, terms, filters, unresolved, local, server });
        setError(null);
      } catch (e) {
        if (my !== seq.current) return;
        setError(e instanceof Error ? e.message : 'Search failed');
      } finally {
        if (my === seq.current) setLoading(false);
      }
    },
    [db, online, query, recent, resolve, saveRecent],
  );

  // Coming back online: re-run the visible search against the server.
  React.useEffect(() => {
    if (online && last.current) void run(last.current.raw, last.current.filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const more = React.useCallback(
    async (type: SearchType) => {
      const cur = result;
      if (!cur?.server) return;
      const have = cur.server[type].items.length;
      try {
        const next = await query(cur.text, cur.filters, {
          types: [type],
          offset: have,
          limit: 20,
        });
        setResult((r) =>
          r?.server
            ? {
                ...r,
                server: {
                  ...r.server,
                  [type]: {
                    items: [...r.server[type].items, ...next[type].items],
                    more: next[type].more,
                  },
                },
              }
            : r,
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Search failed');
      }
    },
    [query, result],
  );

  return {
    online,
    loading,
    error,
    result,
    recent,
    run,
    more,
    removeRecent: (q) => saveRecent(recent.filter((x) => x !== q)),
    clearRecent: () => saveRecent([]),
  };
}
