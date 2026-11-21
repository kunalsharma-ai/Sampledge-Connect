import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { AppError } from '../common/errors.js';

const RELEASE = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

/**
 * Short-lived distributed mutex (single Redis instance, SET NX PX + token-checked release).
 * Used to serialize sequence allocation + insert per conversation, so the commit order
 * of messages matches their sequence order and cursor sync can never skip a message.
 */
export async function withLock<T>(
  redis: Redis,
  key: string,
  fn: () => Promise<T>,
  opts: { ttlMs?: number; waitMs?: number } = {},
): Promise<T> {
  const ttl = opts.ttlMs ?? 5000;
  const deadline = Date.now() + (opts.waitMs ?? 3000);
  const token = randomUUID();
  let delay = 5;
  while ((await redis.set(key, token, 'PX', ttl, 'NX')) !== 'OK') {
    if (Date.now() > deadline)
      throw new AppError('UNAVAILABLE', 'Conversation is busy, retry shortly');
    await new Promise((r) => setTimeout(r, delay + Math.random() * delay));
    delay = Math.min(delay * 2, 50);
  }
  try {
    return await fn();
  } finally {
    await redis.eval(RELEASE, 1, key, token).catch(() => undefined);
  }
}
