import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7, type Conversation } from '@sampledge/contracts';
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
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());

describe('tenant isolation', () => {
  it('a user in tenant B cannot see, read or write tenant A data by guessing ids', async () => {
    const a = await registerTenant(h, 'Tenant A');
    const b = await registerTenant(h, 'Tenant B');
    const aConvs = await api<Conversation[]>(h, 'GET', '/v1/conversations', {
      token: a.session.accessToken,
    });
    const aGeneral = aConvs.body[0]!;
    await api(h, 'POST', `/v1/conversations/${aGeneral.conversationId}/messages`, {
      token: a.session.accessToken,
      body: { clientMessageId: uuidv7(), content: { text: 'secret A' } },
    });

    const tokB = b.session.accessToken;
    expect(
      (await api(h, 'GET', `/v1/conversations/${aGeneral.conversationId}`, { token: tokB })).status,
    ).toBe(404);
    expect(
      (
        await api(h, 'GET', `/v1/conversations/${aGeneral.conversationId}/messages`, {
          token: tokB,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await api(h, 'POST', `/v1/conversations/${aGeneral.conversationId}/messages`, {
          token: tokB,
          body: { clientMessageId: uuidv7(), content: { text: 'x' } },
        })
      ).status,
    ).toBe(404);
    expect(
      (await api(h, 'POST', `/v1/conversations/${aGeneral.conversationId}/join`, { token: tokB }))
        .status,
    ).toBe(404);

    // Directory only lists own tenant; DMs with foreign users are rejected.
    const users = await api<{ userId: string }[]>(h, 'GET', '/v1/users', { token: tokB });
    expect(users.body.map((u) => u.userId)).not.toContain(a.session.user.userId);
    const dm = await api(h, 'POST', '/v1/conversations', {
      token: tokB,
      body: { kind: 'dm', memberIds: [a.session.user.userId] },
    });
    expect(dm.status).toBe(400);

    // Sync for B never includes A's conversations, even when B forges a cursor for one.
    const sync = await api<{ conversations: Conversation[]; revokedConversationIds: string[] }>(
      h,
      'POST',
      '/v1/sync',
      {
        token: tokB,
        body: { cursors: [{ conversationId: aGeneral.conversationId, afterChangeSequence: 0 }] },
      },
    );
    expect(sync.body.conversations.map((c) => c.conversationId)).not.toContain(
      aGeneral.conversationId,
    );
    expect(sync.body.revokedConversationIds).toEqual([aGeneral.conversationId]);
  });

  it('ignores a tenantId supplied in the request body', async () => {
    const a = await registerTenant(h, 'Tenant A');
    const b = await registerTenant(h, 'Tenant B');
    const bConvs = await api<Conversation[]>(h, 'GET', '/v1/conversations', {
      token: b.session.accessToken,
    });
    const res = await api<{ message: { tenantId: string } }>(
      h,
      'POST',
      `/v1/conversations/${bConvs.body[0]!.conversationId}/messages`,
      {
        token: b.session.accessToken,
        body: {
          clientMessageId: uuidv7(),
          content: { text: 'hi' },
          tenantId: a.session.tenant.tenantId,
          senderId: a.session.user.userId,
        },
      },
    );
    expect(res.status).toBe(200);
    expect(res.body.message.tenantId).toBe(b.session.tenant.tenantId);
    expect((res.body.message as unknown as { senderId: string }).senderId).toBe(
      b.session.user.userId,
    );
  });

  it('socket events never cross tenants', async () => {
    const a = await registerTenant(h, 'Tenant A');
    const b = await registerTenant(h, 'Tenant B');
    const sb = await connect(h, b.session.accessToken);
    const leaked: unknown[] = [];
    sb.on('message:new', (m) => leaked.push(m));
    const aGeneral = (
      await api<Conversation[]>(h, 'GET', '/v1/conversations', { token: a.session.accessToken })
    ).body[0]!;
    const sa = await connect(h, a.session.accessToken);
    const got = nextEvent(sa, 'message:new');
    await api(h, 'POST', `/v1/conversations/${aGeneral.conversationId}/messages`, {
      token: a.session.accessToken,
      body: { clientMessageId: uuidv7(), content: { text: 'A only' } },
    });
    await got;
    await new Promise((r) => setTimeout(r, 200));
    expect(leaked).toEqual([]);
    sa.close();
    sb.close();
  });

  it('guests only see conversations they were added to', async () => {
    const a = await registerTenant(h);
    const guest = await inviteAndLogin(h, a.session, a.slug, 'Supplier Guest', 'guest');
    const convs = await api<Conversation[]>(h, 'GET', '/v1/conversations', {
      token: guest.accessToken,
    });
    expect(convs.body).toEqual([]);
    expect((await api(h, 'GET', '/v1/users', { token: guest.accessToken })).status).toBe(403);
  });
});
