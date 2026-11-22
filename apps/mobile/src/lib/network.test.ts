import { describe, expect, it } from 'vitest';
import type {
  Community,
  CommunityMember,
  MyNetworkProfile,
  NetworkPerson,
  Relationship,
} from '@sampledge/contracts';
import {
  localCommunityById,
  pendingFor,
  pendingInvites,
  withPendingCommunities,
  withPendingCommunity,
  withPendingLinks,
  withPendingMembers,
  personLine,
  timeLeft,
  withPendingConnections,
  withPendingFeed,
  withPendingProfile,
  withPendingRelationship,
  withPendingRequests,
  type PendingNet,
} from './network';
import { networkAllows, pathInScopes } from './networkSpace';

const person = (userId: string, name = 'Maria Lopez'): NetworkPerson => ({
  userId,
  handle: name.toLowerCase().replace(' ', '.'),
  displayName: name,
  headline: '',
  kind: 'work',
  organizationName: 'Globex',
  avatarColor: '#888',
});
const none: Relationship = {
  connection: 'none',
  requestId: null,
  circle: null,
  following: false,
  followsYou: false,
  blocked: false,
  canRequest: true,
  canFollow: true,
  canMessage: false,
};
const act = (method: PendingNet['method'], path: string, body?: unknown): PendingNet => ({
  kind: 'net.act',
  method,
  path,
  body,
  label: 'x',
  scopes: [],
});

describe('SampConnect Network on the phone', () => {
  it('shows a relationship as it will be once queued changes land', () => {
    const u = 'a'.repeat(24);
    let r = withPendingRelationship(u, none, [
      act('POST', '/v1/network/requests', { toUserId: u, circle: 'friends' }),
      act('PUT', `/v1/network/follows/user/${u}`),
    ]);
    expect(r).toMatchObject({ connection: 'outgoing', following: true, canRequest: false });
    r = withPendingRelationship(u, { ...none, connection: 'incoming', requestId: 'r1' }, [
      act('POST', '/v1/network/requests/r1/respond', { accept: true, circle: 'friends' }),
    ]);
    expect(r).toMatchObject({ connection: 'connected', circle: 'friends', canMessage: true });
    // A request found through the requests list when the relationship has no id.
    r = withPendingRelationship(
      u,
      { ...none, connection: 'incoming' },
      [act('POST', '/v1/network/requests/r2/respond', { accept: false })],
      new Map([['r2', u]]),
    );
    expect(r.connection).toBe('none');
    r = withPendingRelationship(u, { ...none, connection: 'connected', circle: 'business' }, [
      act('PUT', `/v1/network/blocks/${u}`),
    ]);
    expect(r).toMatchObject({ blocked: true, connection: 'none', following: false });
    // Someone else's changes don't touch this person.
    expect(
      withPendingRelationship(u, none, [act('PUT', '/v1/network/follows/user/other')]),
    ).toEqual(none);
  });

  it('lays queued answers, withdrawals and new requests over the lists', () => {
    const m = person('m1');
    const j = person('j1', 'Jo Kim');
    const lists = {
      incoming: [
        {
          requestId: 'r1',
          direction: 'incoming' as const,
          person: m,
          message: '',
          circle: 'business' as const,
          status: 'pending' as const,
          createdAt: '',
        },
      ],
      outgoing: [
        {
          requestId: 'r2',
          direction: 'outgoing' as const,
          person: j,
          message: '',
          circle: 'friends' as const,
          status: 'pending' as const,
          createdAt: '',
        },
      ],
    };
    const out = withPendingRequests(
      lists,
      [
        act('POST', '/v1/network/requests/r1/respond', { accept: true }),
        act('DELETE', '/v1/network/requests/r2'),
        act('POST', '/v1/network/requests', { toUserId: 'z1', clientActionId: 'c1' }),
      ],
      new Map([['z1', person('z1', 'Zed Ray')]]),
    );
    expect(out.incoming).toEqual([]);
    expect(out.outgoing.map((r) => [r.requestId, r.person.displayName])).toEqual([
      ['local:c1', 'Zed Ray'],
    ]);

    const conns = withPendingConnections(
      [
        { person: m, circle: 'business', connectedAt: '' },
        { person: j, circle: 'business', connectedAt: '' },
      ],
      [
        act('PUT', '/v1/network/connections/m1/circle', { circle: 'friends' }),
        act('DELETE', '/v1/network/connections/j1'),
      ],
    );
    expect(conns.map((c) => [c.person.userId, c.circle])).toEqual([['m1', 'friends']]);
    expect(pendingFor('m1', [act('PUT', '/v1/network/connections/m1/circle')])).toBe(true);
    expect(personLine(m)).toBe('@maria.lopez · Globex');
  });

  it('merges profile and privacy edits still waiting', () => {
    const me = {
      ...person('me'),
      bio: '',
      counts: { connections: 0, followers: 0, following: 0 },
      publicUrl: null,
      email: null,
      phone: null,
      home: null,
      privacy: { discoverableByName: true, allowFollowers: true },
    } as unknown as MyNetworkProfile;
    const out = withPendingProfile(me, [
      act('PATCH', '/v1/network/me', { headline: 'Partnerships' }),
      act('PATCH', '/v1/network/me', { privacy: { allowFollowers: false } }),
    ]);
    expect(out.headline).toBe('Partnerships');
    expect(out.privacy).toMatchObject({ discoverableByName: true, allowFollowers: false });
  });

  it('knows what the network space may call and which lists a change touches', () => {
    expect(networkAllows('GET', '/v1/network/me')).toBe(true);
    expect(networkAllows('POST', '/v1/conversations/x/messages')).toBe(true);
    expect(networkAllows('GET', '/v1/users?x=1')).toBe(true);
    expect(networkAllows('PATCH', '/v1/users/u1')).toBe(false);
    expect(networkAllows('GET', '/v1/tasks?scope=mine')).toBe(false);
    expect(networkAllows('GET', '/v1/meetings')).toBe(false);
    expect(networkAllows('GET', '/v1/ai/status')).toBe(false);
    expect(pathInScopes('/v1/network/people/u1', ['blocks'])).toBe(true);
    expect(pathInScopes('/v1/network/invites', ['requests'])).toBe(false);
  });

  it('shows statuses posted, deleted and seen here before the server knows', () => {
    const me = person('me', 'Sam Okafor');
    const m = person('m1');
    const st = (id: string, viewedByMe = false) => ({
      statusId: id,
      clientStatusId: `c-${id}`,
      author: m,
      kind: 'text' as const,
      text: id,
      background: 'ocean' as const,
      media: null,
      audience: 'connections' as const,
      allowReplies: true,
      createdAt: '',
      expiresAt: '',
      viewedByMe,
      viewCount: null,
    });
    const feed = {
      mine: [{ ...st('s0', true), author: me, clientStatusId: 'mine-0' }],
      people: [
        { person: person('j1', 'Jo Kim'), statuses: [st('j', true)], unseen: 0 },
        { person: m, statuses: [st('a'), st('b')], unseen: 2 },
      ],
    };
    const now = Date.parse('2026-11-22T10:00:00Z');
    const out = withPendingFeed(
      feed,
      [
        act('DELETE', '/v1/network/statuses/s0'),
        {
          ...act('POST', '/v1/network/statuses', {
            clientStatusId: 'new1',
            kind: 'image',
            expiresInHours: 6,
          }),
          media: {
            localUri: 'file:///p.jpg',
            fileName: 'p.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 9,
          },
        },
        act('PUT', '/v1/network/statuses/a/view'),
      ],
      me,
      now,
    );
    expect(out.mine.map((s) => [s.statusId, s.media?.url])).toEqual([
      ['local:new1', 'file:///p.jpg'],
    ]);
    expect(timeLeft(out.mine[0]!.expiresAt, now)).toBe('6h left');
    expect(out.people.map((g) => [g.person.userId, g.unseen])).toEqual([
      ['m1', 1],
      ['j1', 0],
    ]);
    // Once the server has it, the local copy goes.
    const posted = withPendingFeed(
      { ...feed, mine: [{ ...st('srv'), author: me, clientStatusId: 'new1' }] },
      [act('POST', '/v1/network/statuses', { clientStatusId: 'new1' })],
      me,
    );
    expect(posted.mine.map((s) => s.statusId)).toEqual(['srv']);
  });
});

const community = (over: Partial<Community> = {}): Community => ({
  communityId: 'c1',
  slug: 'mr-leaders',
  name: 'MR Leaders',
  description: '',
  rules: '',
  visibility: 'public',
  joinPolicy: 'open',
  memberCount: 3,
  followerCount: 0,
  avatarColor: '#123456',
  createdAt: '2026-11-01T00:00:00.000Z',
  myRole: null,
  myStatus: null,
  following: false,
  groups: [],
  publicUrl: null,
  ...over,
});

describe('communities offline', () => {
  const base = '/v1/network/communities/c1';
  it('joins at once, or asks when approval is needed, and follows', () => {
    const j = withPendingCommunity(community(), [
      act('POST', `${base}/join`),
      act('PUT', '/v1/network/follows/community/c1'),
    ]);
    expect(j).toMatchObject({
      myStatus: 'member',
      myRole: 'member',
      memberCount: 4,
      following: true,
    });
    const ask = withPendingCommunity(community({ joinPolicy: 'approval' }), [
      act('POST', `${base}/join`),
    ]);
    expect(ask.myStatus).toBe('pending');
    const invited = withPendingCommunity(
      community({ joinPolicy: 'approval', myStatus: 'invited' }),
      [act('POST', `${base}/join`)],
    );
    expect(invited.myStatus).toBe('member');
  });

  it('leaves, edits settings, and adds or joins groups', () => {
    const g = {
      conversationId: 'g1',
      name: 'General',
      topic: '',
      kind: 'group' as const,
      access: 'open' as const,
      announcementsOnly: false,
      memberCount: 2,
      joined: false,
    };
    const mine = community({ myStatus: 'member', myRole: 'admin', groups: [g] });
    const c = withPendingCommunity(mine, [
      act('PATCH', base, { clientActionId: 'a', name: 'Leaders', joinPolicy: 'approval' }),
      act('POST', `${base}/groups/g1/join`),
      act('POST', `${base}/groups`, { clientActionId: 'n1', name: 'Panels', access: 'private' }),
    ]);
    expect(c.name).toBe('Leaders');
    expect(c.joinPolicy).toBe('approval');
    expect(c.groups[0]).toMatchObject({ joined: true, memberCount: 3 });
    expect(c.groups[1]).toMatchObject({
      conversationId: 'local:n1',
      name: 'Panels',
      access: 'private',
    });
    const left = withPendingCommunities([mine], [act('POST', `${base}/leave`)]);
    expect(left).toEqual([]);
  });

  it('shows a community made offline first, and can open it', () => {
    const p = [
      act('POST', '/v1/network/communities', { clientActionId: 'x1', name: 'Panel partners' }),
    ];
    const list = withPendingCommunities([community({ myStatus: 'member' })], p);
    expect(list.map((c) => c.communityId)).toEqual(['local:x1', 'c1']);
    expect(localCommunityById('local:x1', p)).toMatchObject({
      myRole: 'owner',
      name: 'Panel partners',
    });
  });

  it('approves, denies, changes roles, removes, bans and unbans members', () => {
    const m = (id: string, status: CommunityMember['status'] = 'active'): CommunityMember => ({
      person: person(id),
      role: 'member',
      status,
      joinedAt: '2026-11-01T00:00:00.000Z',
    });
    const out = withPendingMembers(
      'c1',
      [m('a', 'pending'), m('b', 'pending'), m('c'), m('d'), m('e'), m('f', 'banned')],
      [
        act('POST', `${base}/members/a/approve`),
        act('POST', `${base}/members/b/deny`),
        act('PUT', `${base}/members/c/role`, { role: 'moderator' }),
        act('DELETE', `${base}/members/d`),
        act('DELETE', `${base}/members/e?ban=true`),
        act('DELETE', `${base}/bans/f`),
      ],
    );
    expect(out.map((x) => [x.person.userId, x.status, x.role])).toEqual([
      ['a', 'active', 'member'],
      ['c', 'active', 'moderator'],
      ['e', 'banned', 'member'],
    ]);
  });

  it('shows new links as queued, revokes, and remembers invites', () => {
    const links = withPendingLinks(
      'c1',
      [{ linkId: 'l1', url: 'u', expiresAt: null, maxUses: null, uses: 0, revoked: false }],
      [act('POST', `${base}/links`, { clientActionId: 'k' }), act('DELETE', `${base}/links/l1`)],
    );
    expect(links.map((l) => [l.linkId, l.revoked, !!l.queued])).toEqual([
      ['local:k', false, true],
      ['l1', true, false],
    ]);
    expect([
      ...pendingInvites('c1', [act('POST', `${base}/invite`, { userIds: ['u1', 'u2'] })]),
    ]).toEqual(['u1', 'u2']);
  });
});
