/**
 * Where the API lives. Since issue #128 the API answers under `/api` on the same address as
 * the web app (`https://connect.example.com/api/v1/...`), behind one gateway on port 80.
 * Every REST path in these contracts (`/v1/...`) and every relative URL the API returns is
 * relative to that API base, so join them with `apiUrl` rather than `new URL(path, base)`,
 * which would drop the `/api` prefix.
 */
export const API_PREFIX = '/api';

/** Socket.IO endpoint path on the server. */
export const SOCKET_IO_PATH = `${API_PREFIX}/socket.io`;

/**
 * The API base for a SampConnect address. Accepts the site address people type
 * (`https://connect.example.com`) or the API base itself (`.../api`), with or without a
 * trailing slash, and returns `https://connect.example.com/api`.
 */
export function apiBaseFor(siteOrApiUrl: string): string {
  const trimmed = siteOrApiUrl.trim().replace(/\/+$/, '');
  return trimmed.endsWith(API_PREFIX) ? trimmed : trimmed + API_PREFIX;
}

/**
 * Joins an API path (`/v1/...`) to an API base (`https://x/api`, or `/api` in a browser on
 * the same site). Absolute URLs (`https://...`, `blob:`, `data:`) come back unchanged.
 */
export function apiUrl(base: string, path: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//')) return path;
  return base.replace(/\/+$/, '') + (path.startsWith('/') ? path : `/${path}`);
}

/**
 * Socket.IO treats the path of the URL it is given as a namespace, so `io('https://x/api')`
 * would join namespace `/api`. Split an API base into the origin to connect to and the
 * engine path (`/api/socket.io`). A relative base (`/api`) resolves against `origin`.
 */
export function socketTarget(base: string, origin?: string): { url: string; path: string } {
  const u = new URL(base, origin ?? 'http://localhost');
  const prefix = u.pathname.replace(/\/+$/, '');
  return {
    url: /^[a-z][a-z0-9+.-]*:/i.test(base) ? u.origin : (origin ?? u.origin),
    path: `${prefix}/socket.io`,
  };
}
