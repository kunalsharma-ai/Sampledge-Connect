import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CALL_APPEARANCE,
  DEFAULT_DND_SCHEDULE,
  effectiveChatTheme,
} from '@sampledge/contracts';
import type {
  ChatThemeId,
  ChatThemePolicy,
  CallBackgroundChoice,
  CallBackgroundState,
  MeetingMinutes,
  Approval,
  BookingPage,
  CreateBookingPageRequest,
  Message,
  Poll,
  ScheduledMessage,
  Task,
  UserStatus,
  DndSchedule,
  WorkingHours,
} from '@sampledge/contracts';
import type { SessionManager } from '../auth/session';
import { migrate, rebuildPreservingUnsent } from '../db/migrations';
import { LocalStore } from '../db/store';
import { applyDecision, bookingFromRequest, overlayVote } from '../db/work';
import { Emitter } from '../lib/emitter';
import { ConnectEngine } from '../state/engine';
import { conversation, PEER, SELF, serverMessage } from '../test/fixtures';
import { openNodeDriver } from '../test/nodeDriver';
import type { RealtimeClient } from './realtime';
import { TransportError, type ApiTransport, type DirectoryUser } from './transport';

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
    booking: new Map<string, BookingPage>(),
    recent: ['wave 3'] as string[],
    hours: {
      timeZone: 'Asia/Kolkata',
      days: [{ day: 1, start: '09:00', end: '17:30' }],
    } as WorkingHours,
    theme: { themeId: null, policy: { defaultThemeId: 'default', allowed: null } } as {
      themeId: ChatThemeId | null;
      policy: ChatThemePolicy;
    },
    minutes: null as MeetingMinutes | null,
    minutesFieldRevs: {} as Record<string, number>,
    callbg: {
      choice: null as CallBackgroundChoice | null,
      imageKey: null as string | null,
      policy: { defaultChoice: { kind: 'none' }, enforceLogo: false } as Omit<
        CallBackgroundState['policy'],
        'canManage'
      >,
    },
    users: new Map<string, DirectoryUser>([
      [
        SELF,
        {
          userId: SELF,
          displayName: 'Sam Patel',
          email: 's@x',
          role: 'member',
          title: 'Analyst',
          status: 'active',
          avatarUrl: null,
        },
      ],
      [
        PEER,
        {
          userId: PEER,
          displayName: 'Marco Silva',
          email: 'm@x',
          role: 'member',
          title: null,
          status: 'active',
          avatarUrl: 'https://connect.test/v1/avatars/t1/marco',
        },
      ],
    ]),
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
  const callbgState = (): CallBackgroundState => {
    const b = server.callbg;
    return {
      choice: b.choice,
      effective: b.policy.enforceLogo ? { kind: 'logo' } : (b.choice ?? b.policy.defaultChoice),
      customImageUrl: b.imageKey
        ? `https://connect.test/v1/call-backgrounds/t1/${b.imageKey}`
        : null,
      uploads: [],
      policy: { ...b.policy, canManage: false },
      brand: { name: 'Acme', logo: null, primary: '#1f3a5f', secondary: '#c9a227' },
      appearance: DEFAULT_CALL_APPEARANCE,
    };
  };
  const api = {
    sync: async () => ({ conversations: [], revokedConversationIds: [], results: [] }),
    listUsers: async () => {
      step('listUsers');
      return [...server.users.values()];
    },
    updateProfile: async (patch: Record<string, string | null>) => {
      step(`updateProfile ${JSON.stringify(patch)}`);
      const me = server.users.get(SELF)!;
      const next = { ...me };
      for (const [k, v] of Object.entries(patch)) (next as Record<string, unknown>)[k] = v || null;
      if (patch.displayName) next.displayName = patch.displayName;
      server.users.set(SELF, next);
      return next;
    },
    setAvatar: async (image: string) => {
      step(`setAvatar ${image.slice(0, 22)}`);
      const next = {
        ...server.users.get(SELF)!,
        avatarUrl: `https://connect.test/v1/avatars/t1/k${++server.seq}`,
      };
      server.users.set(SELF, next);
      return next;
    },
    removeAvatar: async () => {
      step('removeAvatar');
      const next = { ...server.users.get(SELF)!, avatarUrl: null };
      server.users.set(SELF, next);
      return next;
    },
    setStatus: async (status: UserStatus) => {
      step(`setStatus ${status.availability} ${status.text ?? ''}`.trim());
      if (status.expiresAt && Date.parse(status.expiresAt) <= Date.now())
        throw new TransportError('Pick a time in the future', 'api', 'VALIDATION_FAILED');
      const me = server.users.get(SELF)!;
      server.users.set(SELF, { ...me, userStatus: status });
      return { status, dndSchedule: me.dndSchedule ?? DEFAULT_DND_SCHEDULE, dndActive: false };
    },
    setDndSchedule: async (schedule: DndSchedule) => {
      step(`setDndSchedule ${schedule.enabled} ${schedule.start}-${schedule.end}`);
      const me = server.users.get(SELF)!;
      server.users.set(SELF, { ...me, dndSchedule: schedule });
      return {
        status: me.userStatus ?? { availability: 'auto', emoji: null, text: null, expiresAt: null },
        dndSchedule: schedule,
        dndActive: false,
      };
    },
    getWorkingHours: async () => {
      step('listWorkingHours');
      return server.hours;
    },
    setWorkingHours: async (h: WorkingHours) => {
      step(`setWorkingHours ${h.days.map((d) => `${d.day}:${d.start}-${d.end}`).join(',')}`);
      server.hours = h;
      return h;
    },
    getChatTheme: async () => {
      step('listChatTheme');
      return {
        ...server.theme,
        effective: effectiveChatTheme(server.theme.themeId, server.theme.policy),
      };
    },
    setChatTheme: async (themeId: ChatThemeId | null) => {
      step(`setChatTheme ${themeId}`);
      const p = server.theme.policy;
      if (themeId && p.allowed && !p.allowed.includes(themeId))
        throw new TransportError(
          'Your organization doesn’t offer that chat theme',
          'api',
          'VALIDATION_FAILED',
        );
      server.theme = { ...server.theme, themeId };
      return { ...server.theme, effective: effectiveChatTheme(themeId, p) };
    },
    callMinutes: async (callId: string) => {
      step(`listCallMinutes ${callId}`);
      return { minutes: server.minutes, canCreate: true, blockedReason: null };
    },
    updateMinutes: async (id: string, req: Record<string, unknown> & { baseRevision: number }) => {
      const { baseRevision, ...patch } = req;
      step(`updateMinutes ${id} base ${baseRevision} ${Object.keys(patch).sort().join(',')}`);
      const cur = server.minutes!;
      const conflicts = Object.keys(patch).filter(
        (f) =>
          (server.minutesFieldRevs[f] ?? 0) > baseRevision &&
          JSON.stringify((cur as Record<string, unknown>)[f]) !== JSON.stringify(patch[f]),
      );
      if (conflicts.length)
        throw new TransportError(
          'Someone else changed the same part of these minutes. Reload to see their version.',
          'api',
          'CONFLICT',
        );
      const revision = cur.revision + 1;
      for (const f of Object.keys(patch)) server.minutesFieldRevs[f] = revision;
      server.minutes = { ...cur, ...patch, revision } as MeetingMinutes;
      return server.minutes;
    },
    getCallBackground: async () => {
      step('listCallBackground');
      return callbgState();
    },
    setCallBackground: async (choice: CallBackgroundChoice) => {
      step(`setCallBackground ${choice.kind === 'preset' ? choice.presetId : choice.kind}`);
      if (choice.kind === 'custom' && !server.callbg.imageKey)
        throw new TransportError('Upload an image first', 'api', 'VALIDATION_FAILED');
      server.callbg.choice = choice;
      return callbgState();
    },
    uploadCallBackground: async (localUri: string) => {
      step(`uploadCallBackground ${localUri}`);
      server.callbg.imageKey = `k${++server.seq}`;
      server.callbg.choice = { kind: 'custom' };
      return callbgState();
    },
    removeCallBackgroundImage: async () => {
      step('removeCallBackgroundImage');
      if (server.callbg.choice?.kind === 'custom') server.callbg.choice = null;
      server.callbg.imageKey = null;
      return callbgState();
    },
    getRecentSearches: async () => {
      step('listRecentSearches');
      return server.recent;
    },
    setRecentSearches: async (recent: string[]) => {
      step(`setRecent ${recent.join('|')}`);
      server.recent = [...recent];
      return server.recent;
    },
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
    listBookingPages: async () => {
      step('listBookingPages');
      return [...server.booking.values()].filter((p) => p.hostIds.includes(SELF));
    },
    createBookingPage: async (req: CreateBookingPageRequest) => {
      step(`createBooking ${req.slug}`);
      if ([...server.booking.values()].some((p) => p.slug === req.slug))
        throw new TransportError('That link is already taken. Try another.', 'api', 'CONFLICT');
      const id = `bp-${server.booking.size + 1}`;
      const p = {
        ...bookingFromRequest(id, req, SELF, new Date(NOW).toISOString()),
        url: `https://connect.test/book/${req.slug}`,
      };
      server.booking.set(id, p);
      return p;
    },
    updateBookingPage: async (id: string, patch: Partial<BookingPage>) => {
      step(`updateBooking ${id} ${JSON.stringify(patch)}`);
      const p = {
        ...server.booking.get(id)!,
        ...patch,
        updatedAt: new Date(NOW + 1000).toISOString(),
      };
      server.booking.set(id, p);
      return p;
    },
    deleteBookingPage: async (id: string) => {
      step(`deleteBooking ${id}`);
      if (!server.booking.delete(id)) throw new TransportError('Gone', 'api', 'NOT_FOUND');
      return { deleted: true };
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

describe('booking pages offline', () => {
  it('a page made offline is listed at once, edits fold into it, and it is created once on reconnect', async () => {
    const t = await setup();
    const local = await t.engine.createBookingPage({ title: 'Intro call', slug: 'intro-call' });
    expect(local.local).toBe(true);
    await t.engine.updateBookingPage(local.bookingPageId, { durationMinutes: 45, enabled: false });
    const shown = await t.engine.listBookingPages({ fresh: false });
    expect(shown.map((p) => [p.title, p.durationMinutes, p.enabled, p.pending])).toEqual([
      ['Intro call', 45, false, true],
    ]);
    await t.online();
    expect(t.calls.filter((c) => /Booking /.test(c))).toEqual(['createBooking intro-call']);
    const [page] = await t.engine.listBookingPages({ fresh: false });
    expect(page).toMatchObject({
      bookingPageId: 'bp-1',
      durationMinutes: 45,
      enabled: false,
      url: 'https://connect.test/book/intro-call',
    });
    expect(page!.pending).toBeFalsy();
    // Opened with the local id: still found under its server id.
    expect((await t.engine.getBookingPage(local.bookingPageId)).bookingPageId).toBe('bp-1');
  });

  it('only changed fields are sent, coalesced, and a delete drops edits waiting before it', async () => {
    const t = await setup();
    const p = {
      ...bookingFromRequest(
        'bp-9',
        { title: 'Demo', slug: 'demo' },
        SELF,
        '2026-11-20T10:00:00.000Z',
      ),
    };
    t.server.booking.set('bp-9', p);
    await t.store.work.upsert('booking', [p]);
    await t.engine.updateBookingPage('bp-9', { enabled: false });
    await t.engine.updateBookingPage('bp-9', { title: 'Product demo' });
    expect((await t.engine.getBookingPage('bp-9')).title).toBe('Product demo');
    await t.online();
    expect(t.calls.filter((c) => /Booking /.test(c))).toEqual([
      'updateBooking bp-9 {"enabled":false,"title":"Product demo"}',
    ]);

    t.engine.setNetworkUp(false);
    await t.engine.updateBookingPage('bp-9', { durationMinutes: 60 });
    await t.engine.deleteBookingPage('bp-9');
    expect(await t.engine.listBookingPages({ fresh: false })).toEqual([]);
    await t.online();
    expect(t.calls.filter((c) => /Booking /.test(c)).slice(1)).toEqual(['deleteBooking bp-9']);
    expect(t.server.booking.size).toBe(0);
  });

  it('a link someone else took is kept as not sent; fixing the link sends it again', async () => {
    const t = await setup();
    t.server.booking.set('bp-0', {
      ...bookingFromRequest(
        'bp-0',
        { title: 'Theirs', slug: 'sales' },
        PEER,
        '2026-11-20T10:00:00.000Z',
      ),
      hostIds: [PEER],
    });
    const local = await t.engine.createBookingPage({ title: 'Sales call', slug: 'sales' });
    await t.online();
    const kept = await t.engine.getBookingPage(local.bookingPageId);
    expect(kept.syncError).toBe('That link is already taken. Try another.');
    expect(t.refused).toEqual(['booking.create: That link is already taken. Try another.']);
    await t.engine.updateBookingPage(local.bookingPageId, { slug: 'sales-intro' });
    await t.online();
    const [page] = await t.engine.listBookingPages({ fresh: false });
    expect(page).toMatchObject({ slug: 'sales-intro', bookingPageId: 'bp-2' });
    expect(page!.syncError).toBeFalsy();
  });

  it('a lost answer does not make a second page or a false conflict', async () => {
    const t = await setup();
    const local = await t.engine.createBookingPage({ title: 'Intro', slug: 'intro' });
    // The first try reached the server, but the answer never arrived.
    t.server.booking.set('bp-1', {
      ...bookingFromRequest(
        'bp-1',
        { title: 'Intro', slug: 'intro' },
        SELF,
        new Date(NOW).toISOString(),
      ),
      url: 'https://connect.test/book/intro',
    });
    await t.online();
    expect(t.server.booking.size).toBe(1);
    expect((await t.engine.getBookingPage(local.bookingPageId)).bookingPageId).toBe('bp-1');
  });

  it('changes by a co-host or another device show live; a page you no longer host goes away', async () => {
    const t = await setup();
    const p = bookingFromRequest(
      'bp-5',
      { title: 'Team intro', slug: 'team', hostIds: [PEER] },
      SELF,
      '2026-11-20T10:00:00.000Z',
    );
    t.rt.events.emit('booking', { bookingPageId: 'bp-5', page: p });
    await new Promise((r) => setTimeout(r, 20));
    expect((await t.engine.listBookingPages({ fresh: false })).map((x) => x.title)).toEqual([
      'Team intro',
    ]);
    t.rt.events.emit('booking', {
      bookingPageId: 'bp-5',
      page: { ...p, hostIds: [PEER], updatedAt: '2026-11-21T10:00:00.000Z' },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(await t.engine.listBookingPages({ fresh: false })).toEqual([]);
  });
});

describe('your profile and photo offline', () => {
  const dir = async (t: Awaited<ReturnType<typeof setup>>) =>
    JSON.parse((await t.store.getSetting('directory'))!) as DirectoryUser[];
  const avatars = async (t: Awaited<ReturnType<typeof setup>>) =>
    JSON.parse((await t.store.getSetting('avatars'))!) as Record<string, string>;

  it('edits and a new photo show at once offline, then reach the server once, newest value winning', async () => {
    const t = await setup();
    await t.online(); // directory cached
    expect(await avatars(t)).toEqual({ [PEER]: 'https://connect.test/v1/avatars/t1/marco' });
    t.engine.setNetworkUp(false);
    await t.engine.updateProfile({ title: 'Senior analyst', phone: '+91 98' });
    await t.engine.updateProfile({ title: 'Research lead', bio: 'Panels in DACH' });
    await t.engine.setAvatar('data:image/jpeg;base64,AAAA');
    const me = await t.engine.myProfile();
    expect(me).toMatchObject({ title: 'Research lead', phone: '+91 98', bio: 'Panels in DACH' });
    expect((await avatars(t))[SELF]).toBe('data:image/jpeg;base64,AAAA');
    // A directory refresh from the server (say a teammate changed) keeps your unsent changes.
    await t.engine['sync'].refreshDirectory();
    expect((await dir(t)).find((u) => u.userId === SELF)?.title).toBe('Research lead');

    await t.online();
    expect(t.calls.filter((c) => /Profile|Avatar/.test(c))).toEqual([
      'updateProfile {"title":"Research lead","phone":"+91 98","bio":"Panels in DACH"}',
      'setAvatar data:image/jpeg;base64',
    ]);
    const after = (await dir(t)).find((u) => u.userId === SELF)!;
    expect(after.title).toBe('Research lead');
    expect(after.avatarUrl).toMatch(/^https:\/\/connect\.test\/v1\/avatars\/t1\/k\d+$/);
    expect(await t.store.pendingCount()).toBe(0);
  });

  it('only the last photo choice is sent; removing it shows initials at once', async () => {
    const t = await setup();
    await t.online();
    t.engine.setNetworkUp(false);
    await t.engine.setAvatar('data:image/jpeg;base64,AAAA');
    await t.engine.setAvatar('data:image/jpeg;base64,BBBB');
    await t.engine.removeAvatar();
    expect((await avatars(t))[SELF]).toBeUndefined();
    await t.online();
    expect(t.calls.filter((c) => /Avatar/.test(c))).toEqual(['removeAvatar']);
  });

  it('a refused change is dropped and your saved profile shows again', async () => {
    const t = await setup();
    await t.online();
    t.refuse('updateProfile', new TransportError('Unknown time zone', 'api', 'VALIDATION_FAILED'));
    await t.engine.updateProfile({ timeZone: 'Mars/Olympus', title: 'Lead' });
    await t.online();
    expect((await t.engine.myProfile())?.title).toBe('Analyst');
    expect(t.refused).toEqual(['profile.update: Unknown time zone']);
  });

  it("a teammate's new photo shows when directory:updated arrives", async () => {
    const t = await setup();
    await t.online();
    t.server.users.set(PEER, {
      ...t.server.users.get(PEER)!,
      avatarUrl: 'https://connect.test/v1/avatars/t1/new',
    });
    t.rt.events.emit('directory', { userId: PEER });
    await new Promise((r) => setTimeout(r, 30));
    expect((await avatars(t))[PEER]).toBe('https://connect.test/v1/avatars/t1/new');
  });
});

describe('recent searches on every device', () => {
  it('saved offline at once, sent once as the latest list, and live changes from another device show', async () => {
    const t = await setup();
    await t.online();
    expect(await t.engine.recentSearches()).toEqual(['wave 3']);
    t.engine.setNetworkUp(false);
    await t.engine.rememberSearch('quota from:@priya');
    await t.engine.rememberSearch('Wave 3'); // moves to the top, not added twice
    await t.engine.rememberSearch('incidence');
    await t.engine.forgetSearch('quota from:@priya');
    expect(await t.engine.recentSearches()).toEqual(['incidence', 'Wave 3']);
    // A list from another device while this one has an unsent change: ours still shows.
    t.rt.events.emit('searchRecent', { recent: ['elsewhere'] });
    await new Promise((r) => setTimeout(r, 20));
    expect(await t.engine.recentSearches()).toEqual(['incidence', 'Wave 3']);
    await t.online();
    expect(t.calls.filter((c) => c.startsWith('setRecent'))).toEqual([
      'setRecent incidence|Wave 3',
    ]);
    expect(await t.engine.recentSearches()).toEqual(['incidence', 'Wave 3']);
    // Now another device clears them; this phone follows.
    t.rt.events.emit('searchRecent', { recent: [] });
    await new Promise((r) => setTimeout(r, 20));
    expect(await t.engine.recentSearches()).toEqual([]);
  });

  it('keeps at most ten', async () => {
    const t = await setup();
    await t.online();
    for (let i = 0; i < 12; i++) await t.engine.rememberSearch(`q${i}`);
    const r = await t.engine.recentSearches();
    expect(r).toHaveLength(10);
    expect(r[0]).toBe('q11');
  });
});

describe('search on this phone', () => {
  it('every word must match, in the text or a file name, with the same filters as the server', async () => {
    const t = await setup();
    await t.addMessage({
      content: { text: 'Wave 3 quota by region', mentions: [] },
      senderId: SELF,
    });
    await t.addMessage({ content: { text: 'quota is fine', mentions: [] }, senderId: PEER });
    await t.engine.send('c1', 'unsent wave 3 quota note');
    const terms = (q: string) => q.toLowerCase().split(' ');
    const texts = async (q: Parameters<typeof t.engine.searchOnPhone>[0]) =>
      (await t.engine.searchOnPhone(q)).map((m) => m.text).sort();
    expect(await texts({ terms: terms('wave quota') })).toEqual([
      'Wave 3 quota by region',
      'unsent wave 3 quota note',
    ]);
    expect(await texts({ terms: ['quota'], from: PEER })).toEqual(['quota is fine']);
    expect(await texts({ terms: ['quota'], in: 'c2' })).toEqual([]);
    expect(await texts({ terms: ['quota'], hasFile: true })).toEqual([]);
  });
});

describe('files on this phone', () => {
  const att = (id: string, fileName: string, mimeType: string, extra: object = {}) => ({
    attachmentId: id,
    conversationId: 'c1',
    uploaderId: PEER,
    fileName,
    mimeType,
    sizeBytes: 1200,
    width: null,
    height: null,
    status: 'ready' as const,
    createdAt: new Date().toISOString(),
    ...extra,
  });

  it('lists files newest first by type and name, leaves out recordings, and shows unsent ones', async () => {
    const t = await setup();
    await t.addMessage({
      senderId: PEER,
      attachments: [
        att(
          'a1',
          'Wave 3 quota.xlsx',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ),
        att('a2', 'site.jpg', 'image/jpeg'),
      ],
    });
    await t.addMessage({
      senderId: PEER,
      attachments: [att('a3', 'voice.m4a', 'audio/mp4', { recording: 'voice', durationMs: 3000 })],
    });
    await t.engine.send('c1', 'here', {
      files: [
        {
          localUri: 'file:///x/brief.pdf',
          fileName: 'brief.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 50,
        },
      ],
    });
    const names = async (q: Parameters<typeof t.engine.filesOnPhone>[0] = {}) =>
      (await t.engine.filesOnPhone(q)).map((f) => f.fileName);
    expect(await names()).toEqual(['brief.pdf', 'Wave 3 quota.xlsx', 'site.jpg']);
    expect(await names({ kind: 'images' })).toEqual(['site.jpg']);
    expect(await names({ kind: 'documents', q: 'quota' })).toEqual(['Wave 3 quota.xlsx']);
    expect(await names({ from: SELF })).toEqual(['brief.pdf']);
    expect(await names({ in: 'c2' })).toEqual([]);
    const [unsent] = await t.engine.filesOnPhone({ q: 'brief' });
    expect(unsent).toMatchObject({
      attachmentId: null,
      localUri: 'file:///x/brief.pdf',
      kind: 'documents',
    });
  });
});

describe('status and quiet hours offline', () => {
  const me = async (t: Awaited<ReturnType<typeof setup>>) =>
    (JSON.parse((await t.store.getSetting('directory'))!) as DirectoryUser[]).find(
      (u) => u.userId === SELF,
    )!;
  const quiet: DndSchedule = {
    enabled: true,
    timeZone: 'Asia/Kolkata',
    days: [1, 2, 3, 4, 5],
    start: '19:00',
    end: '08:00',
  };

  it('shows at once offline; only the latest status and schedule are sent', async () => {
    const t = await setup();
    await t.online();
    t.engine.setNetworkUp(false);
    await t.engine.setStatus({
      availability: 'busy',
      emoji: '📅',
      text: 'In a meeting',
      expiresAt: null,
    });
    await t.engine.setStatus({
      availability: 'away',
      emoji: '🧪',
      text: 'In the field',
      expiresAt: null,
    });
    await t.engine.setDndSchedule(quiet);
    expect((await me(t)).userStatus).toMatchObject({ availability: 'away', text: 'In the field' });
    expect((await me(t)).dndSchedule).toEqual(quiet);
    // A directory refresh while offline keeps them.
    await t.engine['sync'].refreshDirectory();
    expect((await me(t)).userStatus?.text).toBe('In the field');

    await t.online();
    expect(t.calls.filter((c) => /^set(Status|Dnd)/.test(c))).toEqual([
      'setStatus away In the field',
      'setDndSchedule true 19:00-08:00',
    ]);
    expect((await me(t)).userStatus?.text).toBe('In the field');
    expect(await t.store.pendingCount()).toBe(0);
  });

  it('a status that expired while waiting offline is sent as cleared, not refused', async () => {
    const t = await setup();
    await t.online();
    t.engine.setNetworkUp(false);
    await t.engine.setStatus({
      availability: 'busy',
      emoji: null,
      text: 'Quick call',
      expiresAt: new Date(Date.now() + 50).toISOString(),
    });
    await new Promise((r) => setTimeout(r, 80));
    await t.online();
    expect(t.calls.filter((c) => c.startsWith('setStatus'))).toEqual(['setStatus auto']);
    expect(t.refused).toEqual([]);
  });
});

describe('working hours offline and across devices', () => {
  const week = (start: string): WorkingHours => ({
    timeZone: 'Asia/Kolkata',
    days: [1, 2, 3, 4, 5].map((day) => ({ day, start, end: '17:30' })),
  });

  it('opens offline from the phone, saves offline (latest wins), and follows another device', async () => {
    const t = await setup();
    await t.online();
    expect((await t.engine.getWorkingHours()).days).toHaveLength(1); // cached by refreshWork
    t.engine.setNetworkUp(false);
    await t.engine.setWorkingHours(week('08:00'));
    await t.engine.setWorkingHours(week('10:00'));
    expect((await t.engine.getWorkingHours()).days[0]!.start).toBe('10:00');
    // Another device changes them while this one has an unsent change: ours still shows.
    t.rt.events.emit('meetingsChanged', { area: 'working_hours' });
    await new Promise((r) => setTimeout(r, 20));
    expect((await t.engine.getWorkingHours()).days[0]!.start).toBe('10:00');
    await t.online();
    expect(t.calls.filter((c) => c.startsWith('setWorkingHours'))).toEqual([
      'setWorkingHours 1:10:00-17:30,2:10:00-17:30,3:10:00-17:30,4:10:00-17:30,5:10:00-17:30',
    ]);
    // Now another device saves; this phone follows live.
    const seen: string[] = [];
    t.engine.events.on('workingHours', (h) => seen.push(h.days[0]!.start));
    t.server.hours = week('07:30');
    t.rt.events.emit('meetingsChanged', { area: 'working_hours' });
    await new Promise((r) => setTimeout(r, 20));
    expect((await t.engine.getWorkingHours()).days[0]!.start).toBe('07:30');
    expect(seen).toContain('07:30');
  });
});

describe('chat theme offline and across devices', () => {
  it('picks offline (latest wins), keeps the pick over older server copies, and follows other devices', async () => {
    const t = await setup();
    await t.online();
    expect((await t.engine.getChatTheme())?.effective).toBe('default'); // cached by refreshWork
    t.engine.setNetworkUp(false);
    await t.engine.setChatTheme('blueprint');
    await t.engine.setChatTheme('evergreen');
    expect((await t.engine.getChatTheme())?.effective).toBe('evergreen');
    // An older server copy arriving while ours is unsent never replaces it.
    t.rt.events.emit('chatTheme', { themeId: null });
    await new Promise((r) => setTimeout(r, 20));
    expect((await t.engine.getChatTheme())?.effective).toBe('evergreen');
    await t.online();
    expect(t.calls.filter((c) => c.startsWith('setChatTheme'))).toEqual(['setChatTheme evergreen']);
    // Another device picks Library: this phone follows live.
    const seen: string[] = [];
    t.engine.events.on('chatTheme', (s) => seen.push(s.effective));
    t.server.theme = { ...t.server.theme, themeId: 'library' };
    t.rt.events.emit('chatTheme', { themeId: 'library' });
    await new Promise((r) => setTimeout(r, 20));
    expect((await t.engine.getChatTheme())?.effective).toBe('library');
    expect(seen).toContain('library');
  });

  it('organization rules: a removed theme falls back to the default, and a refused pick is reported', async () => {
    const t = await setup();
    await t.online();
    await t.engine.setChatTheme('aurora');
    await t.online();
    t.server.theme = {
      themeId: 'aurora',
      policy: { defaultThemeId: 'graphite', allowed: ['graphite', 'linen'] },
    };
    t.rt.events.emit('tenant', { area: 'chat_themes' });
    await new Promise((r) => setTimeout(r, 20));
    expect((await t.engine.getChatTheme())?.effective).toBe('graphite');
    // Picked offline before the rule reached this phone: the server refuses it.
    t.engine.setNetworkUp(false);
    await t.engine.setChatTheme('aurora');
    await t.online();
    expect(t.refused).toEqual(['theme.set: Your organization doesn’t offer that chat theme']);
    expect((await t.engine.getChatTheme())?.effective).toBe('graphite');
  });
});

describe('call background offline and across devices', () => {
  it('queues picks and an image offline, sends them in order, and follows other devices', async () => {
    const t = await setup();
    await t.online();
    expect((await t.engine.getCallBackground()).effective).toEqual({ kind: 'none' });
    t.engine.setNetworkUp(false);
    await t.engine.setCallBackground({ kind: 'blur' });
    await t.engine.setCallBackground({ kind: 'preset', presetId: 'library-study' });
    await t.engine.setCallBackgroundImage('file:///bg-1.jpg');
    // The image shows straight away, from this phone.
    let s = await t.engine.getCallBackground();
    expect(s.effective).toEqual({ kind: 'custom' });
    expect(s.customImageUrl).toBe('file:///bg-1.jpg');
    // Picked after the upload: it goes after it, so the server ends up on Boardroom.
    await t.engine.setCallBackground({ kind: 'preset', presetId: 'boardroom' });
    expect((await t.engine.getCallBackground()).effective).toEqual({
      kind: 'preset',
      presetId: 'boardroom',
    });
    await t.online();
    expect(t.calls.filter((c) => /CallBackground/.test(c) && !c.startsWith('list'))).toEqual([
      'uploadCallBackground file:///bg-1.jpg',
      'setCallBackground boardroom',
    ]);
    s = await t.engine.getCallBackground();
    expect(s.customImageUrl).toMatch(/^https:\/\/connect.test\/v1\/call-backgrounds\//);
    // Another device goes back to the image: this phone follows live.
    const seen: string[] = [];
    t.engine.events.on('callBackground', (x) => seen.push(x.effective.kind));
    t.server.callbg.choice = { kind: 'custom' };
    t.rt.events.emit('meetingsChanged', { area: 'call_background' });
    await new Promise((r) => setTimeout(r, 20));
    expect((await t.engine.getCallBackground()).effective).toEqual({ kind: 'custom' });
    expect(seen).toContain('custom');
  });

  it('removing the image in use falls back to the default, and the company rule wins', async () => {
    const t = await setup();
    await t.online();
    await t.engine.setCallBackgroundImage('file:///bg-2.jpg');
    await t.online();
    t.server.callbg.policy = { defaultChoice: { kind: 'blur' }, enforceLogo: false };
    t.engine.setNetworkUp(false);
    await t.engine.removeCallBackgroundImage();
    expect((await t.engine.getCallBackground()).effective).toEqual({ kind: 'none' }); // cached rule
    await t.online();
    let s = await t.engine.getCallBackground();
    expect(s.choice).toBeNull();
    expect(s.customImageUrl).toBeNull();
    expect(s.effective).toEqual({ kind: 'blur' });
    t.server.callbg.policy = { defaultChoice: { kind: 'blur' }, enforceLogo: true };
    t.rt.events.emit('tenant', { area: 'calls' });
    await new Promise((r) => setTimeout(r, 20));
    s = await t.engine.getCallBackground();
    expect(s.effective).toEqual({ kind: 'logo' });
    // A pick made while the rule holds is kept as your choice but the company background applies.
    await t.engine.setCallBackground({ kind: 'preset', presetId: 'office-lounge' });
    expect((await t.engine.getCallBackground()).effective).toEqual({ kind: 'logo' });
  });
});

describe('minutes of meeting offline and together', () => {
  const minutes = (over: Partial<MeetingMinutes> = {}): MeetingMinutes => ({
    minutesId: 'mm1',
    callId: 'call1',
    conversationId: 'c1',
    meetingId: null,
    title: 'Weekly sync',
    media: 'video',
    startedAt: '2026-11-20T10:00:00.000Z',
    endedAt: '2026-11-20T10:40:00.000Z',
    durationSec: 2400,
    attendees: [],
    agenda: '',
    summary: 'Draft summary',
    decisions: [],
    actionItems: [],
    openQuestions: [],
    notes: '',
    language: 'en',
    sources: {
      transcripts: 0,
      reviewedTranscripts: 0,
      captionLines: 0,
      chatMessages: 0,
      spokenLanguages: [],
    },
    engine: 'basic',
    status: 'draft',
    revision: 3,
    createdBy: SELF,
    createdAt: '2026-11-20T10:41:00.000Z',
    updatedBy: SELF,
    updatedAt: '2026-11-20T10:41:00.000Z',
    sharedBy: null,
    sharedAt: null,
    canEdit: true,
    ...over,
  });

  it('edits offline show at once, merge per field and go up once from the first revision', async () => {
    const t = await setup();
    t.server.minutes = minutes();
    await t.online();
    await t.engine.reloadCallMinutes('call1');
    const m = (await t.engine.getCallMinutes('call1'))!.minutes!;
    t.engine.setNetworkUp(false);
    await t.engine.editMinutes(m, { summary: 'We agreed the plan' });
    await t.engine.editMinutes(m, { decisions: ['Ship on Friday'] });
    await t.engine.editMinutes(m, { summary: 'We agreed the plan and the date' });
    const shown = (await t.engine.getCallMinutes('call1'))!.minutes!;
    expect(shown.summary).toBe('We agreed the plan and the date');
    expect(shown.decisions).toEqual(['Ship on Friday']);
    // Someone else edits the notes meanwhile: a different field, so both apply.
    t.server.minutes = { ...t.server.minutes, notes: 'From Marco', revision: 4 };
    t.server.minutesFieldRevs.notes = 4;
    await t.online();
    expect(t.calls.filter((c) => c.startsWith('updateMinutes'))).toEqual([
      'updateMinutes mm1 base 3 decisions,summary',
    ]);
    const after = (await t.engine.getCallMinutes('call1'))!.minutes!;
    expect(after.summary).toBe('We agreed the plan and the date');
    expect(after.notes).toBe('From Marco');
    expect(t.refused).toEqual([]);
  });

  it('the same field changed by someone else meanwhile is refused and their version shows', async () => {
    const t = await setup();
    t.server.minutes = minutes();
    await t.online();
    await t.engine.reloadCallMinutes('call1');
    const m = (await t.engine.getCallMinutes('call1'))!.minutes!;
    t.engine.setNetworkUp(false);
    await t.engine.editMinutes(m, { summary: 'Mine' });
    t.server.minutes = { ...t.server.minutes, summary: 'Theirs', revision: 4 };
    t.server.minutesFieldRevs.summary = 4;
    await t.online();
    await new Promise((r) => setTimeout(r, 20));
    expect(t.refused).toEqual([
      'minutes.update: Someone else changed the same part of these minutes. Reload to see their version.',
    ]);
    expect((await t.engine.getCallMinutes('call1'))!.minutes!.summary).toBe('Theirs');
  });
});
