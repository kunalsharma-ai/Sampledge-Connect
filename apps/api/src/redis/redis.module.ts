import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import {
  RateLimiterMemory,
  RateLimiterRedis,
  RateLimiterRes,
  type RateLimiterAbstract,
} from 'rate-limiter-flexible';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { AppError } from '../common/errors.js';

export const REDIS = Symbol('REDIS');

/** Rate-limit policies. Values are deliberately conservative defaults. */
const POLICIES = {
  login_ip: { points: 20, duration: 60 },
  login_account: { points: 8, duration: 300 },
  register_ip: { points: 5, duration: 3600 },
  message_send: { points: 30, duration: 10 },
  reaction: { points: 60, duration: 10 },
  upload: { points: 30, duration: 60 },
  api_user: { points: 300, duration: 60 },
  /** Public guest join page: it polls every few seconds; allows a few guests behind one NAT. */
  guest_link: { points: 240, duration: 60 },
} as const;
export type RateLimitPolicy = keyof typeof POLICIES;

@Injectable()
export class RateLimitService {
  private readonly limiters = new Map<RateLimitPolicy, RateLimiterAbstract>();
  constructor(
    @Inject(REDIS) redis: Redis,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {
    for (const [name, p] of Object.entries(POLICIES) as [
      RateLimitPolicy,
      (typeof POLICIES)[RateLimitPolicy],
    ][]) {
      this.limiters.set(
        name,
        new RateLimiterRedis({
          storeClient: redis,
          keyPrefix: `rl:${name}`,
          points: p.points,
          duration: p.duration,
          // If Redis is down, fall back to a per-process limiter instead of failing open entirely.
          insuranceLimiter: new RateLimiterMemory({ points: p.points, duration: p.duration }),
        }),
      );
    }
  }

  /** Consumes one point or throws RATE_LIMITED with retryAfterMs. */
  async consume(policy: RateLimitPolicy, key: string): Promise<void> {
    if (this.cfg.RATE_LIMIT_DISABLED) return;
    try {
      await this.limiters.get(policy)!.consume(key);
    } catch (e) {
      if (e instanceof RateLimiterRes) {
        throw new AppError(
          'RATE_LIMITED',
          'Too many requests, slow down',
          undefined,
          e.msBeforeNext,
        );
      }
      throw e;
    }
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) =>
        new Redis(cfg.REDIS_URL, { maxRetriesPerRequest: 2, enableAutoPipelining: true }),
    },
    RateLimitService,
  ],
  exports: [REDIS, RateLimitService],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}
  async onApplicationShutdown() {
    await this.redis.quit().catch(() => undefined);
  }
}
