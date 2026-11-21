import type {
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
  ai_embeddings: AiEmbeddingDoc;
  ai_index_state: AiIndexStateDoc;
  ai_summaries: AiSummaryCacheDoc;
  ai_proposals: AiProposalDoc;
}
