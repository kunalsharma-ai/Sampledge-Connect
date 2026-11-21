import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { Db } from 'mongodb';
import type { Redis } from 'ioredis';
import { MONGO_DB } from '../database/database.module.js';
import { REDIS } from '../redis/redis.module.js';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(MONGO_DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
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
}
