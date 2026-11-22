import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  uuidv7,
  type IntegrationTestResult,
  type Message,
  type ModerationQueue,
  type ModerationReport,
  type NetworkAdminView,
  type NetworkSuspensions,
  type SendMessageAck,
  type Session,
} from '@sampledge/contracts';
import {
  api,
  connect,
  device,
  nextEvent,
  registerTenant,
  startHarness,
  type Harness,
} from './harness.js';

/** SMS invites through the database-configured provider, and the moderation queues. */
let h: Harness;
let gateway: Server;
let gatewayUrl: string;
const texts: { headers: IncomingHttpHeaders; body: Record<string, unknown> }[] = [];
const OPERATOR = `ops-${Date.now().toString(36)}@platform.test`;
const act = () => ({ clientActionId: uuidv7() });

let acme: Awaited<ReturnType<typeof registerTenant>>;
let globex: Awaited<ReturnType<typeof registerTenant>>;
let operator: Session;
let priyaNet: Session;
let gloriaNet: Session;
let samNet: Session;
let samWork: Session;

async function link(s: Session) {
  const r = await api<Session>(h, 'POST', '/v1/network/link', {
    token: s.accessToken,
    body: { device: device() },
  });
  if (r.status !== 200) throw new Error(`link ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

async function connectPair(a: Session, b: Session) {
  const req = await api<{ requestId: string }>(h, 'POST', '/v1/network/requests', {
    token: a.accessToken,
    body: { ...act(), toUserId: b.user.userId, circle: 'business', message: '' },
  });
  await api(h, 'POST', `/v1/network/requests/${req.body.requestId}/respond`, {
    token: b.accessToken,
    body: { ...act(), accept: true, circle: 'business' },
  });
}

const queue = (s: Session, status = 'open') =>
  api<ModerationQueue>(h, 'GET', `/v1/platform/network/reports?status=${status}`, {
    token: s.accessToken,
  });
const report = (s: Session, targetType: string, targetId: string, reason = 'spam') =>
  api<{ reportId: string }>(h, 'POST', '/v1/network/reports', {
    token: s.accessToken,
    body: { ...act(), targetType, targetId, reason, details: 'Please look' },
  });
const decide = (s: Session, reportId: string, action: string, note = '') =>
  api<ModerationReport>(h, 'POST', `/v1/platform/network/reports/${reportId}/action`, {
    token: s.accessToken,
    body: { ...act(), action, note },
  });

beforeAll(async () => {
  gateway = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const ok = req.headers.authorization === 'Bearer gw-secret';
      if (ok) texts.push({ headers: req.headers, body: JSON.parse(raw || '{}') });
      res.statusCode = ok ? 200 : 401;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(ok ? { id: 'msg-1' } : { error: 'bad token' }));
    });
  });
  await new Promise<void>((r) => gateway.listen(0, '127.0.0.1', r));
  gatewayUrl = `http://localhost:${(gateway.address() as { port: number }).port}/send`;
  h = await startHarness({
    PLATFORM_ADMIN_EMAILS: OPERATOR,
    SETTINGS_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
  });
  acme = await registerTenant(h, 'Acme Research');
  globex = await registerTenant(h, 'Globex Panels');
  const sam = await registerTenant(h, 'Spammy Ltd');
  const reg = await api<Session>(h, 'POST', '/v1/auth/register', {
    body: {
      organizationName: 'Platform Ops',
      tenantSlug: `ops-${Date.now().toString(36)}`,
      ownerName: 'Olivia Ops',
      ownerEmail: OPERATOR,
      password: 'correct horse battery staple',
      device: device(),
    },
  });
  operator = reg.body;
  priyaNet = await link(acme.session);
  gloriaNet = await link(globex.session);
  samWork = sam.session;
  samNet = await link(sam.session);
  await connectPair(priyaNet, samNet);
  await connectPair(gloriaNet, samNet);
}, 60_000);

afterAll(async () => {
  await h?.close();
  gateway?.close();
});

describe('SMS invites', () => {
  it('reports not_configured until a provider is saved, then sends through it', async () => {
    const before = await api<{ delivery: string; smsUrl: string }>(
      h,
      'POST',
      '/v1/network/invites',
      {
        token: priyaNet.accessToken,
        body: { ...act(), channel: 'sms', phone: '+44 7700 900111', name: 'Meera' },
      },
    );
    expect(before.status).toBe(201);
    expect(before.body.delivery).toBe('not_configured');
    expect(before.body.smsUrl).toMatch(/^sms:\+447700900111/);

    // Organization admins set it up in Administration → Integrations; secrets are encrypted.
    const saved = await api<{ saved: { secretsSet: string[] } }>(
      h,
      'PUT',
      '/v1/admin/integrations/sms',
      {
        token: acme.session.accessToken,
        body: {
          enabled: true,
          values: { provider: 'webhook', webhookUrl: gatewayUrl, secret: 'wrong', from: 'Acme' },
        },
      },
    );
    expect(saved.status).toBe(200);
    expect(saved.body.saved.secretsSet).toEqual(['secret']);
    expect(JSON.stringify(saved.body)).not.toContain('wrong');
    const bad = await api<IntegrationTestResult>(h, 'POST', '/v1/admin/integrations/sms/test', {
      token: acme.session.accessToken,
      body: {},
    });
    expect(bad.body.ok).toBe(false);
    const failed = await api<{ delivery: string }>(h, 'POST', '/v1/network/invites', {
      token: priyaNet.accessToken,
      body: { ...act(), channel: 'sms', phone: '+44 7700 900112' },
    });
    expect(failed.body.delivery).toBe('failed');

    await api(h, 'PUT', '/v1/admin/integrations/sms', {
      token: acme.session.accessToken,
      body: {
        enabled: true,
        values: { provider: 'webhook', webhookUrl: gatewayUrl, secret: 'gw-secret', from: 'Acme' },
      },
    });
    const good = await api<IntegrationTestResult>(h, 'POST', '/v1/admin/integrations/sms/test', {
      token: acme.session.accessToken,
      body: {},
    });
    expect(good.body.ok).toBe(true);
    const sent = await api<{ delivery: string; url: string }>(h, 'POST', '/v1/network/invites', {
      token: priyaNet.accessToken,
      body: { ...act(), channel: 'sms', phone: '+44 7700 900113', name: 'Ola' },
    });
    expect(sent.body.delivery).toBe('sent');
    const text = texts.find((t) => t.body.to === '+447700900113')!;
    expect(text.body.from).toBe('Acme');
    expect(String(text.body.text)).toContain(sent.body.url);
    expect(String(text.body.text)).toContain('invited you to connect on SampConnect');

    // Other organizations don't use Acme's provider.
    const other = await api<{ delivery: string }>(h, 'POST', '/v1/network/invites', {
      token: gloriaNet.accessToken,
      body: { ...act(), channel: 'sms', phone: '+44 7700 900114' },
    });
    expect(other.body.delivery).toBe('not_configured');
  });

  it('platform operators can set a provider everyone falls back to', async () => {
    const r = await api(h, 'PUT', '/v1/platform/integrations/sms', {
      token: operator.accessToken,
      body: {
        enabled: true,
        values: {
          provider: 'webhook',
          webhookUrl: gatewayUrl,
          secret: 'gw-secret',
          from: 'SampConnect',
        },
      },
    });
    expect(r.status).toBe(200);
    const sent = await api<{ delivery: string }>(h, 'POST', '/v1/network/invites', {
      token: gloriaNet.accessToken,
      body: { ...act(), channel: 'sms', phone: '+44 7700 900115' },
    });
    expect(sent.body.delivery).toBe('sent');
    expect(texts.find((t) => t.body.to === '+447700900115')!.body.from).toBe('SampConnect');
  });
});

describe('reports and moderation', () => {
  it('only operators see the queue, and reports carry a snapshot', async () => {
    const view = await api<NetworkAdminView>(h, 'GET', '/v1/admin/network', {
      token: operator.accessToken,
    });
    expect(view.body.canModerate).toBe(true);
    const notOp = await api<NetworkAdminView>(h, 'GET', '/v1/admin/network', {
      token: acme.session.accessToken,
    });
    expect(notOp.body.canModerate).toBe(false);
    expect((await queue(acme.session)).status).toBe(403);
    // Network sessions never reach platform moderation.
    expect((await queue(priyaNet)).status).toBe(403);

    // You can only report what you can see.
    const st = await api<{ statusId: string }>(h, 'POST', '/v1/network/statuses', {
      token: samNet.accessToken,
      body: {
        clientStatusId: uuidv7(),
        kind: 'text',
        text: 'Buy followers cheap',
        audience: 'connections',
      },
    });
    const stranger = await link((await registerTenant(h, 'Stranger Co')).session);
    expect((await report(stranger, 'status', st.body.statusId)).status).toBe(404);

    const sock = await connect(h, operator.accessToken);
    const live = nextEvent(sock, 'moderation:changed', (e) => e.scope === 'reports');
    const r1 = await report(priyaNet, 'status', st.body.statusId);
    expect(r1.status).toBe(201);
    await live;
    sock.disconnect();
    await report(gloriaNet, 'status', st.body.statusId, 'inappropriate');

    const q = await queue(operator);
    expect(q.status).toBe(200);
    // Two reports about one status show as one card (the newest), counting the other.
    const cards = q.body.reports.filter((r) => r.targetId === st.body.statusId);
    expect(cards).toHaveLength(1);
    const mine = cards[0]!;
    expect(mine).toMatchObject({
      targetType: 'status',
      snapshot: 'Buy followers cheap',
      targetState: 'active',
      alsoReported: 1,
      status: 'open',
    });
    expect(mine.subject?.userId).toBe(samNet.user.userId);
    expect(mine.reporter?.userId).toBe(gloriaNet.user.userId);

    // Removing it closes both reports and takes the status off everyone's feed.
    const done = await decide(operator, r1.body.reportId, 'remove_content', 'Spam');
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: 'actioned', targetState: 'removed' });
    expect(done.body.resolution).toMatchObject({ action: 'remove_content', note: 'Spam' });
    expect(
      (await queue(operator)).body.reports.filter((r) => r.targetId === st.body.statusId),
    ).toHaveLength(0);
    expect((await queue(operator, 'actioned')).body.counts.actioned).toBe(1);
    const feed = await api<{ people: unknown[] }>(h, 'GET', '/v1/network/statuses', {
      token: priyaNet.accessToken,
    });
    expect(feed.body.people).toHaveLength(0);
  });

  it('dismissing closes only that report', async () => {
    const r = await report(priyaNet, 'user', gloriaNet.user.userId, 'other');
    const d = await decide(operator, r.body.reportId, 'dismiss', 'Not a problem');
    expect(d.body.status).toBe('dismissed');
    expect(d.body.targetState).toBe('active');
    // A community moderator action isn't available to operators, and vice versa.
    expect((await decide(operator, r.body.reportId, 'ban_from_community')).status).toBe(403);
  });

  it('suspends a person everywhere and restores them', async () => {
    const r = await report(gloriaNet, 'user', samNet.user.userId, 'spam');
    const s = await decide(operator, r.body.reportId, 'suspend_user', 'Repeated spam');
    expect(s.body.targetState).toBe('suspended');
    // Their sessions stop working, they vanish from search and connections, and can't relink.
    const me = await api(h, 'GET', '/v1/network/me', { token: samNet.accessToken });
    expect(me.status).toBe(401);
    const conns = await api<{ person: { userId: string } }[]>(h, 'GET', '/v1/network/connections', {
      token: gloriaNet.accessToken,
    });
    expect(conns.body.map((c) => c.person.userId)).not.toContain(samNet.user.userId);
    const person = await api(h, 'GET', `/v1/network/people/${samNet.user.userId}`, {
      token: gloriaNet.accessToken,
    });
    expect(person.status).toBe(404);
    const relink = await api(h, 'POST', '/v1/network/link', {
      token: samWork.accessToken,
      body: { device: device() },
    });
    expect(relink.status).toBe(403);

    const list = await api<NetworkSuspensions>(h, 'GET', '/v1/platform/network/suspensions', {
      token: operator.accessToken,
    });
    expect(list.body.users.map((u) => u.person.userId)).toContain(samNet.user.userId);
    expect(list.body.users[0]!.reason).toBe('Repeated spam');
    expect(
      (
        await api(h, 'DELETE', `/v1/platform/network/suspensions/users/${samNet.user.userId}`, {
          token: operator.accessToken,
        })
      ).status,
    ).toBe(204);
    const back = await api<{ person: { userId: string } }[]>(h, 'GET', '/v1/network/connections', {
      token: gloriaNet.accessToken,
    });
    expect(back.body.map((c) => c.person.userId)).toContain(samNet.user.userId);
  });

  it('community moderators review reported messages in their groups', async () => {
    samNet = await link((await registerTenant(h, 'Sam Again')).session);
    const c = await api<{
      communityId: string;
      slug: string;
      groups: { conversationId: string; kind: string }[];
    }>(h, 'POST', '/v1/network/communities', {
      token: priyaNet.accessToken,
      body: {
        ...act(),
        name: 'Panel Quality',
        description: '',
        visibility: 'public',
        joinPolicy: 'open',
      },
    });
    const group = c.body.groups.find((g) => g.kind === 'group')!.conversationId;
    for (const s of [gloriaNet, samNet])
      await api(h, 'POST', `/v1/network/communities/${c.body.communityId}/join`, {
        token: s.accessToken,
      });
    const sent = await api<SendMessageAck>(h, 'POST', `/v1/conversations/${group}/messages`, {
      token: samNet.accessToken,
      body: {
        conversationId: group,
        clientMessageId: uuidv7(),
        content: { text: 'DM me for cheap panels', mentions: [] },
      },
    });
    expect(sent.status).toBe(200);
    const msgId = sent.body.message.messageId;

    const sock = await connect(h, priyaNet.accessToken);
    const live = nextEvent(
      sock,
      'network:changed',
      (e) => e.scope === 'reports' && e.id === c.body.communityId,
    );
    const r = await report(gloriaNet, 'message', msgId);
    await live;
    sock.disconnect();

    // Members can't see the community queue; the owner can.
    const base = `/v1/network/communities/${c.body.communityId}/reports`;
    expect((await api(h, 'GET', base, { token: gloriaNet.accessToken })).status).toBe(403);
    const q = await api<ModerationQueue>(h, 'GET', base, { token: priyaNet.accessToken });
    expect(q.body.reports.map((x) => x.reportId)).toEqual([r.body.reportId]);
    expect(q.body.reports[0]).toMatchObject({
      snapshot: 'DM me for cheap panels',
      community: { slug: c.body.slug },
    });
    // Community moderators can't suspend people platform-wide.
    const nope = await api(h, 'POST', `${base}/${r.body.reportId}/action`, {
      token: priyaNet.accessToken,
      body: { ...act(), action: 'suspend_user' },
    });
    expect(nope.status).toBe(403);
    const removed = await api<ModerationReport>(h, 'POST', `${base}/${r.body.reportId}/action`, {
      token: priyaNet.accessToken,
      body: { ...act(), action: 'remove_content', note: 'Off topic' },
    });
    expect(removed.status).toBe(200);
    expect(removed.body.targetState).toBe('removed');
    const hist = await api<Message[]>(h, 'GET', `/v1/conversations/${group}/messages`, {
      token: gloriaNet.accessToken,
    });
    const tomb = hist.body.find((m) => m.messageId === msgId)!;
    expect(tomb.deletedAt).not.toBeNull();
    expect(tomb.content.text).toBe('');

    // Ban the sender from the community from a second report.
    const again = await api<SendMessageAck>(h, 'POST', `/v1/conversations/${group}/messages`, {
      token: samNet.accessToken,
      body: {
        conversationId: group,
        clientMessageId: uuidv7(),
        content: { text: 'Still selling', mentions: [] },
      },
    });
    const r2 = await report(gloriaNet, 'message', again.body.message.messageId);
    const ban = await api<ModerationReport>(h, 'POST', `${base}/${r2.body.reportId}/action`, {
      token: priyaNet.accessToken,
      body: { ...act(), action: 'ban_from_community' },
    });
    expect(ban.status).toBe(200);
    const rejoin = await api(h, 'GET', `/v1/network/communities/${c.body.communityId}`, {
      token: samNet.accessToken,
    });
    expect(rejoin.status).toBe(404);

    // Operators see community reports too, and can suspend the whole community.
    const r3 = await report(gloriaNet, 'community', c.body.communityId, 'inappropriate');
    const sus = await decide(operator, r3.body.reportId, 'suspend_community', 'Closed');
    expect(sus.body.targetState).toBe('suspended');
    expect((await api(h, 'GET', `/v1/network/public/communities/${c.body.slug}`)).status).toBe(404);
    expect(
      (
        await api(h, 'GET', `/v1/network/communities/${c.body.communityId}`, {
          token: priyaNet.accessToken,
        })
      ).status,
    ).toBe(404);
    const post = await api(h, 'POST', `/v1/conversations/${group}/messages`, {
      token: priyaNet.accessToken,
      body: {
        conversationId: group,
        clientMessageId: uuidv7(),
        content: { text: 'hello?', mentions: [] },
      },
    });
    expect(post.status).toBeGreaterThanOrEqual(400);
    await api(h, 'DELETE', `/v1/platform/network/suspensions/communities/${c.body.communityId}`, {
      token: operator.accessToken,
    });
    expect((await api(h, 'GET', `/v1/network/public/communities/${c.body.slug}`)).status).toBe(200);
    const post2 = await api(h, 'POST', `/v1/conversations/${group}/messages`, {
      token: priyaNet.accessToken,
      body: {
        conversationId: group,
        clientMessageId: uuidv7(),
        content: { text: 'We are back', mentions: [] },
      },
    });
    expect(post2.status).toBe(200);
  });
});
