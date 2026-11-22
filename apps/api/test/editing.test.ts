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
import {
  api,
  connect,
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
