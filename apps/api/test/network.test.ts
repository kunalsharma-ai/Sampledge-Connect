import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7, type Session } from '@sampledge/contracts';
import { api, connect, device, inviteAndLogin, nextEvent, registerTenant, startHarness, type Harness } from './harness.js';

let h: Harness;
const act = () => ({ clientActionId: uuidv7() });

async function link(s: Session, handle?: string) {
  const r = await api<Session>(h, 'POST', '/v1/network/link', {
    token: s.accessToken,
    body: { device: device(), ...(handle ? { handle } : {}) },
  });
  if (r.status !== 200) throw new Error(`link ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

async function connectPair(a: Session, b: Session) {
  const req = await api<{ requestId: string }>(h, 'POST', '/v1/network/requests', {
    token: a.accessToken,
    body: { ...act(), toUserId: b.user.userId, circle: 'business', message: 'Hi' },
  });
  expect(req.status).toBe(201);
  const ok = await api(h, 'POST', `/v1/network/requests/${req.body.requestId}/respond`, {
    token: b.accessToken,
    body: { ...act(), accept: true, circle: 'friends' },
  });
  expect(ok.status).toBe(200);
}

let acme: Awaited<ReturnType<typeof registerTenant>>;
let globex: Awaited<ReturnType<typeof registerTenant>>;
let priyaNet: Session; // Acme owner
let ravi: Session; // Acme member (work)
let raviNet: Session;
let gloriaNet: Session; // Globex owner

beforeAll(async () => {
  h = await startHarness();
  acme = await registerTenant(h, 'Acme Research');
  globex = await registerTenant(h, 'Globex Panels');
  ravi = await inviteAndLogin(h, acme.session, acme.slug, 'Ravi Kumar');
  priyaNet = await link(acme.session, `priya.${acme.slug.slice(-6).replace(/-/g, '')}`);
  raviNet = await link(ravi);
  gloriaNet = await link(globex.session);
}, 60_000);

afterAll(async () => {
  await h?.close();
});

describe('identity', () => {
  it('links a work account once and returns a network session', async () => {
    expect(priyaNet.tenant.slug).toBe('sampledge-network');
    expect(priyaNet.tenant.tenantId).not.toBe(acme.session.tenant.tenantId);
    const again = await link(acme.session);
    expect(again.user.userId).toBe(priyaNet.user.userId);
    const st = await api<{ linked: boolean; handle: string }>(h, 'GET', '/v1/network/link', { token: acme.session.accessToken });
    expect(st.body.linked).toBe(true);
    const me = await api<{ kind: string; organizationName: string; handle: string }>(h, 'GET', '/v1/network/me', { token: priyaNet.accessToken });
    expect(me.body.kind).toBe('work');
    expect(me.body.organizationName).toBe('Acme Research');
  });

  it('keeps network sessions away from organization features', async () => {
    for (const [m, p] of [
      ['GET', '/v1/admin/overview'],
      ['GET', '/v1/billing'],
      ['POST', '/v1/ai/search'],
      ['GET', '/v1/integrations/modules'],
      ['POST', '/v1/users'],
    ] as const) {
      const r = await api(h, m, p, { token: priyaNet.accessToken, body: m === 'POST' ? {} : undefined });
      expect(r.status, `${m} ${p}`).toBe(403);
    }
    // An organization token can't call network-side endpoints.
    const r = await api(h, 'GET', '/v1/network/me', { token: acme.session.accessToken });
    expect(r.status).toBe(403);
    // Network members cannot create channels or list everyone.
    const ch = await api(h, 'POST', '/v1/conversations', {
      token: priyaNet.accessToken,
      body: { kind: 'channel_public', name: 'everyone' },
    });
    expect(ch.status).toBe(403);
  });

  it('rejects a taken Connect ID', async () => {
    const me = await api<{ handle: string }>(h, 'GET', '/v1/network/me', { token: priyaNet.accessToken });
    const r = await api(h, 'PATCH', '/v1/network/me', { token: gloriaNet.accessToken, body: { handle: me.body.handle } });
    expect(r.status).toBe(409);
  });
});

describe('search, requests and connections', () => {
  it('finds people by Connect ID, name and email, honouring privacy', async () => {
    const me = await api<{ handle: string; email: string }>(h, 'GET', '/v1/network/me', { token: priyaNet.accessToken });
    const byHandle = await api<{ person: { userId: string } }[]>(h, 'GET', `/v1/network/search?q=@${me.body.handle}`, { token: gloriaNet.accessToken });
    expect(byHandle.body[0]?.person.userId).toBe(priyaNet.user.userId);
    const byEmail = await api<{ person: { userId: string } }[]>(h, 'GET', `/v1/network/search?q=${encodeURIComponent(me.body.email)}`, { token: gloriaNet.accessToken });
    expect(byEmail.body.map((r) => r.person.userId)).toContain(priyaNet.user.userId);
    const byName = await api<{ person: { userId: string } }[]>(h, 'GET', '/v1/network/search?q=Priya', { token: gloriaNet.accessToken });
    expect(byName.body.map((r) => r.person.userId)).toContain(priyaNet.user.userId);

    await api(h, 'PATCH', '/v1/network/me', {
      token: priyaNet.accessToken,
      body: { privacy: { discoverableByName: false, findableByEmail: false } },
    });
    const hiddenName = await api<unknown[]>(h, 'GET', '/v1/network/search?q=Priya', { token: gloriaNet.accessToken });
    expect(hiddenName.body).toHaveLength(0);
    const hiddenEmail = await api<unknown[]>(h, 'GET', `/v1/network/search?q=${encodeURIComponent(me.body.email)}`, { token: gloriaNet.accessToken });
    expect(hiddenEmail.body).toHaveLength(0);
    // The exact Connect ID still works.
    const still = await api<unknown[]>(h, 'GET', `/v1/network/search?q=${me.body.handle}`, { token: gloriaNet.accessToken });
    expect(still.body).toHaveLength(1);
    await api(h, 'PATCH', '/v1/network/me', { token: priyaNet.accessToken, body: { privacy: { discoverableByName: true, findableByEmail: true } } });
  });

  it('needs a connection before a cross-organization DM, then chat works', async () => {
    const early = await api(h, 'POST', '/v1/conversations', {
      token: gloriaNet.accessToken,
      body: { kind: 'dm', memberIds: [priyaNet.user.userId] },
    });
    expect(early.status).toBe(403);

    const sock = await connect(h, priyaNet.accessToken);
    const event = nextEvent(sock, 'network:changed', (e) => e.scope === 'requests');
    const sent = await api<{ requestId: string; direction: string }>(h, 'POST', '/v1/network/requests', {
      token: gloriaNet.accessToken,
      body: { ...act(), toUserId: priyaNet.user.userId, message: 'Panel partnership?' },
    });
    expect(sent.status).toBe(201);
    expect(sent.body.direction).toBe('outgoing');
    expect((await event).scope).toBe('requests');
    // Replaying the same request is harmless.
    const dup = await api<{ requestId: string }>(h, 'POST', '/v1/network/requests', {
      token: gloriaNet.accessToken,
      body: { clientActionId: uuidv7(), toUserId: priyaNet.user.userId },
    });
    expect(dup.body.requestId).toBe(sent.body.requestId);

    const inbox = await api<{ incoming: { requestId: string; message: string }[] }>(h, 'GET', '/v1/network/requests', { token: priyaNet.accessToken });
    expect(inbox.body.incoming[0]?.message).toBe('Panel partnership?');
    const accept = { ...act(), accept: true, circle: 'business' };
    const ok = await api<{ person: { userId: string } }>(h, 'POST', `/v1/network/requests/${sent.body.requestId}/respond`, { token: priyaNet.accessToken, body: accept });
    expect(ok.body.person.userId).toBe(gloriaNet.user.userId);
    const replay = await api<{ person: { userId: string } }>(h, 'POST', `/v1/network/requests/${sent.body.requestId}/respond`, { token: priyaNet.accessToken, body: accept });
    expect(replay.body).toEqual(ok.body);

    const dm = await api<{ conversationId: string }>(h, 'POST', '/v1/conversations', {
      token: gloriaNet.accessToken,
      body: { kind: 'dm', memberIds: [priyaNet.user.userId] },
    });
    expect(dm.status).toBe(201);
    const msg = await api(h, 'POST', `/v1/conversations/${dm.body.conversationId}/messages`, {
      token: gloriaNet.accessToken,
      body: { conversationId: dm.body.conversationId, clientMessageId: uuidv7(), content: { text: 'Hello from Globex', mentions: [] } },
    });
    expect(msg.status).toBe(200);

    // The directory shows connections only, without email addresses.
    const dir = await api<{ userId: string; email: string }[]>(h, 'GET', '/v1/users', { token: gloriaNet.accessToken });
    expect(dir.body.map((u) => u.userId).sort()).toEqual([gloriaNet.user.userId, priyaNet.user.userId].sort());
    expect(dir.body.find((u) => u.userId === priyaNet.user.userId)?.email).toBe('');
    // The organization's own data is untouched: Globex's directory has no Acme people.
    const orgDir = await api<{ userId: string }[]>(h, 'GET', '/v1/users', { token: globex.session.accessToken });
    expect(orgDir.body).toHaveLength(1);
    sock.disconnect();
  });

  it('blocking ends the connection and stops messages', async () => {
    const dm = await api<{ conversationId: string }>(h, 'POST', '/v1/conversations', {
      token: gloriaNet.accessToken,
      body: { kind: 'dm', memberIds: [priyaNet.user.userId] },
    });
    await api(h, 'PUT', `/v1/network/blocks/${gloriaNet.user.userId}`, { token: priyaNet.accessToken });
    const send = await api(h, 'POST', `/v1/conversations/${dm.body.conversationId}/messages`, {
      token: gloriaNet.accessToken,
      body: { conversationId: dm.body.conversationId, clientMessageId: uuidv7(), content: { text: 'still there?', mentions: [] } },
    });
    expect(send.status).toBe(403);
    const conns = await api<unknown[]>(h, 'GET', '/v1/network/connections', { token: gloriaNet.accessToken });
    expect(conns.body).toHaveLength(0);
    const search = await api<unknown[]>(h, 'GET', '/v1/network/search?q=Priya', { token: gloriaNet.accessToken });
    expect(search.body).toHaveLength(0);
    await api(h, 'DELETE', `/v1/network/blocks/${gloriaNet.user.userId}`, { token: priyaNet.accessToken });
    const report = await api(h, 'POST', '/v1/network/reports', {
      token: priyaNet.accessToken,
      body: { ...act(), targetType: 'user', targetId: gloriaNet.user.userId, reason: 'spam' },
    });
    expect(report.status).toBe(201);
    await connectPair(gloriaNet, priyaNet);
  });
});

describe('organization policy', () => {
  it('admins can restrict connections to approved domains, or turn the network off', async () => {
    const base = { enabled: true, connectWith: 'allowlist', allowedDomains: ['partner.example'], allowPersonalAccounts: true, allowCommunities: true, allowStatus: true };
    const set = await api(h, 'PUT', '/v1/admin/network', { token: globex.session.accessToken, body: base });
    expect(set.status).toBe(200);
    const member = await api(h, 'PUT', '/v1/admin/network', { token: ravi.accessToken, body: base });
    expect(member.status).toBe(403);
    const req = await api(h, 'POST', '/v1/network/requests', { token: raviNet.accessToken, body: { ...act(), toUserId: gloriaNet.user.userId } });
    expect(req.status).toBe(403);

    await api(h, 'PUT', '/v1/admin/network', { token: globex.session.accessToken, body: { ...base, enabled: false } });
    const blocked = await api(h, 'GET', '/v1/network/me', { token: gloriaNet.accessToken });
    expect(blocked.status).toBe(403);
    const linkStatus = await api<{ allowed: boolean }>(h, 'GET', '/v1/network/link', { token: globex.session.accessToken });
    expect(linkStatus.body.allowed).toBe(false);
    const view = await api<{ linkedMembers: number }>(h, 'GET', '/v1/admin/network', { token: globex.session.accessToken });
    expect(view.body.linkedMembers).toBe(1);
    await api(h, 'PUT', '/v1/admin/network', { token: globex.session.accessToken, body: { ...base, connectWith: 'anyone', allowedDomains: [] } });
    const back = await api(h, 'GET', '/v1/network/me', { token: gloriaNet.accessToken });
    expect(back.status).toBe(200);
    const audit = await api<{ items: { action: string }[] }>(h, 'GET', '/v1/admin/audit?limit=200', { token: globex.session.accessToken });
    const actions = JSON.stringify(audit.body);
    expect(actions).toContain('network.policy_updated');
    expect(actions).toContain('network.request_sent');
  });
});

describe('invites and personal accounts', () => {
  it('an invited person signs up for free and is connected straight away', async () => {
    const inv = await api<{ url: string; channel: string; smsUrl: string | null }>(h, 'POST', '/v1/network/invites', {
      token: raviNet.accessToken,
      body: { ...act(), channel: 'sms', phone: '+44 7700 900123', name: 'Meera' },
    });
    expect(inv.status).toBe(201);
    expect(inv.body.smsUrl).toMatch(/^sms:\+447700900123/);
    const token = inv.body.url.split('/').pop()!;
    const preview = await api<{ inviter: { displayName: string }; valid: boolean }>(h, 'GET', `/v1/network/public/invites/${token}`);
    expect(preview.body.inviter.displayName).toBe('Ravi Kumar');
    const signup = await api<Session>(h, 'POST', '/v1/network/public/signup', {
      body: { displayName: 'Meera Shah', email: 'meera@gmail.example', password: 'a long personal password', inviteToken: token, device: device() },
    });
    expect(signup.status).toBe(201);
    const conns = await api<{ person: { displayName: string; kind: string } }[]>(h, 'GET', '/v1/network/connections', { token: signup.body.accessToken });
    expect(conns.body.map((c) => c.person.displayName)).toEqual(['Ravi Kumar']);
    // Personal accounts sign in with the normal login and the network address.
    const login = await api<Session>(h, 'POST', '/v1/auth/login', {
      body: { tenantSlug: 'sampledge-network', email: 'meera@gmail.example', password: 'a long personal password', device: device() },
    });
    expect(login.status).toBe(200);
    // Email invites report when no mail server is set up.
    const email = await api<{ delivery: string }>(h, 'POST', '/v1/network/invites', {
      token: raviNet.accessToken,
      body: { ...act(), channel: 'email', email: 'someone@else.example' },
    });
    expect(email.body.delivery).toBe('not_configured');
  });
});

describe('follows and status updates', () => {
  it('shows statuses to the chosen audience, records views and sends private replies', async () => {
    // Ravi follows Priya (same org, not connected).
    expect((await api(h, 'PUT', `/v1/network/follows/user/${priyaNet.user.userId}`, { token: raviNet.accessToken })).status).toBe(204);
    const connectionsOnly = await api<{ statusId: string }>(h, 'POST', '/v1/network/statuses', {
      token: priyaNet.accessToken,
      body: { clientStatusId: uuidv7(), kind: 'text', text: 'Fieldwork closes Friday', audience: 'connections' },
    });
    expect(connectionsOnly.status).toBe(201);
    const forFollowers = await api<{ statusId: string; expiresAt: string; createdAt: string }>(h, 'POST', '/v1/network/statuses', {
      token: priyaNet.accessToken,
      body: { clientStatusId: uuidv7(), kind: 'text', text: 'Speaking at Quirk’s London', audience: 'followers', expiresInHours: 48 },
    });
    expect(new Date(forFollowers.body.expiresAt).getTime() - new Date(forFollowers.body.createdAt).getTime()).toBe(48 * 3_600_000);

    const raviFeed = await api<{ people: { statuses: { text: string }[] }[] }>(h, 'GET', '/v1/network/statuses', { token: raviNet.accessToken });
    expect(raviFeed.body.people.flatMap((p) => p.statuses.map((s) => s.text))).toEqual(['Speaking at Quirk’s London']);
    const gloriaFeed = await api<{ people: { statuses: { text: string }[]; unseen: number }[] }>(h, 'GET', '/v1/network/statuses', { token: gloriaNet.accessToken });
    expect(gloriaFeed.body.people[0]?.statuses).toHaveLength(2);
    expect(gloriaFeed.body.people[0]?.unseen).toBe(2);

    await api(h, 'PUT', `/v1/network/statuses/${connectionsOnly.body.statusId}/view`, { token: gloriaNet.accessToken });
    const viewers = await api<{ person: { userId: string } }[]>(h, 'GET', `/v1/network/statuses/${connectionsOnly.body.statusId}/viewers`, { token: priyaNet.accessToken });
    expect(viewers.body.map((v) => v.person.userId)).toEqual([gloriaNet.user.userId]);
    // Ravi can't see it at all.
    expect((await api(h, 'PUT', `/v1/network/statuses/${connectionsOnly.body.statusId}/view`, { token: raviNet.accessToken })).status).toBe(404);

    const reply = await api<{ message: { conversationId: string; content: { text: string } } }>(h, 'POST', `/v1/network/statuses/${connectionsOnly.body.statusId}/reply`, {
      token: gloriaNet.accessToken,
      body: { clientMessageId: uuidv7(), text: 'Good luck!' },
    });
    expect(reply.status).toBe(201);
    expect(reply.body.message.content.text).toContain('Replying to your status');
    // Followers who aren't connected can view but not reply.
    const r2 = await api(h, 'POST', `/v1/network/statuses/${forFollowers.body.statusId}/reply`, {
      token: raviNet.accessToken,
      body: { clientMessageId: uuidv7(), text: 'Nice' },
    });
    expect(r2.status).toBe(403);
  });

  it('public profiles and public statuses are visible without an account', async () => {
    await api(h, 'PATCH', '/v1/network/me', { token: priyaNet.accessToken, body: { privacy: { profileVisibility: 'public' } } });
    await api(h, 'POST', '/v1/network/statuses', {
      token: priyaNet.accessToken,
      body: { clientStatusId: uuidv7(), kind: 'text', text: 'Hiring panel managers', audience: 'public' },
    });
    const me = await api<{ handle: string; publicUrl: string }>(h, 'GET', '/v1/network/me', { token: priyaNet.accessToken });
    expect(me.body.publicUrl).toContain(`/n/${me.body.handle}`);
    const pub = await api<{ statuses: { text: string }[]; profile: { counts: { followers: number } } }>(h, 'GET', `/v1/network/public/profiles/${me.body.handle}`);
    expect(pub.status).toBe(200);
    expect(pub.body.statuses.map((s) => s.text)).toEqual(['Hiring panel managers']);
    expect(pub.body.profile.counts.followers).toBe(1);
    // Following from a public page: sign up and follow in one step.
    const s = await api<Session>(h, 'POST', '/v1/network/public/signup', {
      body: { displayName: 'Sam Visitor', email: 'sam@visitor.example', password: 'another long password', follow: { type: 'user', id: priyaNet.user.userId }, device: device() },
    });
    const f = await api<{ following: { person: { userId: string } }[] }>(h, 'GET', '/v1/network/follows', { token: s.body.accessToken });
    expect(f.body.following.map((x) => x.person.userId)).toEqual([priyaNet.user.userId]);
  });
});

describe('communities', () => {
  it('create, join, approve, invite links, roles, moderation and public pages', async () => {
    const c = await api<{ communityId: string; slug: string; groups: { conversationId: string; kind: string; name: string }[]; myRole: string }>(h, 'POST', '/v1/network/communities', {
      token: priyaNet.accessToken,
      body: { ...act(), name: 'Market Research Leaders', description: 'Insights people across agencies', visibility: 'public', joinPolicy: 'open' },
    });
    expect(c.status).toBe(201);
    expect(c.body.myRole).toBe('owner');
    expect(c.body.groups.map((g) => g.kind)).toEqual(['announcements', 'group']);
    const ann = c.body.groups[0]!.conversationId;

    const joined = await api<{ myStatus: string; groups: { joined: boolean }[] }>(h, 'POST', `/v1/network/communities/${c.body.communityId}/join`, { token: gloriaNet.accessToken });
    expect(joined.body.myStatus).toBe('member');
    expect(joined.body.groups.every((g) => g.joined)).toBe(true);
    // Members can't post in announcements; the owner can.
    const memberPost = await api(h, 'POST', `/v1/conversations/${ann}/messages`, {
      token: gloriaNet.accessToken,
      body: { conversationId: ann, clientMessageId: uuidv7(), content: { text: 'hi all', mentions: [] } },
    });
    expect(memberPost.status).toBe(403);
    await api(h, 'POST', `/v1/conversations/${ann}/messages`, {
      token: priyaNet.accessToken,
      body: { conversationId: ann, clientMessageId: uuidv7(), content: { text: 'Welcome to MRL!', mentions: [] } },
    });
    const page = await api<{ announcements: { text: string }[]; community: { memberCount: number } }>(h, 'GET', `/v1/network/public/communities/${c.body.slug}`);
    expect(page.body.announcements.map((a) => a.text)).toEqual(['Welcome to MRL!']);
    expect(page.body.community.memberCount).toBe(2);

    // Private, approval-only group via a moderator.
    await api(h, 'PUT', `/v1/network/communities/${c.body.communityId}/members/${gloriaNet.user.userId}/role`, {
      token: priyaNet.accessToken,
      body: { ...act(), role: 'moderator' },
    });
    const grp = await api<{ groups: { name: string; access: string }[] }>(h, 'POST', `/v1/network/communities/${c.body.communityId}/groups`, {
      token: gloriaNet.accessToken,
      body: { ...act(), name: 'Panel quality', access: 'private' },
    });
    expect(grp.body.groups.map((g) => g.name)).toContain('Panel quality');

    // Switch to approval: Ravi asks, a moderator approves.
    await api(h, 'PATCH', `/v1/network/communities/${c.body.communityId}`, { token: priyaNet.accessToken, body: { ...act(), joinPolicy: 'approval' } });
    const pending = await api<{ myStatus: string }>(h, 'POST', `/v1/network/communities/${c.body.communityId}/join`, { token: raviNet.accessToken });
    expect(pending.body.myStatus).toBe('pending');
    expect((await api(h, 'POST', `/v1/network/communities/${c.body.communityId}/members/${raviNet.user.userId}/approve`, { token: gloriaNet.accessToken })).status).toBe(204);
    const members = await api<{ person: { userId: string }; role: string }[]>(h, 'GET', `/v1/network/communities/${c.body.communityId}/members`, { token: raviNet.accessToken });
    expect(members.body.map((m) => m.role)).toEqual(['owner', 'moderator', 'member']);

    // Invite link for a private community.
    const priv = await api<{ communityId: string }>(h, 'POST', '/v1/network/communities', {
      token: priyaNet.accessToken,
      body: { ...act(), name: 'Acme alumni', visibility: 'private' },
    });
    expect((await api(h, 'GET', `/v1/network/communities/${priv.body.communityId}`, { token: raviNet.accessToken })).status).toBe(404);
    const link = await api<{ url: string }>(h, 'POST', `/v1/network/communities/${priv.body.communityId}/links`, {
      token: priyaNet.accessToken,
      body: { ...act(), maxUses: 1 },
    });
    const token = link.body.url.split('/').pop()!;
    expect((await api(h, 'POST', `/v1/network/community-links/${token}/join`, { token: raviNet.accessToken })).status).toBe(200);
    expect((await api(h, 'POST', `/v1/network/community-links/${token}/join`, { token: gloriaNet.accessToken })).status).toBe(404);

    // Ban removes access to every group.
    expect((await api(h, 'DELETE', `/v1/network/communities/${c.body.communityId}/members/${raviNet.user.userId}?ban=true`, { token: priyaNet.accessToken })).status).toBe(204);
    const gone = await api(h, 'GET', `/v1/conversations/${ann}`, { token: raviNet.accessToken });
    expect(gone.status).toBe(404);
    expect((await api(h, 'POST', `/v1/network/communities/${c.body.communityId}/join`, { token: raviNet.accessToken })).status).toBe(404);

    // Follow a community without joining.
    expect((await api(h, 'PUT', `/v1/network/follows/community/${c.body.communityId}`, { token: raviNet.accessToken })).status).toBe(404);
    const discover = await api<{ name: string }[]>(h, 'GET', '/v1/network/communities/discover?q=market', { token: gloriaNet.accessToken });
    expect(discover.body.map((x) => x.name)).toEqual(['Market Research Leaders']);
  });
});
