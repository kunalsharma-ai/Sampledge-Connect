import { Dexie, type EntityTable, type Table } from 'dexie';
import type {
  ApiError,
  Attachment,
  Conversation,
  Message,
  MessageStatus,
  Receipt,
} from '@sampledge/contracts';

/** A message as stored locally: either server-confirmed or still pending on this device. */
export interface LocalMessage extends Omit<
  Message,
  'messageId' | 'serverSequence' | 'changeSequence' | 'tenantId'
> {
  clientMessageId: string;
  messageId: string | null;
  tenantId: string;
  /** null until the server assigns one. */
  serverSequence: number | null;
  changeSequence: number | null;
  /** Local lifecycle. For confirmed messages this is 'sent'; delivered/read are derived from receipts. */
  status: MessageStatus;
  /** Local creation time (ms), used to order unsent messages after confirmed ones. */
  localCreatedAt: number;
  error: ApiError | null;
}

export type OutboxState = 'queued' | 'sending' | 'failed';

export interface OutboxItem {
  clientMessageId: string;
  conversationId: string;
  kind: 'send';
  payload: {
    text: string;
    mentions: string[];
    replyToMessageId: string | null;
    composedAt: string;
    /** Completed uploads to attach (uploading needs a connection; sending can wait). */
    attachments?: Attachment[];
  };
  state: OutboxState;
  attempts: number;
  nextAttemptAt: number;
  createdAt: number;
  lastError: ApiError | null;
}

export interface CursorRow {
  conversationId: string;
  afterChangeSequence: number;
}

export type ReceiptRow = Receipt;

/**
 * A reaction change made on this device and not yet confirmed. Keyed by
 * `messageId|emoji`, so toggling while offline coalesces to the last intent
 * (the server treats add/remove idempotently).
 */
export interface PendingReaction {
  key: string;
  messageId: string;
  conversationId: string;
  emoji: string;
  op: 'add' | 'remove';
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
}

/** What a queued action does to a message, so the UI can show it before it reaches the server. */
export type MessageIntent =
  { kind: 'edit'; text: string } | { kind: 'delete' } | { kind: 'pin'; pinned: boolean };

/**
 * Any other change made on this device and not yet confirmed: edits, deletes, pins, poll
 * votes, saved messages, notification settings, task updates, approval decisions, …
 * Keyed so repeated changes to the same thing coalesce to the latest intent
 * (`pin|<messageId>`, `edit|<messageId>`). Sent oldest first; each is an idempotent request.
 */
export interface PendingAction {
  key: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  /** Shown in the Sync Center, e.g. "Edit message", "Vote in poll". */
  label: string;
  conversationId?: string;
  messageId?: string;
  intent?: MessageIntent;
  state: 'queued' | 'failed';
  /** Queue position: kept when a queued change is replaced, so the order never shifts. */
  createdAt: number;
  /** Bumped on every replacement, so a send that finished after an edit keeps the new edit. */
  revision?: number;
  attempts: number;
  nextAttemptAt: number;
  lastError: ApiError | null;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

export const DB_SCHEMA_VERSION = 3;

/**
 * One database per signed-in identity: `sampledge-connect:{tenantId}:{userId}`.
 * Another user signing in on the same browser never opens this database.
 */
export class ConnectDb extends Dexie {
  messages!: EntityTable<LocalMessage, 'clientMessageId'>;
  outbox!: EntityTable<OutboxItem, 'clientMessageId'>;
  conversations!: EntityTable<Conversation, 'conversationId'>;
  cursors!: EntityTable<CursorRow, 'conversationId'>;
  receipts!: Table<ReceiptRow, [string, string]>;
  meta!: EntityTable<MetaRow, 'key'>;
  reactionQueue!: EntityTable<PendingReaction, 'key'>;
  actions!: EntityTable<PendingAction, 'key'>;

  constructor(name: string, options?: ConstructorParameters<typeof Dexie>[1]) {
    super(name, options);
    this.version(1).stores({
      messages:
        'clientMessageId, messageId, [conversationId+serverSequence], [conversationId+localCreatedAt], status',
      outbox: 'clientMessageId, state, [state+nextAttemptAt], conversationId, createdAt',
      conversations: 'conversationId, lastMessageAt',
      cursors: 'conversationId',
      receipts: '[conversationId+userId], conversationId',
      meta: 'key',
    });
    // v2: offline reaction queue. Never edit an earlier version; add a new one.
    this.version(2).stores({ reactionQueue: 'key, nextAttemptAt, messageId' });
    // v3: queue for every other change (edits, deletes, pins, votes, settings, work items).
    this.version(3).stores({ actions: 'key, createdAt, state, messageId' });
  }
}

export function dbNameFor(tenantId: string, userId: string): string {
  return `sampledge-connect:${tenantId}:${userId}`;
}

/**
 * Opens the identity's database. If it cannot be opened (corruption, failed
 * upgrade), salvage the outbox, recreate the database, and restore the outbox,
 * so queued messages survive cache recovery. Cached history is re-synced.
 */
export async function openConnectDb(
  name: string,
  options?: ConstructorParameters<typeof Dexie>[1],
): Promise<{ db: ConnectDb; recovered: boolean }> {
  const db = new ConnectDb(name, options);
  try {
    await db.open();
    return { db, recovered: false };
  } catch (err) {
    let salvaged: OutboxItem[] = [];
    try {
      const raw = new Dexie(name, options);
      await raw.open(); // dynamic mode: opens whatever version exists
      salvaged = (await raw.table('outbox').toArray()) as OutboxItem[];
      raw.close();
    } catch {
      /* nothing readable */
    }
    await Dexie.delete(name);
    const fresh = new ConnectDb(name, options);
    await fresh.open();
    if (salvaged.length)
      await fresh.outbox.bulkPut(salvaged.map((s) => ({ ...s, state: 'queued' as const })));
    void err;
    return { db: fresh, recovered: true };
  }
}
