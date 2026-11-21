import { z } from 'zod';
import { ClientIdSchema, ServerIdSchema } from './ids.js';
import { ConnectorProviderSchema, SandboxRequestSchema } from './connectors.js';

/**
 * Unified Client Inbox (Phase 3). External conversations from every connector, worked by
 * agents. Internal notes live in their own collection and their own endpoint: there is no
 * code path that can hand a note to a connector.
 */
export const INBOX_STATUSES = ['open', 'pending', 'snoozed', 'resolved'] as const;
export const InboxStatusSchema = z.enum(INBOX_STATUSES);
export type InboxStatus = z.infer<typeof InboxStatusSchema>;

export const INBOX_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const InboxPrioritySchema = z.enum(INBOX_PRIORITIES);
export type InboxPriority = z.infer<typeof InboxPrioritySchema>;

/**
 * queued -> sending -> sent -> delivered -> read; failed after retries run out.
 * handoff: the agent must send it from the client's own app (Signal, iMessage).
 * test: captured by the sandbox in test mode, never sent.
 */
export const EXTERNAL_DELIVERY_STATES = [
  'queued',
  'sending',
  'sent',
  'delivered',
  'read',
  'failed',
  'handoff',
  'test',
] as const;
export type ExternalDeliveryState = (typeof EXTERNAL_DELIVERY_STATES)[number];

export const SLA_STATES = ['none', 'on_track', 'due_soon', 'breached', 'met'] as const;
export type SlaState = (typeof SLA_STATES)[number];

export const LINK_MODULES = ['sampforce', 'samptrek'] as const;
export const LinkModuleSchema = z.enum(LINK_MODULES);

export const LinkedRecordSchema = z.object({
  linkId: z.string(),
  module: LinkModuleSchema,
  /** sampforce: opportunity | account | lead. samptrek: project. */
  recordType: z.string(),
  externalId: z.string(),
  label: z.string(),
  url: z.string().nullable(),
  /** False until the module integration confirms the record exists. */
  verified: z.boolean(),
  linkedBy: z.string(),
  linkedAt: z.string().datetime(),
});
export type LinkedRecord = z.infer<typeof LinkedRecordSchema>;

export const ExternalIdentitySchema = z.object({
  accountId: z.string(),
  provider: ConnectorProviderSchema,
  connectorId: z.string(),
  externalUserId: z.string(),
  displayName: z.string(),
  handle: z.string().nullable(),
});
export type ExternalIdentity = z.infer<typeof ExternalIdentitySchema>;

export const ClientProfileSchema = z.object({
  clientId: z.string(),
  name: z.string(),
  company: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  title: z.string().nullable(),
  tags: z.array(z.string()),
  /** Account owner inside the tenant. */
  ownerId: z.string().nullable(),
  identities: z.array(ExternalIdentitySchema),
  links: z.array(LinkedRecordSchema),
  conversationCount: z.number().int(),
  createdAt: z.string().datetime(),
});
export type ClientProfile = z.infer<typeof ClientProfileSchema>;

export const SlaSchema = z.object({
  state: z.enum(SLA_STATES),
  /** When the client is owed the next reply; null when nothing is waiting. */
  dueAt: z.string().datetime().nullable(),
  firstResponseAt: z.string().datetime().nullable(),
  breachedAt: z.string().datetime().nullable(),
});

export const InboxConversationSchema = z.object({
  conversationId: z.string(),
  connectorId: z.string(),
  provider: ConnectorProviderSchema,
  /** True when the connector is in test mode: replies go to the sandbox. */
  testMode: z.boolean(),
  /** two_way | limited | handoff (from the provider descriptor). */
  channelMode: z.enum(['two_way', 'limited', 'handoff']),
  client: z.object({ clientId: z.string(), name: z.string(), company: z.string().nullable() }),
  subject: z.string(),
  status: InboxStatusSchema,
  priority: InboxPrioritySchema,
  assigneeId: z.string().nullable(),
  teamId: z.string().nullable(),
  tags: z.array(z.string()),
  sla: SlaSchema,
  escalation: z
    .object({
      level: z.number().int().min(1),
      reason: z.string(),
      at: z.string().datetime(),
      by: z.string().nullable(),
    })
    .nullable(),
  links: z.array(LinkedRecordSchema),
  lastMessage: z
    .object({ direction: z.enum(['inbound', 'outbound']), preview: z.string(), at: z.string() })
    .nullable(),
  /** Inbound messages since an agent last replied. */
  awaitingReply: z.number().int(),
  snoozedUntil: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type InboxConversation = z.infer<typeof InboxConversationSchema>;

export const InboxAttachmentSchema = z.object({
  name: z.string(),
  mimeType: z.string().nullable(),
  sizeBytes: z.number().int().nullable(),
  /** Provider file reference; downloading provider media is planned. */
  externalRef: z.string().nullable(),
});

export const InboxMessageSchema = z.object({
  messageId: z.string(),
  conversationId: z.string(),
  direction: z.enum(['inbound', 'outbound']),
  text: z.string(),
  attachments: z.array(InboxAttachmentSchema),
  /** Agent who replied (outbound). */
  authorId: z.string().nullable(),
  /** External sender (inbound). */
  accountId: z.string().nullable(),
  externalMessageId: z.string().nullable(),
  clientMessageId: z.string().nullable(),
  deliveryState: z.enum(EXTERNAL_DELIVERY_STATES),
  error: z.string().nullable(),
  attempts: z.number().int(),
  /** Deep link for handoff channels (open the chat in the client's app). */
  handoffUrl: z.string().nullable(),
  /** What would have been sent, in test mode. */
  sandboxRequest: SandboxRequestSchema.nullable(),
  createdAt: z.string().datetime(),
  sentAt: z.string().datetime().nullable(),
});
export type InboxMessage = z.infer<typeof InboxMessageSchema>;

export const InboxNoteSchema = z.object({
  noteId: z.string(),
  conversationId: z.string(),
  authorId: z.string(),
  text: z.string(),
  mentions: z.array(z.string()),
  clientNoteId: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type InboxNote = z.infer<typeof InboxNoteSchema>;

export const INBOX_ACTIVITY_KINDS = [
  'created',
  'assigned',
  'unassigned',
  'team_changed',
  'status_changed',
  'priority_changed',
  'tags_changed',
  'escalated',
  'sla_breached',
  'linked',
  'unlinked',
  'client_merged',
] as const;
export const InboxActivitySchema = z.object({
  activityId: z.string(),
  conversationId: z.string(),
  kind: z.enum(INBOX_ACTIVITY_KINDS),
  actorId: z.string().nullable(),
  /** Human-readable, e.g. "Priority: normal → urgent". */
  summary: z.string(),
  createdAt: z.string().datetime(),
});
export type InboxActivity = z.infer<typeof InboxActivitySchema>;

/** One timeline, three kinds of items. Notes are rendered as internal and are never sent. */
export const InboxTimelineItemSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message'), message: InboxMessageSchema }),
  z.object({ type: z.literal('note'), note: InboxNoteSchema }),
  z.object({ type: z.literal('activity'), activity: InboxActivitySchema }),
]);
export type InboxTimelineItem = z.infer<typeof InboxTimelineItemSchema>;

export const InboxConversationDetailSchema = z.object({
  conversation: InboxConversationSchema,
  client: ClientProfileSchema,
  timeline: z.array(InboxTimelineItemSchema),
});
export type InboxConversationDetail = z.infer<typeof InboxConversationDetailSchema>;

export const ListInboxQuerySchema = z.object({
  /** me | unassigned | <userId> */
  assignee: z.string().max(64).optional(),
  status: z.union([InboxStatusSchema, z.literal('active')]).optional(),
  provider: ConnectorProviderSchema.optional(),
  priority: InboxPrioritySchema.optional(),
  tag: z.string().max(40).optional(),
  teamId: z.string().max(64).optional(),
  sla: z.enum(['breached', 'due_soon']).optional(),
  clientId: z.string().max(64).optional(),
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type ListInboxQuery = z.input<typeof ListInboxQuerySchema>;

export const InboxListSchema = z.object({
  items: z.array(InboxConversationSchema),
  counts: z.object({
    mine: z.number().int(),
    unassigned: z.number().int(),
    active: z.number().int(),
    breached: z.number().int(),
  }),
});
export type InboxList = z.infer<typeof InboxListSchema>;

/** POST /v1/inbox/conversations/:id/replies. Idempotent on clientMessageId. */
export const SendInboxReplyRequestSchema = z.object({
  clientMessageId: ClientIdSchema,
  text: z.string().trim().min(1).max(4000),
  templateId: ServerIdSchema.optional(),
});
export type SendInboxReplyRequest = z.infer<typeof SendInboxReplyRequestSchema>;

/** POST /v1/inbox/conversations/:id/notes. Idempotent on clientNoteId. Never sent externally. */
export const AddInboxNoteRequestSchema = z.object({
  clientNoteId: ClientIdSchema,
  text: z.string().trim().min(1).max(4000),
  mentions: z.array(ServerIdSchema).max(20).default([]),
});
export type AddInboxNoteRequest = z.input<typeof AddInboxNoteRequestSchema>;

export const UpdateInboxConversationRequestSchema = z.object({
  status: InboxStatusSchema.optional(),
  priority: InboxPrioritySchema.optional(),
  assigneeId: ServerIdSchema.nullable().optional(),
  teamId: ServerIdSchema.nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  subject: z.string().trim().min(1).max(200).optional(),
  snoozedUntil: z.string().datetime().nullable().optional(),
});
export type UpdateInboxConversationRequest = z.infer<typeof UpdateInboxConversationRequestSchema>;

export const EscalateRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  /** Usually a supervisor. Defaults to the first escalation contact in settings. */
  toUserId: ServerIdSchema.optional(),
});
export type EscalateRequest = z.infer<typeof EscalateRequestSchema>;

export const AddLinkRequestSchema = z.object({
  module: LinkModuleSchema,
  recordType: z.string().trim().min(1).max(40),
  externalId: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(200),
  url: z.string().url().nullable().default(null),
});
export type AddLinkRequest = z.input<typeof AddLinkRequestSchema>;

/** Handoff channels: start a conversation by hand (the client wrote in their own app). */
export const CreateInboxConversationRequestSchema = z.object({
  connectorId: ServerIdSchema,
  clientName: z.string().trim().min(1).max(120),
  handle: z.string().trim().min(1).max(120),
  subject: z.string().trim().min(1).max(200),
  firstMessage: z.string().trim().max(4000).optional(),
});
export type CreateInboxConversationRequest = z.infer<typeof CreateInboxConversationRequestSchema>;

/** Handoff channels: record a message the client sent in their own app. */
export const LogInboundRequestSchema = z.object({
  text: z.string().trim().min(1).max(4000),
});

export const UpdateClientRequestSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  company: z.string().trim().max(120).nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  title: z.string().trim().max(120).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  ownerId: ServerIdSchema.nullable().optional(),
});
export type UpdateClientRequest = z.infer<typeof UpdateClientRequestSchema>;

/** Merge another client profile (and its identities and conversations) into this one. */
export const MergeClientRequestSchema = z.object({ fromClientId: ServerIdSchema });

export const InboxTemplateSchema = z.object({
  templateId: z.string(),
  name: z.string(),
  /** Typed after "/" in the composer. */
  shortcut: z.string().nullable(),
  /** May use {{client.name}}, {{client.firstName}}, {{client.company}}, {{agent.name}}. */
  body: z.string(),
  createdBy: z.string(),
  updatedAt: z.string().datetime(),
});
export type InboxTemplate = z.infer<typeof InboxTemplateSchema>;

export const UpsertTemplateRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  shortcut: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{1,30}$/, 'lowercase letters, digits and dashes')
    .nullable()
    .default(null),
  body: z.string().trim().min(1).max(4000),
});
export type UpsertTemplateRequest = z.input<typeof UpsertTemplateRequestSchema>;

export const InboxTeamSchema = z.object({
  teamId: z.string(),
  name: z.string().trim().min(1).max(60),
  memberIds: z.array(z.string()).max(200),
});
export type InboxTeam = z.infer<typeof InboxTeamSchema>;

/** Minutes the client may wait for a reply, per priority. */
export const SlaPolicySchema = z.object({
  low: z.number().int().min(5).max(10080),
  normal: z.number().int().min(5).max(10080),
  high: z.number().int().min(5).max(10080),
  urgent: z.number().int().min(5).max(10080),
});
export type SlaPolicy = z.infer<typeof SlaPolicySchema>;

export const InboxSettingsSchema = z.object({
  sla: SlaPolicySchema,
  /** Due-soon warning when this share of the SLA window is used, e.g. 0.75. */
  dueSoonRatio: z.number().min(0.1).max(0.95),
  /** Escalate automatically (priority to urgent, notify contacts) when an SLA is breached. */
  autoEscalateOnBreach: z.boolean(),
  escalationContactIds: z.array(z.string()).max(20),
  /** Give new conversations to the agent in the owning team with the fewest open ones. */
  autoAssign: z.boolean(),
  teams: z.array(InboxTeamSchema).max(50),
});
export type InboxSettings = z.infer<typeof InboxSettingsSchema>;

export const DEFAULT_INBOX_SETTINGS: InboxSettings = {
  sla: { low: 24 * 60, normal: 4 * 60, high: 60, urgent: 15 },
  dueSoonRatio: 0.75,
  autoEscalateOnBreach: false,
  escalationContactIds: [],
  autoAssign: false,
  teams: [],
};

export const InboxAnalyticsSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  totals: z.object({
    conversations: z.number().int(),
    inbound: z.number().int(),
    outbound: z.number().int(),
    resolved: z.number().int(),
    open: z.number().int(),
    unassigned: z.number().int(),
    breachedNow: z.number().int(),
  }),
  /** Minutes; null without data. */
  medianFirstResponseMinutes: z.number().nullable(),
  /** Share of answered conversations whose first reply met the SLA (0..1); null without data. */
  slaMetRate: z.number().nullable(),
  byProvider: z.array(
    z.object({
      provider: ConnectorProviderSchema,
      conversations: z.number().int(),
      inbound: z.number().int(),
    }),
  ),
  byStatus: z.array(z.object({ status: InboxStatusSchema, count: z.number().int() })),
  byPriority: z.array(z.object({ priority: InboxPrioritySchema, count: z.number().int() })),
  agents: z.array(
    z.object({
      userId: z.string(),
      open: z.number().int(),
      resolved: z.number().int(),
      replies: z.number().int(),
      breached: z.number().int(),
      medianFirstResponseMinutes: z.number().nullable(),
    }),
  ),
  daily: z.array(
    z.object({ day: z.string(), inbound: z.number().int(), outbound: z.number().int() }),
  ),
  breaches: z.array(
    z.object({
      conversationId: z.string(),
      subject: z.string(),
      clientName: z.string(),
      assigneeId: z.string().nullable(),
      dueAt: z.string().datetime(),
    }),
  ),
});
export type InboxAnalytics = z.infer<typeof InboxAnalyticsSchema>;

/** Socket event payload: an inbox conversation changed; refetch it (and the list). */
export interface InboxChangedEvent {
  conversationId: string;
  reason: 'message' | 'note' | 'updated' | 'delivery';
}

/** Fills {{client.name}}, {{client.firstName}}, {{client.company}} and {{agent.name}}. Unknown variables stay as typed. */
export function renderTemplate(
  body: string,
  vars: { clientName: string; clientCompany: string | null; agentName: string },
): string {
  const values: Record<string, string> = {
    'client.name': vars.clientName,
    'client.firstName': vars.clientName.split(/\s+/)[0] ?? vars.clientName,
    'client.company': vars.clientCompany ?? '',
    'agent.name': vars.agentName,
    'agent.firstName': vars.agentName.split(/\s+/)[0] ?? vars.agentName,
  };
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, k: string) => values[k] ?? m);
}
