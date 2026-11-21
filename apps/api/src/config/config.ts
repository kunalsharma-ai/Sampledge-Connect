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
  /** Push delivery. `expo` sends through Expo Push; `none` stores tokens but sends nothing. FCM/APNs direct are planned. */
  PUSH_PROVIDER: z.enum(['none', 'expo']).default('none'),
  EXPO_PUSH_URL: z.string().url().default('https://exp.host/--/api/v2/push/send'),
  /** Optional Expo access token (enhanced push security). */
  EXPO_ACCESS_TOKEN: z.string().optional(),
  /** When false, push bodies say "New message" instead of including message text. */
  PUSH_SHOW_PREVIEWS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /**
   * Self-hosted LiveKit SFU for voice and video calls. Calls are disabled until all three
   * of LIVEKIT_PUBLIC_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET are set.
   */
  /** URL browsers and phones use to reach the SFU, e.g. wss://rtc.example.com. */
  LIVEKIT_PUBLIC_URL: z.string().url().optional(),
  /** URL the API uses for the SFU's server API (defaults to the public URL over http/https). */
  LIVEKIT_API_URL: z.string().url().optional(),
  LIVEKIT_API_KEY: z.string().min(3).optional(),
  LIVEKIT_API_SECRET: z.string().min(32).optional(),
  /** Seconds an unanswered call invite rings before it counts as missed. */
  CALL_RING_TIMEOUT_SECONDS: z.coerce.number().int().min(10).max(300).default(45),
  /**
   * Call recording through a self-hosted LiveKit Egress service. Enabled when this is set:
   * the folder where this API reads finished recordings (a volume shared with egress).
   */
  RECORDINGS_SPOOL_DIR: z.string().min(1).optional(),
  /** The same folder as the egress container sees it (where it writes files). */
  LIVEKIT_EGRESS_OUTPUT_DIR: z.string().min(1).default('/out'),
  /** Largest call recording kept (bytes). Default 2 GB. */
  RECORDING_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(2 * 1024 * 1024 * 1024),
  /** Longest call recording (minutes); egress stops at this limit. */
  RECORDING_MAX_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .default(4 * 60),
  /** Public URL of the web app, used for links in emails (guest join links). */
  PUBLIC_WEB_URL: z.string().url().optional(),
  /**
   * Outgoing email (meeting invites to external guests) through your own SMTP server.
   * Email is off until SMTP_HOST and SMTP_FROM are set; invites then show "not sent" and
   * organizers copy the join link instead.
   */
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  /** true: TLS from the first byte (usually port 465). false: STARTTLS when offered (587/25). */
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Refuse to send unless the server upgrades to TLS (recommended outside a private network). */
  SMTP_REQUIRE_TLS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  /** Sender, e.g. "Sampledge Connect <meetings@example.com>". */
  SMTP_FROM: z.string().min(3).optional(),
  /**
   * Master key (32 bytes, base64) that seals integration credentials stored in MongoDB.
   * Integration credentials themselves are entered in the admin screens, never in env.
   * Required in production; development uses a fixed, insecure key and logs a warning.
   */
  SETTINGS_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64')
    .optional(),
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
    if (!cfg.SETTINGS_ENCRYPTION_KEY)
      throw new Error('SETTINGS_ENCRYPTION_KEY is required in production');
    if (cfg.RATE_LIMIT_DISABLED)
      throw new Error('RATE_LIMIT_DISABLED is not allowed in production');
  }
  if (cfg.SMTP_USER && !cfg.SMTP_PASSWORD)
    throw new Error('SMTP_PASSWORD is required when SMTP_USER is set');
  return {
    ...cfg,
    corsOrigins: cfg.CORS_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
