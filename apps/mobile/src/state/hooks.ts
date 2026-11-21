import { useCallback, useEffect, useState } from 'react';
import type { CallsState } from './calls';
import type { LocalConversation, LocalMessage, LocalNotification } from '../db/store';
import type { TenantRole } from '@sampledge/contracts';
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
