import { describe, expect, it } from 'vitest';
import type { Conversation, CreateConversationRequest } from '@sampledge/contracts';
import type { SessionManager } from '../auth/session';
import { migrate } from '../db/migrations';
import { LocalStore } from '../db/store';
import { canInConversation, channelNameError, isUnjoinedChannel } from '../lib/access';
import { Emitter } from '../lib/emitter';
import { conversation, PEER, SELF, serverMessage } from '../test/fixtures';
import { openNodeDriver } from '../test/nodeDriver';
import { TransportError, type ApiTransport } from '../sync/transport';
import { ConnectEngine } from './engine';

const OTHER = 'user-other';

async function setup(state: 'active' | 'demo' = 'active') {
  const db = openNodeDriver();
  await migrate(db);
  const store = new LocalStore(db, SELF);
  await store.upsertConversations([
    conversation('g1', {
      kind: 'group',
      name: 'Launch',
      memberIds: [SELF, PEER, OTHER],
      myRole: 'owner',
    }),
    conversation('pub', {
      kind: 'channel_public',
      name: 'general',
      memberIds: [PEER],
      myRole: null,
    }),
  ]);
  const calls: string[] = [];
  let refuse = false;
  const server: Record<string, Conversation> = {};
  const api = {
    sync: async () => ({
      conversations: [],
      revokedConversationIds: [],
      changes: [],
      hasMore: false,
    }),
    listUsers: async () => [],
    listNotifications: async () => ({ items: [], unreadCount: 0, nextBefore: null }),
    callsConfig: async () => ({ enabled: false, provider: 'none', ringTimeoutSeconds: 30 }),
    activeCalls: async () => [],
    createConversation: async (req: CreateConversationRequest) => {
      calls.push(`create:${req.kind}`);
      if (refuse) throw new TransportError('no', 'api', 'FORBIDDEN');
      return conversation('new1', {
        kind: req.kind,
        memberIds: [SELF, ...req.memberIds!],
        myRole: 'owner',
      });
    },
    joinConversation: async (id: string) => {
      calls.push(`join:${id}`);
      return conversation(id, {
        kind: 'channel_public',
        name: 'general',
        memberIds: [PEER, SELF],
        myRole: 'member',
      });
    },
    addMembers: async (id: string, userIds: string[]) => {
      calls.push(`add:${id}:${userIds.join(',')}`);
      return conversation(id, {
        kind: 'group',
        name: 'Launch',
        memberIds: [SELF, PEER, OTHER, ...userIds],
        myRole: 'owner',
      });
    },
    removeMember: async (id: string, userId: string) => {
      calls.push(`remove:${id}:${userId}`);
      server[id] = conversation(id, {
        kind: 'group',
        name: 'Launch',
        memberIds: [SELF, PEER],
        myRole: 'owner',
      });
    },
    getConversation: async (id: string) => server[id]!,
    setArchived: async (id: string, archived: boolean) =>
      conversation(id, {
        kind: 'group',
        name: 'Launch',
        memberIds: [SELF, PEER, OTHER],
        myRole: 'owner',
        archivedAt: archived ? '2026-11-21T00:00:00.000Z' : null,
      }),
    logout: async () => {
      calls.push('logout');
      throw new TransportError('gone', 'api', 'SESSION_EXPIRED');
    },
  } as unknown as ApiTransport;
  const session = {
    state,
    events: new Emitter(),
    refresh: async () => null,
  } as unknown as SessionManager;
  const engine = new ConnectEngine(store, api, session, null);
  return { store, engine, calls, refuse: () => (refuse = true) };
}

describe('conversation membership', () => {
  it('needs a connection and says why', async () => {
    const t = await setup();
    expect(t.engine.serverActionBlocker()).toMatch(/offline/);
    await expect(t.engine.createConversation({ kind: 'dm', memberIds: [PEER] })).rejects.toThrow(
      /offline/,
    );
    expect(t.calls).toEqual([]);
    const demo = await setup('demo');
    expect(demo.engine.serverActionBlocker()).toMatch(/demo workspace/);
  });

  it('creates a conversation and stores it locally', async () => {
    const t = await setup();
    t.engine.setNetworkUp(true);
    const id = await t.engine.createConversation({ kind: 'group', memberIds: [PEER, OTHER] });
    expect(id).toBe('new1');
    expect((await t.store.getConversation('new1'))?.myRole).toBe('owner');
  });

  it('turns a refusal into a readable message', async () => {
    const t = await setup();
    t.engine.setNetworkUp(true);
    t.refuse();
    await expect(t.engine.createConversation({ kind: 'dm', memberIds: [PEER] })).rejects.toThrow(
      'You do not have permission to do that.',
    );
  });

  it('keeps unjoined public channels out of unread counts until you join', async () => {
    const t = await setup();
    await t.store.applyServerMessages([
      serverMessage({ conversationId: 'pub', serverSequence: 1 }),
    ]);
    const pub = await t.store.getConversation('pub');
    expect(pub && isUnjoinedChannel(pub)).toBe(true);
    expect(pub?.unread).toBe(0);
    t.engine.setNetworkUp(true);
    await t.engine.joinChannel('pub');
    const joined = await t.store.getConversation('pub');
    expect(joined?.myRole).toBe('member');
    expect(joined && isUnjoinedChannel(joined)).toBe(false);
    expect(joined?.memberIds).toContain(SELF);
    expect(joined?.unread).toBe(1);
  });

  it('adds and removes members, and leaving removes the local copy', async () => {
    const t = await setup();
    t.engine.setNetworkUp(true);
    await t.engine.addMembers('g1', ['user-new']);
    expect((await t.store.getConversation('g1'))?.memberIds).toContain('user-new');
    await t.engine.removeMember('g1', OTHER);
    expect((await t.store.getConversation('g1'))?.memberIds).toEqual([SELF, PEER]);
    await t.engine.removeMember('g1', SELF);
    expect(await t.store.getConversation('g1')).toBeUndefined();
    expect(t.calls).toEqual(['add:g1:user-new', `remove:g1:${OTHER}`, `remove:g1:${SELF}`]);
  });

  it('archives for everyone', async () => {
    const t = await setup();
    t.engine.setNetworkUp(true);
    await t.engine.setArchived('g1', true);
    expect((await t.store.getConversation('g1'))?.archivedAt).not.toBeNull();
  });

  it('ends the server session on sign-out, but never blocks it', async () => {
    const t = await setup();
    await t.engine.logoutServer(); // offline: skipped
    expect(t.calls).toEqual([]);
    t.engine.setNetworkUp(true);
    await expect(t.engine.logoutServer()).resolves.toBeUndefined();
    expect(t.calls).toEqual(['logout']);
  });
});

describe('access rules shown in the app', () => {
  it('matches the server: members cannot add people, owners can', async () => {
    const t = await setup();
    const g = (await t.store.getConversation('g1'))!;
    expect(canInConversation(g, 'member', 'members.add')).toBe(true);
    expect(canInConversation({ ...g, myRole: 'member' }, 'member', 'members.add')).toBe(false);
    expect(
      canInConversation({ ...g, archivedAt: '2026-11-21T00:00:00.000Z' }, 'member', 'members.add'),
    ).toBe(false);
  });

  it('checks channel names the way the server does', () => {
    expect(channelNameError('fieldwork-ops')).toBeNull();
    expect(channelNameError('')).toMatch(/name/);
    expect(channelNameError('-bad')).toMatch(/starting/);
  });
});
