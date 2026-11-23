import { API_PREFIX, apiUrl } from '@sampledge/contracts';

/**
 * The API base. Since issue #128 the API answers under /api on this same address (the gateway
 * sends /api/** to it), so the default is the relative `/api`: no separate API host and no
 * CORS. Set NEXT_PUBLIC_API_URL only to point a build somewhere else.
 */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || API_PREFIX).replace(/\/+$/, '');

/** A path the API returned (`/v1/...`), or an absolute URL, as a URL the browser can load. */
export const toApiUrl = (path: string) => apiUrl(API_URL, path);

/** The same, always absolute (for addresses people copy into other systems). */
export const absoluteApiUrl = (path: string) =>
  new URL(
    toApiUrl(path),
    typeof window === 'undefined' ? 'http://localhost' : window.location.origin,
  ).toString();
