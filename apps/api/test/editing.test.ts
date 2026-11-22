import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  TENANT_PERMISSIONS,
  uuidv7,
  type AuditPage,
  type Conversation,
  type Message,
  type MessageEditHistory,
  type MessageEditingState,
  type PlatformActivityPage,
  type SendMessageAck,
  type Session,
  type TenantPermissionPolicy,
} from '@sampledge/contracts';
import { TenantDb } from '../src/database/tenant-db.js';
import type { Approval, NetworkStatus, Project, Task } from '@sampledge/contracts';
import {
  api,
  connect,
  device,
  grantPlatformRole,
  inviteAndLogin,
  nextEvent,
  registerTenant,
  startHarness,
  type Harness,
} from './harness.js';

/** Editing across SampConnect (docs/editing.md). */
let h: Harness;
let acme: Awaited<ReturnType<typeof registerTenant>>;
let owner: Session;
let ravi: Session;
let lena: Session;
let superAdmin: Session;
let group: Conversation;

const as = <T>(s: Session, method: string, path: string, body?: unknown) =>
  api<T>(h, method, path, { token: s.accessToken, body });
const send = async (s: Session, text: string) =>
  (
    await as<SendMessageAck>(s, 'POST', `/v1/conversations/${group.conversationId}/messages`, {
      clientMessageId: uuidv7(),
      content: { text },
    })
  ).body.message;
const edit = (s: Session, id: string, text: string) =>
  as<Message & { error?: { message: string } }>(s, 'PATCH', `/v1/messages/${id}`, {
    content: { text },
  });
const rules = (body: object) => as<MessageEditingState>(owner, 'PUT', '/v1/admin/message-editing', body);

beforeAll(async () => {
  h = await startHarness();
  const hq = await registerTenant(h, 'SampConnect HQ');
  superAdmin = hq.session;
  await grantPlatformRole(h, superAdmin, 'owner');
  acme = await registerTenant(h, 'Acme Research');
  owner = acme.session;
  ravi = await inviteAndLogin(h, owner, acme.slug, 'Ravi Kumar');
  lena = await inviteAndLogin(h, owner, acme.slug, 'Lena Fischer');
  group = (
    await as<Conversation>(owner, 'POST', '/v1/conversations', {
      kind: 'group',
      name: 'Q4 tracker',
      memberIds: [ravi.user.userId, lena.user.userId],
    })
  ).body;
}, 60_000);
afterAll(() => h?.close());

describe('message edit history', () => {
  it('keeps every earlier version, in order, and audits the edit', async () => {
    const m = await send(ravi, 'Fieldwork closes Friday');
    expect((await edit(ravi, m.messageId, 'Fieldwork closes Thursday')).status).toBe(200);
    // A retry of the same edit keeps no extra version.
    expect((await edit(ravi, m.messageId, 'Fieldwork closes Thursday')).status).toBe(200);
    expect((await edit(ravi, m.messageId, 'Fieldwork closes Thursday 5 pm')).status).toBe(200);

    const hist = await as<MessageEditHistory>(lena, 'GET', `/v1/messages/${m.messageId}/edits`);
    expect(hist.status).toBe(200);
    expect(hist.body.versions.map((v) => [v.version, v.text, v.current])).toEqual([
      [1, 'Fieldwork closes Friday', false],
      [2, 'Fieldwork closes Thursday', false],
      [3, 'Fieldwork closes Thursday 5 pm', true],
    ]);

    const log = await as<AuditPage>(owner, 'GET', '/v1/admin/audit?q=message.edited');
    const mine = log.body.items.filter((i) => i.target?.id === m.messageId);
    expect(mine).toHaveLength(2);
    // Ids only: the audit log never copies message text.
    expect(JSON.stringify(mine)).not.toContain('Fieldwork');

    // Super admins see it in Activity across organizations.
    const act = await as<PlatformActivityPage>(
      superAdmin,
      'GET',
      `/v1/platform/activity?tenantId=${acme.session.tenant.tenantId}&q=message.edited`,
    );
    expect(act.status).toBe(200);
    expect(act.body.items.some((i) => i.target?.id === m.messageId)).toBe(true);
  });

  it('erases the history when the message is deleted', async () => {
    const m = await send(ravi, 'draft numbers');
    await edit(ravi, m.messageId, 'final numbers');
    await as(ravi, 'DELETE', `/v1/messages/${m.messageId}`);
    expect((await as(owner, 'GET', `/v1/messages/${m.messageId}/edits`)).status).toBe(409);
    const left = await h.app
      .get(TenantDb)
      .for(acme.session.tenant.tenantId)
      .message_edits.countDocuments({ messageId: m.messageId });
    expect(left).toBe(0);
  });

  it('can limit earlier versions to moderators and admins', async () => {
    const m = await send(ravi, 'v1');
    await edit(ravi, m.messageId, 'v2');
    await rules({ historyVisibleTo: 'moderators' });
    expect((await as(lena, 'GET', `/v1/messages/${m.messageId}/edits`)).status).toBe(403);
    // The sender and the organization's owner still can.
    expect((await as(ravi, 'GET', `/v1/messages/${m.messageId}/edits`)).status).toBe(200);
    expect((await as(owner, 'GET', `/v1/messages/${m.messageId}/edits`)).status).toBe(200);
    await rules({ historyVisibleTo: 'everyone' });
  });
});

describe('editing rules', () => {
  it('only people with messages.manage change them; everyone hears about it live', async () => {
    expect((await as(ravi, 'PUT', '/v1/admin/message-editing', { allowEditing: false })).status).toBe(
      403,
    );
    const sock = await connect(h, lena.accessToken);
    const live = nextEvent(sock, 'tenant:updated', (e) => e.area === 'messages');
    const r = await rules({ allowEditing: false });
    expect(r.status).toBe(200);
    expect(r.body.policy).toEqual({
      allowEditing: false,
      editWindowMinutes: null,
      historyVisibleTo: 'everyone',
    });
    await live;
    sock.disconnect();
    const s = await as<MessageEditingState>(lena, 'GET', '/v1/message-editing');
    expect(s.body).toMatchObject({ policy: { allowEditing: false }, canEditOwn: true, canManage: false });

    const m = await send(lena, 'hello');
    const refused = await edit(lena, m.messageId, 'hello all');
    expect(refused.status).toBe(403);
    expect(refused.body.error?.message).toMatch(/turned off editing/);
    // Deleting still works.
    expect((await as(lena, 'DELETE', `/v1/messages/${m.messageId}`)).status).toBe(200);
    await rules({ allowEditing: true });
  });

  it('enforces the time limit', async () => {
    await rules({ editWindowMinutes: 15 });
    const fresh = await send(ravi, 'just now');
    expect((await edit(ravi, fresh.messageId, 'just now!')).status).toBe(200);
    const old = await send(ravi, 'an hour ago');
    await h.app
      .get(TenantDb)
      .for(acme.session.tenant.tenantId)
      .messages.updateOne(
        { _id: old.messageId },
        { $set: { createdAt: new Date(Date.now() - 60 * 60_000) } },
      );
    const refused = await edit(ravi, old.messageId, 'an hour ago!');
    expect(refused.status).toBe(403);
    expect(refused.body.error?.message).toMatch(/15 minutes after sending/);
    await rules({ editWindowMinutes: null });
    expect((await edit(ravi, old.messageId, 'an hour ago!')).status).toBe(200);
  });

  it('lets a super admin take editing away from a role', async () => {
    const tenantId = acme.session.tenant.tenantId;
    const cur = await as<{ policy: TenantPermissionPolicy }>(
      superAdmin,
      'GET',
      `/v1/platform/orgs/${tenantId}/permissions`,
    );
    const policy = {
      ...cur.body.policy,
      member: cur.body.policy.member.filter((p) => p !== 'messages.edit'),
    };
    const sock = await connect(h, ravi.accessToken);
    const live = nextEvent(sock, 'tenant:updated', (e) => e.area === 'messages');
    expect(
      (await as(superAdmin, 'PUT', `/v1/platform/orgs/${tenantId}/permissions`, { policy })).status,
    ).toBe(200);
    await live;
    sock.disconnect();
    await new Promise((r) => setTimeout(r, 50));
    expect((await as<MessageEditingState>(ravi, 'GET', '/v1/message-editing')).body.canEditOwn).toBe(
      false,
    );
    const m = await send(ravi, 'locked');
    const refused = await edit(ravi, m.messageId, 'unlocked');
    expect(refused.status).toBe(403);
    expect(refused.body.error?.message).toMatch(/role can’t edit/);
    // The owner keeps it.
    const o = await send(owner, 'mine');
    expect((await edit(owner, o.messageId, 'mine, edited')).status).toBe(200);
    await as(superAdmin, 'PUT', `/v1/platform/orgs/${tenantId}/permissions`, { policy: null });
  });

  it('keeps new permissions on for policies saved before they existed', async () => {
    const { cleanPolicy } = await import('../src/platform/permission-policy.service.js');
    const legacy = { owner: ['tenant.manage'], admin: [], member: ['directory.read'], guest: [] };
    const p = cleanPolicy(legacy)!;
    expect(p.member).toEqual(['messages.edit', 'directory.read']);
    expect(p.admin).toContain('messages.manage');
    // A policy saved knowing the permission keeps the super admin's choice.
    const known = cleanPolicy({ ...legacy, _known: [...TENANT_PERMISSIONS] })!;
    expect(known.member).toEqual(['directory.read']);
  });
});

describe('editing elsewhere', () => {
  it('renames a group or channel and changes a channel description, live', async () => {
    const ch = (
      await as<Conversation>(owner, 'POST', '/v1/conversations', {
        kind: 'channel_public',
        name: 'wave 4',
        memberIds: [ravi.user.userId],
      })
    ).body;
    const sock = await connect(h, ravi.accessToken);
    const live = nextEvent(
      sock,
      'conversation:upsert',
      (c) => c.conversationId === ch.conversationId && c.name === 'Wave 4 fieldwork',
    );
    const r = await as<Conversation>(owner, 'PATCH', `/v1/conversations/${ch.conversationId}`, {
      name: 'Wave 4 fieldwork',
      topic: 'Daily quotas and field issues',
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ name: 'Wave 4 fieldwork', topic: 'Daily quotas and field issues' });
    await live;
    sock.disconnect();
    // Plain members can't; bad channel names are refused; archiving still works.
    expect(
      (await as(ravi, 'PATCH', `/v1/conversations/${ch.conversationId}`, { name: 'mine' })).status,
    ).toBe(403);
    expect(
      (await as(owner, 'PATCH', `/v1/conversations/${ch.conversationId}`, { name: '#!' })).status,
    ).toBe(400);
    expect(
      (await as(owner, 'PATCH', `/v1/conversations/${ch.conversationId}`, { archived: true }))
        .status,
    ).toBe(200);
    // A group gets a name but no description.
    expect(
      (await as<Conversation>(owner, 'PATCH', `/v1/conversations/${group.conversationId}`, { name: 'Q4 tracker team' }))
        .body.name,
    ).toBe('Q4 tracker team');
    expect(
      (await as(owner, 'PATCH', `/v1/conversations/${group.conversationId}`, { topic: 'x' })).status,
    ).toBe(400);
  });

  it('edits every part of a task', async () => {
    const t = (
      await as<Task>(ravi, 'POST', '/v1/tasks', { title: 'Check quotas', assigneeIds: [ravi.user.userId] })
    ).body;
    const due = new Date(Date.now() + 86_400_000).toISOString();
    const r = await as<Task>(ravi, 'PATCH', `/v1/tasks/${t.taskId}`, {
      title: 'Check quotas for UK',
      description: 'Boost 25-34',
      priority: 'high',
      assigneeIds: [ravi.user.userId, lena.user.userId],
      dueAt: due,
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      title: 'Check quotas for UK',
      description: 'Boost 25-34',
      priority: 'high',
      dueAt: due,
    });
    expect(r.body.assigneeIds).toEqual([ravi.user.userId, lena.user.userId]);
  });

  it('edits an approval until someone decides', async () => {
    const a = (
      await as<Approval>(ravi, 'POST', '/v1/approvals', {
        title: 'Incentive top-up',
        approverIds: [owner.user.userId],
        amount: { amountMinor: 50000, currency: 'GBP' },
      })
    ).body;
    const sock = await connect(h, owner.accessToken);
    const live = nextEvent(
      sock,
      'approval:upsert',
      (x) => x.approvalId === a.approvalId && x.title === 'Incentive top-up (UK)',
    );
    const r = await as<Approval>(ravi, 'PATCH', `/v1/approvals/${a.approvalId}`, {
      title: 'Incentive top-up (UK)',
      description: 'Low response in 25-34',
      amount: { amountMinor: 65000, currency: 'GBP' },
    });
    expect(r.status).toBe(200);
    expect(r.body.amount).toEqual({ amountMinor: 65000, currency: 'GBP' });
    await live;
    sock.disconnect();
    // Approvers can't change it.
    expect((await as(owner, 'PATCH', `/v1/approvals/${a.approvalId}`, { title: 'x' })).status).toBe(
      403,
    );
    await as(owner, 'POST', `/v1/approvals/${a.approvalId}/decision`, { decision: 'approve' });
    const late = await as<{ error: { message: string } }>(
      ravi,
      'PATCH',
      `/v1/approvals/${a.approvalId}`,
      { title: 'Incentive top-up (UK, revised)' },
    );
    expect(late.status).toBe(409);
  });

  it('edits a project and renames its channel', async () => {
    const p = (
      await as<Project>(owner, 'POST', '/v1/projects', { name: 'Brand tracker', memberIds: [ravi.user.userId] })
    ).body;
    const r = await as<Project>(owner, 'PATCH', `/v1/projects/${p.projectId}`, {
      name: 'Brand tracker 2027',
      description: 'Quarterly waves',
      status: 'at_risk',
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ name: 'Brand tracker 2027', description: 'Quarterly waves', status: 'at_risk' });
    const ch = await as<Conversation>(owner, 'GET', `/v1/conversations/${p.conversationId}`);
    expect(ch.body.name).toBe('Brand tracker 2027');
    expect((await as(ravi, 'PATCH', `/v1/projects/${p.projectId}`, { name: 'x' })).status).toBe(403);
  });

  it('edits a poll until the first vote', async () => {
    const poll = (
      await as<Message>(lena, 'POST', `/v1/conversations/${group.conversationId}/polls`, {
        clientMessageId: uuidv7(),
        question: 'Kick-off day?',
        options: ['Mon', 'Tue'],
      })
    ).body;
    const r = await as<Message>(lena, 'PATCH', `/v1/messages/${poll.messageId}/poll`, {
      question: 'Kick-off day next week?',
      options: ['Mon', 'Tue', 'Wed'],
      multiple: true,
    });
    expect(r.status).toBe(200);
    expect(r.body.poll).toMatchObject({ question: 'Kick-off day next week?', multiple: true });
    expect(r.body.poll!.options.map((o) => o.text)).toEqual(['Mon', 'Tue', 'Wed']);
    expect(r.body.editedAt).not.toBeNull();
    expect(
      (await as(ravi, 'PATCH', `/v1/messages/${poll.messageId}/poll`, { question: 'x', options: ['a', 'b'] }))
        .status,
    ).toBe(403);
    await as(ravi, 'PUT', `/v1/messages/${poll.messageId}/poll/vote`, { optionIds: ['o1'] });
    const late = await as(lena, 'PATCH', `/v1/messages/${poll.messageId}/poll`, {
      question: 'Kick-off?',
      options: ['Mon', 'Tue'],
    });
    expect(late.status).toBe(409);
  });

  it('edits a status update', async () => {
    const net = (
      await api<Session>(h, 'POST', '/v1/network/link', {
        token: ravi.accessToken,
        body: { device: device() },
      })
    ).body;
    const st = (
      await as<NetworkStatus>(net, 'POST', '/v1/network/statuses', {
        clientStatusId: uuidv7(),
        kind: 'text',
        text: 'At ESOMAR this weke',
      })
    ).body;
    const r = await as<NetworkStatus>(net, 'PATCH', `/v1/network/statuses/${st.statusId}`, {
      text: 'At ESOMAR this week',
      background: 'sunset',
      allowReplies: false,
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ text: 'At ESOMAR this week', background: 'sunset', allowReplies: false });
    expect(r.body.editedAt).toBeTruthy();
    expect(
      (await as(net, 'PATCH', `/v1/network/statuses/${st.statusId}`, { text: '' })).status,
    ).toBe(400);
  });
});
