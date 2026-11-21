import { Inject, Logger, type BeforeApplicationShutdown } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
} from '@nestjs/websockets';
import type { Redis } from 'ioredis';
import type { Server, Socket } from 'socket.io';
import {
  PRESENCE_STATUSES,
  TYPING_TTL_MS,
  type Ack,
  type ClientToServerEvents,
  type PresenceStatus,
  type ServerToClientEvents,
} from '@sampledge/contracts';
import { toApiError } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { SessionService } from '../auth/session.service.js';
import { TenantDb } from '../database/tenant-db.js';
import { MessagesService } from '../messages/messages.service.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { REDIS } from '../redis/redis.module.js';
import { RealtimePublisher } from './realtime.publisher.js';
import { conversationRoom, tenantRoom, userRoom } from './rooms.js';

interface SocketData {
  ctx: TenantContext;
  token: string;
  timer?: NodeJS.Timeout;
}
type AppSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

const PRESENCE_TTL_S = 90;
const RECHECK_MS = 60_000;

async function wrap<T>(fn: () => Promise<T>): Promise<Ack<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    return { ok: false, error: toApiError(e) };
  }
}

@WebSocketGateway()
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, BeforeApplicationShutdown
{
  private readonly logger = new Logger('RealtimeGateway');
  private server!: Server;
  private shuttingDown = false;

  constructor(
    private readonly sessions: SessionService,
    private readonly messages: MessagesService,
    private readonly conversations: ConversationsService,
    private readonly publisher: RealtimePublisher,
    private readonly db: TenantDb,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  afterInit(server: Server) {
    this.server = server;
    this.publisher.attach(server);
    // Authenticate during the handshake; unauthenticated sockets never connect.
    server.use((socket, next) => {
      const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
      if (typeof token !== 'string')
        return next(
          Object.assign(new Error('UNAUTHENTICATED'), { data: { code: 'UNAUTHENTICATED' } }),
        );
      this.sessions
        .resolve(token)
        .then((ctx) => {
          (socket.data as SocketData) = { ctx, token };
          next();
        })
        .catch((e) => {
          const err = toApiError(e);
          next(Object.assign(new Error(err.code), { data: err }));
        });
    });
  }

  async handleConnection(socket: AppSocket) {
    if (this.shuttingDown) return void socket.disconnect(true);
    const { ctx } = socket.data;
    await socket.join([userRoom(ctx.tenantId, ctx.userId), tenantRoom(ctx.tenantId)]);
    // Join only conversations the user is a member of (public channels they haven't joined sync via REST).
    const mine = await this.db
      .for(ctx.tenantId)
      .conversation_members.find({ userId: ctx.userId }, { projection: { conversationId: 1 } })
      .toArray();
    if (mine.length)
      await socket.join(mine.map((m) => conversationRoom(ctx.tenantId, m.conversationId)));
    await this.setPresence(socket, 'online');
    // Re-validate periodically: revoked sessions and expired tokens are cut off.
    socket.data.timer = setInterval(() => void this.recheck(socket), RECHECK_MS);
  }

  /** Open Socket.IO connections on this instance (for /health/metrics). */
  connectedSockets(): number {
    return this.server?.engine?.clientsCount ?? 0;
  }

  /** Drop sockets before Redis/Mongo close, so disconnect handlers don't hit closed connections. */
  beforeApplicationShutdown() {
    this.shuttingDown = true;
    this.server?.disconnectSockets(true);
  }

  async handleDisconnect(socket: AppSocket) {
    if (!socket.data?.ctx) return;
    clearInterval(socket.data.timer);
    if (this.shuttingDown) return;
    const { tenantId, userId } = socket.data.ctx;
    const key = `presence:${tenantId}:${userId}`;
    try {
      await this.redis.hdel(key, socket.id);
      if ((await this.redis.hlen(key)) === 0) {
        this.server.to(tenantRoom(tenantId)).emit('presence:update', { userId, status: 'offline' });
      }
    } catch (e) {
      // During shutdown Redis may already be closed; presence keys expire on their own (TTL).
      this.logger.debug(`presence cleanup skipped: ${(e as Error).message}`);
    }
  }

  private async recheck(socket: AppSocket) {
    try {
      socket.data.ctx = await this.sessions.resolve(socket.data.token);
      await this.redis.expire(
        `presence:${socket.data.ctx.tenantId}:${socket.data.ctx.userId}`,
        PRESENCE_TTL_S,
      );
    } catch (e) {
      const code = toApiError(e).code;
      socket.emit('session:expired', {
        reason: code === 'SESSION_EXPIRED' ? 'token_expired' : 'revoked',
      });
      socket.disconnect(true);
    }
  }

  private async setPresence(socket: AppSocket, status: PresenceStatus) {
    const { tenantId, userId } = socket.data.ctx;
    const key = `presence:${tenantId}:${userId}`;
    await this.redis.multi().hset(key, socket.id, status).expire(key, PRESENCE_TTL_S).exec();
    this.server.to(tenantRoom(tenantId)).emit('presence:update', { userId, status });
  }

  @SubscribeMessage('message:send')
  onSend(@ConnectedSocket() socket: AppSocket, @MessageBody() body: unknown) {
    return wrap(() => this.messages.send(socket.data.ctx, body));
  }

  @SubscribeMessage('reaction:set')
  onReaction(@ConnectedSocket() socket: AppSocket, @MessageBody() body: unknown) {
    return wrap(() => this.messages.react(socket.data.ctx, body));
  }

  @SubscribeMessage('receipt:ack')
  onReceipt(@ConnectedSocket() socket: AppSocket, @MessageBody() body: unknown) {
    return wrap(() => this.messages.ackReceipt(socket.data.ctx, body));
  }

  @SubscribeMessage('typing:set')
  async onTyping(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() body: { conversationId?: unknown; typing?: unknown },
  ) {
    const { ctx } = socket.data;
    if (typeof body?.conversationId !== 'string') return;
    try {
      await this.conversations.authorize(ctx, body.conversationId, 'message.send');
    } catch {
      return;
    }
    const typing = body.typing === true;
    const key = `typing:${ctx.tenantId}:${body.conversationId}:${ctx.userId}`;
    if (typing) await this.redis.set(key, '1', 'PX', TYPING_TTL_MS);
    else await this.redis.del(key);
    socket
      .to(conversationRoom(ctx.tenantId, body.conversationId))
      .emit('typing:update', { conversationId: body.conversationId, userId: ctx.userId, typing });
  }

  @SubscribeMessage('presence:set')
  async onPresence(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() body: { status?: unknown },
  ) {
    if (
      !(PRESENCE_STATUSES as readonly unknown[]).includes(body?.status) ||
      body.status === 'offline'
    )
      return;
    await this.setPresence(socket, body.status as PresenceStatus);
  }
}

/** Presence lookup for REST (directory). */
export async function presenceOf(
  redis: Redis,
  tenantId: string,
  userIds: string[],
): Promise<Record<string, PresenceStatus>> {
  const out: Record<string, PresenceStatus> = {};
  await Promise.all(
    userIds.map(async (id) => {
      const vals = Object.values(await redis.hgetall(`presence:${tenantId}:${id}`));
      out[id] = vals.includes('online')
        ? 'online'
        : vals.includes('dnd')
          ? 'dnd'
          : vals.includes('away')
            ? 'away'
            : 'offline';
    }),
  );
  return out;
}
