import { apiBaseFor } from '@sampledge/contracts';
/**
 * Helpers for single sign-on from the app (docs/sign-in.md, "From the mobile app").
 * The flow itself lives in auth/ssoFlow.ts; these stay pure so they can be tested.
 */

export function base64url(bytes: Uint8Array): string {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += abc[(n >> 18) & 63]! + abc[(n >> 12) & 63]! + abc[(n >> 6) & 63]! + abc[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += abc[(n >> 18) & 63]! + abc[(n >> 12) & 63]!;
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += abc[(n >> 18) & 63]! + abc[(n >> 12) & 63]! + abc[(n >> 6) & 63]!;
  }
  return out;
}

/** A PKCE code verifier: 32 random bytes as base64url (43 characters). */
export function makeVerifier(random: (n: number) => Uint8Array): string {
  return base64url(random(32));
}

/** S256 challenge for a verifier. */
export async function challengeFor(
  verifier: string,
  sha256: (data: Uint8Array) => Promise<Uint8Array>,
): Promise<string> {
  return base64url(await sha256(new TextEncoder().encode(verifier)));
}

export function ssoStartUrl(
  serverUrl: string,
  tenantSlug: string,
  q: {
    returnTo: string;
    codeChallenge: string;
    deviceId: string;
    deviceName: string;
    platform: 'ios' | 'android';
  },
): string {
  const p = new URLSearchParams(q);
  return `${apiBaseFor(serverUrl)}/v1/auth/sso/${encodeURIComponent(tenantSlug)}/start?${p.toString()}`;
}

export type SsoReturn = { code: string } | { error: string };

/** Reads `…#sso=<code>` or `…#sso_error=<message>` from the URL the server sent us back to. */
export function parseSsoReturn(url: string): SsoReturn | null {
  const hash = url.indexOf('#');
  if (hash < 0) return null;
  const p = new URLSearchParams(url.slice(hash + 1));
  const code = p.get('sso');
  if (code) return { code };
  const error = p.get('sso_error');
  if (error) return { error };
  return null;
}
