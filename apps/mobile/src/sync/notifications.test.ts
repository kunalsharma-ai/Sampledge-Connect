import { describe, expect, it } from 'vitest';
import type { MarkNotificationsReadRequest } from '@sampledge/contracts';
import type { SessionManager } from '../auth/session';
import { migrate } from '../db/migrations';
import { LocalStore } from '../db/store';
import { Emitter } from '../lib/emitter';
import { ConnectEngine } from '../state/engine';
import { conversation, PEER, SELF, serverMessage } from '../test/fixtures';
import { openNodeDriver } from '../test/nodeDriver';
import type { ServerNotification } from './notificationTypes';
import { TransportError, type ApiTransport } from './transport';

const note = (id: string, over: Partial<ServerNotification> = {}): ServerNotification => ({
  notificationId: id,
  kind: 'mention',
  conversationId: 'c1',
  messageId: `m-${id}`,
  actorId: PEER,
  preview: `preview ${id}`,
  createdAt: new Date(1_000_000 + Number(id.replace(/\D/g, '') || 0) * 1000).toISOString(),
  readAt: null,
  ...over,
});

async function setup() {
  const db = openNodeDriver();
  await migrate(db);
  const store = new LocalStore(db, SELF, undefined, () => 2_000_000);
  await store.upsertConversations([conversation('c1'), conversation('c2')]);
  // What the server holds; reads mutate it the way the API does.
  const server = { items: [note('n1'), note('n2'), note('n3', { conversationId: 'c2' })] };
  const posts: MarkNotificationsReadRequest[] = [];
  let mode: 'ok' | 'down' | 'refuse' = 'ok';
  const unread = () => server.items.filter((n) => !n.readAt).length;
  const api = {
    listNotifications: async () => {
      if (mode === 'down') throw new TransportError('offline', 'network');
      return { items: [...server.items].reverse(), unreadCount: unread(), nextBefore: null };
    },
    markNotificationsRead: async (req: MarkNotificationsReadRequest) => {
      posts.push(req);
      if (mode === 'down') throw new TransportError('offline', 'network');
      if (mode === 'refuse') throw new TransportError('gone', 'api', 'FORBIDDEN');
      server.items = server.items.map((n) =>
        !n.readAt &&
        ('all' in req ||
          ('conversationId' in req && n.conversationId === req.conversationId) ||
          ('notificationIds' in req && req.notificationIds.includes(n.notificationId)))
          ? { ...n, readAt: '2026-01-01T00:00:00.000Z' }
          : n,
      );
      return { unreadCount: unread() };
    },
    sync: async () => ({ changes: [], cursor: 0, hasMore: false }),
  } as unknown as ApiTransport;
  const session = {
    state: 'active',
    events: new Emitter(),
    refresh: async () => null,
  } as unknown as SessionManager;
  const engine = new ConnectEngine(store, api, session, null);
  return {
    store,
    engine,
    server,
    posts,
    setMode: (m: typeof mode) => (mode = m),
    online: () => engine.setNetworkUp(true),
  };
}

describe('notifications', () => {
  it('loads the newest page and the server unread count', async () => {
    const t = await setup();
    t.online();
    await t.engine.refreshNotifications();
    expect((await t.store.listNotifications()).map((n) => n.notificationId)).toEqual([
      'n3',
      'n2',
      'n1',
    ]);
    expect(await t.store.notificationUnread()).toBe(3);
  });

  it('marks a conversation read offline and sends the mark before reloading', async () => {
    const t = await setup();
    t.online();
    await t.engine.refreshNotifications();
    t.engine.setNetworkUp(false);
    await t.engine.markNotificationsRead({ conversationId: 'c1' });
    expect(await t.store.notificationUnread()).toBe(1);
    expect((await t.store.listNotifications()).filter((n) => !n.readAt)).toHaveLength(1);
    expect(t.posts).toHaveLength(0);
    expect(await t.store.pendingNotificationReads()).toBe(1);

    t.online();
    await t.engine.refreshNotifications();
    expect(t.posts).toEqual([{ conversationId: 'c1' }]);
    expect(await t.store.pendingNotificationReads()).toBe(0);
    // Reloaded from the server, which now agrees.
    expect(await t.store.notificationUnread()).toBe(1);
    expect(t.server.items.filter((n) => !n.readAt).map((n) => n.notificationId)).toEqual(['n3']);
  });

  it('does not queue a mark when nothing cached was unread', async () => {
    const t = await setup();
    t.online();
    await t.engine.refreshNotifications();
    await t.engine.markNotificationsRead({ conversationId: 'c1' });
    await t.engine.refreshNotifications();
    const sent = t.posts.length;
    await t.engine.markNotificationsRead({ conversationId: 'c1' });
    await t.engine.refreshNotifications();
    expect(t.posts.length).toBe(sent);
  });

  it('keeps a mark queued while offline and drops one the server refuses', async () => {
    const t = await setup();
    t.online();
    await t.engine.refreshNotifications();
    t.setMode('down');
    await t.engine.markNotificationsRead({ all: true });
    await t.engine.refreshNotifications();
    expect(await t.store.pendingNotificationReads()).toBe(1);
    expect(await t.store.notificationUnread()).toBe(0);

    t.setMode('refuse');
    await t.engine.refreshNotifications();
    expect(await t.store.pendingNotificationReads()).toBe(0);
    t.setMode('ok');
    await t.engine.refreshNotifications();
    // The refused mark is corrected by the reload: the server still has them unread.
    expect(await t.store.notificationUnread()).toBe(3);
  });

  it('adds live notifications once and counts them', async () => {
    const t = await setup();
    expect(await t.store.addNotification(note('n9'))).toBe(true);
    expect(await t.store.addNotification(note('n9'))).toBe(false);
    expect(await t.store.notificationUnread()).toBe(1);
  });

  it('drops notifications for deleted messages and removed conversations', async () => {
    const t = await setup();
    t.online();
    await t.engine.refreshNotifications();
    await t.store.applyServerMessages([
      {
        ...serverMessage({ conversationId: 'c1', serverSequence: 1 }),
        messageId: 'm-n1',
        deletedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    expect((await t.store.listNotifications()).map((n) => n.notificationId)).toEqual(['n3', 'n2']);
    expect(await t.store.notificationUnread()).toBe(2);
    await t.store.purgeConversations(['c2']);
    expect((await t.store.listNotifications()).map((n) => n.notificationId)).toEqual(['n2']);
  });
});
