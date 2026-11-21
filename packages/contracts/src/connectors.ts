import { z } from 'zod';

/**
 * External messaging gateway (Phase 3). A connector links one external messaging account
 * (a Telegram bot, a Slack app, a LINE channel...) to the tenant's Client Inbox.
 *
 * Every provider is described by a static ConnectorDescriptor so the admin screen can say
 * exactly what a connector does and does not support before anyone enters credentials.
 * Credentials are entered in the admin screen and stored encrypted in MongoDB, never in env.
 */
export const CONNECTOR_PROVIDERS = [
  'telegram',
  'slack',
  'teams',
  'google_chat',
  'discord',
  'line',
  'mattermost',
  'nextcloud_talk',
  'wechat',
  'qq',
  'signal',
  'imessage',
] as const;
export const ConnectorProviderSchema = z.enum(CONNECTOR_PROVIDERS);
export type ConnectorProvider = z.infer<typeof ConnectorProviderSchema>;

/**
 * two_way: official API supports receiving and sending messages.
 * limited: official API works but with real restrictions (reply windows, slash commands only...).
 * handoff: no supported business API. Agents open the conversation in the client's own app;
 *          the inbox keeps the record. Nothing is automated against the platform.
 */
export const CONNECTOR_MODES = ['two_way', 'limited', 'handoff'] as const;
export type ConnectorMode = (typeof CONNECTOR_MODES)[number];

export interface ConnectorCredentialField {
  key: string;
  label: string;
  /** Secret values are write-only: the API only ever returns a masked hint. */
  secret: boolean;
  required: boolean;
  help: string;
  placeholder?: string;
}

export interface ConnectorDescriptor {
  provider: ConnectorProvider;
  name: string;
  mode: ConnectorMode;
  /** One line shown on the catalog card. */
  summary: string;
  auth: { method: string; authorization: string };
  credentialFields: ConnectorCredentialField[];
  inboundEvents: string[];
  outboundOperations: string[];
  attachments: { inbound: boolean; outbound: boolean; note: string };
  webhookValidation: string;
  rateLimit: { perSecond: number; note: string };
  retry: string;
  errorHandling: string;
  identityMapping: string;
  deliveryStates: string;
  credentialRotation: string;
  limitations: string[];
  docsUrl: string;
}

export const CONNECTOR_STATUSES = ['active', 'paused', 'error'] as const;
export type ConnectorStatus = (typeof CONNECTOR_STATUSES)[number];

/** test: credentials are generated, nothing leaves the server. live: real provider API. */
export const CONNECTOR_ENVIRONMENTS = ['test', 'live'] as const;
export type ConnectorEnvironment = (typeof CONNECTOR_ENVIRONMENTS)[number];

export const ConnectorSchema = z.object({
  connectorId: z.string(),
  provider: ConnectorProviderSchema,
  name: z.string(),
  environment: z.enum(CONNECTOR_ENVIRONMENTS),
  status: z.enum(CONNECTOR_STATUSES),
  /** Masked values ("••••3f9a") for secrets, plain values for non-secret fields. */
  credentialHints: z.record(z.string(), z.string()),
  /** Required credential fields that are still empty. Live mode cannot start until this is []. */
  missingCredentials: z.array(z.string()),
  /** Path of the public webhook endpoint (append to the API base URL). null for handoff. */
  webhookPath: z.string().nullable(),
  /** Inbox team that owns new conversations from this connector. */
  teamId: z.string().nullable(),
  credentialsRotatedAt: z.string().datetime().nullable(),
  /** The previous secret still verifies webhooks until then (rotation grace window). */
  previousCredentialsValidUntil: z.string().datetime().nullable(),
  health: z.object({
    lastInboundAt: z.string().datetime().nullable(),
    lastOutboundAt: z.string().datetime().nullable(),
    lastError: z.string().nullable(),
    lastErrorAt: z.string().datetime().nullable(),
    consecutiveFailures: z.number().int(),
    /** Outbound sends are paused until then after repeated failures (circuit breaker). */
    circuitOpenUntil: z.string().datetime().nullable(),
    rejectedWebhooks: z.number().int(),
    queued: z.number().int(),
  }),
  createdAt: z.string().datetime(),
});
export type Connector = z.infer<typeof ConnectorSchema>;

const CredentialValues = z.record(z.string().min(1).max(64), z.string().max(4096));

export const CreateConnectorRequestSchema = z.object({
  provider: ConnectorProviderSchema,
  name: z.string().trim().min(1).max(80),
  environment: z.enum(CONNECTOR_ENVIRONMENTS).default('test'),
  /** Ignored in test mode (test credentials are generated). */
  credentials: CredentialValues.default({}),
  teamId: z.string().nullable().default(null),
});
export type CreateConnectorRequest = z.input<typeof CreateConnectorRequestSchema>;

export const UpdateConnectorRequestSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  environment: z.enum(CONNECTOR_ENVIRONMENTS).optional(),
  status: z.enum(['active', 'paused']).optional(),
  teamId: z.string().nullable().optional(),
});
export type UpdateConnectorRequest = z.infer<typeof UpdateConnectorRequestSchema>;

/**
 * PUT /v1/connectors/:id/credentials. Fields left out keep their stored value. The old
 * values keep verifying webhooks for `graceHours` so in-flight deliveries are not rejected.
 */
export const RotateCredentialsRequestSchema = z.object({
  credentials: CredentialValues,
  graceHours: z.number().int().min(0).max(168).default(24),
});
export type RotateCredentialsRequest = z.input<typeof RotateCredentialsRequestSchema>;

export const TestConnectorResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  /** True when the check ran against the sandbox, not the real provider. */
  sandbox: z.boolean(),
});
export type TestConnectorResult = z.infer<typeof TestConnectorResultSchema>;

/** POST /v1/connectors/:id/simulate-inbound (test mode only). Builds a signed provider payload. */
export const SimulateInboundRequestSchema = z.object({
  fromName: z.string().trim().min(1).max(80),
  fromHandle: z.string().trim().min(1).max(80),
  text: z.string().trim().min(1).max(4000),
  /** Reuse to continue an existing external thread; defaults to the sender's DM thread. */
  threadId: z.string().max(128).optional(),
  email: z.string().email().optional(),
});
export type SimulateInboundRequest = z.infer<typeof SimulateInboundRequestSchema>;

/** A request the sandbox captured instead of sending (test mode). Secrets are redacted. */
export const SandboxRequestSchema = z.object({
  method: z.string(),
  url: z.string(),
  headers: z.record(z.string(), z.string()),
  body: z.unknown(),
  at: z.string().datetime(),
});
export type SandboxRequest = z.infer<typeof SandboxRequestSchema>;
