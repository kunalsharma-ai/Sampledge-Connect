import type {
  ConnectorProvider,
  ConversationKind,
  ConversationRole,
  MessageContent,
  MessageType,
  RecordingKind,
  TenantRole,
} from '@sampledge/contracts';

/**
 * MongoDB document shapes. `_id` values are ObjectId hex strings, so every
 * reference field is a plain string and ids round-trip to clients unchanged.
 */
interface TenantOwned {
  _id: string;
  tenantId: string;
}

export interface TenantDoc {
  _id: string;
  slug: string;
  name: string;
  status: 'active' | 'suspended';
  plan: 'trial' | 'starter' | 'professional' | 'business' | 'enterprise';
  branding: {
    primary?: string;
    secondary?: string;
    logoUrl?: string;
    mode?: 'dark' | 'light';
  } | null;
  /** 'shared' today; 'dedicated:<dbName>' is the enterprise upgrade path. */
  dataPlacement: string;
  createdAt: Date;
}

export interface UserDoc extends TenantOwned {
  email: string;
  passwordHash: string;
  displayName: string;
  title: string | null;
  status: 'active' | 'deactivated';
  createdAt: Date;
}

export interface MembershipDoc extends TenantOwned {
  userId: string;
  workspaceId: string;
  role: TenantRole;
  createdAt: Date;
}

export interface WorkspaceDoc extends TenantOwned {
  name: string;
  slug: string;
  isDefault: boolean;
  createdAt: Date;
}

export interface ConversationDoc extends TenantOwned {
  workspaceId: string;
  kind: ConversationKind;
  name: string | null;
  topic: string | null;
  /** Sorted "userA:userB" for DMs; unique per tenant so a pair has one DM. */
  dmKey?: string;
  createdBy: string;
  createdAt: Date;
  archivedAt: Date | null;
  lastChangeSequence: number;
  lastMessageAt: Date | null;
}

export interface ConversationMemberDoc extends TenantOwned {
  conversationId: string;
  userId: string;
  role: ConversationRole;
  joinedAt: Date;
  /** Absent means 'all'. */
  notifyLevel?: 'all' | 'mentions' | 'none';
}

export interface AttachmentSnapshot {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  createdAt: Date;
  recording?: RecordingKind | null;
  durationMs?: number | null;
  deletedAt?: Date | null;
}

export interface MessageDoc extends TenantOwned {
  conversationId: string;
  clientMessageId: string;
  senderId: string;
  senderDeviceId: string;
  messageType: MessageType;
  content: MessageContent;
  attachmentIds: string[];
  replyToMessageId: string | null;
  serverSequence: number;
  changeSequence: number;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  metadata: Record<string, unknown>;
  /** Snapshot of attachment metadata at send time (absent on older messages). */
  attachments?: AttachmentSnapshot[];
  /** Absent on messages nobody reacted to. userIds in reaction order (full list). */
  reactions?: { emoji: string; userIds: string[] }[];
}

export interface ReceiptDoc extends TenantOwned {
  conversationId: string;
  userId: string;
  deliveredUpTo: number;
  readUpTo: number;
  updatedAt: Date;
}

export interface DeviceDoc extends TenantOwned {
  userId: string;
  deviceId: string;
  name: string;
  platform: string;
  refreshTokenHash: string;
  /** Hash of the token this one replaced; presenting it again means theft. */
  previousRefreshTokenHash: string | null;
  refreshExpiresAt: Date;
  createdAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
  /** Push token for this device session; cleared on revoke and sign-out. */
  push?: {
    provider: 'expo' | 'fcm' | 'apns';
    token: string;
    platform: string;
    updatedAt: Date;
  } | null;
}

export interface SyncCheckpointDoc extends TenantOwned {
  userId: string;
  deviceId: string;
  lastSyncAt: Date;
}

export interface AuditLogDoc extends TenantOwned {
  actorId: string | null;
  action: string;
  target: { type: string; id: string } | null;
  ip: string | null;
  userAgent: string | null;
  at: Date;
  metadata: Record<string, unknown>;
}

export interface AttachmentDoc extends TenantOwned {
  conversationId: string;
  uploaderId: string;
  fileName: string;
  mimeType: string;
  /** Declared at ticket creation. */
  sizeBytes: number;
  /** Actually received. */
  storedBytes: number | null;
  sha256: string | null;
  width: number | null;
  height: number | null;
  status: 'pending' | 'ready';
  storageKey: string | null;
  /** Set when attached to a message; an attachment can be used once. */
  messageId: string | null;
  createdAt: Date;
  completedAt: Date | null;
  /** Recording kind; absent/null for ordinary files. */
  recording?: RecordingKind | null;
  durationMs?: number | null;
  /** Call recordings: the call they came from. */
  callId?: string | null;
  /** Set when deleted by a person or the retention policy (bytes removed, row kept for history). */
  deletedAt?: Date | null;
  deletedBy?: string | null;
}

export interface NotificationDoc extends TenantOwned {
  userId: string;
  kind: 'mention' | 'reply';
  conversationId: string;
  messageId: string;
  actorId: string;
  preview: string;
  createdAt: Date;
  readAt: Date | null;
}

export interface CallParticipantDoc {
  userId: string;
  state: 'ringing' | 'joined' | 'left' | 'declined' | 'missed';
  joinedAt: Date | null;
  leftAt: Date | null;
  /** When a `ringing` invite turns into `missed`. */
  ringUntil: Date | null;
}

export interface CallDoc extends TenantOwned {
  conversationId: string;
  media: 'audio' | 'video';
  status: 'live' | 'ended';
  startedBy: string;
  startedAt: Date;
  endedAt: Date | null;
  /** SFU room name. Embeds the tenant and call ids, so tokens can never cross tenants. */
  room: string;
  participants: CallParticipantDoc[];
  /** The system message (call card) this call posted in its conversation. */
  messageId: string | null;
  /** Last join/leave/heartbeat. A live call with nobody joined for a while is closed. */
  lastActivityAt: Date;
  /** The recording in progress (one at a time), or null. */
  recording?: CallRecordingDoc | null;
  /** External guests waiting to be admitted. */
  lobby?: CallLobbyDoc[];
  /** External guests admitted to (or denied from) this call. */
  guests?: CallGuestDoc[];
}

export interface CallLobbyDoc {
  guestId: string;
  meetingId: string;
  name: string;
  email: string;
  requestedAt: Date;
  /** Last poll from the guest's page; stale entries are dropped by the sweeper. */
  seenAt?: Date;
}

export interface CallGuestDoc {
  guestId: string;
  meetingId: string;
  name: string;
  email: string;
  state: 'admitted' | 'joined' | 'left' | 'denied';
  decidedBy: string;
  joinedAt: Date | null;
  leftAt: Date | null;
}

export interface CallRecordingDoc {
  egressId: string | null;
  status: 'starting' | 'active' | 'stopping';
  startedBy: string;
  startedAt: Date;
  audioOnly: boolean;
  /** File name inside the recordings spool directory (we choose it; never taken from a webhook). */
  fileName: string;
}

export interface TenantSettingsDoc extends TenantOwned {
  recordingRetentionDays: number | null;
  callRecordingEnabled: boolean;
  /** Private AI assistant on/off for the organization. Absent means on. */
  aiEnabled?: boolean;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface MeetingDoc extends TenantOwned {
  conversationId: string;
  title: string;
  agenda: string;
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
  organizerId: string;
  attendees: {
    userId: string;
    response: 'pending' | 'accepted' | 'tentative' | 'declined';
    optional: boolean;
  }[];
  media: 'audio' | 'video';
  remindMinutes: number[];
  /** Reminder offsets already delivered for the current start time. */
  remindersSent: number[];
  status: 'scheduled' | 'cancelled';
  /** The meeting card posted in the meeting chat. */
  messageId: string | null;
  /** External guests invited by email. */
  guests?: MeetingGuestDoc[];
  /** iCalendar SEQUENCE: bumped whenever invite emails carry a change. */
  sequence?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MeetingGuestDoc {
  /** Globally unique (an ObjectId), so a join link can find its tenant. */
  guestId: string;
  email: string;
  name: string;
  response: 'pending' | 'accepted' | 'tentative' | 'declined';
  /** Part of the link signature. Rotating it revokes the link. */
  linkNonce: string;
  invite: {
    status: 'sending' | 'sent' | 'failed' | 'not_configured';
    at: Date | null;
    error: string | null;
  };
  invitedBy: string;
  invitedAt: Date;
}

export interface UserSettingsDoc extends TenantOwned {
  userId: string;
  workingHours: { timeZone: string; days: { day: number; start: string; end: string }[] };
  updatedAt: Date;
}

// ---- External messaging gateway and Client Inbox (Phase 3) ----

export interface ConnectorDoc extends TenantOwned {
  provider: ConnectorProvider;
  name: string;
  environment: 'test' | 'live';
  status: 'active' | 'paused' | 'error';
  /** AES-256-GCM sealed JSON of all credential values (see connectors/credential-vault.ts). */
  credentials: string | null;
  /** Previous credentials, still accepted for webhook verification until previousValidUntil. */
  previousCredentials: string | null;
  previousValidUntil: Date | null;
  credentialHints: Record<string, string>;
  credentialsRotatedAt: Date | null;
  /** Random public path segment for the webhook URL; globally unique. Rotating it changes the URL. */
  webhookKey: string;
  teamId: string | null;
  health: {
    lastInboundAt: Date | null;
    lastOutboundAt: Date | null;
    lastError: string | null;
    lastErrorAt: Date | null;
    consecutiveFailures: number;
    circuitOpenUntil: Date | null;
    rejectedWebhooks: number;
  };
  /** Cached provider access token (WeChat, QQ, Teams, Google), sealed. */
  accessToken?: string | null;
  accessTokenExpiresAt?: Date | null;
  createdBy: string;
  createdAt: Date;
  deletedAt: Date | null;
}

/** One external identity (a Telegram user, a Slack user...) mapped to a client profile. */
export interface ExternalAccountDoc extends TenantOwned {
  connectorId: string;
  provider: ConnectorProvider;
  externalUserId: string;
  displayName: string;
  handle: string | null;
  clientId: string;
  createdAt: Date;
}

export interface ClientProfileDoc extends TenantOwned {
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  tags: string[];
  ownerId: string | null;
  /** Set when merged into another profile; the profile is then hidden. */
  mergedInto: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LinkedRecordDoc {
  linkId: string;
  module: 'sampforce' | 'samptrek';
  recordType: string;
  externalId: string;
  label: string;
  url: string | null;
  verified: boolean;
  linkedBy: string;
  linkedAt: Date;
}

export interface ExternalConversationDoc extends TenantOwned {
  connectorId: string;
  provider: ConnectorProvider;
  /** Provider thread key (chat id, channel id + thread...). Unique per connector. */
  externalThreadId: string;
  /** Provider routing data needed to reply (serviceUrl, replyToken, msg_id...). */
  replyContext: Record<string, string>;
  clientId: string;
  accountId: string | null;
  subject: string;
  status: 'open' | 'pending' | 'snoozed' | 'resolved';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  assigneeId: string | null;
  teamId: string | null;
  tags: string[];
  /** When the client is owed a reply (null when nothing is waiting). */
  slaDueAt: Date | null;
  /** When the current wait started (oldest unanswered inbound). */
  waitingSince: Date | null;
  firstResponseAt: Date | null;
  firstResponseMet: boolean | null;
  slaBreachedAt: Date | null;
  escalation: { level: number; reason: string; at: Date; by: string | null } | null;
  links: LinkedRecordDoc[];
  lastMessage: { direction: 'inbound' | 'outbound'; preview: string; at: Date } | null;
  awaitingReply: number;
  snoozedUntil: Date | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExternalMessageDoc extends TenantOwned {
  conversationId: string;
  connectorId: string;
  direction: 'inbound' | 'outbound';
  text: string;
  attachments: {
    name: string;
    mimeType: string | null;
    sizeBytes: number | null;
    externalRef: string | null;
  }[];
  authorId: string | null;
  accountId: string | null;
  /** Provider message id; unique per connector (provider redeliveries are ignored). */
  externalMessageId: string | null;
  /** Agent idempotency key for replies; unique per tenant. */
  clientMessageId: string | null;
  deliveryState:
    'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'handoff' | 'test';
  error: string | null;
  attempts: number;
  nextAttemptAt: Date | null;
  lockedUntil: Date | null;
  handoffUrl: string | null;
  sandboxRequest: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: unknown;
    at: Date;
  } | null;
  createdAt: Date;
  sentAt: Date | null;
}

/** Internal notes. A separate collection on purpose: the outbound worker never reads it. */
export interface InboxNoteDoc extends TenantOwned {
  conversationId: string;
  authorId: string;
  text: string;
  mentions: string[];
  clientNoteId: string;
  createdAt: Date;
}

export interface InboxActivityDoc extends TenantOwned {
  conversationId: string;
  kind: string;
  actorId: string | null;
  summary: string;
  createdAt: Date;
}

export interface InboxTemplateDoc extends TenantOwned {
  name: string;
  shortcut: string | null;
  body: string;
  createdBy: string;
  updatedAt: Date;
}

export interface InboxSettingsDoc extends TenantOwned {
  sla: { low: number; normal: number; high: number; urgent: number };
  dueSoonRatio: number;
  autoEscalateOnBreach: boolean;
  escalationContactIds: string[];
  autoAssign: boolean;
  teams: { teamId: string; name: string; memberIds: string[] }[];
  updatedAt: Date;
  updatedBy: string | null;
}

/** One embedding per message per embedding model (the vector index for semantic search). */
export interface AiEmbeddingDoc extends TenantOwned {
  conversationId: string;
  messageId: string;
  senderId: string;
  /** Embedding model id, e.g. "basic-hash-512" or "model:nomic-embed-text". */
  model: string;
  vector: number[];
  changeSequence: number;
  createdAt: Date;
}

/** How far each conversation is indexed, per embedding model. */
export interface AiIndexStateDoc extends TenantOwned {
  conversationId: string;
  model: string;
  indexedUpTo: number;
  updatedAt: Date;
}

/** Cached summaries, keyed by conversation, message range and engine. Expire after a week. */
export interface AiSummaryCacheDoc extends TenantOwned {
  conversationId: string;
  key: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

/** A drafted action waiting for the person to confirm. Nothing happens until they do. */
export interface AiProposalDoc extends TenantOwned {
  userId: string;
  kind: 'send_message';
  conversationId: string;
  text: string;
  risk: { level: 'normal' | 'sensitive'; categories: string[] };
  status: 'pending' | 'confirmed' | 'dismissed';
  /** Idempotency key for the message sent on confirm. */
  clientMessageId: string;
  messageId: string | null;
  createdAt: Date;
  expiresAt: Date;
  confirmedAt: Date | null;
}

export interface TenantCollections {
  users: UserDoc;
  memberships: MembershipDoc;
  workspaces: WorkspaceDoc;
  conversations: ConversationDoc;
  conversation_members: ConversationMemberDoc;
  messages: MessageDoc;
  message_receipts: ReceiptDoc;
  devices: DeviceDoc;
  sync_checkpoints: SyncCheckpointDoc;
  audit_logs: AuditLogDoc;
  attachments: AttachmentDoc;
  notifications: NotificationDoc;
  calls: CallDoc;
  meetings: MeetingDoc;
  user_settings: UserSettingsDoc;
  tenant_settings: TenantSettingsDoc;
  connectors: ConnectorDoc;
  external_accounts: ExternalAccountDoc;
  client_profiles: ClientProfileDoc;
  external_conversations: ExternalConversationDoc;
  external_messages: ExternalMessageDoc;
  inbox_notes: InboxNoteDoc;
  inbox_activity: InboxActivityDoc;
  inbox_templates: InboxTemplateDoc;
  inbox_settings: InboxSettingsDoc;
  ai_embeddings: AiEmbeddingDoc;
  ai_index_state: AiIndexStateDoc;
  ai_summaries: AiSummaryCacheDoc;
  ai_proposals: AiProposalDoc;
}
