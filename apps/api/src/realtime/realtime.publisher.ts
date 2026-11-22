import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';
import type { ServerToClientEvents } from '@sampledge/contracts';
import { conversationRoom, moderatorsRoom, tenantRoom, userRoom } from './rooms.js';

type Events = ServerToClientEvents;

/**
 * Thin facade over the Socket.IO server used by domain services.
 * Emitting is best-effort: clients recover anything missed via cursor sync,
 * so a failed emit never fails the request that caused it.
 */
@Injectable()
export class RealtimePublisher {
  private readonly logger = new Logger('RealtimePublisher');
  private server: Server<Record<string, never>, Events> | null = null;

  attach(server: Server) {
    this.server = server as unknown as Server<Record<string, never>, Events>;
  }

  toConversation<E extends keyof Events>(
    tenantId: string,
    conversationId: string,
    event: E,
    ...args: Parameters<Events[E]>
  ) {
    this.safe(() =>
      this.server?.to(conversationRoom(tenantId, conversationId)).emit(event, ...args),
    );
  }

  toUser<E extends keyof Events>(
    tenantId: string,
    userId: string,
    event: E,
    ...args: Parameters<Events[E]>
  ) {
    this.safe(() => this.server?.to(userRoom(tenantId, userId)).emit(event, ...args));
  }

  /** Everyone signed in to the organization (all users, all devices). */
  toTenant<E extends keyof Events>(tenantId: string, event: E, ...args: Parameters<Events[E]>) {
    this.safe(() => this.server?.to(tenantRoom(tenantId)).emit(event, ...args));
  }

  /** Platform operators signed in anywhere (the SampConnect Network moderation queue). */
  toModerators<E extends keyof Events>(event: E, ...args: Parameters<Events[E]>) {
    this.safe(() => this.server?.to(moderatorsRoom()).emit(event, ...args));
  }

  /** Make all of a user's sockets (on every node) join / leave a conversation room. */
  joinConversation(tenantId: string, userId: string, conversationId: string) {
    this.safe(() =>
      this.server
        ?.in(userRoom(tenantId, userId))
        .socketsJoin(conversationRoom(tenantId, conversationId)),
    );
  }
  leaveConversation(tenantId: string, userId: string, conversationId: string) {
    this.safe(() =>
      this.server
        ?.in(userRoom(tenantId, userId))
        .socketsLeave(conversationRoom(tenantId, conversationId)),
    );
  }
  disconnectSession(tenantId: string, userId: string, sessionId: string) {
    this.safe(async () => {
      const sockets = await this.server?.in(userRoom(tenantId, userId)).fetchSockets();
      for (const s of sockets ?? []) {
        if ((s.data as { ctx?: { sessionId: string } }).ctx?.sessionId === sessionId) {
          s.emit('session:expired', { reason: 'revoked' });
          s.disconnect(true);
        }
      }
    });
  }

  /**
   * Session ids with a connected socket for this user (on any node). socket.io drops a
   * socket that misses its ping timeout, so a backgrounded app stops counting quickly.
   */
  async liveSessions(tenantId: string, userId: string): Promise<Set<string>> {
    try {
      const sockets = (await this.server?.in(userRoom(tenantId, userId)).fetchSockets()) ?? [];
      return new Set(
        sockets
          .map((s) => (s.data as { ctx?: { sessionId: string } }).ctx?.sessionId)
          .filter((id): id is string => !!id),
      );
    } catch {
      return new Set(); // Unknown: prefer sending a push over silently dropping it.
    }
  }

  private safe(fn: () => unknown) {
    try {
      const r = fn();
      if (r instanceof Promise)
        r.catch((e: Error) => this.logger.warn(`emit failed: ${e.message}`));
    } catch (e) {
      this.logger.warn(`emit failed: ${(e as Error).message}`);
    }
  }
}
