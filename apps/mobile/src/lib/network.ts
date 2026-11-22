import type {
  Circle,
  Community,
  CommunityGroup,
  CommunityInviteLink,
  CommunityMember,
  Connection,
  ConnectionRequest,
  MyNetworkProfile,
  NetworkPerson,
  NetworkStatus,
  Relationship,
  StatusFeed,
} from '@sampledge/contracts';
import type { ActionInput } from '../db/work';

/** A SampConnect Network change waiting on this device (see ConnectEngine.netAct). */
export type PendingNet = Extract<ActionInput, { kind: 'net.act' }>;

export const CIRCLE_LABEL: Record<Circle, string> = { business: 'Business', friends: 'Friends' };

const userIn = (path: string, re: RegExp): string | null => re.exec(path)?.[1] ?? null;

/**
 * Your relationship with someone as it will be once your waiting changes land, so a tap shows
 * at once, offline too. The server's copy wins again after each change is sent or refused.
 */
export function withPendingRelationship(
  userId: string,
  r: Relationship,
  pending: readonly PendingNet[],
  requestsById: ReadonlyMap<string, string> = new Map(),
): Relationship {
  let out = { ...r };
  for (const p of pending) {
    const body = (p.body ?? {}) as Record<string, unknown>;
    if (userIn(p.path, /^\/v1\/network\/follows\/user\/([^/?]+)$/) === userId)
      out = { ...out, following: p.method === 'PUT' };
    else if (userIn(p.path, /^\/v1\/network\/blocks\/([^/?]+)$/) === userId)
      out =
        p.method === 'PUT'
          ? {
              ...out,
              blocked: true,
              connection: 'none',
              requestId: null,
              circle: null,
              following: false,
              canMessage: false,
              canRequest: false,
            }
          : { ...out, blocked: false };
    else if (p.path === '/v1/network/requests' && p.method === 'POST' && body.toUserId === userId)
      out = { ...out, connection: 'outgoing', canRequest: false };
    else if (userIn(p.path, /^\/v1\/network\/connections\/([^/?]+)$/) === userId)
      out = { ...out, connection: 'none', circle: null, canMessage: false };
    else if (userIn(p.path, /^\/v1\/network\/connections\/([^/?]+)\/circle$/) === userId)
      out = { ...out, circle: (body.circle as Circle) ?? out.circle };
    else {
      const responded = userIn(p.path, /^\/v1\/network\/requests\/([^/?]+)\/respond$/);
      const withdrawn =
        p.method === 'DELETE' && userIn(p.path, /^\/v1\/network\/requests\/([^/?]+)$/);
      const rid = responded ?? withdrawn;
      if (rid && (rid === out.requestId || requestsById.get(rid) === userId)) {
        out =
          responded && body.accept
            ? {
                ...out,
                connection: 'connected',
                requestId: null,
                circle: (body.circle as Circle) ?? 'business',
                canMessage: true,
              }
            : { ...out, connection: 'none', requestId: null };
      }
    }
  }
  return out;
}

/** Requests with the ones you answered or withdrew here taken out (and new ones you sent added). */
export function withPendingRequests(
  lists: { incoming: ConnectionRequest[]; outgoing: ConnectionRequest[] },
  pending: readonly PendingNet[],
  people: ReadonlyMap<string, NetworkPerson> = new Map(),
): { incoming: ConnectionRequest[]; outgoing: ConnectionRequest[] } {
  const gone = new Set<string>();
  const blocked = new Set<string>();
  const sent: ConnectionRequest[] = [];
  for (const p of pending) {
    const rid =
      userIn(p.path, /^\/v1\/network\/requests\/([^/?]+)\/respond$/) ??
      (p.method === 'DELETE' ? userIn(p.path, /^\/v1\/network\/requests\/([^/?]+)$/) : null);
    if (rid) gone.add(rid);
    const b = p.method === 'PUT' ? userIn(p.path, /^\/v1\/network\/blocks\/([^/?]+)$/) : null;
    if (b) blocked.add(b);
    const body = (p.body ?? {}) as Record<string, unknown>;
    if (p.path === '/v1/network/requests' && p.method === 'POST') {
      const person = people.get(String(body.toUserId));
      if (person)
        sent.push({
          requestId: `local:${String(body.clientActionId)}`,
          direction: 'outgoing',
          person,
          message: String(body.message ?? ''),
          circle: (body.circle as Circle) ?? 'business',
          status: 'pending',
          createdAt: new Date().toISOString(),
        });
    }
  }
  const keep = (r: ConnectionRequest) => !gone.has(r.requestId) && !blocked.has(r.person.userId);
  const outgoing = lists.outgoing.filter(keep);
  for (const s of sent)
    if (!outgoing.some((o) => o.person.userId === s.person.userId)) outgoing.unshift(s);
  return { incoming: lists.incoming.filter(keep), outgoing };
}

/** Connections with removals, blocks and circle changes made here laid over. */
export function withPendingConnections(
  list: Connection[],
  pending: readonly PendingNet[],
): Connection[] {
  let out = list;
  for (const p of pending) {
    const body = (p.body ?? {}) as Record<string, unknown>;
    const circleOf = userIn(p.path, /^\/v1\/network\/connections\/([^/?]+)\/circle$/);
    const removed =
      p.method === 'DELETE' ? userIn(p.path, /^\/v1\/network\/connections\/([^/?]+)$/) : null;
    const blocked = p.method === 'PUT' ? userIn(p.path, /^\/v1\/network\/blocks\/([^/?]+)$/) : null;
    if (circleOf)
      out = out.map((c) =>
        c.person.userId === circleOf ? { ...c, circle: (body.circle as Circle) ?? c.circle } : c,
      );
    const gone = removed ?? blocked;
    if (gone) out = out.filter((c) => c.person.userId !== gone);
  }
  return out;
}

/** Whether a waiting change is about this person (for the "Queued" badge). */
export const pendingFor = (userId: string, pending: readonly PendingNet[]): boolean =>
  pending.some(
    (p) =>
      p.path.includes(userId) ||
      ((p.body as Record<string, unknown> | undefined)?.toUserId ?? null) === userId,
  );

/** "@maria.lopez · Globex" */
export function personLine(p: NetworkPerson): string {
  return [`@${p.handle}`, p.organizationName ?? (p.kind === 'personal' ? 'Personal' : null)]
    .filter(Boolean)
    .join(' · ');
}

/** Your network profile with the edits still waiting on this device laid over. */
export function withPendingProfile(
  me: MyNetworkProfile,
  pending: readonly PendingNet[],
): MyNetworkProfile {
  let out = me;
  for (const p of pending) {
    if (p.path !== '/v1/network/me' || p.method !== 'PATCH') continue;
    const { privacy, ...rest } = (p.body ?? {}) as Partial<MyNetworkProfile>;
    out = { ...out, ...rest, privacy: { ...out.privacy, ...privacy } };
  }
  return out;
}

/** "1 connection", "3 followers" */
export const count = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

export const LOCAL_STATUS = 'local:';

/**
 * The status feed with what you did here laid over: statuses you posted (shown from the phone,
 * photo or video included, until they are up), ones you deleted, and ones you have seen.
 */
export function withPendingFeed(
  feed: StatusFeed,
  pending: readonly PendingNet[],
  me: NetworkPerson | null,
  now = Date.now(),
): StatusFeed {
  const deleted = new Set<string>();
  const viewed = new Set<string>();
  const posted: NetworkStatus[] = [];
  for (const p of pending) {
    const id = /^\/v1\/network\/statuses\/([^/?]+)(\/view)?$/.exec(p.path);
    if (id && p.method === 'DELETE' && !id[2]) deleted.add(id[1]!);
    if (id && p.method === 'PUT' && id[2]) viewed.add(id[1]!);
    if (p.path === '/v1/network/statuses' && p.method === 'POST' && me) {
      const b = (p.body ?? {}) as Record<string, unknown>;
      const hours = Number(b.expiresInHours ?? 24);
      posted.push({
        statusId: `${LOCAL_STATUS}${String(b.clientStatusId)}`,
        clientStatusId: String(b.clientStatusId),
        author: me,
        kind: (b.kind as NetworkStatus['kind']) ?? 'text',
        text: String(b.text ?? ''),
        background: (b.background as NetworkStatus['background']) ?? 'ocean',
        media: p.media
          ? {
              attachmentId: '',
              mimeType: p.media.mimeType,
              url: p.media.localUri,
              expiresAt: new Date(now + hours * 3_600_000).toISOString(),
            }
          : null,
        audience: (b.audience as NetworkStatus['audience']) ?? 'connections',
        allowReplies: b.allowReplies !== false,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + hours * 3_600_000).toISOString(),
        viewedByMe: true,
        viewCount: 0,
      });
    }
  }
  const sent = new Set(feed.mine.map((s) => s.clientStatusId));
  const mine = [
    ...feed.mine.filter((s) => !deleted.has(s.statusId)),
    ...posted.filter((s) => !sent.has(s.clientStatusId)),
  ];
  const people = feed.people.map((g) => {
    const statuses = g.statuses.map((s) =>
      viewed.has(s.statusId) ? { ...s, viewedByMe: true } : s,
    );
    return { ...g, statuses, unseen: statuses.filter((s) => !s.viewedByMe).length };
  });
  // Unseen first, as the server orders them.
  people.sort((a, b) => Number(b.unseen > 0) - Number(a.unseen > 0));
  return { mine, people };
}

/** "3h left", "45m left" */
export function timeLeft(expiresAt: string, now = Date.now()): string {
  const ms = Date.parse(expiresAt) - now;
  if (ms <= 0) return 'Expired';
  const h = Math.floor(ms / 3_600_000);
  if (h >= 24) return `${Math.floor(h / 24)}d left`;
  if (h >= 1) return `${h}h left`;
  return `${Math.max(1, Math.round(ms / 60_000))}m left`;
}

export const STATUS_GRADIENT: Record<NetworkStatus['background'], [string, string]> = {
  ocean: ['#1e3a8a', '#5B8CFF'],
  violet: ['#4c1d95', '#8B5CF6'],
  sunset: ['#9a3412', '#f59e0b'],
  emerald: ['#064e3b', '#34D399'],
  graphite: ['#111827', '#4b5563'],
};

export const AUDIENCE_LABEL: Record<NetworkStatus['audience'], string> = {
  connections: 'Connections',
  followers: 'Connections and followers',
  public: 'Everyone',
  selected: 'Only people I pick',
};

// ─── Communities ─────────────────────────────────────────────────────────────

export const LOCAL_COMMUNITY = 'local:';

export const ROLE_LABEL = {
  owner: 'Owner',
  admin: 'Admin',
  moderator: 'Moderator',
  member: 'Member',
} as const;

const C_BASE = /^\/v1\/network\/communities\/([^/?]+)/;
const commOf = (path: string): string | null => C_BASE.exec(path)?.[1] ?? null;
const rest = (path: string, id: string): string =>
  path.slice(`/v1/network/communities/${id}`.length);

/** A community you created here that is not on the server yet. */
function localCommunity(p: PendingNet): Community {
  const b = (p.body ?? {}) as Record<string, unknown>;
  return {
    communityId: `${LOCAL_COMMUNITY}${String(b.clientActionId ?? '')}`,
    slug: '',
    name: String(b.name ?? ''),
    description: String(b.description ?? ''),
    rules: String(b.rules ?? ''),
    visibility: b.visibility === 'private' ? 'private' : 'public',
    joinPolicy: b.joinPolicy === 'approval' ? 'approval' : 'open',
    memberCount: 1,
    followerCount: 0,
    avatarColor: '#6366f1',
    createdAt: new Date().toISOString(),
    myRole: 'owner',
    myStatus: 'member',
    following: false,
    groups: [],
    publicUrl: null,
  };
}

/** Whether a waiting change is about this community (for the "Queued" tag). */
export const pendingForCommunity = (id: string, pending: readonly PendingNet[]): boolean =>
  id.startsWith(LOCAL_COMMUNITY) ||
  pending.some((p) => p.path.endsWith(`/community/${id}`) || commOf(p.path) === id);

/**
 * A community as it will be once your waiting changes land: joining, leaving, following,
 * settings, and groups you made or joined, so a tap shows at once, offline too.
 */
export function withPendingCommunity(c: Community, pending: readonly PendingNet[]): Community {
  let out: Community = { ...c, groups: [...c.groups] };
  for (const p of pending) {
    const b = (p.body ?? {}) as Record<string, unknown>;
    if (p.path === `/v1/network/follows/community/${c.communityId}`) {
      out = { ...out, following: p.method === 'PUT' };
      continue;
    }
    if (commOf(p.path) !== c.communityId) continue;
    const r = rest(p.path, c.communityId);
    if (r === '/join' && out.myStatus !== 'member') {
      const asks = out.joinPolicy === 'approval' && out.myStatus !== 'invited';
      out = asks
        ? { ...out, myStatus: 'pending' }
        : { ...out, myStatus: 'member', myRole: 'member', memberCount: out.memberCount + 1 };
    } else if (r === '/leave' && out.myStatus === 'member') {
      out = {
        ...out,
        myStatus: null,
        myRole: null,
        memberCount: Math.max(0, out.memberCount - 1),
        groups: [],
      };
    } else if (r === '/decline') out = { ...out, myStatus: null };
    else if (r === '' && p.method === 'PATCH') {
      const { clientActionId: _a, ...fields } = b;
      out = { ...out, ...(fields as Partial<Community>) };
    } else if (r === '/groups' && p.method === 'POST') {
      const g: CommunityGroup = {
        conversationId: `${LOCAL_COMMUNITY}${String(b.clientActionId ?? '')}`,
        name: String(b.name ?? ''),
        topic: String(b.topic ?? ''),
        kind: 'group',
        access: b.access === 'private' ? 'private' : 'open',
        announcementsOnly: !!b.announcementsOnly,
        memberCount: 1,
        joined: true,
      };
      out = { ...out, groups: [...out.groups, g] };
    } else {
      const m = /^\/groups\/([^/?]+)(\/join|\/leave)?$/.exec(r);
      if (!m) continue;
      const [, cid, verb] = m;
      if (p.method === 'DELETE' && !verb)
        out = { ...out, groups: out.groups.filter((g) => g.conversationId !== cid) };
      else if (verb)
        out = {
          ...out,
          groups: out.groups.map((g) =>
            g.conversationId !== cid || g.joined === (verb === '/join')
              ? g
              : {
                  ...g,
                  joined: verb === '/join',
                  memberCount: Math.max(0, g.memberCount + (verb === '/join' ? 1 : -1)),
                },
          ),
        };
    }
  }
  return out;
}

/**
 * Your communities with what you did here laid over: ones you created (shown at once with a
 * local id), ones you left taken out, and the rest as `withPendingCommunity` shows them.
 */
export function withPendingCommunities(
  list: readonly Community[],
  pending: readonly PendingNet[],
): Community[] {
  const made = pending
    .filter((p) => p.method === 'POST' && p.path === '/v1/network/communities')
    .map(localCommunity);
  return [...made.reverse(), ...list.map((c) => withPendingCommunity(c, pending))].filter(
    (c) => c.myStatus !== null || c.following,
  );
}

/** A community made here that is still waiting: built from the queue, for its page. */
export function localCommunityById(
  id: string,
  pending: readonly PendingNet[],
): Community | undefined {
  return withPendingCommunities([], pending).find((c) => c.communityId === id);
}

/** Members with your waiting approvals, denials, role changes, removals and bans laid over. */
export function withPendingMembers(
  communityId: string,
  members: readonly CommunityMember[],
  pending: readonly PendingNet[],
): CommunityMember[] {
  let out = [...members];
  for (const p of pending) {
    if (commOf(p.path) !== communityId) continue;
    const r = rest(p.path, communityId);
    const b = (p.body ?? {}) as Record<string, unknown>;
    let m: RegExpExecArray | null;
    if ((m = /^\/members\/([^/?]+)\/(approve|deny)$/.exec(r))) {
      const [, uid, verb] = m;
      out =
        verb === 'approve'
          ? out.map((x) => (x.person.userId === uid ? { ...x, status: 'active' } : x))
          : out.filter((x) => x.person.userId !== uid);
    } else if ((m = /^\/members\/([^/?]+)\/role$/.exec(r))) {
      const uid = m[1];
      const role = b.role as CommunityMember['role'];
      out = out.map((x) => (x.person.userId === uid ? { ...x, role } : x));
    } else if ((m = /^\/members\/([^/?]+)(\?ban=true)?$/.exec(r)) && p.method === 'DELETE') {
      const [, uid, ban] = m;
      out = ban
        ? out.map((x) => (x.person.userId === uid ? { ...x, status: 'banned', role: 'member' } : x))
        : out.filter((x) => x.person.userId !== uid);
    } else if ((m = /^\/bans\/([^/?]+)$/.exec(r)))
      out = out.filter((x) => x.person.userId !== m![1]);
  }
  return out;
}

/** Invite links with your waiting new links and revokes laid over. */
export function withPendingLinks(
  communityId: string,
  links: readonly CommunityInviteLink[],
  pending: readonly PendingNet[],
): (CommunityInviteLink & { queued?: boolean })[] {
  let out: (CommunityInviteLink & { queued?: boolean })[] = [...links];
  for (const p of pending) {
    if (commOf(p.path) !== communityId) continue;
    const r = rest(p.path, communityId);
    if (r === '/links' && p.method === 'POST') {
      const b = (p.body ?? {}) as Record<string, unknown>;
      out = [
        {
          linkId: `${LOCAL_COMMUNITY}${String(b.clientActionId ?? '')}`,
          url: '',
          expiresAt: null,
          maxUses: null,
          uses: 0,
          revoked: false,
          queued: true,
        },
        ...out,
      ];
    } else {
      const m = /^\/links\/([^/?]+)$/.exec(r);
      if (m && p.method === 'DELETE')
        out = out.map((l) => (l.linkId === m[1] ? { ...l, revoked: true } : l));
    }
  }
  return out;
}

/** People you invited here who the server has not heard about yet. */
export function pendingInvites(communityId: string, pending: readonly PendingNet[]): Set<string> {
  const ids = new Set<string>();
  for (const p of pending)
    if (p.path === `/v1/network/communities/${communityId}/invite`)
      for (const u of (p.body as { userIds?: string[] } | undefined)?.userIds ?? []) ids.add(u);
  return ids;
}
