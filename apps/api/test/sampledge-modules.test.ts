import { createServer, type IncomingMessage, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  Approval,
  Conversation,
  LinkedRecord,
  Message,
  ModuleAction,
  ModuleCardMetadata,
  ModuleCredentials,
  ModuleEventInput,
  ModuleEventResult,
  ModuleIntegration,
  Notification,
  NotificationPage,
  Project,
  Session,
  Task,
  WebhookDelivery,
  WidgetSession,
} from '@sampledge/contracts';
import { signPayload, verifySignature } from '../src/integrations/signing.js';
import {
  api,
  connect,
  inviteAndLogin,
  nextEvent,
  registerTenant,
  startHarness,
  type Harness,
} from './harness.js';

let h: Harness;
let owner: Session;
let ravi: Session;
let mia: Session;
let outsider: Session;
let slug: string;
let samptrek: ModuleCredentials;
let talk2tax: ModuleCredentials;

/** A stand-in for a module's own server (or a webhook subscriber): records what Connect sends. */
interface Received {
  path: string;
  headers: IncomingMessage['headers'];
  body: string;
}
let receiver: Server;
let receiverUrl: string;
const received: Received[] = [];

const email = (name: string) => `${name.toLowerCase().replace(/\s+/g, '.')}@${slug}.test`;

async function enable(module: string, values: Record<string, unknown> = { mode: 'test' }) {
  const r = await api(h, 'PUT', `/v1/admin/integrations/sampledge.${module}`, {
    token: owner.accessToken,
    body: { enabled: true, values },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}

async function issueKeys(module: string) {
  const r = await api<ModuleCredentials>(h, 'POST', `/v1/integrations/modules/${module}/keys`, {
    token: owner.accessToken,
    body: { generateSigningSecret: true },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
}

/** Sends a module event the way the SDK does: Bearer key + HMAC signature over the raw body. */
async function sendEvent(
  creds: ModuleCredentials,
  event: ModuleEventInput,
  opts: { sign?: string | null } = {},
) {
  const body = JSON.stringify(event);
  const res = await fetch(`${h.url}/v1/integration/events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${creds.connectApiKey}`,
      ...(opts.sign === null
        ? {}
        : { 'sampledge-signature': opts.sign ?? signPayload(creds.signingSecret!, body) }),
    },
    body,
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as ModuleEventResult };
}

const moduleApi = <T>(creds: ModuleCredentials, method: string, path: string, body?: unknown) =>
  api<T>(h, method, path, { token: creds.connectApiKey, body });

const messagesIn = async (s: Session, conversationId: string) =>
  (
    await api<Message[]>(h, 'GET', `/v1/conversations/${conversationId}/messages`, {
      token: s.accessToken,
    })
  ).body;

async function waitFor<T>(fn: () => T | undefined | Promise<T | undefined>, ms = 6000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v !== undefined) return v;
    if (Date.now() > until) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}

beforeAll(async () => {
  receiver = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ path: req.url ?? '', headers: req.headers, body });
      res.writeHead(req.url?.includes('fail') ? 500 : 200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', () => r()));
  receiverUrl = `http://127.0.0.1:${(receiver.address() as { port: number }).port}`;

  h = await startHarness();
  const t = await registerTenant(h);
  owner = t.session;
  slug = t.slug;
  ravi = await inviteAndLogin(h, owner, slug, 'Ravi Kumar');
  mia = await inviteAndLogin(h, owner, slug, 'Mia Chen');
  outsider = await inviteAndLogin(h, owner, slug, 'Outside Person');
  await enable('samptrek');
  samptrek = await issueKeys('samptrek');
  await enable('talk2tax');
  talk2tax = await issueKeys('talk2tax');
});

afterAll(async () => {
  await h?.close();
  receiver?.close();
});

describe('module connection', () => {
  it('settings live in the database; status lists what live mode still needs', async () => {
    const r = await api<ModuleIntegration[]>(h, 'GET', '/v1/integrations/modules', {
      token: owner.accessToken,
    });
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(7);
    const st = r.body.find((m) => m.module === 'samptrek')!;
    expect(st).toMatchObject({ enabled: true, mode: 'test', signingSecretSet: true });
    expect(st.connectKeyPrefix).toMatch(/^sk_samptrek_/);
    expect(st.missing).toEqual(['Samptrek API base URL', 'Samptrek API key']);
    expect(r.body.find((m) => m.module === 'sampforce')!.enabled).toBe(false);
  });

  it('only admins can manage modules', async () => {
    const r = await api(h, 'GET', '/v1/integrations/modules', { token: ravi.accessToken });
    expect(r.status).toBe(403);
    const k = await api(h, 'POST', '/v1/integrations/modules/samptrek/keys', {
      token: ravi.accessToken,
      body: {},
    });
    expect(k.status).toBe(403);
  });

  it('authenticates the module server by its Connect API key', async () => {
    const me = await moduleApi<{ module: string; tenantId: string }>(
      samptrek,
      'GET',
      '/v1/integration/me',
    );
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ module: 'samptrek', tenantId: owner.tenant.tenantId });
    const bad = await api(h, 'GET', '/v1/integration/me', { token: 'sk_samptrek_nope' });
    expect(bad.status).toBe(401);
    // A user's access token is not a module key.
    const user = await api(h, 'GET', '/v1/integration/me', { token: owner.accessToken });
    expect(user.status).toBe(401);
  });

  it('rejects events that are unsigned, badly signed or replayed late', async () => {
    const ev = {
      eventId: 'sig-1',
      type: 'project.created',
      record: { type: 'project', id: 'P-SIG', title: 'Sig test' },
    };
    expect((await sendEvent(samptrek, ev, { sign: null })).status).toBe(401);
    expect(
      (await sendEvent(samptrek, ev, { sign: signPayload('wrong-secret', JSON.stringify(ev)) }))
        .status,
    ).toBe(401);
    const stale = signPayload(
      samptrek.signingSecret!,
      JSON.stringify(ev),
      Date.now() - 10 * 60_000,
    );
    expect((await sendEvent(samptrek, ev, { sign: stale })).status).toBe(401);
  });
});

describe('Samptrek adapter', () => {
  let projectConv: string;

  it('project.created opens a project channel, adds the team and notifies them', async () => {
    const sock = await connect(h, ravi.accessToken);
    const notified = nextEvent(sock, 'notification:new', (n: Notification) => n.kind === 'alert');
    const r = await sendEvent(samptrek, {
      eventId: 'evt-1',
      type: 'project.created',
      record: {
        type: 'project',
        id: 'PRJ-1042',
        title: 'Northwind tracker Q1',
        url: 'https://samptrek.example/p/1042',
      },
      people: [
        { email: email('Ravi Kumar'), externalUserId: 'st-ravi' },
        { email: 'nobody@elsewhere.test' },
      ],
      summary: 'New project',
      data: { status: 'active', dueAt: '2026-12-19T17:00:00.000Z', client: 'Northwind' },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({
      status: 'processed',
      duplicate: false,
      unmatchedPeople: ['nobody@elsewhere.test'],
    });
    expect(r.body.actions).toEqual(
      expect.arrayContaining(['conversation.created', 'project.updated', 'card.posted']),
    );
    projectConv = r.body.conversationId!;
    expect((await notified).conversationId).toBe(projectConv);
    sock.disconnect();

    const conv = await api<Conversation>(h, 'GET', `/v1/conversations/${projectConv}`, {
      token: ravi.accessToken,
    });
    expect(conv.body).toMatchObject({ kind: 'channel_public', name: 'Northwind tracker Q1' });
    expect(conv.body.memberIds).toContain(ravi.user.userId);

    const card = (await messagesIn(ravi, projectConv)).find((m) => m.metadata.module)!;
    const meta = card.metadata.module as ModuleCardMetadata;
    expect(meta).toMatchObject({
      module: 'samptrek',
      eventType: 'project.created',
      tone: 'info',
      test: false,
    });
    expect(meta.facts).toEqual(
      expect.arrayContaining([
        { label: 'Status', value: 'active' },
        { label: 'Due', value: '19 Dec 2026' },
      ]),
    );

    const projects = await api<Project[]>(h, 'GET', '/v1/projects', { token: ravi.accessToken });
    expect(projects.body.find((p) => p.externalId === 'PRJ-1042')).toMatchObject({
      source: 'samptrek',
      conversationId: projectConv,
      status: 'active',
      url: 'https://samptrek.example/p/1042',
    });

    // Identity mapping: the email match created a link for the Samptrek user id.
    const links = await api<{ externalUserId: string; userId: string; matchedBy: string }[]>(
      h,
      'GET',
      '/v1/integrations/modules/samptrek/identities',
      { token: owner.accessToken },
    );
    expect(links.body).toContainEqual(
      expect.objectContaining({
        externalUserId: 'st-ravi',
        userId: ravi.user.userId,
        matchedBy: 'email',
      }),
    );
  });

  it('a repeated eventId is processed once', async () => {
    const before = (await messagesIn(ravi, projectConv)).length;
    const r = await sendEvent(samptrek, {
      eventId: 'evt-1',
      type: 'project.created',
      record: { type: 'project', id: 'PRJ-1042', title: 'Northwind tracker Q1' },
    });
    expect(r.body).toMatchObject({
      duplicate: true,
      status: 'processed',
      conversationId: projectConv,
    });
    expect((await messagesIn(ravi, projectConv)).length).toBe(before);
  });

  it('task.assigned (by Samptrek user id) creates a Connect task in the project channel', async () => {
    const r = await sendEvent(samptrek, {
      eventId: 'evt-2',
      type: 'task.assigned',
      record: { type: 'task', id: 'TSK-311', title: 'Translate screener into German' },
      parent: { type: 'project', id: 'PRJ-1042', title: 'Northwind tracker Q1' },
      people: [{ externalUserId: 'st-ravi' }],
      data: { dueAt: '2026-11-26T12:00:00.000Z', priority: 'high' },
    });
    expect(r.body.conversationId).toBe(projectConv);
    expect(r.body.taskId).toBeTruthy();
    const mine = await api<Task[]>(h, 'GET', '/v1/tasks?scope=mine', { token: ravi.accessToken });
    expect(mine.body.find((t) => t.taskId === r.body.taskId)).toMatchObject({
      title: 'Translate screener into German',
      priority: 'high',
      origin: 'module',
      record: { module: 'samptrek', recordType: 'task', externalId: 'TSK-311' },
    });
  });

  it('milestone events keep the project milestones current', async () => {
    await sendEvent(samptrek, {
      eventId: 'evt-3',
      type: 'milestone.due',
      record: { type: 'milestone', id: 'MS-7', title: 'Questionnaire sign-off' },
      parent: { type: 'project', id: 'PRJ-1042', title: 'Northwind tracker Q1' },
      data: { dueAt: '2026-11-24T17:00:00.000Z' },
    });
    const p = (
      await api<Project[]>(h, 'GET', '/v1/projects', { token: ravi.accessToken })
    ).body.find((x) => x.externalId === 'PRJ-1042')!;
    expect(p.milestones).toEqual([
      {
        milestoneId: 'MS-7',
        title: 'Questionnaire sign-off',
        dueAt: '2026-11-24T17:00:00.000Z',
        status: 'due',
      },
    ]);
    expect(p.openTasks).toBe(1);
  });

  it('members see linked records change live (record:changed to the conversation)', async () => {
    const sock = await connect(h, ravi.accessToken);
    const linked = nextEvent(
      sock,
      'record:changed',
      (e) => e.conversationId === projectConv && e.reason === 'linked',
    );
    await sendEvent(samptrek, {
      eventId: 'evt-live-1',
      type: 'milestone.reached',
      record: { type: 'milestone', id: 'MS-LIVE', title: 'Live sync check' },
      parent: { type: 'project', id: 'PRJ-1042', title: 'Northwind tracker Q1' },
      data: {},
    });
    const e = await linked;
    const records = (
      await api<{ linkId: string; externalId: string }[]>(
        h,
        'GET',
        `/v1/integrations/records?conversationId=${projectConv}`,
        { token: ravi.accessToken },
      )
    ).body;
    expect(records.find((r) => r.linkId === e.linkId)?.externalId).toBe('MS-LIVE');

    const updated = nextEvent(
      sock,
      'record:changed',
      (x) => x.conversationId === projectConv && x.reason === 'updated',
    );
    await sendEvent(samptrek, {
      eventId: 'evt-live-2',
      type: 'project.updated',
      record: { type: 'project', id: 'PRJ-1042', title: 'Northwind tracker Q1' },
      data: { status: 'at_risk' },
    });
    await updated;
    sock.disconnect();
  });

  it('chat-to-task in a project channel links the task and records the Samptrek push (test mode)', async () => {
    const send = await api<{ message: Message }>(
      h,
      'POST',
      `/v1/conversations/${projectConv}/messages`,
      {
        token: ravi.accessToken,
        body: {
          conversationId: projectConv,
          clientMessageId: crypto.randomUUID(),
          content: { text: 'Can someone check the German quotas before Friday?', mentions: [] },
        },
      },
    );
    expect(send.status).toBe(200);
    const msgId = send.body.message.messageId;
    const clientRequestId = crypto.randomUUID();
    const body = {
      title: 'Check German quotas',
      conversationId: projectConv,
      sourceMessageId: msgId,
      assigneeIds: [ravi.user.userId],
      clientRequestId,
    };
    const t = await api<Task>(h, 'POST', '/v1/tasks', { token: ravi.accessToken, body });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    expect(t.body).toMatchObject({
      sourceMessageId: msgId,
      sourceExcerpt: 'Can someone check the German quotas before Friday?',
      record: { module: 'samptrek', recordType: 'project', externalId: 'PRJ-1042' },
      moduleSync: { status: 'test_mode' },
    });
    // Offline retry with the same clientRequestId returns the same task.
    const again = await api<Task>(h, 'POST', '/v1/tasks', { token: ravi.accessToken, body });
    expect(again.body.taskId).toBe(t.body.taskId);

    const actions = await api<ModuleAction[]>(
      h,
      'GET',
      '/v1/integrations/actions?module=samptrek',
      {
        token: owner.accessToken,
      },
    );
    expect(actions.body[0]).toMatchObject({ type: 'task.created', status: 'test_mode' });
    expect((actions.body[0]!.payload.task as Task).title).toBe('Check German quotas');

    // A task card was posted; completing the task updates it.
    const card = (await messagesIn(ravi, projectConv)).find(
      (m) => (m.metadata.work as { id?: string } | undefined)?.id === t.body.taskId,
    )!;
    expect(card.content.text).toBe('Task: Check German quotas (Open)');
    const done = await api<Task>(h, 'PATCH', `/v1/tasks/${t.body.taskId}`, {
      token: ravi.accessToken,
      body: { status: 'done' },
    });
    expect(done.body.completedAt).toBeTruthy();
    const updated = (await messagesIn(ravi, projectConv)).find(
      (m) => m.messageId === card.messageId,
    )!;
    expect(updated.content.text).toBe('Task: Check German quotas (Done)');
  });

  it('outsiders cannot change or see tasks in private conversations', async () => {
    const priv = await api<Conversation>(h, 'POST', '/v1/conversations', {
      token: ravi.accessToken,
      body: { kind: 'channel_private', name: 'secret plans', memberIds: [] },
    });
    const t = await api<Task>(h, 'POST', '/v1/tasks', {
      token: ravi.accessToken,
      body: { title: 'Private thing', conversationId: priv.body.conversationId },
    });
    expect(
      (await api(h, 'GET', `/v1/tasks/${t.body.taskId}`, { token: outsider.accessToken })).status,
    ).toBe(404);
    expect(
      (
        await api(h, 'PATCH', `/v1/tasks/${t.body.taskId}`, {
          token: outsider.accessToken,
          body: { status: 'done' },
        })
      ).status,
    ).toBe(404);
    // Assignees must be able to read the conversation.
    const bad = await api(h, 'POST', '/v1/tasks', {
      token: ravi.accessToken,
      body: {
        title: 'x',
        conversationId: priv.body.conversationId,
        assigneeIds: [outsider.user.userId],
      },
    });
    expect(bad.status).toBe(400);
  });

  it('unknown event types are logged and ignored', async () => {
    const r = await sendEvent(samptrek, {
      eventId: 'evt-x',
      type: 'project.archived_forever',
      record: { type: 'project', id: 'PRJ-1042', title: 'Northwind tracker Q1' },
    });
    expect(r.body.status).toBe('ignored');
    const log = await api<{ eventId: string; status: string }[]>(
      h,
      'GET',
      '/v1/integrations/modules/samptrek/events',
      {
        token: owner.accessToken,
      },
    );
    expect(log.body[0]).toMatchObject({ eventId: 'evt-x', status: 'ignored' });
  });

  it('admin "Send test event" runs the catalogue example, addressed to the admin, marked as a test', async () => {
    const r = await api<ModuleEventResult>(
      h,
      'POST',
      '/v1/integrations/modules/samptrek/test-event',
      {
        token: owner.accessToken,
        body: { type: 'milestone.reached' },
      },
    );
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('processed');
    const card = (await messagesIn(owner, r.body.conversationId!)).find((m) => m.metadata.module)!;
    expect((card.metadata.module as ModuleCardMetadata).test).toBe(true);
    expect(card.content.text.startsWith('[Test]')).toBe(true);
  });
});

describe('Talk2Tax adapter: restricted finance records and approvals', () => {
  let result: ModuleEventResult;

  it('expense.submitted opens a private chat and asks the approver', async () => {
    result = (
      await sendEvent(talk2tax, {
        eventId: 'exp-1',
        type: 'expense.submitted',
        record: { type: 'expense', id: 'EXP-930', title: 'Expense EXP-930: client workshop' },
        actor: { email: email('Ravi Kumar') },
        people: [{ email: email('Mia Chen') }],
        summary: 'Travel and venue for the Northwind workshop',
        data: { amount: { amountMinor: 128900, currency: 'EUR' }, category: 'Travel' },
      })
    ).body;
    expect(result.status, JSON.stringify(result)).toBe('processed');
    expect(result.approvalId).toBeTruthy();
    const conv = await api<Conversation>(h, 'GET', `/v1/conversations/${result.conversationId}`, {
      token: mia.accessToken,
    });
    expect(conv.body.kind).toBe('channel_private');
    expect(conv.body.memberIds).toEqual(
      expect.arrayContaining([mia.user.userId, ravi.user.userId]),
    );
    // Not visible to people outside the chat, even with the ids.
    expect(
      (
        await api(h, 'GET', `/v1/conversations/${result.conversationId}`, {
          token: outsider.accessToken,
        })
      ).status,
    ).toBe(404);
    expect(
      (await api(h, 'GET', `/v1/approvals/${result.approvalId}`, { token: outsider.accessToken }))
        .status,
    ).toBe(404);

    const todo = await api<Approval[]>(h, 'GET', '/v1/approvals?scope=to_decide&status=pending', {
      token: mia.accessToken,
    });
    expect(todo.body[0]).toMatchObject({
      approvalId: result.approvalId,
      category: 'expense',
      amount: { amountMinor: 128900, currency: 'EUR' },
      requesterId: ravi.user.userId,
      origin: 'module',
    });
    const notes = await api<NotificationPage>(h, 'GET', '/v1/notifications', {
      token: mia.accessToken,
    });
    expect(notes.body.items[0]).toMatchObject({
      kind: 'approval',
      conversationId: result.conversationId,
    });
  });

  it('only approvers decide; the decision updates the card and is recorded for Talk2Tax', async () => {
    const no = await api(h, 'POST', `/v1/approvals/${result.approvalId}/decision`, {
      token: ravi.accessToken,
      body: { decision: 'approve' },
    });
    expect(no.status).toBe(403);
    const yes = await api<Approval>(h, 'POST', `/v1/approvals/${result.approvalId}/decision`, {
      token: mia.accessToken,
      body: { decision: 'approve', comment: 'Within policy' },
    });
    expect(yes.status).toBe(200);
    expect(yes.body.status).toBe('approved');
    const twice = await api(h, 'POST', `/v1/approvals/${result.approvalId}/decision`, {
      token: mia.accessToken,
      body: { decision: 'reject' },
    });
    expect(twice.status).toBe(409);
    const card = (await messagesIn(mia, result.conversationId!)).find(
      (m) => m.messageId === result.messageId,
    )!;
    expect(card.content.text).toContain('(Approved)');
    const actions = await api<ModuleAction[]>(
      h,
      'GET',
      '/v1/integrations/actions?module=talk2tax',
      {
        token: owner.accessToken,
      },
    );
    expect(actions.body[0]).toMatchObject({ type: 'approval.decided', status: 'test_mode' });
  });

  it('module records are tenant-isolated', async () => {
    const other = await registerTenant(h, 'Other Org');
    const r = await api(h, 'PUT', '/v1/admin/integrations/sampledge.talk2tax', {
      token: other.session.accessToken,
      body: { enabled: true, values: { mode: 'test' } },
    });
    expect(r.status).toBe(200);
    const key = (
      await api<ModuleCredentials>(h, 'POST', '/v1/integrations/modules/talk2tax/keys', {
        token: other.session.accessToken,
        body: { generateSigningSecret: true },
      })
    ).body;
    const look = await moduleApi(key, 'GET', '/v1/integration/records/expense/EXP-930');
    expect(look.status).toBe(404);
    const mine = await moduleApi<LinkedRecord>(
      talk2tax,
      'GET',
      '/v1/integration/records/expense/EXP-930',
    );
    expect(mine.status).toBe(200);
  });
});

describe('contextual chat API and widget sign-on', () => {
  it('ensures a record conversation, posts into it once per idempotency key, and reads history', async () => {
    const rec = await moduleApi<LinkedRecord>(samptrek, 'PUT', '/v1/integration/records', {
      record: { type: 'project', id: 'PRJ-2000', title: 'Contoso diary study' },
      members: [{ email: email('Mia Chen') }],
    });
    expect(rec.status).toBe(200);
    expect(rec.body.conversationId).toBeTruthy();
    const post = () =>
      moduleApi<{ duplicate: boolean; messageId: string }>(
        samptrek,
        'POST',
        '/v1/integration/records/project/PRJ-2000/messages',
        {
          text: 'Kick-off moved to Monday',
          notify: [{ email: email('Mia Chen') }],
          idempotencyKey: 'k-1',
        },
      );
    const a = await post();
    const b = await post();
    expect(a.body.duplicate).toBe(false);
    expect(b.body).toMatchObject({ duplicate: true, messageId: a.body.messageId });
    const hist = await moduleApi<{ messages: Message[] }>(
      samptrek,
      'GET',
      '/v1/integration/records/project/PRJ-2000/messages',
    );
    expect(
      hist.body.messages.filter((m) => m.content.text === 'Kick-off moved to Monday'),
    ).toHaveLength(1);
  });

  it('signs a module user into the chat widget with a normal, revocable session', async () => {
    const w = await moduleApi<WidgetSession>(samptrek, 'POST', '/v1/integration/widget-sessions', {
      user: { email: email('Mia Chen') },
      record: { type: 'project', id: 'PRJ-1042', title: 'Northwind tracker Q1' },
    });
    expect(w.status, JSON.stringify(w.body)).toBe(201);
    expect(w.body.userId).toBe(mia.user.userId);
    const me = await api<{ user: { userId: string } }>(h, 'GET', '/v1/me', {
      token: w.body.accessToken,
    });
    expect(me.body.user.userId).toBe(mia.user.userId);
    const conv = await api<Conversation>(h, 'GET', `/v1/conversations/${w.body.conversationId}`, {
      token: w.body.accessToken,
    });
    expect(conv.body.memberIds).toContain(mia.user.userId);
    const unknown = await moduleApi(samptrek, 'POST', '/v1/integration/widget-sessions', {
      user: { email: 'stranger@nowhere.test' },
    });
    expect(unknown.status).toBe(404);
  });
});

describe('live mode and webhooks', () => {
  it('test connection and outbound actions call the module API with its key and a signature', async () => {
    await enable('samptrek', {
      mode: 'live',
      baseUrl: `${receiverUrl}/samptrek`,
      apiKey: 'samptrek-key-123456',
    });
    const test = await api<{ ok: boolean; message: string }>(
      h,
      'POST',
      '/v1/admin/integrations/sampledge.samptrek/test',
      {
        token: owner.accessToken,
        body: {},
      },
    );
    expect(test.body.ok, JSON.stringify(test.body)).toBe(true);
    expect(received.at(-1)).toMatchObject({ path: '/samptrek/connect/health' });
    expect(received.at(-1)!.headers.authorization).toBe('Bearer samptrek-key-123456');

    const rec = await moduleApi<LinkedRecord>(
      samptrek,
      'GET',
      '/v1/integration/records/project/PRJ-1042',
    );
    const t = await api<Task>(h, 'POST', '/v1/tasks', {
      token: ravi.accessToken,
      body: { title: 'Book the translator', conversationId: rec.body.conversationId },
    });
    expect(t.body.moduleSync?.status).toBe('sent');
    const call = received.find((r) => r.path === '/samptrek/connect/actions')!;
    expect(call.headers.authorization).toBe('Bearer samptrek-key-123456');
    expect(
      verifySignature(
        samptrek.signingSecret!,
        call.body,
        call.headers['sampledge-signature'] as string,
      ),
    ).toBe('ok');
    expect(JSON.parse(call.body)).toMatchObject({
      type: 'task.created',
      data: { record: { type: 'project', id: 'PRJ-1042' }, task: { title: 'Book the translator' } },
    });
    await enable('samptrek', { mode: 'test' });
  });

  it('delivers signed webhooks for tasks and messages in linked conversations, and retries failures', async () => {
    const sub = await api<{ subscriptionId: string; signingSecret: string }>(
      h,
      'POST',
      '/v1/integrations/webhooks',
      {
        token: owner.accessToken,
        body: {
          url: `${receiverUrl}/hooks`,
          events: ['task.created', 'message.created'],
          modules: ['samptrek'],
        },
      },
    );
    expect(sub.status).toBe(201);
    const rec = await moduleApi<LinkedRecord>(
      samptrek,
      'GET',
      '/v1/integration/records/project/PRJ-1042',
    );
    await api(h, 'POST', `/v1/conversations/${rec.body.conversationId}/messages`, {
      token: ravi.accessToken,
      body: {
        conversationId: rec.body.conversationId,
        clientMessageId: crypto.randomUUID(),
        content: { text: 'Webhook me', mentions: [] },
      },
    });
    const hook = await waitFor(() =>
      received.find((r) => r.path === '/hooks' && JSON.parse(r.body).type === 'message.created'),
    );
    expect(
      verifySignature(
        sub.body.signingSecret,
        hook.body,
        hook.headers['sampledge-signature'] as string,
      ),
    ).toBe('ok');
    expect(JSON.parse(hook.body).data).toMatchObject({
      message: { content: { text: 'Webhook me' } },
      record: { module: 'samptrek', externalId: 'PRJ-1042' },
    });
    // Messages in conversations without a module record are not sent.
    const dm = await api<Conversation>(h, 'POST', '/v1/conversations', {
      token: ravi.accessToken,
      body: { kind: 'dm', memberIds: [mia.user.userId] },
    });
    await api(h, 'POST', `/v1/conversations/${dm.body.conversationId}/messages`, {
      token: ravi.accessToken,
      body: {
        conversationId: dm.body.conversationId,
        clientMessageId: crypto.randomUUID(),
        content: { text: 'private dm', mentions: [] },
      },
    });

    const failing = await api<{ subscriptionId: string }>(h, 'POST', '/v1/integrations/webhooks', {
      token: owner.accessToken,
      body: { url: `${receiverUrl}/fail`, events: ['task.created'] },
    });
    await api(h, 'POST', '/v1/tasks', { token: ravi.accessToken, body: { title: 'Webhook task' } });
    const failed = await waitFor(async () => {
      const d = await api<WebhookDelivery[]>(
        h,
        'GET',
        `/v1/integrations/webhooks/${failing.body.subscriptionId}/deliveries`,
        {
          token: owner.accessToken,
        },
      );
      return d.body.find((x) => x.status === 'failed');
    });
    expect(failed).toMatchObject({ attempts: 1, lastStatusCode: 500 });
    expect(failed.nextAttemptAt).toBeTruthy();
    expect(received.some((r) => r.body.includes('private dm'))).toBe(false);
  });
});

describe('SampCrew directory sync', () => {
  it('employee.synced links SampCrew people to Connect users without posting anything', async () => {
    await enable('sampcrew');
    const crew = await issueKeys('sampcrew');
    const r = await sendEvent(crew, {
      eventId: 'sync-1',
      type: 'employee.synced',
      record: { type: 'employee', id: 'EMP-1', title: 'Directory' },
      people: [
        { externalUserId: 'emp-ravi', email: email('Ravi Kumar') },
        { externalUserId: 'emp-ghost', email: 'ghost@nowhere.test' },
      ],
    });
    expect(r.body).toMatchObject({ status: 'processed', messageId: null, conversationId: null });
    expect(r.body.actions).toContain('identities.linked:1');
    expect(r.body.unmatchedPeople).toEqual(['ghost@nowhere.test']);
  });
});
