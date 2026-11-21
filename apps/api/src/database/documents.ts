import type {
  ConversationKind,
  ConversationRole,
  MessageContent,
  MessageType,
  RecordingKind,
  Recurrence,
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
  /** White-label settings (see BrandingInputSchema); older tenants may have none. */
  branding: Record<string, unknown> | null;
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
  /** Profile (edited by the person on PATCH /v1/me/profile). */
  department?: string | null;
  phone?: string | null;
  bio?: string | null;
  timeZone?: string | null;
  /** Key of the current row in `user_avatars`; a new key per photo. */
  avatarKey?: string | null;
  /** Two-step verification. Secrets are sealed with SETTINGS_ENCRYPTION_KEY. */
  mfa?: UserMfaDoc | null;
}

export interface UserMfaDoc {
  /** Sealed base32 TOTP secret; set once confirmed. */
  totpSecret: string | null;
  /** Sealed secret awaiting a first code. */
  pendingSecret: string | null;
  enabledAt: Date | null;
  /** sha256 of unused recovery codes. */
  recoveryCodeHashes: string[];
  /** Last accepted TOTP step: a code is never accepted twice. */
  lastStep: number;
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
  /** Channels only; absent = everyone may post. */
  postingPolicy?: 'everyone' | 'moderators';
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
  pinned?: { pinnedBy: string; pinnedAt: Date } | null;
  /** Poll messages only. Votes live inline so tallies change atomically under the conversation lock. */
  poll?: PollDoc;
}

export interface PollDoc {
  question: string;
  options: { optionId: string; text: string }[];
  multiple: boolean;
  anonymous: boolean;
  closesAt: Date | null;
  closedAt: Date | null;
  closedBy: string | null;
  /** One row per voter, in first-vote order. */
  votes: { userId: string; optionIds: string[]; at: Date }[];
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
    provider: 'expo' | 'fcm' | 'apns' | 'webpush';
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
  /** Where the bytes live. Absent on older rows (GridFS). */
  storage?: {
    backend: 'gridfs' | 'nextcloud';
    /** Nextcloud test-mode copy, or a live-mode upload that fell back to Connect storage. */
    mirror?: { status: 'copying' | 'copied' | 'failed'; at: Date; error: string | null } | null;
  };
}

export interface NotificationDoc extends TenantOwned {
  userId: string;
  kind: 'mention' | 'reply' | 'alert' | 'task' | 'approval';
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
  /** Occurrence of a recurring meeting. */
  series?: {
    seriesId: string;
    /** Start the rule gave this occurrence (its iCalendar RECURRENCE-ID). */
    originalStartsAt: Date;
    /** Changed on its own (time, title or agenda). */
    detached: boolean;
    /** The series rule and its summary when this occurrence was created. */
    recurrence: Recurrence;
    summary: string;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A recurring meeting's rule and template. Occurrences are ordinary meetings with
 * `series.seriesId`; they are created up to SERIES_HORIZON_DAYS ahead and extended by the
 * sweeper while the rule goes on.
 */
export interface MeetingSeriesDoc extends TenantOwned {
  conversationId: string;
  organizerId: string;
  title: string;
  agenda: string;
  timeZone: string;
  media: 'audio' | 'video';
  remindMinutes: number[];
  recurrence: Recurrence;
  /** First meeting of the current rule (DTSTART in guests' invites). */
  anchorStartsAt: Date;
  durationMinutes: number;
  /** Series-wide answers, copied to newly created occurrences. */
  attendees: MeetingDoc['attendees'];
  guests: MeetingGuestDoc[];
  status: 'active' | 'cancelled';
  /** Start of the last occurrence created so far. */
  lastStartsAt: Date;
  /** The rule has no meetings beyond those already created. */
  complete: boolean;
  /** The series card in the meeting chat. */
  messageId: string | null;
  sequence: number;
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

/** A person's recent searches, newest first (synced to all of their devices). */
export interface SearchHistoryDoc extends TenantOwned {
  userId: string;
  recent: string[];
  updatedAt: Date;
}

/** A profile photo. `_id` is a random key, so its public URL can't be guessed. */
export interface UserAvatarDoc extends TenantOwned {
  userId: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  data: Buffer;
  size: number;
  createdAt: Date;
}

export interface BookmarkDoc extends TenantOwned {
  userId: string;
  messageId: string;
  conversationId: string;
  createdAt: Date;
}

export interface ScheduledMessageDoc extends TenantOwned {
  conversationId: string;
  userId: string;
  clientMessageId: string;
  content: { text: string; mentions: string[] };
  replyToMessageId: string | null;
  sendAt: Date;
  /** 'sending' is a short-lived claim held by the sweeper. */
  status: 'scheduled' | 'sending' | 'sent' | 'failed' | 'cancelled';
  messageId: string | null;
  error: string | null;
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
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

/** One transcript per recording or voice message, from the tenant's own speech-to-text server. */
export interface AiTranscriptDoc extends TenantOwned {
  attachmentId: string;
  conversationId: string;
  messageId: string | null;
  kind: string | null;
  status: 'queued' | 'processing' | 'done' | 'failed';
  text: string | null;
  segments: { startMs: number; endMs: number; text: string }[];
  language: string | null;
  model: string | null;
  error: string | null;
  attempts: number;
  /** null when queued automatically (call recordings). */
  requestedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A public booking page (`/book/<slug>`); slugs are unique across all tenants. */
export interface BookingPageDoc extends TenantOwned {
  slug: string;
  title: string;
  description: string;
  durationMinutes: number;
  hostIds: string[];
  mode: 'all' | 'any';
  bufferMinutes: number;
  minNoticeMinutes: number;
  horizonDays: number;
  media: 'audio' | 'video';
  enabled: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
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
  meeting_series: MeetingSeriesDoc;
  booking_pages: BookingPageDoc;
  user_settings: UserSettingsDoc;
  tenant_settings: TenantSettingsDoc;
  bookmarks: BookmarkDoc;
  search_history: SearchHistoryDoc;
  user_avatars: UserAvatarDoc;
  scheduled_messages: ScheduledMessageDoc;
  ai_embeddings: AiEmbeddingDoc;
  ai_index_state: AiIndexStateDoc;
  ai_summaries: AiSummaryCacheDoc;
  ai_proposals: AiProposalDoc;
  ai_transcripts: AiTranscriptDoc;
  billing_subscriptions: BillingSubscriptionDoc;
  billing_invoices: BillingInvoiceDoc;
}

/** One per tenant. Prices are never stored here: they come from the plan catalog. */
export interface BillingSubscriptionDoc extends TenantOwned {
  planId: string | null;
  status: 'none' | 'trialing' | 'active' | 'past_due' | 'canceled';
  interval: 'month' | 'year';
  seats: number;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  provider: 'manual' | 'stripe' | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeItemId: string | null;
  /** A free trial is offered once per organization. */
  trialUsed: boolean;
  updatedAt: Date;
}

export interface BillingInvoiceDoc extends TenantOwned {
  provider: 'stripe' | 'manual';
  providerInvoiceId: string;
  number: string | null;
  status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
  currency: string;
  total: number;
  periodStart: Date | null;
  periodEnd: Date | null;
  createdAt: Date;
  url: string | null;
  pdfUrl: string | null;
}

/** Global plan catalog (no tenantId): edited by platform operators. */
export interface BillingPlanDoc {
  _id: string;
  name: string;
  description: string;
  currency: string;
  monthlyPerSeat: number;
  yearlyPerSeat: number | null;
  limits: { seats: number | null; storageGb: number | null; recordingHours: number | null };
  features: string[];
  trialDays: number;
  public: boolean;
  active: boolean;
  sortOrder: number;
  updatedAt: Date;
  updatedBy: string | null;
}
