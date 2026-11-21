import { z } from 'zod';
import { ServerIdSchema } from './ids.js';

/**
 * Sampledge module integrations (Phase 2). See docs/sampledge-modules.md and docs/sdk.md.
 *
 * Every connection setting (base URL, API key, mode) lives in the database per tenant and is
 * edited by an admin in Integrations, never in environment variables. Secrets are encrypted at
 * rest and never returned to a browser: the API only says whether one is set.
 *
 * Two directions:
 *  - Inbound: a module's server sends signed events to Connect (POST /v1/hooks/modules/:module)
 *    and calls the contextual chat API with a Connect API key (Authorization: Bearer sk_...).
 *  - Outbound: Connect calls the module's own API (base URL + API key) for actions such as
 *    pushing a task created from chat, and delivers signed webhooks to subscribed URLs.
 *
 * Test mode is the safe default: inbound events are processed for real (channels, cards, tasks
 * are created in Connect), but nothing is sent to the module. Outbound actions are recorded with
 * status `test_mode` so the admin sees exactly what would have been sent.
 */

export const SAMPLEDGE_MODULES = [
  'samptrek',
  'sampleaudience',
  'sampcode',
  'sampbidx',
  'sampforce',
  'sampcrew',
  'talk2tax',
] as const;
export const SampledgeModuleSchema = z.enum(SAMPLEDGE_MODULES);
export type SampledgeModule = z.infer<typeof SampledgeModuleSchema>;

export const MODULE_MODES = ['test', 'live'] as const;
export const ModuleModeSchema = z.enum(MODULE_MODES);
export type ModuleMode = z.infer<typeof ModuleModeSchema>;

/** A person in a module event: matched to a Connect user by identity link, then by email. */
export const IdentityRefSchema = z
  .object({
    externalUserId: z.string().trim().min(1).max(128).optional(),
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    name: z.string().trim().max(120).optional(),
  })
  .refine((r) => !!r.externalUserId || !!r.email, 'externalUserId or email is required');
export type IdentityRef = z.infer<typeof IdentityRefSchema>;

/** The business record an event is about (a project, a bid, an invoice...). */
export const RecordRefSchema = z.object({
  type: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,39}$/, 'lowercase record type'),
  id: z.string().trim().min(1).max(128),
  title: z.string().trim().min(1).max(160),
  /** Deep link back into the module, shown as "Open in <module>". */
  url: z.string().url().max(2048).optional(),
});
export type RecordRef = z.infer<typeof RecordRefSchema>;

/** Body a module POSTs to /v1/hooks/modules/:module, signed with the module signing secret. */
export const ModuleEventSchema = z.object({
  /** Idempotency key chosen by the module: the same eventId is processed once. */
  eventId: z.string().trim().min(1).max(128),
  type: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, 'dotted event type, e.g. milestone.due'),
  occurredAt: z.string().datetime().optional(),
  record: RecordRefSchema,
  /** For record types that live under another (a milestone in a project). */
  parent: RecordRefSchema.optional(),
  actor: IdentityRefSchema.optional(),
  /** People the event is for: added to the record's conversation and notified. */
  people: z.array(IdentityRefSchema).max(100).default([]),
  /** Short human summary; adapters fall back to a sentence built from the type. */
  summary: z.string().trim().max(1000).optional(),
  data: z.record(z.string(), z.unknown()).default({}),
});
export type ModuleEvent = z.infer<typeof ModuleEventSchema>;
export type ModuleEventInput = z.input<typeof ModuleEventSchema>;

export const MODULE_EVENT_STATUSES = ['processed', 'ignored', 'failed'] as const;
export type ModuleEventStatus = (typeof MODULE_EVENT_STATUSES)[number];

export const ModuleEventResultSchema = z.object({
  eventId: z.string(),
  /** true when this eventId had already been received; nothing was done twice. */
  duplicate: z.boolean(),
  status: z.enum(MODULE_EVENT_STATUSES),
  /** What Connect did, e.g. ["conversation.created", "card.posted", "task.created"]. */
  actions: z.array(z.string()),
  conversationId: ServerIdSchema.nullable(),
  messageId: ServerIdSchema.nullable(),
  taskId: ServerIdSchema.nullable(),
  approvalId: ServerIdSchema.nullable(),
  /** People named in the event with no Connect account (not added, not notified). */
  unmatchedPeople: z.array(z.string()),
  error: z.string().nullable(),
});
export type ModuleEventResult = z.infer<typeof ModuleEventResultSchema>;

/** One row of the integration's event log (Integrations → module → Activity). */
export const ModuleEventLogSchema = ModuleEventResultSchema.extend({
  module: SampledgeModuleSchema,
  type: z.string(),
  recordTitle: z.string(),
  /** 'admin_test' when sent with "Send test event" from the admin screen. */
  source: z.enum(['module', 'admin_test']),
  receivedAt: z.string().datetime(),
});
export type ModuleEventLog = z.infer<typeof ModuleEventLogSchema>;

/**
 * Status of one module's connection (GET /v1/integrations/modules). The settings themselves
 * (base URL, API key, signing secret, mode) are edited through the shared integration-settings
 * store (provider id `sampledge.<module>`); this is the read model with activity and what's missing.
 */
export const ModuleIntegrationSchema = z.object({
  module: SampledgeModuleSchema,
  enabled: z.boolean(),
  mode: ModuleModeSchema,
  /** The module's API base URL that Connect calls for outbound actions. */
  baseUrl: z.string().nullable(),
  /** The module's API key Connect sends when calling it (encrypted at rest). */
  moduleApiKeySet: z.boolean(),
  /** Prefix of the Connect API key issued to this module (the full key is shown once). */
  connectKeyPrefix: z.string().nullable(),
  /** Whether a signing secret for inbound events is saved. */
  signingSecretSet: z.boolean(),
  /** What is still needed before live mode can work, e.g. ["Module API base URL"]. */
  missing: z.array(z.string()),
  /** Where new record conversations are created: channels visible to everyone or private. */
  channelVisibility: z.enum(['public', 'private']),
  lastEventAt: z.string().datetime().nullable(),
  eventCount: z.number().int().nonnegative(),
  lastTestedAt: z.string().datetime().nullable(),
  lastTestResult: z.string().nullable(),
  updatedAt: z.string().datetime().nullable(),
});
export type ModuleIntegration = z.infer<typeof ModuleIntegrationSchema>;

/** POST /v1/integrations/modules/:module/keys: issues a new Connect API key, returned once. */
export const ModuleCredentialsSchema = z.object({
  module: SampledgeModuleSchema,
  /** For the module's server: Authorization: Bearer <connectApiKey>. Stored hashed. */
  connectApiKey: z.string(),
  /** Set when Connect generated a new signing secret too (also shown only this once). */
  signingSecret: z.string().nullable(),
});
export type ModuleCredentials = z.infer<typeof ModuleCredentialsSchema>;

/** POST /v1/integrations/modules/:module/test-connection result. */
export const TestConnectionResultSchema = z.object({
  ok: z.boolean(),
  mode: ModuleModeSchema,
  message: z.string(),
  statusCode: z.number().int().nullable(),
  latencyMs: z.number().int().nullable(),
});
export type TestConnectionResult = z.infer<typeof TestConnectionResultSchema>;

/** Central identity mapping: a module's user id ↔ a Connect user. */
export const IdentityLinkSchema = z.object({
  module: SampledgeModuleSchema,
  externalUserId: z.string(),
  userId: ServerIdSchema,
  email: z.string().nullable(),
  /** email: matched automatically by email address; manual: set by an admin or the module. */
  matchedBy: z.enum(['email', 'manual']),
  createdAt: z.string().datetime(),
});
export type IdentityLink = z.infer<typeof IdentityLinkSchema>;

/** PUT /v1/integration/identities (module API key) or /v1/integrations/modules/:m/identities. */
export const LinkIdentityRequestSchema = z
  .object({
    externalUserId: z.string().trim().min(1).max(128),
    userId: ServerIdSchema.optional(),
    email: z.string().trim().toLowerCase().email().max(254).optional(),
  })
  .refine((r) => !!r.userId || !!r.email, 'userId or email is required');
export type LinkIdentityRequest = z.input<typeof LinkIdentityRequestSchema>;

export const RECORD_SENSITIVITIES = ['standard', 'restricted'] as const;

/** A module record connected to a Connect conversation ("work-aware communication"). */
export const LinkedRecordSchema = z.object({
  linkId: ServerIdSchema,
  module: SampledgeModuleSchema,
  recordType: z.string(),
  externalId: z.string(),
  title: z.string(),
  url: z.string().nullable(),
  conversationId: ServerIdSchema.nullable(),
  parent: z.object({ type: z.string(), id: z.string(), title: z.string() }).nullable(),
  /** restricted: HR and finance records. Their conversations are private, never public channels. */
  sensitivity: z.enum(RECORD_SENSITIVITIES),
  /** Latest scalar facts from events (status, amount, due date...), for the context panel. */
  fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  lastEventType: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type LinkedRecord = z.infer<typeof LinkedRecordSchema>;

/** `metadata.module` on the card a module event posts in its record conversation. */
export const ModuleCardMetadataSchema = z.object({
  module: SampledgeModuleSchema,
  eventType: z.string(),
  eventLabel: z.string(),
  tone: z.enum(['info', 'success', 'warning', 'danger']),
  record: z.object({
    type: z.string(),
    id: z.string(),
    title: z.string(),
    url: z.string().nullable(),
  }),
  facts: z.array(z.object({ label: z.string(), value: z.string() })).max(8),
  taskId: ServerIdSchema.nullable(),
  approvalId: ServerIdSchema.nullable(),
  /** true when posted by "Send test event", so nobody mistakes it for real data. */
  test: z.boolean(),
});
export type ModuleCardMetadata = z.infer<typeof ModuleCardMetadataSchema>;

/* ---------- Contextual chat API (module server, Connect API key) ---------- */

/** PUT /v1/integration/records: find or create the conversation for a module record. */
export const EnsureRecordConversationRequestSchema = z.object({
  record: RecordRefSchema,
  parent: RecordRefSchema.optional(),
  members: z.array(IdentityRefSchema).max(100).default([]),
  topic: z.string().trim().max(240).optional(),
});
export type EnsureRecordConversationRequest = z.input<typeof EnsureRecordConversationRequestSchema>;

/** POST /v1/integration/records/:recordType/:externalId/messages: post as the module. */
export const PostRecordMessageRequestSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  /** People to notify (they are added to the conversation first). */
  notify: z.array(IdentityRefSchema).max(50).default([]),
  /** Idempotency key: the same key posts once. */
  idempotencyKey: z.string().trim().min(1).max(128),
});
export type PostRecordMessageRequest = z.input<typeof PostRecordMessageRequestSchema>;

/** POST /v1/integration/widget-sessions: sign a module user into the embedded chat widget. */
export const CreateWidgetSessionRequestSchema = z.object({
  user: IdentityRefSchema,
  record: RecordRefSchema.optional(),
  /** Shown in the user's device list, e.g. "Samptrek web". */
  deviceName: z.string().trim().min(1).max(60).optional(),
});
export type CreateWidgetSessionRequest = z.input<typeof CreateWidgetSessionRequestSchema>;

export const WidgetSessionSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresIn: z.number().int(),
  refreshToken: z.string(),
  sessionId: z.string(),
  deviceId: z.string(),
  userId: ServerIdSchema,
  tenantId: ServerIdSchema,
  conversationId: ServerIdSchema.nullable(),
});
export type WidgetSession = z.infer<typeof WidgetSessionSchema>;

/* ---------- Outbound actions (Connect → module API) ---------- */

export const MODULE_ACTION_STATUSES = ['sent', 'failed', 'test_mode', 'not_configured'] as const;
export const ModuleActionSchema = z.object({
  actionId: ServerIdSchema,
  module: SampledgeModuleSchema,
  /** e.g. task.created, approval.decided, crm.activity.logged */
  type: z.string(),
  record: z.object({ type: z.string(), id: z.string(), title: z.string() }).nullable(),
  /** What was (or in test mode, would have been) sent. */
  payload: z.record(z.string(), z.unknown()),
  status: z.enum(MODULE_ACTION_STATUSES),
  statusCode: z.number().int().nullable(),
  error: z.string().nullable(),
  requestedBy: ServerIdSchema,
  createdAt: z.string().datetime(),
});
export type ModuleAction = z.infer<typeof ModuleActionSchema>;

/** POST /v1/integrations/records/:linkId/actions: conversation-to-CRM and similar actions. */
export const RunRecordActionRequestSchema = z.object({
  action: z.string().trim().min(1).max(60),
  note: z.string().trim().max(4000).default(''),
  messageId: ServerIdSchema.optional(),
});
export type RunRecordActionRequest = z.input<typeof RunRecordActionRequestSchema>;

/* ---------- Outbound webhooks (Connect events → subscriber URLs) ---------- */

export const WEBHOOK_EVENT_TYPES = [
  'message.created',
  'task.created',
  'task.updated',
  'approval.requested',
  'approval.decided',
  'record.linked',
] as const;
export const WebhookEventTypeSchema = z.enum(WEBHOOK_EVENT_TYPES);
export type WebhookEventType = z.infer<typeof WebhookEventTypeSchema>;

export const WebhookSubscriptionSchema = z.object({
  subscriptionId: ServerIdSchema,
  url: z.string(),
  description: z.string(),
  events: z.array(WebhookEventTypeSchema),
  /** Only events about these modules' records; empty = all. message.created is linked-only. */
  modules: z.array(SampledgeModuleSchema),
  active: z.boolean(),
  createdAt: z.string().datetime(),
  lastDeliveryAt: z.string().datetime().nullable(),
  lastDeliveryStatus: z.enum(['delivered', 'failed', 'dead']).nullable(),
});
export type WebhookSubscription = z.infer<typeof WebhookSubscriptionSchema>;

export const CreateWebhookSubscriptionRequestSchema = z.object({
  url: z
    .string()
    .trim()
    .url()
    .max(2048)
    .refine((u) => /^https?:\/\//.test(u), 'must be http(s)'),
  description: z.string().trim().max(200).default(''),
  events: z.array(WebhookEventTypeSchema).min(1),
  modules: z.array(SampledgeModuleSchema).default([]),
});
export type CreateWebhookSubscriptionRequest = z.input<
  typeof CreateWebhookSubscriptionRequestSchema
>;

/** Create response: the signing secret is returned exactly once. */
export const CreatedWebhookSubscriptionSchema = WebhookSubscriptionSchema.extend({
  signingSecret: z.string(),
});

export const WebhookDeliverySchema = z.object({
  deliveryId: ServerIdSchema,
  subscriptionId: ServerIdSchema,
  event: WebhookEventTypeSchema,
  status: z.enum(['pending', 'delivered', 'failed', 'dead']),
  attempts: z.number().int(),
  lastStatusCode: z.number().int().nullable(),
  lastError: z.string().nullable(),
  nextAttemptAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type WebhookDelivery = z.infer<typeof WebhookDeliverySchema>;

/** Envelope Connect POSTs to webhook subscribers (and to modules for outbound actions). */
export interface WebhookEnvelope<T = unknown> {
  id: string;
  type: string;
  tenantId: string;
  createdAt: string;
  data: T;
}

/* ---------- Signatures ---------- */

/**
 * Every signed request carries `Sampledge-Signature: t=<unix seconds>,v1=<hex>` where
 * v1 = HMAC-SHA256(secret, `${t}.${rawBody}`). Receivers must reject a timestamp more than
 * SIGNATURE_TOLERANCE_SECONDS away from their clock (replay protection).
 */
export const SIGNATURE_HEADER = 'sampledge-signature';
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function parseSignatureHeader(header: string | undefined | null): {
  timestamp: number;
  signatures: string[];
} | null {
  if (!header) return null;
  let timestamp = NaN;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [k, v] = part.trim().split('=', 2);
    if (k === 't') timestamp = Number(v);
    else if (k === 'v1' && v && /^[0-9a-f]{64}$/.test(v)) signatures.push(v);
  }
  if (!Number.isFinite(timestamp) || signatures.length === 0) return null;
  return { timestamp, signatures };
}
