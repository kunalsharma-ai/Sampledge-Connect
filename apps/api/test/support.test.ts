import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  uuidv7,
  type Session,
  type SupportQuery,
  type SupportQueryList,
} from '@sampledge/contracts';
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

let h: Harness;
let owner: Session;
let ravi: Session;
let mia: Session;
let support: Session; // SampConnect support, in another organization

const ask = (s: Session, body: Record<string, unknown>) =>
  api<SupportQuery>(h, 'POST', '/v1/support/queries', {
    token: s.accessToken,
    body: {
      clientId: uuidv7(),
      subject: 'How do I record?',
      body: 'Where is the button?',
      ...body,
    },
  });

beforeAll(async () => {
  h = await startHarness();
  const t = await registerTenant(h);
  owner = t.session;
  ravi = await inviteAndLogin(h, owner, t.slug, 'Ravi Kumar');
  mia = await inviteAndLogin(h, owner, t.slug, 'Mia Chen');
  support = (await registerTenant(h, 'SampConnect HQ')).session;
  await grantPlatformRole(h, support, 'support');
});
afterAll(() => h.close());

describe('help center queries', () => {
  it('reaches the admins live, is idempotent by clientId, and stays private to the asker', async () => {
    const sock = await connect(h, owner.accessToken);
    const live = nextEvent(sock, 'support:changed');
    const clientId = uuidv7();
    const r = await ask(ravi, { clientId, featureId: 'recordings' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'open', route: 'org', requesterName: 'Ravi Kumar' });
    expect((await live).queryId).toBe(r.body.queryId);
    const again = await ask(ravi, { clientId });
    expect(again.body.queryId).toBe(r.body.queryId);

    const mine = await api<SupportQueryList>(h, 'GET', '/v1/support/queries', {
      token: ravi.accessToken,
    });
    expect(mine.body.items).toHaveLength(1);
    const org = await api<SupportQueryList>(h, 'GET', '/v1/support/admin/queries', {
      token: owner.accessToken,
    });
    expect(org.body.items.map((q) => q.queryId)).toContain(r.body.queryId);
    // Another member cannot read it or the admin queue.
    expect(
      (await api(h, 'GET', `/v1/support/queries/${r.body.queryId}`, { token: mia.accessToken }))
        .status,
    ).toBe(404);
    expect(
      (await api(h, 'GET', '/v1/support/admin/queries', { token: mia.accessToken })).status,
    ).toBe(403);
    sock.disconnect();
  });

  it('admin replies answer it, the asker reopens by replying, and can resolve it', async () => {
    const q = (await ask(ravi, {})).body;
    const raviSock = await connect(h, ravi.accessToken);
    const live = nextEvent(raviSock, 'support:changed', (e) => e.queryId === q.queryId);
    const replyId = uuidv7();
    const a = await api<SupportQuery>(h, 'POST', `/v1/support/queries/${q.queryId}/replies`, {
      token: owner.accessToken,
      body: { clientId: replyId, text: 'Use the record button in the call bar.' },
    });
    expect(a.body.status).toBe('answered');
    expect(a.body.replies[0]).toMatchObject({ side: 'org' });
    await live;
    // A retried reply is added once.
    const dup = await api<SupportQuery>(h, 'POST', `/v1/support/queries/${q.queryId}/replies`, {
      token: owner.accessToken,
      body: { clientId: replyId, text: 'Use the record button in the call bar.' },
    });
    expect(dup.body.replies).toHaveLength(1);
    const back = await api<SupportQuery>(h, 'POST', `/v1/support/queries/${q.queryId}/replies`, {
      token: ravi.accessToken,
      body: { clientId: uuidv7(), text: 'I do not see it' },
    });
    expect(back.body.status).toBe('open');
    // Members may only resolve or reopen; admins may set any status.
    expect(
      (
        await api(h, 'PATCH', `/v1/support/queries/${q.queryId}`, {
          token: ravi.accessToken,
          body: { status: 'in_progress' },
        })
      ).status,
    ).toBe(403);
    const done = await api<SupportQuery>(h, 'PATCH', `/v1/support/queries/${q.queryId}`, {
      token: ravi.accessToken,
      body: { status: 'resolved' },
    });
    expect(done.body.status).toBe('resolved');
    raviSock.disconnect();
  });

  it('reaches SampConnect support when routed or passed on', async () => {
    const direct = (await ask(mia, { route: 'platform', subject: 'Billing question' })).body;
    const orgOnly = (await ask(mia, { subject: 'Org only' })).body;
    const list = async () =>
      (
        await api<SupportQueryList>(h, 'GET', '/v1/platform/support/queries', {
          token: support.accessToken,
        })
      ).body.items.map((q) => q.queryId);
    expect(await list()).toContain(direct.queryId);
    expect(await list()).not.toContain(orgOnly.queryId);
    // Members cannot see the platform queue.
    expect(
      (await api(h, 'GET', '/v1/platform/support/queries', { token: mia.accessToken })).status,
    ).toBe(403);

    await api(h, 'PATCH', `/v1/support/queries/${orgOnly.queryId}`, {
      token: owner.accessToken,
      body: { route: 'platform' },
    });
    expect(await list()).toContain(orgOnly.queryId);

    const a = await api<SupportQuery>(
      h,
      'POST',
      `/v1/platform/support/queries/${direct.tenantId}/${direct.queryId}/replies`,
      {
        token: support.accessToken,
        body: { clientId: uuidv7(), text: 'Your plan renews monthly.' },
      },
    );
    expect(a.status).toBe(201);
    expect(a.body.replies[0]).toMatchObject({
      side: 'platform',
      authorName: 'SampConnect support',
    });
    const seen = await api<SupportQuery>(h, 'GET', `/v1/support/queries/${direct.queryId}`, {
      token: mia.accessToken,
    });
    expect(seen.body.status).toBe('answered');
  });
});
