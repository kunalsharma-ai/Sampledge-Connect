import type { NetworkChangedEvent } from '@sampledge/contracts';

/**
 * Routes a SampConnect Network session may call (the same list the server's NetworkGate
 * enforces). Everything else is organization-only: in the network space the app doesn't ask
 * for it, and hides the screens that need it.
 */
const ALLOWED: { prefix: string; methods?: string[] }[] = [
  { prefix: '/v1/network' },
  { prefix: '/v1/auth' },
  { prefix: '/v1/me' },
  { prefix: '/v1/users', methods: ['GET'] },
  { prefix: '/v1/devices' },
  { prefix: '/v1/conversations' },
  { prefix: '/v1/messages' },
  { prefix: '/v1/sync' },
  { prefix: '/v1/uploads' },
  { prefix: '/v1/attachments' },
  { prefix: '/v1/calls' },
  { prefix: '/v1/notifications' },
  { prefix: '/v1/push' },
  { prefix: '/v1/bookmarks' },
];

export function networkAllows(method: string, path: string): boolean {
  const p = path.split('?')[0]!;
  return ALLOWED.some(
    (a) =>
      (p === a.prefix || p.startsWith(`${a.prefix}/`)) &&
      (!a.methods || a.methods.includes(method.toUpperCase())),
  );
}

export type NetworkScope = NetworkChangedEvent['scope'];
export const NETWORK_SCOPES: NetworkScope[] = [
  'profile',
  'requests',
  'connections',
  'follows',
  'blocks',
  'statuses',
  'communities',
  'invites',
];

/** Which cached network lists belong to a scope (refetched when the server says it changed). */
const SCOPE_PATHS: Record<NetworkScope, RegExp> = {
  profile: /^\/v1\/network\/(me|people)/,
  requests: /^\/v1\/network\/(requests|search|people)/,
  connections: /^\/v1\/network\/(connections|search|people|requests|statuses)/,
  follows: /^\/v1\/network\/(follows|search|people|statuses)/,
  blocks: /^\/v1\/network\/(blocks|search|people|connections|follows)/,
  statuses: /^\/v1\/network\/statuses/,
  communities: /^\/v1\/network\/communit/,
  invites: /^\/v1\/network\/invites/,
};

export const pathInScopes = (path: string, scopes: readonly NetworkScope[]): boolean =>
  scopes.some((s) => SCOPE_PATHS[s].test(path));
