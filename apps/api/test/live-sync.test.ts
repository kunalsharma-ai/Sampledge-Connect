/**
 * Full synchronization: every user action reaches the actor's other devices and the other
 * people it concerns, live, while private changes stay with their owner.
 * Device A and B are the same person (the owner) signed in twice; Ravi is another member.
 * See docs/sync-coverage.md.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  uuidv7,
  type Conversation,
  type InboxChangedEvent,
  type InboxList,
  type Message,
  type SendMessageAck,
  type Session,
  type Task,
} from '@sampledge/contracts';
import {
  api,
  connect,
  device,
  inviteAndLogin,
  nextEvent,
  registerTenant,
  startHarness,
  type ClientSocket,
  type Harness,
} from './harness.js';

let h: Harness;
let owner: Session;
let ravi: Session;
let group: Conversation;
let a: ClientSocket; // owner, laptop
let b: ClientSocket; // owner, phone
let r: ClientSocket; // Ravi

beforeAll(async () => {
  h = await startHarness();
  const t = await registerTenant(h, 'Sync Co');
  owner = t.session;
  ravi = await inviteAndLogin(h, owner, t.slug, 'Ravi Kumar');
  const ana = await inviteAndLogin(h, owner, t.slug, 'Ana Silva');
  const second = await api<Session>(h, 'POST', '/v1/auth/login', {
    body: {
      tenantSlug: t.slug,
      email: `priya@${t.slug}.test`,
      password: t.password,
      device: { ...device('Phone'), platform: 'ios' },
    },
  });
  expect(second.status).toBe(200);
  const g = await api<Conversation>(h, 'POST', '/v1/conversations', {
    token: owner.accessToken,
    body: { kind: 'group', memberIds: [ravi.user.userId, ana.user.userId], name: 'Fieldwork' },
  });
  expect(g.status, JSON.stringify(g.body)).toBe(201);
  group = g.body;
  [a, b, r] = await Promise.all([
    connect(h, owner.accessToken),
    connect(h, second.body.accessToken),
    connect(h, ravi.accessToken),
  ]);
});
afterAll(async () => {
  for (const s of [a, b, r]) s?.disconnect();
  await h?.close();
});

const as = (s: Session) => ({ token: s.accessToken });
const send = async (s: Session, text: string) => {
  const res = await api<SendMessageAck>(
    h,
    'POST',
    `/v1/conversations/${group.conversationId}/messages`,
    { ...as(s), body: { clientMessageId: uuidv7(), content: { text } } },
  );
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  return res.body.message;
};

/** Resolves when no event of this name arrives within the window. */
const silent = (s: ClientSocket, event: 'bookmark:updated', ms = 400) =>
  new Promise<void>((resolve, reject) => {
    const fail = () => reject(new Error(`unexpected ${event}`));
    s.once(event, fail);
    setTimeout(() => {
      s.off(event, fail);
      resolve();
    }, ms);
  });

describe('messages', () => {
  it('a new message reaches my other device and the other member', async () => {
    const onB = nextEvent(b, 'message:new', (m) => m.content.text === 'Quota check');
    const onR = nextEvent(r, 'message:new', (m) => m.content.text === 'Quota check');
    await send(owner, 'Quota check');
    expect((await onB).senderId).toBe(owner.user.userId);
    expect((await onR).conversationId).toBe(group.conversationId);
  });

  it('edits, pins, reactions and deletes reach everyone', async () => {
    const m = await send(owner, 'Draft text');
    const is = (pred: (x: Message) => boolean) => (x: Message) =>
      x.messageId === m.messageId && pred(x);

    let wait = [b, r].map((s) =>
      nextEvent(
        s,
        'message:updated',
        is((x) => x.content.text === 'Final text'),
      ),
    );
    await api(h, 'PATCH', `/v1/messages/${m.messageId}`, {
      ...as(owner),
      body: { content: { text: 'Final text' } },
    });
    for (const e of await Promise.all(wait)) expect(e.editedAt).not.toBeNull();

    wait = [b, r].map((s) =>
      nextEvent(
        s,
        'message:updated',
        is((x) => !!x.pinned),
      ),
    );
    await api(h, 'PUT', `/v1/messages/${m.messageId}/pin`, as(ravi));
    await Promise.all(wait);

    wait = [a, b].map((s) =>
      nextEvent(
        s,
        'message:updated',
        is((x) => (x.reactions ?? []).length > 0),
      ),
    );
    await api(
      h,
      'PUT',
      `/v1/messages/${m.messageId}/reactions/${encodeURIComponent('👍')}`,
      as(ravi),
    );
    await Promise.all(wait);

    wait = [b, r].map((s) =>
      nextEvent(
        s,
        'message:updated',
        is((x) => !!x.deletedAt),
      ),
    );
    await api(h, 'DELETE', `/v1/messages/${m.messageId}`, as(owner));
    await Promise.all(wait);
  });

  it('read receipts reach my other device and the sender', async () => {
    const m = await send(ravi, 'Did you read this?');
    const wait = [b, r].map((s) =>
      nextEvent(s, 'receipt:updated', (x) => x.userId === owner.user.userId),
    );
    await api(h, 'POST', '/v1/messages/receipts', {
      ...as(owner),
      body: { conversationId: group.conversationId, kind: 'read', upToSequence: m.serverSequence },
    });
    await Promise.all(wait);
  });
});

describe('personal changes', () => {
  it('saved messages sync to my other devices only', async () => {
    const m = await send(ravi, 'Save me');
    const onB = nextEvent(b, 'bookmark:updated', (e) => e.messageId === m.messageId);
    const notRavi = silent(r, 'bookmark:updated');
    await api(h, 'PUT', `/v1/messages/${m.messageId}/bookmark`, as(owner));
    expect(await onB).toEqual({
      messageId: m.messageId,
      conversationId: group.conversationId,
      saved: true,
    });
    await notRavi;
    const off = nextEvent(b, 'bookmark:updated', (e) => e.messageId === m.messageId);
    await api(h, 'DELETE', `/v1/messages/${m.messageId}/bookmark`, as(owner));
    expect((await off).saved).toBe(false);
  });

  it('notification level syncs to my other devices', async () => {
    const onB = nextEvent(
      b,
      'conversation:upsert',
      (c) => c.conversationId === group.conversationId && c.myNotifyLevel === 'mentions',
    );
    await api(h, 'PUT', `/v1/conversations/${group.conversationId}/notify-level`, {
      ...as(owner),
      body: { level: 'mentions' },
    });
    await onB;
  });
});

describe('work', () => {
  it('tasks and their updates reach the assignee and my other device', async () => {
    const created = nextEvent(r, 'task:upsert', (t) => t.title === 'Check German quotas');
    const t = await api<Task>(h, 'POST', '/v1/tasks', {
      ...as(owner),
      body: {
        title: 'Check German quotas',
        conversationId: group.conversationId,
        assigneeIds: [ravi.user.userId],
      },
    });
    expect(t.status).toBe(201);
    await created;
    const done = [a, b].map((s) =>
      nextEvent(s, 'task:upsert', (x) => x.taskId === t.body.taskId && x.status === 'done'),
    );
    await api(h, 'PATCH', `/v1/tasks/${t.body.taskId}`, { ...as(ravi), body: { status: 'done' } });
    await Promise.all(done);
  });

  it('a new project tells every member to refresh', async () => {
    const wait = [b, r].map((s) => nextEvent(s, 'project:changed'));
    const p = await api<{ projectId: string }>(h, 'POST', '/v1/projects', {
      ...as(owner),
      body: { name: 'Wave 3' },
    });
    expect(p.status).toBe(201);
    for (const e of await Promise.all(wait)) expect(e.projectId).toBe(p.body.projectId);
  });
});

describe('organization changes', () => {
  it('branding changes reach every member', async () => {
    const wait = [b, r].map((s) => nextEvent(s, 'tenant:updated', (e) => e.area === 'branding'));
    const res = await api(h, 'PUT', '/v1/branding', { ...as(owner), body: { appName: 'Sync' } });
    expect(res.status).toBe(200);
    await Promise.all(wait);
  });

  it('AI and recording settings reach every member', async () => {
    let wait = [r].map((s) => nextEvent(s, 'tenant:updated', (e) => e.area === 'ai'));
    await api(h, 'PUT', '/v1/ai/settings', { ...as(owner), body: { enabled: false } });
    await Promise.all(wait);
    wait = [r].map((s) => nextEvent(s, 'tenant:updated', (e) => e.area === 'recordings'));
    const rec = await api(h, 'PUT', '/v1/admin/recording-settings', {
      ...as(owner),
      body: { retentionDays: null, callRecordingEnabled: true },
    });
    expect(rec.status, JSON.stringify(rec.body)).toBe(200);
    await Promise.all(wait);
  });

  it('member changes update everyone’s directory', async () => {
    const wait = nextEvent(r, 'directory:updated', (e) => e.userId !== ravi.user.userId);
    const inv = await api<{ userId: string }>(h, 'POST', '/v1/users', {
      ...as(owner),
      body: {
        email: `meera@sync-${Date.now()}.test`,
        displayName: 'Meera Iyer',
        role: 'member',
        temporaryPassword: 'temporary password 123',
      },
    });
    expect(inv.status).toBe(201);
    await wait;
    const changed = nextEvent(b, 'directory:updated', (e) => e.userId === ravi.user.userId);
    await api(h, 'PATCH', `/v1/users/${ravi.user.userId}`, {
      ...as(owner),
      body: { role: 'admin' },
    });
    await changed;
  });
});

describe('client inbox', () => {
  it('inbound messages, assignment, replies and read marks sync live', async () => {
    const connector = await api<{ connectorId: string }>(h, 'POST', '/v1/connectors', {
      ...as(owner),
      body: { provider: 'telegram', name: 'Sync bot', environment: 'test' },
    });
    expect(connector.status, JSON.stringify(connector.body)).toBe(201);
    const isMsg = (e: InboxChangedEvent) => e.reason === 'message';

    // A client writes: every agent who can see the conversation hears about it.
    let wait = [b, r].map((s) => nextEvent(s, 'inbox:changed', isMsg));
    const sim = await api<{ conversationIds: string[] }>(
      h,
      'POST',
      `/v1/connectors/${connector.body.connectorId}/simulate-inbound`,
      { ...as(owner), body: { fromName: 'Mia Chen', fromHandle: '@mia', text: 'Any update?' } },
    );
    const id = sim.body.conversationIds[0]!;
    for (const e of await Promise.all(wait)) expect(e.conversationId).toBe(id);

    // Assigning from the laptop reaches the phone and the new assignee.
    wait = [b, r].map((s) => nextEvent(s, 'inbox:changed', (e) => e.reason === 'updated'));
    await api(h, 'PATCH', `/v1/inbox/conversations/${id}`, {
      ...as(owner),
      body: { assigneeId: ravi.user.userId },
    });
    await Promise.all(wait);

    // The assignee's reply reaches both of the owner's devices.
    wait = [a, b].map((s) => nextEvent(s, 'inbox:changed', isMsg));
    await api(h, 'POST', `/v1/inbox/conversations/${id}/replies`, {
      ...as(ravi),
      body: { clientMessageId: uuidv7(), text: 'Results land Wednesday.' },
    });
    await Promise.all(wait);

    // Read marks are personal: my phone hears, Ravi does not, and it is idempotent.
    const list = async (s: Session) =>
      (await api<InboxList>(h, 'GET', '/v1/inbox/conversations', as(s))).body.items.find(
        (c) => c.conversationId === id,
      )!;
    await simulateAgain(connector.body.connectorId);
    expect((await list(owner)).unread).toBe(true);
    const onB = nextEvent(
      b,
      'inbox:changed',
      (e) => e.reason === 'read' && e.conversationId === id,
    );
    const notR = new Promise<void>((resolve, reject) => {
      const fail = (e: InboxChangedEvent) =>
        e.reason === 'read' ? reject(new Error('read mark leaked to another agent')) : undefined;
      r.on('inbox:changed', fail);
      setTimeout(() => (r.off('inbox:changed', fail), resolve()), 400);
    });
    for (let i = 0; i < 2; i++) {
      const res = await api(h, 'PUT', `/v1/inbox/conversations/${id}/read`, as(owner));
      expect(res.status).toBe(200);
    }
    await Promise.all([onB, notR]);
    expect((await list(owner)).unread).toBe(false);
    expect((await list(ravi)).unread).toBe(true);
  });

  it('channels, templates and inbox settings reach every member', async () => {
    const isInbox = (e: { area: string }) => e.area === 'inbox';
    let wait = [b, r].map((s) => nextEvent(s, 'tenant:updated', isInbox));
    const c = await api<{ connectorId: string }>(h, 'POST', '/v1/connectors', {
      ...as(owner),
      body: { provider: 'slack', name: 'Synced channel', environment: 'test' },
    });
    expect(c.status).toBe(201);
    await Promise.all(wait);

    wait = [b, r].map((s) => nextEvent(s, 'tenant:updated', isInbox));
    await api(h, 'PATCH', `/v1/connectors/${c.body.connectorId}`, {
      ...as(owner),
      body: { status: 'paused' },
    });
    await Promise.all(wait);

    wait = [b, r].map((s) => nextEvent(s, 'tenant:updated', isInbox));
    const tpl = await api(h, 'POST', '/v1/inbox/templates', {
      ...as(ravi),
      body: { name: 'Synced', shortcut: 'synced', body: 'Hi {{client.firstName}}' },
    });
    expect(tpl.status, JSON.stringify(tpl.body)).toBe(201);
    await Promise.all(wait);

    wait = [b, r].map((s) => nextEvent(s, 'tenant:updated', isInbox));
    const cur = await api<Record<string, unknown>>(h, 'GET', '/v1/inbox/settings', as(owner));
    const put = await api(h, 'PUT', '/v1/inbox/settings', {
      ...as(owner),
      body: { ...cur.body, autoAssign: true },
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    await Promise.all(wait);

    wait = [b, r].map((s) => nextEvent(s, 'tenant:updated', isInbox));
    await api(h, 'DELETE', `/v1/connectors/${c.body.connectorId}`, as(owner));
    await Promise.all(wait);
  });
});

async function simulateAgain(connectorId: string) {
  const res = await api(h, 'POST', `/v1/connectors/${connectorId}/simulate-inbound`, {
    ...as(owner),
    body: { fromName: 'Mia Chen', fromHandle: '@mia', text: 'One more thing' },
  });
  expect(res.status).toBeLessThan(300);
}
