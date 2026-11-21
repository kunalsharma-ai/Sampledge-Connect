import { describe, expect, it } from 'vitest';
import type { Approval, Message, Poll, ScheduledMessage, Task } from '@sampledge/contracts';
import type { SessionManager } from '../auth/session';
import { migrate, rebuildPreservingUnsent } from '../db/migrations';
import { LocalStore } from '../db/store';
import { applyDecision, overlayVote } from '../db/work';
import { Emitter } from '../lib/emitter';
import { ConnectEngine } from '../state/engine';
import { conversation, PEER, SELF, serverMessage } from '../test/fixtures';
import { openNodeDriver } from '../test/nodeDriver';
import type { RealtimeClient } from './realtime';
import { TransportError, type ApiTransport } from './transport';

const NOW = Date.parse('2026-11-21T12:00:00.000Z');

const poll = (over: Partial<Poll> = {}): Poll => ({
  question: 'Lunch?',
  options: [
    { optionId: 'o1', text: 'Pizza', count: 1, voterIds: [PEER] },
    { optionId: 'o2', text: 'Salad', count: 0, voterIds: [] },
  ],
  multiple: false,
  anonymous: false,
  totalVoters: 1,
  closesAt: null,
  closedAt: null,
  closedBy: null,
  ...over,
});

const task = (over: Partial<Task> = {}): Task => ({
  taskId: 'task-1',
  title: 'Send the deck',
  description: '',
  kind: 'task',
  status: 'open',
  priority: 'normal',
  assigneeIds: [SELF],
  createdBy: PEER,
  dueAt: null,
  conversationId: 'c1',
  sourceMessageId: null,
  sourceExcerpt: null,
  record: null,
  origin: 'connect',
  moduleSync: null,
  createdAt: '2026-11-20T10:00:00.000Z',
  updatedAt: '2026-11-20T10:00:00.000Z',
  completedAt: null,
  ...over,
});

const approval = (over: Partial<Approval> = {}): Approval => ({
  approvalId: 'ap-1',
  title: 'Budget',
  description: '',
  category: 'budget',
  amount: null,
  requesterId: PEER,
  approverIds: [SELF],
  policy: 'any',
  decisions: [],
  status: 'pending',
  conversationId: 'c1',
  sourceMessageId: null,
  record: null,
  origin: 'connect',
  dueAt: null,
  createdAt: '2026-11-20T10:00:00.000Z',
  decidedAt: null,
  ...over,
});

/** An engine over a real SQLite cache with a scripted server. */
async function setup() {
  const db = openNodeDriver();
  await migrate(db);
  const store = new LocalStore(db, SELF);
  await store.upsertConversations([conversation('c1')]);
  const calls: string[] = [];
  let down = false;
  const refuse = new Map<string, TransportError>();
  const server = {
    messages: new Map<string, Message>(),
    tasks: new Map<string, Task>(),
    approvals: new Map<string, Approval>(),
    scheduled: new Map<string, ScheduledMessage>(),
    seq: 100,
  };
  const step = (name: string) => {
    calls.push(name);
    if (down) throw new TransportError('offline', 'network');
    const r = refuse.get(name.split(' ')[0]!);
    if (r) throw r;
  };
  const bump = (m: Message, over: Partial<Message>): Message => {
    const next = { ...m, ...over, changeSequence: ++server.seq };
    server.messages.set(m.messageId, next);
    return next;
  };
  const api = {
    sync: async () => ({ conversations: [], revokedConversationIds: [], results: [] }),
    listUsers: async () => [],
    listNotifications: async () => ({ items: [], unreadCount: 0, nextBefore: null }),
    listMeetings: async () => [],
    callsConfig: async () => ({ enabled: false, provider: 'none', ringTimeoutSeconds: 30 }),
    activeCalls: async () => [],
    pinMessage: async (id: string, pinned: boolean) => {
      step(`pin ${id} ${pinned}`);
      return bump(server.messages.get(id)!, {
        pinned: pinned ? { pinnedBy: SELF, pinnedAt: new Date(NOW).toISOString() } : null,
      });
    },
    setBookmark: async (id: string, saved: boolean) => step(`bookmark ${id} ${saved}`),
    listBookmarks: async () => {
      step('listBookmarks');
      return [];
    },
    createPoll: async (
      conversationId: string,
      req: { clientMessageId: string; question: string },
    ) => {
      step(`createPoll ${req.question}`);
      const m = serverMessage({
        conversationId,
        serverSequence: ++server.seq,
        clientMessageId: req.clientMessageId,
        senderId: SELF,
        content: { text: req.question, mentions: [] },
        poll: poll({
          question: req.question,
          options: poll().options.map((o) => ({ ...o, count: 0, voterIds: [] })),
          totalVoters: 0,
        }),
      });
      server.messages.set(m.messageId, m);
      return m;
    },
    votePoll: async (id: string, optionIds: string[]) => {
      step(`vote ${id} ${optionIds.join(',')}`);
      const m = server.messages.get(id)!;
      return bump(m, { poll: overlayVote(m.poll!, SELF, [], optionIds) });
    },
    closePoll: async (id: string) => {
      step(`close ${id}`);
      const m = server.messages.get(id)!;
      return bump(m, {
        poll: { ...m.poll!, closedAt: new Date(NOW).toISOString(), closedBy: SELF },
      });
    },
    myPollVote: async (id: string) => ({ messageId: id, optionIds: [] }),
    listTasks: async () => {
      step('listTasks');
      return [...server.tasks.values()];
    },
    getTask: async (id: string) => server.tasks.get(id)!,
    createTask: async (req: { title: string; priority?: string; clientRequestId: string }) => {
      step(`createTask ${req.title} ${req.priority ?? 'normal'}`);
      const t = task({
        taskId: `task-${server.tasks.size + 10}`,
        title: req.title,
        priority: (req.priority ?? 'normal') as Task['priority'],
        createdBy: SELF,
      });
      server.tasks.set(t.taskId, t);
      return t;
    },
    updateTask: async (id: string, patch: Partial<Task>) => {
      step(`updateTask ${id} ${JSON.stringify(patch)}`);
      const t = {
        ...server.tasks.get(id)!,
        ...patch,
        updatedAt: new Date(NOW + 1000).toISOString(),
      };
      server.tasks.set(id, t);
      return t;
    },
    listApprovals: async () => [...server.approvals.values()],
    getApproval: async (id: string) => server.approvals.get(id)!,
    decideApproval: async (id: string, req: { decision: 'approve' | 'reject' }) => {
      step(`decide ${id} ${req.decision}`);
      const a = applyDecision(server.approvals.get(id)!, SELF, req, new Date(NOW).toISOString());
      server.approvals.set(id, a);
      return a;
    },
    cancelApproval: async (id: string) => {
      step(`cancelApproval ${id}`);
      return { ...server.approvals.get(id)!, status: 'cancelled' };
    },
    listScheduled: async () => [...server.scheduled.values()],
    scheduleMessage: async (
      conversationId: string,
      req: { clientMessageId: string; sendAt: string; content: { text: string } },
    ) => {
      step(`schedule ${req.content.text}`);
      const s: ScheduledMessage = {
        scheduledId: `s-${server.scheduled.size + 1}`,
        conversationId,
        clientMessageId: req.clientMessageId,
        content: { text: req.content.text, mentions: [] },
        replyToMessageId: null,
        sendAt: req.sendAt,
        status: 'scheduled',
        messageId: null,
        error: null,
        createdAt: new Date(NOW).toISOString(),
        updatedAt: new Date(NOW).toISOString(),
      };
      server.scheduled.set(s.scheduledId, s);
      return s;
    },
    sendMessage: async () => {
      throw new TransportError('offline', 'network');
    },
  } as unknown as ApiTransport;
  const session = {
    state: 'active',
    current: { user: { userId: SELF }, tenant: { tenantId: 't1' } },
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
  const refused: string[] = [];
  engine.events.on('actionRefused', (e) => refused.push(`${e.kind}: ${e.reason}`));
  /** Goes online and waits for the queue to drain. */
  const online = async () => {
    down = false;
    engine.setNetworkUp(true);
    await engine.resume();
    await engine.resume();
  };
  const addMessage = async (over: Partial<Message> = {}) => {
    const m = serverMessage({ conversationId: 'c1', serverSequence: ++server.seq, ...over });
    server.messages.set(m.messageId, m);
    await store.applyServerMessages([m]);
    return m;
  };
  return {
    db,
    store,
    engine,
    rt,
    calls,
    server,
    refused,
    online,
    addMessage,
    setDown: (d: boolean) => (down = d),
    refuse: (name: string, err: TransportError | null) =>
      err ? refuse.set(name, err) : refuse.delete(name),
  };
}

describe('pins and saved messages offline', () => {
  it('shows a pin at once, keeps only the latest intent, and sends it on reconnect', async () => {
    const t = await setup();
    const m = await t.addMessage();
    await t.engine.pinMessage(m.messageId, true);
    await t.engine.pinMessage(m.messageId, false);
    await t.engine.pinMessage(m.messageId, true);
    const pins = await t.store.listPinned('c1');
    expect(pins.map((p) => p.messageId)).toEqual([m.messageId]);
    expect(pins[0]!.actionPending).toBe(true);
    expect(await t.store.pendingCount()).toBe(1);

    await t.online();
    expect(t.calls.filter((c) => c.startsWith('pin'))).toEqual([`pin ${m.messageId} true`]);
    const after = await t.store.listPinned('c1');
    expect(after[0]!.actionPending).toBe(false);
    expect(after[0]!.pinned?.pinnedBy).toBe(SELF);
    expect(await t.store.pendingCount()).toBe(0);
  });

  it('an unpin made offline hides the pin until the server confirms', async () => {
    const t = await setup();
    const m = await t.addMessage({
      pinned: { pinnedBy: PEER, pinnedAt: '2026-11-20T09:00:00.000Z' },
    });
    await t.engine.pinMessage(m.messageId, false);
    expect(await t.store.listPinned('c1')).toEqual([]);
  });

  it('saves offline from the local copy and syncs the saved list', async () => {
    const t = await setup();
    const m = await t.addMessage();
    await t.engine.setBookmark(m.messageId, true);
    expect([...(await t.engine.savedIds())]).toEqual([m.messageId]);
    const list = await t.engine.listBookmarks({ fresh: false });
    expect(list).toHaveLength(1);
    expect(list[0]!.pending).toBe(true);
    expect(list[0]!.message.content.text).toBe(m.content.text);

    await t.online();
    expect(t.calls).toContain(`bookmark ${m.messageId} true`);
  });

  it('applies a save from another device live', async () => {
    const t = await setup();
    const m = await t.addMessage();
    t.rt.events.emit('bookmark', { messageId: m.messageId, conversationId: 'c1', saved: true });
    await new Promise((r) => setTimeout(r, 20));
    expect([...(await t.engine.savedIds())]).toEqual([m.messageId]);
    t.rt.events.emit('bookmark', { messageId: m.messageId, conversationId: 'c1', saved: false });
    await new Promise((r) => setTimeout(r, 20));
    expect([...(await t.engine.savedIds())]).toEqual([]);
  });
});

describe('polls offline', () => {
  it('a poll made offline shows in the conversation and is posted once on reconnect', async () => {
    const t = await setup();
    await t.engine.createPoll('c1', { question: 'Friday?', options: ['Yes', 'No'] });
    const local = (await t.store.listMessages('c1')).find((m) => m.poll);
    expect(local?.status).toBe('queued');
    expect(local?.poll?.question).toBe('Friday?');

    await t.online();
    expect(t.calls.filter((c) => c.startsWith('createPoll'))).toEqual(['createPoll Friday?']);
    const polls = (await t.store.listMessages('c1')).filter((m) => m.poll);
    expect(polls).toHaveLength(1); // the server copy replaced the local one (same client id)
    expect(polls[0]!.messageId).not.toBeNull();
  });

  it('a vote shows at once with counts adjusted, and only the last choice is sent', async () => {
    const t = await setup();
    const m = await t.addMessage({ poll: poll() });
    await t.engine.votePoll(m.messageId, ['o1']);
    await t.engine.votePoll(m.messageId, ['o2']);
    const shown = (await t.store.getMessageByServerId(m.messageId))!;
    expect(shown.poll!.options.map((o) => o.count)).toEqual([1, 1]);
    expect(shown.poll!.options[1]!.voterIds).toContain(SELF);
    expect(shown.poll!.totalVoters).toBe(2);
    expect(await t.engine.myPollVote(m.messageId, shown.poll!)).toEqual(['o2']);

    await t.online();
    expect(t.calls.filter((c) => c.startsWith('vote'))).toEqual([`vote ${m.messageId} o2`]);
    const after = (await t.store.getMessageByServerId(m.messageId))!;
    expect(after.actionPending).toBe(false);
    expect(after.poll!.options.map((o) => o.count)).toEqual([1, 1]);
  });

  it('a close the server refuses is dropped and reported; the server state shows again', async () => {
    const t = await setup();
    const m = await t.addMessage({ poll: poll() });
    await t.engine.closePoll(m.messageId);
    expect((await t.store.getMessageByServerId(m.messageId))!.poll!.closedAt).not.toBeNull();
    t.refuse('close', new TransportError('Not allowed', 'api', 'FORBIDDEN'));
    await t.online();
    expect((await t.store.getMessageByServerId(m.messageId))!.poll!.closedAt).toBeNull();
    expect(t.refused).toEqual(['poll.close: You do not have permission to do that.']);
    expect(await t.store.pendingCount()).toBe(0);
  });
});

describe('tasks and approvals offline', () => {
  it('a task created offline is listed at once, edits fold into the create, and later changes follow its new id', async () => {
    const t = await setup();
    const local = await t.engine.createTask({ title: 'Draft brief', assigneeIds: [SELF] });
    expect(local.local).toBe(true);
    await t.engine.updateTask(local.taskId, { priority: 'high' });
    await t.engine.updateTask(local.taskId, { status: 'in_progress' });
    const mine = await t.engine.listTasks({ scope: 'mine', status: 'active' }, { fresh: false });
    expect(mine.map((x) => [x.title, x.priority, x.status, x.pending])).toEqual([
      ['Draft brief', 'high', 'in_progress', true],
    ]);

    await t.online();
    expect(t.calls.filter((c) => /Task /.test(c))).toEqual([
      'createTask Draft brief high',
      'updateTask task-10 {"status":"in_progress"}',
    ]);
    // The screen opened with the local id still finds it.
    const opened = await t.engine.getTask(local.taskId, { fresh: false });
    expect(opened.taskId).toBe('task-10');
    expect(opened.pending).toBeFalsy();
    expect(opened.status).toBe('in_progress');
  });

  it('a network failure holds later actions so they never overtake the one before', async () => {
    const t = await setup();
    t.server.tasks.set('task-1', task());
    await t.store.work.upsert('task', [task()]);
    await t.engine.updateTask('task-1', { status: 'done' });
    const m = await t.addMessage();
    await t.engine.pinMessage(m.messageId, true);
    t.engine.setNetworkUp(true);
    t.setDown(true);
    await t.engine.resume();
    expect(t.calls.filter((c) => !c.startsWith('list'))).toEqual([
      'updateTask task-1 {"status":"done"}',
    ]);
    expect(await t.store.pendingCount()).toBe(2);
  });

  it('a decision shows at once; a refused one is dropped and the server copy shows', async () => {
    const t = await setup();
    t.server.approvals.set('ap-1', approval());
    await t.store.work.upsert('approval', [approval()]);
    await t.engine.decideApproval('ap-1', { decision: 'approve' });
    expect((await t.engine.getApproval('ap-1', { fresh: false })).status).toBe('approved');
    t.refuse('decide', new TransportError('Already decided', 'api', 'CONFLICT'));
    await t.online();
    expect((await t.engine.getApproval('ap-1', { fresh: false })).status).toBe('pending');
    expect(t.refused).toEqual(['approval.decide: Already decided']);
  });

  it('a create the server refuses is kept as not sent until retried or discarded', async () => {
    const t = await setup();
    t.refuse('createTask', new TransportError('Assignee left', 'api', 'VALIDATION_FAILED'));
    const local = await t.engine.createTask({ title: 'Doomed' });
    await t.online();
    const kept = await t.engine.getTask(local.taskId, { fresh: false });
    expect(kept.syncError).toBe('Assignee left');
    expect(await t.store.pendingCount()).toBe(0); // refused items are not "waiting"
    t.refuse('createTask', null);
    await t.engine.retryLocal('task', local.taskId);
    await t.online();
    expect((await t.engine.getTask(local.taskId, { fresh: false })).taskId).toBe('task-10');
  });

  it('live task changes from other devices update the cache', async () => {
    const t = await setup();
    t.rt.events.emit('work', { kind: 'task', task: task({ title: 'From the web' }) });
    await new Promise((r) => setTimeout(r, 20));
    const mine = await t.engine.listTasks({ scope: 'mine', status: 'active' }, { fresh: false });
    expect(mine.map((x) => x.title)).toEqual(['From the web']);
    // An older copy arriving late never replaces it.
    t.rt.events.emit('work', {
      kind: 'task',
      task: task({ title: 'Stale', updatedAt: '2026-11-19T00:00:00.000Z' }),
    });
    await new Promise((r) => setTimeout(r, 20));
    expect((await t.engine.getTask('task-1', { fresh: false })).title).toBe('From the web');
  });

  it('a reconnect drops tasks the server no longer lists in that scope', async () => {
    const t = await setup();
    await t.store.work.upsert('task', [task(), task({ taskId: 'task-2', title: 'Gone' })]);
    t.server.tasks.set('task-1', task());
    await t.online();
    const mine = await t.engine.listTasks({ scope: 'mine', status: 'active' }, { fresh: false });
    expect(mine.map((x) => x.taskId)).toEqual(['task-1']);
  });
});

describe('scheduled messages offline', () => {
  it('scheduling offline shows it at once and creates it on reconnect', async () => {
    const t = await setup();
    const at = new Date(Date.now() + 3600_000);
    const s = await t.engine.scheduleMessage('c1', 'Morning all', at);
    expect(s.local).toBe(true);
    const later = new Date(Date.now() + 7200_000);
    await t.engine.rescheduleMessage(s.scheduledId, later);
    expect((await t.engine.listScheduled('c1', { fresh: false }))[0]!.sendAt).toBe(
      later.toISOString(),
    );
    await t.online();
    expect(t.calls.filter((c) => c.startsWith('schedule'))).toEqual(['schedule Morning all']);
    const list = await t.engine.listScheduled('c1', { fresh: false });
    expect(list.map((x) => [x.scheduledId, x.sendAt])).toEqual([['s-1', later.toISOString()]]);
  });

  it('send now on one that never reached the server becomes an ordinary send', async () => {
    const t = await setup();
    const s = await t.engine.scheduleMessage('c1', 'Ship it', new Date(Date.now() + 3600_000));
    await t.engine.sendScheduledNow(s.scheduledId);
    expect(await t.engine.listScheduled('c1', { fresh: false })).toEqual([]);
    const queued = (await t.store.listMessages('c1')).filter((m) => m.status === 'queued');
    expect(queued.map((m) => m.text)).toEqual(['Ship it']);
  });
});

describe('cache recovery', () => {
  it('a rebuilt cache keeps queued actions and does not turn an offline poll into a text', async () => {
    const t = await setup();
    const m = await t.addMessage();
    await t.engine.pinMessage(m.messageId, true);
    await t.engine.createPoll('c1', { question: 'Keep?', options: ['A', 'B'] });
    await rebuildPreservingUnsent(t.db);
    const store = new LocalStore(t.db, SELF);
    const left = await t.db.all<{ kind: string }>('SELECT kind FROM actions ORDER BY enqueued_at');
    expect(left.map((a) => a.kind)).toEqual(['pin', 'poll.create']);
    expect(await store.listMessages('c1')).toEqual([]); // the poll is posted from its action
    expect(await t.db.all('SELECT * FROM outbox')).toEqual([]);
  });
});

describe('organization changes from other devices', () => {
  it('refreshes names on directory:updated and reloads branding on tenant:updated', async () => {
    const t = await setup();
    let users = [
      {
        userId: PEER,
        displayName: 'Marco',
        email: 'm@x',
        role: 'member',
        title: null,
        status: 'active',
      },
    ];
    const api = (t.engine as unknown as { api: Record<string, unknown> }).api;
    api.listUsers = async () => users;
    api.getBranding = async () => ({ appName: 'Northwind' });
    t.engine.setNetworkUp(true);
    users = [{ ...users[0]!, displayName: 'Marco Silva' }];
    t.rt.events.emit('directory', { userId: PEER });
    await new Promise((r) => setTimeout(r, 30));
    expect(JSON.parse((await t.store.getSetting('people'))!)).toEqual({ [PEER]: 'Marco Silva' });

    const seen: unknown[] = [];
    t.engine.events.on('branding', (b) => seen.push(b));
    t.engine.events.on('tenant', (e) => seen.push(e.area));
    t.rt.events.emit('tenant', { area: 'branding' });
    await new Promise((r) => setTimeout(r, 30));
    expect(seen).toEqual([{ appName: 'Northwind' }, 'branding']);
  });
});
