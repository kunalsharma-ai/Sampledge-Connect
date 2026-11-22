import { useCallback, useEffect, useState } from 'react';
import type { CallsState } from './calls';
import type {
  LocalConversation,
  LocalMeeting,
  LocalMessage,
  LocalNotification,
  LocalStore,
} from '../db/store';
import type { DirectoryUser } from '../sync/transport';
import type { TenantRole } from '@sampledge/contracts';
import type { LocalBookingPage, LocalScheduled } from '../db/work';
import { useApp, useWorkspace } from './AppProvider';

/** Re-reads from the local store whenever it reports a change. The UI never reads the network directly. */
export function useConversations(): { conversations: LocalConversation[]; loading: boolean } {
  const { store } = useWorkspace();
  const [state, setState] = useState<{ conversations: LocalConversation[]; loading: boolean }>({
    conversations: [],
    loading: true,
  });
  useEffect(() => {
    let alive = true;
    const load = () =>
      void store
        .listConversations()
        .then((conversations) => alive && setState({ conversations, loading: false }));
    load();
    const offs = [
      store.events.on('conversations', load),
      store.events.on('messages', load),
      store.events.on('outbox', load),
    ];
    return () => {
      alive = false;
      offs.forEach((o) => o());
    };
  }, [store]);
  return state;
}

export function useMessages(conversationId: string): {
  messages: LocalMessage[];
  loading: boolean;
} {
  const { store } = useWorkspace();
  const [state, setState] = useState<{ messages: LocalMessage[]; loading: boolean }>({
    messages: [],
    loading: true,
  });
  useEffect(() => {
    let alive = true;
    const load = () =>
      void store
        .listMessages(conversationId)
        .then((messages) => alive && setState({ messages, loading: false }));
    load();
    const off = store.events.on('messages', (e) => e.conversationId === conversationId && load());
    return () => {
      alive = false;
      off();
    };
  }, [store, conversationId]);
  return state;
}

/**
 * Display names by user id, cached from GET /v1/users after each sync.
 * Falls back to a short id when the directory is unavailable (e.g. guest accounts).
 */
export function usePeople(): (userId: string, opts?: { asWritten?: boolean }) => string {
  const { store, selfId } = useWorkspace();
  const [people, setPeople] = useState<Record<string, string>>({});
  useEffect(() => {
    const load = () =>
      void store
        .getSetting('people')
        .then((raw) => raw && setPeople(JSON.parse(raw) as Record<string, string>));
    load();
    // Sync rewrites the directory after each successful pass.
    return store.events.on('settings', ({ key }) => key === 'people' && load());
  }, [store]);
  return useCallback(
    // asWritten: your own directory name (as others type it in @mentions) instead of "You".
    (id: string, opts?: { asWritten?: boolean }) =>
      id === selfId && !opts?.asWritten ? 'You' : (people[id] ?? `Member ${id.slice(-4)}`),
    [people, selfId],
  );
}

export function conversationTitle(
  c: LocalConversation,
  nameOf: (id: string) => string,
  selfId: string,
): string {
  if (c.name) return c.kind.startsWith('channel') ? `# ${c.name}` : c.name;
  const others = c.memberIds.filter((m) => m !== selfId);
  return others.map(nameOf).join(', ') || 'Just you';
}

/** The cached notification feed and unread count; both update live and work offline. */
export function useNotifications(): {
  items: LocalNotification[];
  unread: number;
  loading: boolean;
} {
  const { store } = useWorkspace();
  const [state, setState] = useState<{
    items: LocalNotification[];
    unread: number;
    loading: boolean;
  }>({ items: [], unread: 0, loading: true });
  useEffect(() => {
    let alive = true;
    const load = () =>
      void Promise.all([store.listNotifications(), store.notificationUnread()]).then(
        ([items, unread]) => alive && setState({ items, unread, loading: false }),
      );
    load();
    const off = store.events.on('notifications', load);
    return () => {
      alive = false;
      off();
    };
  }, [store]);
  return state;
}

/** Live calls, the ringing call and the call you are in. */
export function useCalls(): CallsState {
  const { engine } = useWorkspace();
  const [state, setState] = useState<CallsState>(engine.calls.state);
  useEffect(() => {
    setState(engine.calls.state);
    return engine.calls.events.on('change', setState);
  }, [engine]);
  return state;
}

export interface DirectoryEntry {
  userId: string;
  displayName: string;
  email: string;
  role: string;
  title: string | null;
  avatarUrl?: string | null;
  department?: string | null;
  phone?: string | null;
  bio?: string | null;
  timeZone?: string | null;
}

/** One shared copy of the photo map per workspace, so a long list does not read it per row. */
const avatarMaps = new WeakMap<
  LocalStore,
  { map: Record<string, string>; subs: Set<(m: Record<string, string>) => void> }
>();
function avatarMap(store: LocalStore) {
  let entry = avatarMaps.get(store);
  if (!entry) {
    const e = {
      map: {} as Record<string, string>,
      subs: new Set<(m: Record<string, string>) => void>(),
    };
    const load = () =>
      void store.getSetting('avatars').then((raw) => {
        e.map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
        e.subs.forEach((f) => f(e.map));
      });
    load();
    store.events.on('settings', ({ key }) => key === 'avatars' && load());
    avatarMaps.set(store, e);
    entry = e;
  }
  return entry;
}

/**
 * Someone's profile photo (a full URL, or a data URL for your own photo not sent yet), or null
 * to show initials. Follows changes made anywhere (directory:updated) and on this phone.
 */
export function useAvatarUri(userId?: string | null): string | null {
  const { store } = useWorkspace();
  const [map, setMap] = useState<Record<string, string>>(() => avatarMap(store).map);
  useEffect(() => {
    const e = avatarMap(store);
    setMap(e.map);
    e.subs.add(setMap);
    return () => void e.subs.delete(setMap);
  }, [store]);
  return userId ? (map[userId] ?? null) : null;
}

/** One person's profile card from the copy on this phone (kept current). */
export function useProfile(userId: string): DirectoryUser | null {
  const { store, engine, selfId } = useWorkspace();
  const [u, setU] = useState<DirectoryUser | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void (
        userId === selfId
          ? engine.myProfile()
          : store
              .getSetting('directory')
              .then((raw) =>
                raw
                  ? ((JSON.parse(raw) as DirectoryUser[]).find((x) => x.userId === userId) ?? null)
                  : null,
              )
      ).then((x) => alive && setU(x));
    load();
    const offs = [
      store.events.on('settings', ({ key }) => key === 'directory' && load()),
      engine.events.on('profile', () => load()),
    ];
    return () => {
      alive = false;
      offs.forEach((o) => o());
    };
  }, [store, engine, selfId, userId]);
  return u;
}

/**
 * Active people in your workspace, cached after each sync so the picker works offline.
 * Falls back to the cached names (no email or title) when the full directory has not loaded yet.
 */
export function useDirectory(): DirectoryEntry[] {
  const { store, selfId } = useWorkspace();
  const [list, setList] = useState<DirectoryEntry[]>([]);
  useEffect(() => {
    const load = () =>
      void Promise.all([store.getSetting('directory'), store.getSetting('people')]).then(
        ([dir, people]) => {
          const rows: DirectoryEntry[] = dir
            ? (JSON.parse(dir) as DirectoryEntry[])
            : Object.entries(people ? (JSON.parse(people) as Record<string, string>) : {}).map(
                ([userId, displayName]) => ({
                  userId,
                  displayName,
                  email: '',
                  role: 'member',
                  title: null,
                }),
              );
          setList(
            rows
              .filter((u) => u.userId !== selfId)
              .sort((a, b) => a.displayName.localeCompare(b.displayName)),
          );
        },
      );
    load();
    return store.events.on(
      'settings',
      ({ key }) => (key === 'directory' || key === 'people') && load(),
    );
  }, [store, selfId]);
  return list;
}

/** Your workspace role (the demo workspace acts as a regular member). */
export function useTenantRole(): TenantRole {
  const { session, sessionState } = useApp();
  return sessionState === 'demo' ? 'member' : (session?.user.role ?? 'member');
}

/** One conversation from the local store, kept current. */
export function useConversation(id: string): LocalConversation | undefined {
  const { store } = useWorkspace();
  const [conv, setConv] = useState<LocalConversation | undefined>();
  useEffect(() => {
    let alive = true;
    const load = () => void store.getConversation(id).then((c) => alive && setConv(c));
    load();
    const off = store.events.on('conversations', load);
    return () => {
      alive = false;
      off();
    };
  }, [store, id]);
  return conv;
}

/** Cached meetings overlapping [from, to), soonest first; updates live and works offline. */
export function useMeetings(
  from: string,
  to: string,
): { meetings: LocalMeeting[]; loading: boolean } {
  const { store } = useWorkspace();
  const [state, setState] = useState<{ meetings: LocalMeeting[]; loading: boolean }>({
    meetings: [],
    loading: true,
  });
  useEffect(() => {
    let alive = true;
    const load = () =>
      void store
        .listMeetings(from, to)
        .then((meetings) => alive && setState({ meetings, loading: false }));
    load();
    const off = store.events.on('meetings', load);
    return () => {
      alive = false;
      off();
    };
  }, [store, from, to]);
  return state;
}

export function useMeeting(id: string): { meeting: LocalMeeting | undefined; loading: boolean } {
  const { store } = useWorkspace();
  const [state, setState] = useState<{ meeting: LocalMeeting | undefined; loading: boolean }>({
    meeting: undefined,
    loading: true,
  });
  useEffect(() => {
    let alive = true;
    const load = () =>
      void store.getMeeting(id).then((meeting) => alive && setState({ meeting, loading: false }));
    load();
    const off = store.events.on('meetings', load);
    return () => {
      alive = false;
      off();
    };
  }, [store, id]);
  return state;
}

/** Re-renders every `ms` so "in 5 min" labels and Join buttons stay current. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Pinned messages of a conversation from the local cache, most recently pinned first. */
export function usePinned(conversationId: string): LocalMessage[] {
  const { store } = useWorkspace();
  const [pins, setPins] = useState<LocalMessage[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => void store.listPinned(conversationId).then((p) => alive && setPins(p));
    load();
    const off = store.events.on('messages', (e) => e.conversationId === conversationId && load());
    return () => {
      alive = false;
      off();
    };
  }, [store, conversationId]);
  return pins;
}

/** Ids of messages you saved (queued saves included); refreshed from the server when online. */
export function useSavedIds(): ReadonlySet<string> {
  const { engine } = useWorkspace();
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    let alive = true;
    const off = engine.events.on('bookmarks', (s) => alive && setIds(s));
    void engine.savedIds().then((s) => alive && setIds(s));
    void engine.listBookmarks().catch(() => undefined);
    return () => {
      alive = false;
      off();
    };
  }, [engine]);
  return ids;
}

/**
 * Your scheduled messages (optionally for one conversation): the copy on this device at once,
 * then the server's when online. Changes made offline show straight away.
 */
export function useScheduled(conversationId?: string): {
  items: LocalScheduled[] | null;
  error: string | null;
  reload: () => void;
} {
  const { engine } = useWorkspace();
  const { engineState } = useApp();
  const [items, setItems] = useState<LocalScheduled[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = (fresh = false) => {
      void engine
        .listScheduled(conversationId, { fresh })
        .then((l) => {
          if (!alive) return;
          setItems(l);
          setError(null);
        })
        .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    };
    load(true);
    const offs = [
      engine.events.on('scheduled', () => load()),
      engine.store.work.events.on('changed', (e) => e.kind === 'scheduled' && load()),
    ];
    return () => {
      alive = false;
      offs.forEach((o) => o());
    };
  }, [engine, conversationId, engineState?.networkUp, tick]);
  return { items, error, reload: () => setTick((t) => t + 1) };
}

/**
 * A list of tasks or approvals: the copy on this device at once (with changes made offline),
 * refreshed from the server when online, and reloaded when one changes here or live.
 */
export function useWorkList<T>(
  /** `fresh`: also ask the server (when online); otherwise read the copy on this device. */
  load: (fresh: boolean) => Promise<T[]>,
  deps: readonly unknown[],
): { items: T[] | null; error: string | null; loading: boolean; reload: () => void } {
  const { engine } = useWorkspace();
  const { engineState } = useApp();
  const [items, setItems] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const run = (fresh = false) => {
      setLoading(fresh);
      load(fresh)
        .then((l) => {
          if (!alive) return;
          setItems(l);
          setError(null);
        })
        .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)))
        .finally(() => alive && setLoading(false));
    };
    run(true);
    const offs = [
      engine.events.on('work', () => run()),
      engine.store.work.events.on(
        'changed',
        (e) => (e.kind === 'task' || e.kind === 'approval') && run(),
      ),
    ];
    return () => {
      alive = false;
      offs.forEach((o) => o());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, engineState?.networkUp, tick, ...deps]);
  return { items, error, loading, reload: () => setTick((t) => t + 1) };
}

/**
 * Booking pages you host: the copy on this phone at once (with changes made offline), refreshed
 * when online, and reloaded when one changes here, on another device or by a co-host.
 */
export function useBookingPages(): {
  items: LocalBookingPage[] | null;
  error: string | null;
  reload: () => void;
} {
  const { engine } = useWorkspace();
  const { engineState } = useApp();
  const [items, setItems] = useState<LocalBookingPage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = (fresh = false) => {
      void engine
        .listBookingPages({ fresh })
        .then((l) => {
          if (!alive) return;
          setItems(l);
          setError(null);
        })
        .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    };
    load(true);
    const offs = [
      engine.events.on('booking', () => load()),
      engine.store.work.events.on('changed', (e) => e.kind === 'booking' && load()),
    ];
    return () => {
      alive = false;
      offs.forEach((o) => o());
    };
  }, [engine, engineState?.networkUp, tick]);
  return { items, error, reload: () => setTick((t) => t + 1) };
}

/**
 * People you can assign work to or ask for approval: the conversation's members when there is
 * one, else everyone in the workspace. You come first, as "Me".
 */
export function usePeopleChoices(conversationId?: string): { key: string; label: string }[] {
  const { selfId } = useWorkspace();
  const conv = useConversation(conversationId ?? '');
  const directory = useDirectory();
  const nameOf = usePeople();
  const ids = conversationId
    ? (conv?.memberIds ?? []).filter((u) => u !== selfId)
    : directory.map((u) => u.userId);
  return [
    { key: selfId, label: 'Me' },
    ...ids
      .map((u) => ({ key: u, label: nameOf(u) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];
}

/** Your recent searches, newest first; follows changes here and on your other devices. */
export function useRecentSearches(): string[] {
  const { engine } = useWorkspace();
  const [items, setItems] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => void engine.recentSearches().then((r) => alive && setItems(r));
    load();
    const offs = [
      engine.events.on('recentSearches', (r) => alive && setItems(r)),
      engine.store.work.events.on('changed', (e) => e.kind === 'search' && load()),
    ];
    return () => {
      alive = false;
      offs.forEach((o) => o());
    };
  }, [engine]);
  return items;
}
