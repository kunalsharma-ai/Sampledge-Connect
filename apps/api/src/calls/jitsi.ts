import { SignJWT } from 'jose';
import type { IntegrationValues } from '@sampledge/contracts';

/**
 * A self-hosted Jitsi Meet server (deploy/jitsi, `docker compose --profile jitsi`), saved in
 * Integrations → Calls (Jitsi Meet). The API signs a short JWT for every join (prosody's
 * token_verification checks it), so a room can only be opened from SampConnect.
 *
 * Rooms live under a per-organization path, `<server>/<tenantId>/<callId>`. Jitsi passes that
 * path to the branding endpoint (`?conferenceFqn=<tenantId>/<callId>`), which is how every
 * organization sees its own logo and colours on one shared server.
 */
export interface JitsiSettings {
  serverUrl: string;
  appId: string;
  appSecret: string;
  use: 'all' | 'fallback';
}

/** Public Jitsi services that can't verify our tokens or show our branding. */
const PUBLIC_JITSI_HOSTS = /(^|\.)(meet\.jit\.si|8x8\.vc|jitsi\.org)$/i;

export function isPublicJitsi(url: string): boolean {
  try {
    return PUBLIC_JITSI_HOSTS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function jitsiFromValues(v: IntegrationValues): JitsiSettings | null {
  const serverUrl = typeof v.serverUrl === 'string' ? v.serverUrl.trim().replace(/\/+$/, '') : '';
  const appId = typeof v.appId === 'string' ? v.appId.trim() : '';
  const appSecret = typeof v.appSecret === 'string' ? v.appSecret : '';
  if (!serverUrl || !appId || !appSecret || isPublicJitsi(serverUrl)) return null;
  return { serverUrl, appId, appSecret, use: v.use === 'fallback' ? 'fallback' : 'all' };
}

/** Jitsi lowercases room and tenant names; ours are hex ids already, this keeps it certain. */
export const jitsiTenant = (tenantId: string) => tenantId.toLowerCase();
export const jitsiRoom = (callId: string) => callId.toLowerCase();

/**
 * Long enough for a long meeting: prosody checks the token when the connection is made and
 * again if it has to reconnect, so a short token would drop people from long calls.
 */
export const JITSI_TOKEN_TTL_S = 4 * 60 * 60;

export interface JitsiJoinInput {
  tenantId: string;
  callId: string;
  user: { id: string; name: string; avatar?: string | null; email?: string | null };
  moderator: boolean;
  media: 'audio' | 'video';
  /** Shown as the meeting title at the top of the Jitsi page. */
  subject?: string | null;
  ttlSeconds?: number;
}

export async function jitsiJoin(s: JitsiSettings, input: JitsiJoinInput) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (input.ttlSeconds ?? JITSI_TOKEN_TTL_S);
  const tenant = jitsiTenant(input.tenantId);
  const room = jitsiRoom(input.callId);
  const token = await new SignJWT({
    room,
    context: {
      user: {
        id: input.user.id,
        name: input.user.name,
        ...(input.user.avatar ? { avatar: input.user.avatar } : {}),
        ...(input.user.email ? { email: input.user.email } : {}),
        moderator: input.moderator ? 'true' : 'false',
      },
      features: { recording: false, livestreaming: false, transcription: false },
    },
    moderator: input.moderator,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(s.appId)
    .setAudience(s.appId)
    .setSubject(tenant)
    .setIssuedAt(now)
    .setNotBefore(now - 30)
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(s.appSecret));
  return {
    engine: 'jitsi' as const,
    url: jitsiEmbedUrl(s, { tenant, room, token, media: input.media, subject: input.subject }),
    token,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

/**
 * The page the app opens. Overrides go in the hash (Jitsi only accepts whitelisted keys there);
 * `jitsi_meet_external_api_id` makes the page post its events (left the call, ready to close)
 * to the app that embeds it.
 */
export function jitsiEmbedUrl(
  s: JitsiSettings,
  o: {
    tenant: string;
    room: string;
    token: string;
    media: 'audio' | 'video';
    subject?: string | null;
  },
) {
  const hash: Record<string, unknown> = {
    jitsi_meet_external_api_id: 0,
    'config.startWithAudioMuted': false,
    'config.startWithVideoMuted': o.media === 'audio',
    'config.prejoinConfig.enabled': false,
    'config.disableDeepLinking': true,
    'config.disableInviteFunctions': true,
    'config.p2p.enabled': false,
    // SampConnect shows the conversation's name above the frame; Jitsi would show the room id.
    'config.hideConferenceSubject': !o.subject,
    'config.disableThirdPartyRequests': true,
    ...(o.subject ? { 'config.subject': o.subject.slice(0, 80) } : {}),
  };
  const fragment = Object.entries(hash)
    .map(([k, v]) => `${k}=${encodeURIComponent(JSON.stringify(v))}`)
    .join('&');
  return `${s.serverUrl}/${o.tenant}/${o.room}?jwt=${encodeURIComponent(o.token)}#${fragment}`;
}

/** Test connection: the server answers with a Jitsi config that requires sign-in tokens. */
export async function testJitsi(v: IntegrationValues): Promise<{ ok: boolean; message: string }> {
  const raw = typeof v.serverUrl === 'string' ? v.serverUrl.trim().replace(/\/+$/, '') : '';
  if (isPublicJitsi(raw))
    return {
      ok: false,
      message:
        'meet.jit.si is Jitsi’s public server. It can’t check SampConnect sign-ins or show your logo, and anyone could join. Run your own server (docker compose --profile jitsi, see docs/jitsi.md) and enter its address.',
    };
  const s = jitsiFromValues(v);
  if (!s) return { ok: false, message: 'Enter the server URL, app ID and app secret' };
  const res = await fetch(`${s.serverUrl}/config.js`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return { ok: false, message: `${s.serverUrl} answered ${res.status}` };
  const body = await res.text();
  if (!/config\.hosts|hosts\s*:/.test(body))
    return { ok: false, message: `${s.serverUrl} doesn’t look like a Jitsi Meet server` };
  const signIn = /config\.hosts\.anonymousdomain/.test(body)
    ? ' Turn guest access off on it (ENABLE_GUESTS=0) so only signed joins get in.'
    : '';
  return {
    ok: true,
    message: `Jitsi Meet at ${s.serverUrl} is reachable. Joins are signed with the app secret, so a wrong secret shows up as "not allowed" when someone joins.${signIn}`,
  };
}
