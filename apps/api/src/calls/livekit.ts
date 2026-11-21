import { createHash, timingSafeEqual } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import type { AppConfig } from '../config/config.js';

/**
 * Minimal client for a self-hosted LiveKit server: join tokens, webhook verification and the
 * three RoomService calls we need. LiveKit tokens are HS256 JWTs signed with the API secret
 * (https://docs.livekit.io/home/get-started/authentication/), so no SDK dependency is needed.
 */
export interface LiveKitSettings {
  publicUrl: string;
  apiUrl: string;
  apiKey: string;
  apiSecret: string;
}

export function liveKitSettings(cfg: AppConfig): LiveKitSettings | null {
  if (!cfg.LIVEKIT_PUBLIC_URL || !cfg.LIVEKIT_API_KEY || !cfg.LIVEKIT_API_SECRET) return null;
  const apiUrl =
    cfg.LIVEKIT_API_URL ??
    cfg.LIVEKIT_PUBLIC_URL.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
  return {
    publicUrl: cfg.LIVEKIT_PUBLIC_URL,
    apiUrl: apiUrl.replace(/\/$/, ''),
    apiKey: cfg.LIVEKIT_API_KEY,
    apiSecret: cfg.LIVEKIT_API_SECRET,
  };
}

export interface VideoGrant {
  room?: string;
  roomJoin?: boolean;
  roomAdmin?: boolean;
  roomCreate?: boolean;
  roomList?: boolean;
  canPublish?: boolean;
  canSubscribe?: boolean;
  canPublishData?: boolean;
  canPublishSources?: ('camera' | 'microphone' | 'screen_share' | 'screen_share_audio')[];
  canUpdateOwnMetadata?: boolean;
}

export class LiveKitClient {
  private readonly log = new Logger('LiveKit');
  private readonly key: Uint8Array;

  constructor(readonly settings: LiveKitSettings) {
    this.key = new TextEncoder().encode(settings.apiSecret);
  }

  async token(opts: {
    identity?: string;
    name?: string;
    metadata?: string;
    attributes?: Record<string, string>;
    grant: VideoGrant;
    ttlSeconds: number;
  }): Promise<{ token: string; expiresAt: Date }> {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + opts.ttlSeconds;
    const jwt = new SignJWT({
      video: opts.grant,
      ...(opts.name ? { name: opts.name } : {}),
      ...(opts.metadata ? { metadata: opts.metadata } : {}),
      ...(opts.attributes ? { attributes: opts.attributes } : {}),
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(this.settings.apiKey)
      .setNotBefore(now - 5)
      .setExpirationTime(exp);
    if (opts.identity) jwt.setSubject(opts.identity).setJti(opts.identity);
    return { token: await jwt.sign(this.key), expiresAt: new Date(exp * 1000) };
  }

  /**
   * LiveKit signs each webhook with a JWT in the Authorization header whose `sha256` claim
   * is the base64 SHA-256 of the raw body. Returns the parsed event, or null if it is forged.
   */
  async verifyWebhook(rawBody: Buffer, authorization: string | undefined) {
    if (!authorization) return null;
    try {
      const { payload } = await jwtVerify(authorization.replace(/^Bearer\s+/i, ''), this.key, {
        issuer: this.settings.apiKey,
        algorithms: ['HS256'],
      });
      const expected = Buffer.from(createHash('sha256').update(rawBody).digest('base64'));
      const got = Buffer.from(String(payload.sha256 ?? ''));
      if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
      return JSON.parse(rawBody.toString('utf8')) as LiveKitWebhookEvent;
    } catch {
      return null;
    }
  }

  /** Identities currently connected to a room. A room that doesn't exist has nobody in it. */
  async listParticipants(room: string): Promise<string[]> {
    const res = await this.twirp<{ participants?: { identity: string }[] }>(
      'ListParticipants',
      { room },
      { room, roomAdmin: true },
    );
    return (res?.participants ?? []).map((p) => p.identity);
  }

  /** Rooms are created explicitly (auto_create is off), so a stale token can't reopen an ended call. */
  async createRoom(room: string, opts: { emptyTimeoutSeconds: number; maxParticipants: number }) {
    await this.twirp(
      'CreateRoom',
      {
        name: room,
        empty_timeout: opts.emptyTimeoutSeconds,
        departure_timeout: 20,
        max_participants: opts.maxParticipants,
      },
      { roomCreate: true },
    );
  }

  async removeParticipant(room: string, identity: string): Promise<void> {
    await this.twirp('RemoveParticipant', { room, identity }, { room, roomAdmin: true });
  }

  /** Closes the room and disconnects everyone in it. */
  async deleteRoom(room: string): Promise<void> {
    await this.twirp('DeleteRoom', { room }, { roomCreate: true });
  }

  private async twirp<T>(method: string, body: unknown, grant: VideoGrant): Promise<T | null> {
    const { token } = await this.token({ grant, ttlSeconds: 60 });
    const res = await fetch(`${this.settings.apiUrl}/twirp/livekit.RoomService/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 404) return null; // room not found
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // LiveKit answers "not_found" as a Twirp error for missing rooms on some versions.
      if (text.includes('not_found') || text.includes('does not exist')) return null;
      this.log.warn(`RoomService.${method} failed: HTTP ${res.status} ${text.slice(0, 200)}`);
      throw new Error(`LiveKit ${method} failed (${res.status})`);
    }
    return (await res.json()) as T;
  }
}

export interface LiveKitWebhookEvent {
  event:
    | 'room_started'
    | 'room_finished'
    | 'participant_joined'
    | 'participant_left'
    | 'track_published'
    | 'track_unpublished'
    | 'egress_started'
    | 'egress_updated'
    | 'egress_ended'
    | 'ingress_started'
    | 'ingress_ended'
    | string;
  room?: { name: string; sid?: string };
  participant?: { identity: string; sid?: string; name?: string };
  id?: string;
  createdAt?: number | string;
}
