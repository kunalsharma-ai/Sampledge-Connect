import type {
  ConversationKind,
  ConversationRole,
  MessageContent,
  MessageType,
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
}
