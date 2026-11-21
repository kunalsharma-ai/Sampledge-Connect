import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  MONGO_URL: z.string().default('mongodb://localhost:27017'),
  MONGO_DB: z.string().default('sampledge_connect'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  /** Comma-separated list of allowed browser origins. */
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  /** Ed25519 keys in PKCS8 / SPKI PEM. Required in production. */
  JWT_PRIVATE_KEY: z.string().optional(),
  JWT_PUBLIC_KEY: z.string().optional(),
  JWT_ISSUER: z.string().default('sampledge-connect'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  /** Disable rate limits (integration tests only). */
  RATE_LIMIT_DISABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** HMAC key for signed download URLs (32+ chars). Required in production. */
  FILES_URL_SECRET: z.string().min(32).optional(),
  /** Where attachment bytes live. `gridfs` (MongoDB) is built; `nextcloud` is planned. */
  FILE_STORAGE: z.enum(['gridfs']).default('gridfs'),
  /** Public base URL of this API, used to build absolute signed URLs. */
  PUBLIC_API_URL: z.string().url().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type AppConfig = z.infer<typeof EnvSchema> & { corsOrigins: string[] };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  }
  const cfg = parsed.data;
  if (cfg.NODE_ENV === 'production') {
    if (!cfg.JWT_PRIVATE_KEY || !cfg.JWT_PUBLIC_KEY) {
      throw new Error('JWT_PRIVATE_KEY and JWT_PUBLIC_KEY are required in production');
    }
    if (!cfg.FILES_URL_SECRET) throw new Error('FILES_URL_SECRET is required in production');
    if (cfg.RATE_LIMIT_DISABLED)
      throw new Error('RATE_LIMIT_DISABLED is not allowed in production');
  }
  return {
    ...cfg,
    corsOrigins: cfg.CORS_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
