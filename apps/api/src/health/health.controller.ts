import { timingSafeEqual } from 'node:crypto';
import {
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import type { Db } from 'mongodb';
import type { Redis } from 'ioredis';
import { MONGO_DB } from '../database/database.module.js';
import { REDIS } from '../redis/redis.module.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { Metrics } from './metrics.js';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(MONGO_DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly metrics: Metrics,
    private readonly gateway: RealtimeGateway,
  ) {}

  /** Liveness: the process is up. */
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /** Readiness: dependencies reachable. */
  @Get('ready')
  async ready() {
    const [mongo, redis] = await Promise.allSettled([
      this.db.command({ ping: 1 }),
      this.redis.ping(),
    ]);
    const result = {
      mongo: mongo.status === 'fulfilled' ? 'ok' : 'down',
      redis: redis.status === 'fulfilled' ? 'ok' : 'down',
    };
    if (result.mongo !== 'ok' || result.redis !== 'ok')
      throw new ServiceUnavailableException(result);
    return { status: 'ok', ...result };
  }

  /** Prometheus scrape endpoint, behind METRICS_TOKEN (see docs/monitoring.md). */
  @Get('metrics')
  async scrape(@Headers('authorization') auth: string | undefined, @Res() res: Response) {
    const token = this.cfg.METRICS_TOKEN;
    if (!token) throw new NotFoundException();
    const a = Buffer.from(auth ?? '');
    const b = Buffer.from(`Bearer ${token}`);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException();
    const [mongo, redis] = await Promise.allSettled([
      this.db.command({ ping: 1 }),
      this.redis.ping(),
    ]);
    res.type('text/plain; version=0.0.4').send(
      this.metrics.render({
        sc_socket_connections: this.gateway.connectedSockets(),
        sc_mongo_up: mongo.status === 'fulfilled' ? 1 : 0,
        sc_redis_up: redis.status === 'fulfilled' ? 1 : 0,
      }),
    );
  }
}
