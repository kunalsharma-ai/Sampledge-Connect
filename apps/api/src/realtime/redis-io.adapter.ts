import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';
import { SOCKET_IO_PATH } from '@sampledge/contracts';
import type { AppConfig } from '../config/config.js';

/**
 * Socket.IO with the Redis adapter, so emits reach sockets on every API replica.
 * Pub/Sub here is only a latency path; durable history is in MongoDB and
 * clients recover missed events with cursor sync.
 */
export class RedisIoAdapter extends IoAdapter {
  private pub: Redis;
  private sub: Redis;
  constructor(
    app: INestApplicationContext,
    private readonly cfg: AppConfig,
    private readonly widgetOrigins?: { widgetOriginAllowed(origin: string): Promise<boolean> },
  ) {
    super(app);
    this.pub = new Redis(cfg.REDIS_URL, { lazyConnect: false });
    this.sub = this.pub.duplicate();
  }
  override createIOServer(port: number, options?: ServerOptions): Server {
    const server: Server = super.createIOServer(port, {
      ...options,
      // Same address as the web app, behind the gateway's /api route.
      path: SOCKET_IO_PATH,
      // Same-origin only, plus the chat widget's configured origins (see bootstrap.ts).
      cors: {
        origin: (origin: string | undefined, cb: (e: Error | null, ok?: boolean) => void) => {
          if (!origin || !this.widgetOrigins) return cb(null, !origin);
          this.widgetOrigins.widgetOriginAllowed(origin).then(
            (ok) => cb(null, ok),
            () => cb(null, false),
          );
        },
        credentials: false,
      },
      // Browsers don't apply CORS to WebSockets, so check the Origin header here as well.
      allowRequest: (req, cb) => {
        const origin = req.headers.origin;
        if (!origin) return cb(null, true); // phones and servers send none
        const fwd = req.headers['x-forwarded-host'];
        const host = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim() || req.headers.host;
        let sameHost = false;
        try {
          sameHost = new URL(origin).host === host;
        } catch {
          return cb(null, false);
        }
        if (sameHost) return cb(null, true);
        if (!this.widgetOrigins) return cb(null, false);
        this.widgetOrigins.widgetOriginAllowed(origin).then(
          (ok) => cb(null, ok),
          () => cb(null, false),
        );
      },
      maxHttpBufferSize: 256 * 1024,
      pingInterval: 20_000,
      pingTimeout: 20_000,
    } as ServerOptions);
    server.adapter(createAdapter(this.pub, this.sub));
    return server;
  }
  override async close(server: Server) {
    await super.close(server);
    await Promise.allSettled([this.pub.quit(), this.sub.quit()]);
  }
}
