import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';
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
  ) {
    super(app);
    this.pub = new Redis(cfg.REDIS_URL, { lazyConnect: false });
    this.sub = this.pub.duplicate();
  }
  override createIOServer(port: number, options?: ServerOptions): Server {
    const server: Server = super.createIOServer(port, {
      ...options,
      cors: { origin: this.cfg.corsOrigins, credentials: false },
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
