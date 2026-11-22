import type {
  Circle,
  Connection,
  ConnectionRequest,
  MyNetworkProfile,
  NetworkPerson,
  Relationship,
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
