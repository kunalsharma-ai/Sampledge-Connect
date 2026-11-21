import type {
  ApprovalCategory,
  ModuleEventStatus,
  SampledgeModule,
  TaskKind,
  TaskPriority,
  TaskStatus,
  WebhookEventType,
} from '@sampledge/contracts';

/**
 * Documents owned by the integrations and work modules. They live in their own collections
 * (see migration 011-sampledge-modules) and are always accessed through TenantCollection,
 * so every read and write is tenant-scoped.
 */
interface Owned {
  _id: string;
  tenantId: string;
}

/** Connect API key issued to a module's server. Only the SHA-256 hash is stored. */
export interface ModuleKeyDoc extends Owned {
  module: SampledgeModule;
  prefix: string;
  hash: string;
  createdAt: Date;
  createdBy: string;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
}

/** The module's bot user (sender of its cards), one per tenant and module. */
export interface ModuleBotDoc extends Owned {
  module: SampledgeModule;
  userId: string;
}

export interface IntegrationEventDoc extends Owned {
  module: SampledgeModule;
  eventId: string;
  type: string;
  recordType: string;
  recordId: string;
  recordTitle: string;
  source: 'module' | 'admin_test';
  status: ModuleEventStatus;
  actions: string[];
  conversationId: string | null;
  messageId: string | null;
  taskId: string | null;
  approvalId: string | null;
  unmatchedPeople: string[];
  error: string | null;
  receivedAt: Date;
}

export interface IdentityLinkDoc extends Owned {
  module: SampledgeModule;
  externalUserId: string;
  userId: string;
  email: string | null;
  matchedBy: 'email' | 'manual';
  createdAt: Date;
}

export interface LinkedRecordDoc extends Owned {
  module: SampledgeModule;
  recordType: string;
  externalId: string;
  title: string;
  url: string | null;
  conversationId: string | null;
  parent: { type: string; id: string; title: string } | null;
  sensitivity: 'standard' | 'restricted';
  fields: Record<string, string | number | boolean | null>;
  lastEventType: string | null;
  /** Shared module channels (#announcements) use a key instead of a record. */
  channelKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ModuleActionDoc extends Owned {
  module: SampledgeModule;
  type: string;
  record: { type: string; id: string; title: string } | null;
  payload: Record<string, unknown>;
  status: 'sent' | 'failed' | 'test_mode' | 'not_configured';
  statusCode: number | null;
  error: string | null;
  requestedBy: string;
  createdAt: Date;
}

export interface WebhookSubscriptionDoc extends Owned {
  url: string;
  description: string;
  events: WebhookEventType[];
  modules: SampledgeModule[];
  /** Encrypted with the shared settings cipher (it must be recoverable to sign). */
  secretEnc: string;
  active: boolean;
  createdBy: string;
  createdAt: Date;
  lastDeliveryAt: Date | null;
  lastDeliveryStatus: 'delivered' | 'failed' | 'dead' | null;
}

export interface WebhookDeliveryDoc extends Owned {
  subscriptionId: string;
  event: WebhookEventType;
  /** The envelope id; the same event is delivered once per subscription. */
  eventId: string;
  body: string;
  status: 'pending' | 'delivered' | 'failed' | 'dead';
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  nextAttemptAt: Date | null;
  lockedUntil: Date | null;
  createdAt: Date;
}

export interface WorkRecordDoc {
  module: SampledgeModule;
  recordType: string;
  externalId: string;
  title: string;
  url: string | null;
}

export interface TaskDoc extends Owned {
  title: string;
  description: string;
  kind: TaskKind;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeIds: string[];
  createdBy: string;
  dueAt: Date | null;
  conversationId: string | null;
  sourceMessageId: string | null;
  sourceExcerpt: string | null;
  record: WorkRecordDoc | null;
  origin: 'connect' | 'module';
  /** Idempotency: client request id, or `module:<module>:<eventId>`. */
  requestKey: string | null;
  cardMessageId: string | null;
  moduleSync: { status: ModuleActionDoc['status']; at: Date } | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface ApprovalDoc extends Owned {
  title: string;
  description: string;
  category: ApprovalCategory;
  amount: { amountMinor: number; currency: string } | null;
  requesterId: string;
  approverIds: string[];
  policy: 'any' | 'all';
  decisions: { userId: string; decision: 'approve' | 'reject'; comment: string; at: Date }[];
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  conversationId: string | null;
  sourceMessageId: string | null;
  record: WorkRecordDoc | null;
  origin: 'connect' | 'module';
  requestKey: string | null;
  cardMessageId: string | null;
  dueAt: Date | null;
  createdAt: Date;
  decidedAt: Date | null;
}

export interface ProjectDoc extends Owned {
  name: string;
  description: string;
  status: 'active' | 'on_hold' | 'at_risk' | 'completed' | 'cancelled';
  source: 'connect' | 'samptrek';
  externalId: string | null;
  url: string | null;
  conversationId: string | null;
  ownerIds: string[];
  dueAt: Date | null;
  milestones: {
    milestoneId: string;
    title: string;
    dueAt: Date | null;
    status: 'upcoming' | 'due' | 'reached' | 'missed';
  }[];
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}
