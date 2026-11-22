import { describe, expect, it } from 'vitest';
import type {
  InboxConversation,
  InboxConversationDetail,
  InboxList,
  InboxMessage,
  InboxSettings,
} from '@sampledge/contracts';
import { DEFAULT_INBOX_SETTINGS } from '@sampledge/contracts';
import type { SessionManager } from '../auth/session';
import { migrate } from '../db/migrations';
import { LocalStore } from '../db/store';
import { Emitter } from '../lib/emitter';
import {
  inboxListPath,
  inboxQuery,
  NO_PENDING,
  overlayList,
  slaLabel,
  templateQuery,
  timelineWithPending,
} from '../lib/inbox';
import { ConnectEngine } from '../state/engine';
import { SELF } from '../test/fixtures';
import { openNodeDriver } from '../test/nodeDriver';
import type { RealtimeClient } from './realtime';
import { TransportError, type ApiTransport } from './transport';

const AT = '2026-11-22T09:00:00.000Z';

const conv = (over: Partial<InboxConversation> = {}): InboxConversation => ({
  conversationId: 'x1',
  connectorId: 'k1',
  provider: 'telegram',
  testMode: true,
  channelMode: 'two_way',
  client: { clientId: 'cl1', name: 'Hannah Becker', company: 'Acme' },
  subject: 'Q4 topline',
  status: 'open',
  priority: 'normal',
  assigneeId: null,
  teamId: null,
  tags: [],
  sla: {
    state: 'on_track',
    dueAt: '2026-11-22T13:00:00.000Z',
    firstResponseAt: null,
    breachedAt: null,
  },
  escalation: null,
  links: [],
  lastMessage: { direction: 'inbound', preview: 'Hi!', at: AT },
  awaitingReply: 1,
  unread: true,
  snoozedUntil: null,
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

const inbound = (text: string, at = AT): InboxMessage => ({
  messageId: `m-${text}`,
  conversationId: 'x1',
  direction: 'inbound',
  text,
  attachments: [],
  authorId: null,
  accountId: 'a1',
  externalMessageId: null,
  clientMessageId: null,
  deliveryState: 'delivered',
  error: null,
  attempts: 0,
  handoffUrl: null,
  sandboxRequest: null,
  createdAt: at,
  sentAt: null,
});

/** A fake inbox server: replies, notes, field changes and read marks, with refusals on demand. */
async function setup() {
  const db = openNodeDriver();
  await migrate(db);
  const store = new LocalStore(db, SELF);
  const calls: string[] = [];
  let down = true;
  let refuseReplies = false;
  const server = {
    settings: { ...DEFAULT_INBOX_SETTINGS } as InboxSettings,
    channels: [{ connectorId: 'k1', name: 'Telegram support', status: 'active' }],
    c: conv(),
    timeline: [{ type: 'message', message: inbound('Hi!') }] as InboxConversationDetail['timeline'],
  };
  const detail = (): InboxConversationDetail => ({
    conversation: server.c,
    client: {
      clientId: 'cl1',
      name: 'Hannah Becker',
      company: 'Acme',
      email: null,
      phone: null,
      title: null,
      tags: [],
      ownerId: null,
      identities: [],
      links: [],
      conversationCount: 1,
      createdAt: AT,
    },
    timeline: server.timeline,
  });
  const inbox = async (method: string, path: string, body?: Record<string, unknown>) => {
    if (down) throw new TransportError('offline', 'network');
    calls.push(`${method} ${path}${body ? ` ${JSON.stringify(body)}` : ''}`);
    if (method === 'GET' && path.startsWith('/v1/inbox/conversations?')) {
      const l: InboxList = {
        items: [server.c],
        counts: {
          mine: server.c.assigneeId === SELF ? 1 : 0,
          unassigned: 0,
          active: 1,
          breached: 0,
        },
      };
      return l;
    }
    if (method === 'GET' && path === '/v1/inbox/conversations/x1') return detail();
    if (method === 'GET' && path === '/v1/inbox/settings') return server.settings;
    if (method === 'PUT' && path === '/v1/inbox/settings') {
      server.settings = body as unknown as InboxSettings;
      return server.settings;
    }
    if (method === 'GET' && path === '/v1/connectors') return server.channels;
    if (method === 'POST' && path.endsWith('/replies')) {
      if (refuseReplies) throw new TransportError('This channel is paused', 'api', 'CONFLICT');
      server.timeline = [
        ...server.timeline,
        {
          type: 'message',
          message: {
            ...inbound(String(body!.text)),
            messageId: `r${server.timeline.length}`,
            direction: 'outbound',
            authorId: SELF,
            clientMessageId: String(body!.clientMessageId),
            deliveryState: 'test',
          },
        },
      ];
      return server.timeline[server.timeline.length - 1];
    }
    if (method === 'POST' && path.endsWith('/notes')) {
      const note = {
        noteId: `n${server.timeline.length}`,
        conversationId: 'x1',
        authorId: SELF,
        text: String(body!.text),
        mentions: [],
        clientNoteId: String(body!.clientNoteId),
        createdAt: AT,
      };
      server.timeline = [...server.timeline, { type: 'note', note }];
      return note;
    }
    if (method === 'PATCH') {
      server.c = { ...server.c, ...(body as Partial<InboxConversation>) };
      return detail();
    }
    if (method === 'PUT' && path.endsWith('/read')) {
      server.c = { ...server.c, unread: false };
      return { ok: true };
    }
    throw new TransportError('Not found', 'api', 'NOT_FOUND');
  };
  // Everything else the engine reads on resume (sync, notifications...) is just "offline".
  const api = new Proxy(
    { inbox },
    {
      get: (t, k) =>
        k in t
          ? (t as Record<string | symbol, unknown>)[k]
          : async () => {
              throw new TransportError('offline', 'network');
            },
    },
  ) as unknown as ApiTransport;
  const session = {
    state: 'active',
    current: { user: { userId: SELF }, tenant: { tenantId: 't1', slug: 'acme' } },
    events: new Emitter(),
    refresh: async () => null,
  } as unknown as SessionManager;
  const rt = {
    events: new Emitter(),
    state: 'disconnected',
    connect() {},
    disconnect() {},
    reconnect() {},
  };
  const engine = new ConnectEngine(store, api, session, rt as unknown as RealtimeClient);
  await engine.start();
  const online = async () => {
    down = false;
    engine.setNetworkUp(true);
    await engine.resume();
    await engine.resume();
  };
  return {
    engine,
    server,
    calls,
    rt,
    online,
    offline: () => {
      down = true;
      engine.setNetworkUp(false);
    },
    refuse: (on: boolean) => (refuseReplies = on),
  };
}

describe('Client Inbox on mobile', () => {
  it('keeps a reply, a note, an assignment and a read mark made offline and sends them in order', async () => {
    const t = await setup();
    // Opened once online, so the conversation is on the phone.
    await t.online();
    await t.engine.inboxLoad('/v1/inbox/conversations/x1');
    t.offline();
    const p = '/v1/inbox/conversations/x1';
    await t.engine.inboxReply('x1', 'On it, Hannah');
    await t.engine.inboxNote('x1', 'Check with Lena first');
    await t.engine.inboxUpdate('x1', { assigneeId: SELF });
    await t.engine.inboxUpdate('x1', { priority: 'high' });
    await t.engine.inboxMarkRead('x1');
    await t.engine.inboxMarkRead('x1');

    const pending = await t.engine.inboxPending();
    expect(pending.posts.map((x) => `${x.kind}:${x.text}`)).toEqual([
      'reply:On it, Hannah',
      'note:Check with Lena first',
    ]);
    // Field changes merged into one; read marked once.
    expect(pending.updates.x1).toEqual({ assigneeId: SELF, priority: 'high' });
    expect([...pending.reads]).toEqual(['x1']);

    // The cached conversation already shows them.
    const d = (await t.engine.inboxCached<InboxConversationDetail>(p))!;
    const tl = timelineWithPending(d, pending, SELF);
    expect(tl.map((x) => x.type)).toEqual(['message', 'message', 'note']);

    t.calls.length = 0;
    await t.online();
    const sent = t.calls.filter((c) => !c.startsWith('GET'));
    expect(sent[0]).toMatch(/^POST \/v1\/inbox\/conversations\/x1\/replies .*On it, Hannah/);
    expect(sent[1]).toMatch(/^POST .*\/notes .*Check with Lena first/);
    expect(sent).toContain(`PATCH ${p} {"assigneeId":"${SELF}","priority":"high"}`);
    expect(sent).toContain(`PUT ${p}/read`);
    expect(sent.filter((c) => c.startsWith('PUT'))).toHaveLength(1);

    const after = await t.engine.inboxPending();
    expect(after.posts).toEqual([]);
    expect(after.updates).toEqual({});
    // The server's copy now has both, once each.
    const fresh = (await t.engine.inboxCached<InboxConversationDetail>(p))!;
    expect(timelineWithPending(fresh, after, SELF)).toHaveLength(3);
    expect(fresh.conversation.assigneeId).toBe(SELF);
    expect(fresh.conversation.unread).toBe(false);
  });

  it('keeps a refused reply with the reason until it is sent again or discarded', async () => {
    const t = await setup();
    await t.online();
    t.refuse(true);
    await t.engine.inboxReply('x1', 'Hello?');
    await t.engine.resume();
    let p = await t.engine.inboxPending();
    expect(p.posts).toHaveLength(1);
    expect(p.posts[0]!.error).toBe('This channel is paused');
    // A refused reply never holds back other changes to the conversation.
    await t.engine.inboxUpdate('x1', { status: 'resolved' });
    await t.engine.resume();
    expect(t.server.c.status).toBe('resolved');

    t.refuse(false);
    await t.engine.inboxRetry(p.posts[0]!.actionId);
    await t.engine.resume();
    p = await t.engine.inboxPending();
    expect(p.posts).toEqual([]);
    expect(t.server.timeline.some((x) => x.type === 'message' && x.message.text === 'Hello?')).toBe(
      true,
    );

    t.refuse(true);
    await t.engine.inboxReply('x1', 'Discard me');
    await t.engine.resume();
    p = await t.engine.inboxPending();
    await t.engine.inboxDiscard(p.posts[0]!.actionId);
    expect((await t.engine.inboxPending()).posts).toEqual([]);
  });

  it('re-reads cached lists and the conversation on inbox:changed from another agent', async () => {
    const t = await setup();
    await t.online();
    const listPath = inboxListPath(inboxQuery({ view: 'active' }));
    await t.engine.inboxLoad(listPath);
    t.server.c = { ...t.server.c, subject: 'Changed by Marco' };
    const seen: (string | null)[] = [];
    t.engine.events.on('inbox', (e) => seen.push(e.conversationId));
    t.rt.events.emit('inbox' as never, { conversationId: 'x1', reason: 'updated' } as never);
    await new Promise((r) => setTimeout(r, 20));
    const l = await t.engine.inboxCached<InboxList>(listPath);
    expect(l!.items[0]!.subject).toBe('Changed by Marco');
    expect(seen).toContain('x1');
  });
});

describe('Inbox settings and channels on mobile', () => {
  it('saves settings offline, shows the latest save at once and sends only that on reconnect', async () => {
    const t = await setup();
    await t.online();
    await t.engine.inboxLoad('/v1/inbox/settings');
    t.offline();
    const first = { ...t.server.settings, autoAssign: true };
    await t.engine.saveInboxSettings(first);
    const second = { ...first, sla: { ...first.sla, urgent: 15 }, dueSoonRatio: 0.5 };
    await t.engine.saveInboxSettings(second);
    // This phone shows the latest save before anything is sent.
    expect(await t.engine.inboxSettings()).toEqual(second);
    expect(t.server.settings.autoAssign).toBe(DEFAULT_INBOX_SETTINGS.autoAssign);

    t.calls.length = 0;
    await t.online();
    const puts = t.calls.filter((c) => c.startsWith('PUT /v1/inbox/settings'));
    expect(puts).toHaveLength(1);
    expect(t.server.settings).toEqual(second);
    // Nothing waits any more; the cached server copy is the saved one.
    expect(await t.engine.inboxCached<InboxSettings>('/v1/inbox/settings')).toEqual(second);
    expect(await t.engine.inboxSettings()).toEqual(second);
  });

  it('re-reads channels and settings when another admin changes them', async () => {
    const t = await setup();
    await t.online();
    await t.engine.inboxLoad('/v1/connectors');
    await t.engine.inboxLoad('/v1/inbox/settings');
    t.server.channels = [{ connectorId: 'k1', name: 'Telegram support', status: 'paused' }];
    t.server.settings = { ...t.server.settings, autoEscalateOnBreach: true };
    const seen: (string | null)[] = [];
    t.engine.events.on('inbox', (e) => seen.push(e.conversationId));
    t.rt.events.emit('tenant' as never, { area: 'inbox' } as never);
    await new Promise((r) => setTimeout(r, 20));
    const ch = await t.engine.inboxCached<{ status: string }[]>('/v1/connectors');
    expect(ch![0]!.status).toBe('paused');
    expect((await t.engine.inboxSettings())!.autoEscalateOnBreach).toBe(true);
    expect(seen).toContain(null);
  });
});

describe('inbox helpers', () => {
  it('builds stable list paths and drops conversations a change moved out of the view', () => {
    expect(inboxListPath(inboxQuery({ view: 'mine', q: ' tracker ' }))).toBe(
      '/v1/inbox/conversations?assignee=me&q=tracker&status=active',
    );
    const items = [conv({ assigneeId: SELF })];
    expect(overlayList(items, NO_PENDING, 'mine', SELF)).toHaveLength(1);
    const resolved = { ...NO_PENDING, updates: { x1: { status: 'resolved' as const } } };
    expect(overlayList(items, resolved, 'mine', SELF)).toHaveLength(0);
    expect(overlayList(items, resolved, 'resolved', SELF)).toHaveLength(1);
  });

  it('labels service levels and finds template shortcuts', () => {
    const now = Date.parse('2026-11-22T12:00:00.000Z');
    expect(slaLabel(conv().sla, now)).toEqual({ text: '1h left', tone: 'muted' });
    expect(
      slaLabel({ ...conv().sla, state: 'breached', dueAt: '2026-11-22T11:30:00.000Z' }, now),
    ).toEqual({
      text: '30m over',
      tone: 'danger',
    });
    expect(templateQuery('/top')).toBe('top');
    expect(templateQuery('hi /top')).toBeNull();
  });
});
