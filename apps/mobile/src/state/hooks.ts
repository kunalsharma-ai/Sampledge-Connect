import { useEffect, useState } from 'react';
import type { LocalConversation, LocalMessage } from '../db/store';
import { useWorkspace } from './AppProvider';

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
export function usePeople(): (userId: string) => string {
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
  return (id) => (id === selfId ? 'You' : (people[id] ?? `Member ${id.slice(-4)}`));
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
