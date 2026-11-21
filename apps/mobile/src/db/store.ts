import {
  deriveConfirmedStatus,
  uuidv7,
  type Conversation,
  type ConversationKind,
  type Message,
  type MessageStatus,
  type Receipt,
} from '@sampledge/contracts';
import { Emitter } from '../lib/emitter';
import type { SqlDriver, SqlExecutor } from './driver';

/** A message as rendered by the UI: server-confirmed or still local. */
export interface LocalMessage {
  clientId: string;
  messageId: string | null;
  conversationId: string;
  senderId: string;
  text: string;
  replyTo: string | null;
  serverSeq: number | null;
  changeSeq: number | null;
  status: MessageStatus;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  error: string | null;
}

export interface LocalConversation {
  conversationId: string;
  kind: ConversationKind;
  name: string | null;
  topic: string | null;
  memberIds: string[];
  archivedAt: string | null;
  lastChangeSeq: number;
  cursor: number;
  lastMessageAt: string | null;
  lastPreview: string | null;
  unread: number;
  pending: number;
}

export interface OutboxItem {
  clientId: string;
  conversationId: string;
  state: 'pending' | 'inflight' | 'failed';
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
}

export interface QuotaPolicy {
  /** Server-confirmed messages kept per conversation; older ones are re-fetched on demand. */
  maxMessagesPerConversation: number;
  /** Hard cap on cached server-confirmed messages across all conversations. */
  maxMessagesTotal: number;
}

export const DEFAULT_QUOTA: QuotaPolicy = {
  maxMessagesPerConversation: 1_000,
  maxMessagesTotal: 25_000,
};

type StoreEvents = {
  messages: { conversationId: string };
  conversations: undefined;
  outbox: undefined;
  settings: { key: string };
};

interface MessageRow {
  client_id: string;
  message_id: string | null;
  conversation_id: string;
  sender_id: string;
  text: string;
  reply_to: string | null;
  server_seq: number | null;
  change_seq: number | null;
  status: MessageStatus;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  error: string | null;
}

const toMessage = (r: MessageRow): LocalMessage => ({
  clientId: r.client_id,
  messageId: r.message_id,
  conversationId: r.conversation_id,
  senderId: r.sender_id,
  text: r.text,
  replyTo: r.reply_to,
  serverSeq: r.server_seq,
  changeSeq: r.change_seq,
  status: r.status,
  createdAt: r.created_at,
  editedAt: r.edited_at,
  deletedAt: r.deleted_at,
  error: r.error,
});

/** Statuses only the server can confirm. A local row in one of these is never downgraded by local code. */
const CONFIRMED: ReadonlySet<MessageStatus> = new Set(['sent', 'delivered', 'read']);

/**
 * The on-device source of truth for the UI. Every user action is written here first
 * (inside a transaction) and only then handed to the network layer.
 */
export class LocalStore {
  readonly events = new Emitter<StoreEvents>();

  constructor(
    private readonly db: SqlDriver,
    /** Current signed-in user's id, used for receipts and unread counts. */
    private readonly selfId: string,
    private readonly quota: QuotaPolicy = DEFAULT_QUOTA,
    private readonly now: () => number = Date.now,
  ) {}

  // ---------------------------------------------------------------- composing

  async saveDraft(conversationId: string, text: string): Promise<void> {
    if (text.trim().length === 0) {
      await this.db.run('DELETE FROM drafts WHERE conversation_id = ?', [conversationId]);
      return;
    }
    await this.db.run(
      'INSERT INTO drafts (conversation_id, text, updated_at) VALUES (?, ?, ?) ON CONFLICT(conversation_id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at',
      [conversationId, text, this.now()],
    );
  }

  async getDraft(conversationId: string): Promise<string> {
    return (
      (
        await this.db.get<{ text: string }>('SELECT text FROM drafts WHERE conversation_id = ?', [
          conversationId,
        ])
      )?.text ?? ''
    );
  }

  /**
   * Durably queues a message before any network attempt: message row, outbox row and
   * draft removal commit together, so a crash or kill right after "send" loses nothing.
   */
  async enqueueSend(input: {
    conversationId: string;
    text: string;
    replyTo?: string | null;
  }): Promise<LocalMessage> {
    const text = input.text.trim();
    if (!text) throw new Error('Cannot send an empty message');
    const clientId = uuidv7(this.now());
    const createdAt = new Date(this.now()).toISOString();
    await this.db.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO messages (client_id, conversation_id, sender_id, text, reply_to, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'queued', ?)`,
        [clientId, input.conversationId, this.selfId, text, input.replyTo ?? null, createdAt],
      );
      await tx.run(
        `INSERT INTO outbox (client_id, conversation_id, state, enqueued_at) VALUES (?, ?, 'pending', ?)`,
        [clientId, input.conversationId, this.now()],
      );
      await tx.run('DELETE FROM drafts WHERE conversation_id = ?', [input.conversationId]);
      await tx.run(
        'UPDATE conversations SET last_preview = ?, last_message_at = ? WHERE conversation_id = ?',
        [text, createdAt, input.conversationId],
      );
    });
    this.events.emit('messages', { conversationId: input.conversationId });
    this.events.emit('outbox', undefined);
    this.events.emit('conversations', undefined);
    return (await this.getMessage(clientId))!;
  }

  // ---------------------------------------------------------------- outbox

  /** Oldest due item. The queue is drained strictly in enqueue order so per-conversation order holds. */
  async nextDueOutbox(): Promise<OutboxItem | undefined> {
    const row = await this.db.get<{
      client_id: string;
      conversation_id: string;
      state: OutboxItem['state'];
      attempts: number;
      next_attempt_at: number;
      last_error: string | null;
    }>(
      `SELECT * FROM outbox WHERE state = 'pending' AND next_attempt_at <= ? ORDER BY enqueued_at, client_id LIMIT 1`,
      [this.now()],
    );
    return (
      row && {
        clientId: row.client_id,
        conversationId: row.conversation_id,
        state: row.state,
        attempts: row.attempts,
        nextAttemptAt: row.next_attempt_at,
        lastError: row.last_error,
      }
    );
  }

  /** Earliest time a pending item becomes due, for scheduling the next drain. */
  async nextOutboxWakeAt(): Promise<number | undefined> {
    return (
      (
        await this.db.get<{ t: number | null }>(
          "SELECT MIN(next_attempt_at) AS t FROM outbox WHERE state = 'pending'",
        )
      )?.t ?? undefined
    );
  }

  async pendingCount(): Promise<number> {
    return (
      (await this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM outbox WHERE state != 'failed'"))
        ?.n ?? 0
    );
  }

  async markSending(clientId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.run(
        "UPDATE outbox SET state = 'inflight', attempts = attempts + 1 WHERE client_id = ?",
        [clientId],
      );
      await tx.run(
        "UPDATE messages SET status = 'sending', error = NULL WHERE client_id = ? AND status IN ('queued','failed')",
        [clientId],
      );
    });
    await this.emitForMessage(clientId);
  }

  /** Transient failure: back to queued and retried at `nextAttemptAt`. */
  async markRetry(clientId: string, nextAttemptAt: number, error: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.run(
        "UPDATE outbox SET state = 'pending', next_attempt_at = ?, last_error = ? WHERE client_id = ?",
        [nextAttemptAt, error, clientId],
      );
      await tx.run(
        "UPDATE messages SET status = 'queued', error = ? WHERE client_id = ? AND status = 'sending'",
        [error, clientId],
      );
    });
    await this.emitForMessage(clientId);
  }

  /** Permanent failure: kept on the device and shown as failed until the user retries or discards it. */
  async markFailed(clientId: string, error: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.run("UPDATE outbox SET state = 'failed', last_error = ? WHERE client_id = ?", [
        error,
        clientId,
      ]);
      await tx.run(
        "UPDATE messages SET status = 'failed', error = ? WHERE client_id = ? AND status IN ('queued','sending')",
        [error, clientId],
      );
    });
    await this.emitForMessage(clientId);
  }

  /** Manual retry from the UI; also used for "retry all" after a session is restored. */
  async retry(clientId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.run(
        "UPDATE outbox SET state = 'pending', next_attempt_at = 0, attempts = 0 WHERE client_id = ?",
        [clientId],
      );
      await tx.run(
        "UPDATE messages SET status = 'queued', error = NULL WHERE client_id = ? AND status = 'failed'",
        [clientId],
      );
    });
    await this.emitForMessage(clientId);
  }

  /** User chose to discard an unsent message. Confirmed messages cannot be discarded this way. */
  async discardUnsent(clientId: string): Promise<void> {
    const msg = await this.getMessage(clientId);
    if (!msg || CONFIRMED.has(msg.status)) return;
    await this.db.transaction(async (tx) => {
      await tx.run('DELETE FROM outbox WHERE client_id = ?', [clientId]);
      await tx.run('DELETE FROM messages WHERE client_id = ?', [clientId]);
    });
    this.events.emit('messages', { conversationId: msg.conversationId });
    this.events.emit('outbox', undefined);
  }

  /** After an app crash, anything left "inflight" was never acknowledged; requeue it (the server dedupes). */
  async requeueInflight(): Promise<number> {
    const r = await this.db.transaction(async (tx) => {
      await tx.run("UPDATE messages SET status = 'queued' WHERE status = 'sending'");
      return tx.run("UPDATE outbox SET state = 'pending' WHERE state = 'inflight'");
    });
    if (r.changes) this.events.emit('outbox', undefined);
    return r.changes;
  }

  // ---------------------------------------------------------------- applying server state

  /**
   * Upserts server messages (from an ack, a sync page or a socket event). Idempotent and
   * order-independent: a change is applied only if its changeSequence is newer than what
   * we hold, and a row matching a local pending message (same clientMessageId) is merged,
   * which also reconciles messages this user sent from another device.
   */
  async applyServerMessages(messages: readonly Message[]): Promise<void> {
    if (messages.length === 0) return;
    const touched = new Set<string>();
    await this.db.transaction(async (tx) => {
      for (const m of messages) {
        await this.applyOne(tx, m);
        touched.add(m.conversationId);
      }
      for (const id of touched) await this.recomputeOwnStatuses(tx, id);
    });
    for (const id of touched) this.events.emit('messages', { conversationId: id });
    this.events.emit('conversations', undefined);
    this.events.emit('outbox', undefined);
  }

  private async applyOne(tx: SqlExecutor, m: Message): Promise<void> {
    const existing = await tx.get<{ change_seq: number | null; status: MessageStatus }>(
      'SELECT change_seq, status FROM messages WHERE client_id = ?',
      [m.clientMessageId],
    );
    if (existing?.change_seq != null && existing.change_seq >= m.changeSequence) return; // stale or replayed
    // Keep a receipt-derived status (delivered/read) we already computed; otherwise it is now `sent`.
    const status: MessageStatus =
      existing && CONFIRMED.has(existing.status) ? existing.status : 'sent';
    await tx.run(
      `INSERT INTO messages (client_id, message_id, conversation_id, sender_id, text, mentions, reply_to, server_seq, change_seq, status, created_at, edited_at, deleted_at, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(client_id) DO UPDATE SET
         message_id = excluded.message_id, text = excluded.text, mentions = excluded.mentions,
         reply_to = excluded.reply_to, server_seq = excluded.server_seq, change_seq = excluded.change_seq,
         status = excluded.status, created_at = excluded.created_at, edited_at = excluded.edited_at,
         deleted_at = excluded.deleted_at, error = NULL`,
      [
        m.clientMessageId,
        m.messageId,
        m.conversationId,
        m.senderId,
        m.deletedAt ? '' : m.content.text,
        JSON.stringify(m.content.mentions ?? []),
        m.replyToMessageId ?? null,
        m.serverSequence,
        m.changeSequence,
        status,
        m.createdAt,
        m.editedAt ?? null,
        m.deletedAt ?? null,
      ],
    );
    // Server accepted it: the send is done, whichever device sent it.
    await tx.run('DELETE FROM outbox WHERE client_id = ?', [m.clientMessageId]);
    await tx.run(
      `UPDATE conversations SET
         last_change_seq = MAX(last_change_seq, ?),
         last_message_at = CASE WHEN last_message_at IS NULL OR last_message_at < ? THEN ? ELSE last_message_at END,
         last_preview = CASE WHEN last_message_at IS NULL OR last_message_at <= ? THEN ? ELSE last_preview END
       WHERE conversation_id = ?`,
      [
        m.changeSequence,
        m.createdAt,
        m.createdAt,
        m.createdAt,
        m.deletedAt ? 'Message deleted' : m.content.text,
        m.conversationId,
      ],
    );
  }

  /** Upserts the authoritative conversation list from sync or a socket event. Never moves the cursor. */
  async upsertConversations(conversations: readonly Conversation[]): Promise<void> {
    if (conversations.length === 0) return;
    await this.db.transaction(async (tx) => {
      for (const c of conversations) {
        await tx.run(
          `INSERT INTO conversations (conversation_id, kind, name, topic, member_ids, archived_at, my_role, last_change_seq, last_message_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(conversation_id) DO UPDATE SET
             kind = excluded.kind, name = excluded.name, topic = excluded.topic, member_ids = excluded.member_ids,
             archived_at = excluded.archived_at, my_role = excluded.my_role,
             last_change_seq = MAX(conversations.last_change_seq, excluded.last_change_seq),
             last_message_at = COALESCE(MAX(conversations.last_message_at, excluded.last_message_at), excluded.last_message_at, conversations.last_message_at)`,
          [
            c.conversationId,
            c.kind,
            c.name,
            c.topic,
            JSON.stringify(c.memberIds),
            c.archivedAt,
            c.myRole,
            c.lastChangeSequence,
            c.lastMessageAt,
          ],
        );
      }
    });
    this.events.emit('conversations', undefined);
  }

  /** Lost access: purge the conversation, its cache and any unsent work for it. */
  async purgeConversations(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.transaction(async (tx) => {
      for (const id of ids) {
        for (const table of ['outbox', 'messages', 'receipts', 'drafts', 'conversations']) {
          await tx.run(`DELETE FROM ${table} WHERE conversation_id = ?`, [id]);
        }
      }
    });
    this.events.emit('conversations', undefined);
    this.events.emit('outbox', undefined);
  }

  async setCursor(conversationId: string, cursor: number): Promise<void> {
    await this.db.run(
      'UPDATE conversations SET cursor = MAX(cursor, ?) WHERE conversation_id = ?',
      [cursor, conversationId],
    );
  }

  async cursors(): Promise<{ conversationId: string; afterChangeSequence: number }[]> {
    return (
      await this.db.all<{ conversation_id: string; cursor: number }>(
        'SELECT conversation_id, cursor FROM conversations',
      )
    ).map((r) => ({
      conversationId: r.conversation_id,
      afterChangeSequence: r.cursor,
    }));
  }

  /** Receipts are watermarks; they only ever move forward. */
  async applyReceipts(
    receipts: readonly Pick<Receipt, 'conversationId' | 'userId' | 'deliveredUpTo' | 'readUpTo'>[],
  ): Promise<void> {
    if (receipts.length === 0) return;
    const touched = new Set<string>();
    await this.db.transaction(async (tx) => {
      for (const r of receipts) {
        await tx.run(
          `INSERT INTO receipts (conversation_id, user_id, delivered_up_to, read_up_to) VALUES (?, ?, ?, ?)
           ON CONFLICT(conversation_id, user_id) DO UPDATE SET
             delivered_up_to = MAX(delivered_up_to, excluded.delivered_up_to),
             read_up_to = MAX(read_up_to, excluded.read_up_to)`,
          [r.conversationId, r.userId, r.deliveredUpTo, r.readUpTo],
        );
        if (r.userId === this.selfId) {
          await tx.run(
            'UPDATE conversations SET read_up_to = MAX(read_up_to, ?) WHERE conversation_id = ?',
            [r.readUpTo, r.conversationId],
          );
        }
        touched.add(r.conversationId);
      }
      for (const id of touched) await this.recomputeOwnStatuses(tx, id);
    });
    for (const id of touched) this.events.emit('messages', { conversationId: id });
    this.events.emit('conversations', undefined);
  }

  /** Marks the conversation read locally up to `seq`. Returns true if the watermark moved (so the caller should ack). */
  async markReadLocally(conversationId: string, seq: number): Promise<boolean> {
    const r = await this.db.run(
      'UPDATE conversations SET read_up_to = ? WHERE conversation_id = ? AND read_up_to < ?',
      [seq, conversationId, seq],
    );
    if (r.changes) this.events.emit('conversations', undefined);
    return r.changes > 0;
  }

  private async recomputeOwnStatuses(tx: SqlExecutor, conversationId: string): Promise<void> {
    const conv = await tx.get<{ member_ids: string }>(
      'SELECT member_ids FROM conversations WHERE conversation_id = ?',
      [conversationId],
    );
    if (!conv) return;
    const memberIds = JSON.parse(conv.member_ids) as string[];
    const receipts = (
      await tx.all<{ user_id: string; delivered_up_to: number; read_up_to: number }>(
        'SELECT user_id, delivered_up_to, read_up_to FROM receipts WHERE conversation_id = ?',
        [conversationId],
      )
    ).map((r) => ({ userId: r.user_id, deliveredUpTo: r.delivered_up_to, readUpTo: r.read_up_to }));
    const own = await tx.all<{ client_id: string; server_seq: number; status: MessageStatus }>(
      "SELECT client_id, server_seq, status FROM messages WHERE conversation_id = ? AND sender_id = ? AND status IN ('sent','delivered')",
      [conversationId, this.selfId],
    );
    for (const m of own) {
      const next = deriveConfirmedStatus({
        serverSequence: m.server_seq,
        senderId: this.selfId,
        memberIds,
        receipts,
      });
      if (next !== m.status && rank(next) > rank(m.status)) {
        await tx.run('UPDATE messages SET status = ? WHERE client_id = ?', [next, m.client_id]);
      }
    }
  }

  // ---------------------------------------------------------------- reading

  async getMessage(clientId: string): Promise<LocalMessage | undefined> {
    const r = await this.db.get<MessageRow>('SELECT * FROM messages WHERE client_id = ?', [
      clientId,
    ]);
    return r && toMessage(r);
  }

  /**
   * Newest `limit` messages, oldest first. Confirmed messages are ordered by serverSequence;
   * local ones (no sequence yet) follow in creation order, as they would be once sent.
   */
  async listMessages(conversationId: string, limit = 200): Promise<LocalMessage[]> {
    const rows = await this.db.all<MessageRow>(
      `SELECT * FROM (
         SELECT * FROM messages WHERE conversation_id = ?
         ORDER BY server_seq IS NULL DESC, server_seq DESC, created_at DESC, client_id DESC
         LIMIT ?
       ) ORDER BY server_seq IS NULL, server_seq, created_at, client_id`,
      [conversationId, limit],
    );
    return rows.map(toMessage);
  }

  async listConversations(): Promise<LocalConversation[]> {
    const rows = await this.db.all<{
      conversation_id: string;
      kind: ConversationKind;
      name: string | null;
      topic: string | null;
      member_ids: string;
      archived_at: string | null;
      last_change_seq: number;
      cursor: number;
      last_message_at: string | null;
      last_preview: string | null;
      unread: number;
      pending: number;
    }>(
      `SELECT c.*,
         (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.conversation_id AND m.sender_id != ? AND m.server_seq > c.read_up_to AND m.deleted_at IS NULL) AS unread,
         (SELECT COUNT(*) FROM outbox o WHERE o.conversation_id = c.conversation_id) AS pending
       FROM conversations c
       ORDER BY c.archived_at IS NOT NULL, COALESCE(c.last_message_at, '') DESC`,
      [this.selfId],
    );
    return rows.map((r) => ({
      conversationId: r.conversation_id,
      kind: r.kind,
      name: r.name,
      topic: r.topic,
      memberIds: JSON.parse(r.member_ids) as string[],
      archivedAt: r.archived_at,
      lastChangeSeq: r.last_change_seq,
      cursor: r.cursor,
      lastMessageAt: r.last_message_at,
      lastPreview: r.last_preview,
      unread: r.unread,
      pending: r.pending,
    }));
  }

  async getConversation(id: string): Promise<LocalConversation | undefined> {
    return (await this.listConversations()).find((c) => c.conversationId === id);
  }

  async searchMessages(query: string, limit = 50): Promise<LocalMessage[]> {
    const q = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return (
      await this.db.all<MessageRow>(
        "SELECT * FROM messages WHERE deleted_at IS NULL AND text LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT ?",
        [q, limit],
      )
    ).map(toMessage);
  }

  // ---------------------------------------------------------------- settings

  async getSetting(key: string): Promise<string | undefined> {
    return (await this.db.get<{ value: string }>('SELECT value FROM kv WHERE key = ?', [key]))
      ?.value;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.db.run(
      'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value],
    );
    this.events.emit('settings', { key });
  }

  // ---------------------------------------------------------------- quota

  /**
   * Evicts the oldest server-confirmed messages beyond the quota. Unsent messages
   * (anything in the outbox, or not yet confirmed) are never evicted.
   */
  async enforceQuota(): Promise<number> {
    let removed = 0;
    await this.db.transaction(async (tx) => {
      const perConv = await tx.run(
        `DELETE FROM messages WHERE client_id IN (
           SELECT client_id FROM (
             SELECT client_id, ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY server_seq DESC) AS rn
             FROM messages WHERE server_seq IS NOT NULL AND client_id NOT IN (SELECT client_id FROM outbox)
           ) WHERE rn > ?
         )`,
        [this.quota.maxMessagesPerConversation],
      );
      const total = await tx.run(
        `DELETE FROM messages WHERE client_id IN (
           SELECT client_id FROM messages WHERE server_seq IS NOT NULL AND client_id NOT IN (SELECT client_id FROM outbox)
           ORDER BY created_at DESC LIMIT -1 OFFSET ?
         )`,
        [this.quota.maxMessagesTotal],
      );
      removed = perConv.changes + total.changes;
    });
    if (removed) this.events.emit('conversations', undefined);
    return removed;
  }

  async stats(): Promise<{
    cachedMessages: number;
    queued: number;
    failed: number;
    conversations: number;
  }> {
    const r = await this.db.get<{ cached: number; queued: number; failed: number; convs: number }>(
      `SELECT (SELECT COUNT(*) FROM messages WHERE server_seq IS NOT NULL) AS cached,
              (SELECT COUNT(*) FROM outbox WHERE state != 'failed') AS queued,
              (SELECT COUNT(*) FROM outbox WHERE state = 'failed') AS failed,
              (SELECT COUNT(*) FROM conversations) AS convs`,
    );
    return {
      cachedMessages: r?.cached ?? 0,
      queued: r?.queued ?? 0,
      failed: r?.failed ?? 0,
      conversations: r?.convs ?? 0,
    };
  }

  async retryAllFailed(): Promise<number> {
    const r = await this.db.transaction(async (tx) => {
      await tx.run("UPDATE messages SET status = 'queued', error = NULL WHERE status = 'failed'");
      return tx.run(
        "UPDATE outbox SET state = 'pending', next_attempt_at = 0, attempts = 0 WHERE state = 'failed'",
      );
    });
    this.events.emit('outbox', undefined);
    this.events.emit('conversations', undefined);
    return r.changes;
  }

  /**
   * Drops server-confirmed history and resets cursors so it downloads again.
   * Unsent messages and drafts are kept.
   */
  async clearSyncedCache(): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.run(
        'DELETE FROM messages WHERE server_seq IS NOT NULL AND client_id NOT IN (SELECT client_id FROM outbox)',
      );
      await tx.run('DELETE FROM receipts');
      await tx.run('UPDATE conversations SET cursor = 0');
    });
    this.events.emit('conversations', undefined);
  }

  // ---------------------------------------------------------------- lifecycle

  /** Sign-out wipe of every cached row. Callers check pendingCount() first so the user can be warned. */
  async wipe(): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const table of ['outbox', 'messages', 'receipts', 'drafts', 'conversations', 'kv'])
        await tx.run(`DELETE FROM ${table}`);
    });
    this.events.emit('conversations', undefined);
    this.events.emit('outbox', undefined);
  }

  private async emitForMessage(clientId: string): Promise<void> {
    const m = await this.getMessage(clientId);
    if (m) this.events.emit('messages', { conversationId: m.conversationId });
    this.events.emit('outbox', undefined);
  }
}

const RANK: Record<MessageStatus, number> = {
  draft: 0,
  failed: 1,
  queued: 2,
  sending: 3,
  sent: 4,
  delivered: 5,
  read: 6,
};
const rank = (s: MessageStatus) => RANK[s];
