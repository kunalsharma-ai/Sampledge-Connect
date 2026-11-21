import {
  deriveConfirmedStatus,
  uuidv7,
  type Conversation,
  type ConversationKind,
  type ConversationRole,
  type Attachment,
  type Meeting,
  type Message,
  type MessageStatus,
  type RsvpResponse,
  type NotifyLevel,
  type Reaction,
  type Receipt,
} from '@sampledge/contracts';
import { Emitter } from '../lib/emitter';
import { systemText } from '../lib/systemMessages';
import type {
  ListNotificationsResponse,
  MarkNotificationsReadRequest,
  NotificationKind,
  ServerNotification,
} from '../sync/notificationTypes';
import type { SqlDriver, SqlExecutor } from './driver';

/** A notification from the server feed as cached on this device. */
export type LocalNotification = ServerNotification;

/** A read mark made on this device, waiting to reach the server. */
export interface PendingNotificationRead {
  id: number;
  body: MarkNotificationsReadRequest;
  attempts: number;
}

/** A message as rendered by the UI: server-confirmed or still local. */
export interface LocalMessage {
  clientId: string;
  messageId: string | null;
  conversationId: string;
  senderId: string;
  text: string;
  /** User ids mentioned with @. */
  mentions: string[];
  /** Server messageId of the message this one replies to. */
  replyTo: string | null;
  serverSeq: number | null;
  changeSeq: number | null;
  status: MessageStatus;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  error: string | null;
  /** An edit or delete made on this device that the server has not confirmed yet. */
  pendingOp: MessageOpKind | null;
  /** Server reactions with your unconfirmed changes applied on top. */
  reactions: LocalReaction[];
  attachments: LocalAttachment[];
  /** 'text' for people's messages, 'system' for events the server writes (calls, ...). */
  messageType: string;
  metadata: Record<string, unknown>;
}

/** A file on a message: from the server snapshot, from this device, or both. */
export interface LocalAttachment {
  /** Null until the upload completes. */
  attachmentId: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  /** The copy kept on this device (files you sent from here); shown without downloading. */
  localUri: string | null;
}

/** A file picked in the composer, already copied into app storage. */
export interface PendingFileInput {
  localUri: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
}

export interface PendingFile extends PendingFileInput {
  clientId: string;
  position: number;
  attachmentId: string | null;
}

export interface LocalReaction {
  emoji: string;
  count: number;
  userIds: string[];
  /** You reacted with this emoji (as far as this device knows). */
  mine: boolean;
  /** Your change to this emoji is still queued. */
  pending: boolean;
}

export interface ReactionOp {
  messageId: string;
  emoji: string;
  op: 'add' | 'remove';
  conversationId: string;
  attempts: number;
}

/**
 * Applies queued add/remove intents to the server's reactions for display.
 * `userIds` is capped by the server, so "mine" can only be known from the ids it lists.
 */
export function overlayReactions(
  server: readonly Reaction[],
  ops: readonly Pick<ReactionOp, 'emoji' | 'op'>[],
  selfId: string,
): LocalReaction[] {
  const out: LocalReaction[] = server.map((r) => ({
    emoji: r.emoji,
    count: r.count,
    userIds: [...r.userIds],
    mine: r.userIds.includes(selfId),
    pending: false,
  }));
  for (const o of ops) {
    let r = out.find((x) => x.emoji === o.emoji);
    if (o.op === 'add') {
      if (!r) {
        r = { emoji: o.emoji, count: 0, userIds: [], mine: false, pending: true };
        out.push(r);
      }
      if (!r.mine) {
        r.count += 1;
        r.userIds.push(selfId);
        r.mine = true;
      }
      r.pending = true;
    } else if (r) {
      if (r.mine) {
        r.count -= 1;
        r.userIds = r.userIds.filter((u) => u !== selfId);
        r.mine = false;
      }
      r.pending = true;
    }
  }
  return out.filter((r) => r.count > 0);
}

export type MessageOpKind = 'edit' | 'delete';

export interface MessageOp {
  clientId: string;
  messageId: string;
  conversationId: string;
  kind: MessageOpKind;
  text: string | null;
  mentions: string[];
  attempts: number;
}

export interface LocalConversation {
  conversationId: string;
  kind: ConversationKind;
  name: string | null;
  topic: string | null;
  memberIds: string[];
  archivedAt: string | null;
  /** Your role here; null for a public channel you can read but have not joined. */
  myRole: ConversationRole | null;
  lastChangeSeq: number;
  cursor: number;
  lastMessageAt: string | null;
  lastPreview: string | null;
  unread: number;
  pending: number;
  /** What notifies you here: everything, @mentions only, or nothing. Includes a change not yet sent. */
  notifyLevel: NotifyLevel;
  /** True while a level set on this device has not reached the server. */
  notifyLevelPending: boolean;
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
  notifications: undefined;
  meetings: undefined;
};

/** A meeting from the cache, with your own answer (a choice not yet sent wins). */
export interface LocalMeeting extends Meeting {
  myResponse: RsvpResponse | null;
  /** True while an RSVP made on this device has not reached the server. */
  rsvpPending: boolean;
}

type SentRsvp = Exclude<RsvpResponse, 'pending'>;

interface MessageRow {
  client_id: string;
  message_id: string | null;
  conversation_id: string;
  sender_id: string;
  text: string;
  mentions: string;
  reactions?: string;
  attachments?: string;
  reply_to: string | null;
  server_seq: number | null;
  change_seq: number | null;
  status: MessageStatus;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  error: string | null;
  pending_op?: MessageOpKind | null;
  message_type?: string;
  metadata?: string;
}

interface FileRow {
  client_id: string;
  position: number;
  local_uri: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  attachment_id: string | null;
}

const filesPreview = (files: readonly { fileName: string }[]): string =>
  files.length === 0
    ? ''
    : files.length === 1
      ? `📎 ${files[0]!.fileName}`
      : `📎 ${files.length} files`;

/** Message columns plus the kind of any pending edit/delete. */
const MESSAGE_SELECT =
  'SELECT m.*, o.kind AS pending_op FROM messages m LEFT JOIN message_ops o ON o.client_id = m.client_id';

const parseIds = (raw: string | null | undefined): string[] => {
  try {
    const v = JSON.parse(raw ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

const toMessage = (r: MessageRow): LocalMessage => ({
  clientId: r.client_id,
  messageId: r.message_id,
  conversationId: r.conversation_id,
  senderId: r.sender_id,
  text: r.text,
  mentions: parseIds(r.mentions),
  replyTo: r.reply_to,
  serverSeq: r.server_seq,
  changeSeq: r.change_seq,
  status: r.status,
  createdAt: r.created_at,
  editedAt: r.edited_at,
  deletedAt: r.deleted_at,
  error: r.error,
  pendingOp: r.pending_op ?? null,
  reactions: [],
  attachments: [],
  messageType: r.message_type ?? 'text',
  metadata: parseObject(r.metadata),
});

const parseObject = (raw: string | undefined): Record<string, unknown> => {
  try {
    const v = JSON.parse(raw ?? '{}') as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const parseAttachments = (raw: string | undefined): Attachment[] => {
  try {
    const v = JSON.parse(raw ?? '[]') as unknown;
    return Array.isArray(v) ? (v as Attachment[]) : [];
  } catch {
    return [];
  }
};

const parseReactions = (raw: string | undefined): Reaction[] => {
  try {
    const v = JSON.parse(raw ?? '[]') as unknown;
    return Array.isArray(v) ? (v as Reaction[]) : [];
  } catch {
    return [];
  }
};

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

  /** Signed-in user's id. */
  get selfUserId(): string {
    return this.selfId;
  }

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
    mentions?: readonly string[];
    files?: readonly PendingFileInput[];
  }): Promise<LocalMessage> {
    const text = input.text.trim();
    const files = input.files ?? [];
    if (!text && files.length === 0) throw new Error('Cannot send an empty message');
    const clientId = uuidv7(this.now());
    const createdAt = new Date(this.now()).toISOString();
    await this.db.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO messages (client_id, conversation_id, sender_id, text, mentions, reply_to, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'queued', ?)`,
        [
          clientId,
          input.conversationId,
          this.selfId,
          text,
          JSON.stringify([...new Set(input.mentions ?? [])]),
          input.replyTo ?? null,
          createdAt,
        ],
      );
      await tx.run(
        `INSERT INTO outbox (client_id, conversation_id, state, enqueued_at) VALUES (?, ?, 'pending', ?)`,
        [clientId, input.conversationId, this.now()],
      );
      for (const [position, f] of files.entries()) {
        await tx.run(
          `INSERT INTO message_files (client_id, position, local_uri, file_name, mime_type, size_bytes, width, height)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            clientId,
            position,
            f.localUri,
            f.fileName,
            f.mimeType,
            f.sizeBytes,
            f.width ?? null,
            f.height ?? null,
          ],
        );
      }
      await tx.run('DELETE FROM drafts WHERE conversation_id = ?', [input.conversationId]);
      await tx.run(
        'UPDATE conversations SET last_preview = ?, last_message_at = ? WHERE conversation_id = ?',
        [text || filesPreview(files), createdAt, input.conversationId],
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
          `SELECT MIN(t) AS t FROM (
             SELECT MIN(next_attempt_at) AS t FROM outbox WHERE state = 'pending'
             UNION ALL SELECT MIN(next_attempt_at) FROM message_ops
             UNION ALL SELECT MIN(next_attempt_at) FROM reaction_ops
           )`,
        )
      )?.t ?? undefined
    );
  }

  async pendingCount(): Promise<number> {
    return (
      (
        await this.db.get<{ n: number }>(
          "SELECT (SELECT COUNT(*) FROM outbox WHERE state != 'failed') + (SELECT COUNT(*) FROM message_ops) + (SELECT COUNT(*) FROM reaction_ops) AS n",
        )
      )?.n ?? 0
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

  // ---------------------------------------------------------------- edits and deletes

  /**
   * Edits one of your sent messages. The change shows at once and is queued; the server copy
   * is replaced when it confirms. Several edits before that collapse into the last one.
   */
  async enqueueEdit(
    clientId: string,
    text: string,
    mentions: readonly string[] = [],
  ): Promise<void> {
    const body = text.trim();
    if (!body) throw new Error('Cannot save an empty message');
    await this.enqueueOp(clientId, 'edit', body, [...new Set(mentions)]);
  }

  /** Deletes a message. An unsent one is simply discarded; a sent one is deleted for everyone. */
  async enqueueDelete(clientId: string): Promise<void> {
    const msg = await this.getMessage(clientId);
    if (!msg) return;
    if (!msg.messageId) return this.discardUnsent(clientId);
    await this.enqueueOp(clientId, 'delete', null, []);
  }

  private async enqueueOp(
    clientId: string,
    kind: MessageOpKind,
    text: string | null,
    mentions: string[],
  ): Promise<void> {
    const row = await this.db.get<MessageRow>('SELECT * FROM messages WHERE client_id = ?', [
      clientId,
    ]);
    if (!row?.message_id) throw new Error('This message has not been sent yet');
    if (row.deleted_at) throw new Error('This message was deleted');
    if (kind === 'edit' && row.sender_id !== this.selfId)
      throw new Error('You can only edit your own messages');
    const nowIso = new Date(this.now()).toISOString();
    await this.db.transaction(async (tx) => {
      // prev_* keeps the last server-confirmed copy, so a rejected change can be rolled back.
      await tx.run(
        `INSERT INTO message_ops (client_id, message_id, conversation_id, kind, text, mentions, prev_text, prev_mentions, prev_edited_at, enqueued_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(client_id) DO UPDATE SET kind = excluded.kind, text = excluded.text,
           mentions = excluded.mentions, attempts = 0, next_attempt_at = 0, last_error = NULL`,
        [
          clientId,
          row.message_id,
          row.conversation_id,
          kind,
          text,
          JSON.stringify(mentions),
          row.text,
          row.mentions,
          row.edited_at,
          this.now(),
        ],
      );
      await tx.run('UPDATE messages SET error = NULL WHERE client_id = ?', [clientId]);
      await this.overlayPendingOp(tx, clientId, nowIso);
    });
    this.events.emit('messages', { conversationId: row.conversation_id });
    this.events.emit('outbox', undefined);
    this.events.emit('conversations', undefined);
  }

  /** Shows a pending edit/delete on top of whatever the server last sent. */
  private async overlayPendingOp(tx: SqlExecutor, clientId: string, at?: string): Promise<void> {
    const op = await tx.get<{ kind: MessageOpKind; text: string | null; mentions: string | null }>(
      'SELECT kind, text, mentions FROM message_ops WHERE client_id = ?',
      [clientId],
    );
    if (!op) return;
    const when = at ?? new Date(this.now()).toISOString();
    if (op.kind === 'delete') {
      await tx.run(
        "UPDATE messages SET text = '', mentions = '[]', deleted_at = COALESCE(deleted_at, ?) WHERE client_id = ?",
        [when, clientId],
      );
    } else {
      await tx.run(
        'UPDATE messages SET text = ?, mentions = ?, edited_at = COALESCE(?, edited_at) WHERE client_id = ?',
        [op.text ?? '', op.mentions ?? '[]', at ?? null, clientId],
      );
    }
  }

  async nextDueOp(): Promise<MessageOp | undefined> {
    const r = await this.db.get<{
      client_id: string;
      message_id: string;
      conversation_id: string;
      kind: MessageOpKind;
      text: string | null;
      mentions: string | null;
      attempts: number;
    }>(
      'SELECT * FROM message_ops WHERE next_attempt_at <= ? ORDER BY enqueued_at, client_id LIMIT 1',
      [this.now()],
    );
    return (
      r && {
        clientId: r.client_id,
        messageId: r.message_id,
        conversationId: r.conversation_id,
        kind: r.kind,
        text: r.text,
        mentions: parseIds(r.mentions),
        attempts: r.attempts,
      }
    );
  }

  async markOpRetry(clientId: string, at: number, error: string): Promise<void> {
    await this.db.run(
      'UPDATE message_ops SET attempts = attempts + 1, next_attempt_at = ?, last_error = ? WHERE client_id = ?',
      [at, error, clientId],
    );
    this.events.emit('outbox', undefined);
  }

  /**
   * The server confirmed the change. `expected` guards against a newer local change made while
   * this one was in flight: that one stays queued.
   */
  async completeOp(op: MessageOp, server: Message): Promise<void> {
    await this.db.run(
      `DELETE FROM message_ops WHERE client_id = ? AND kind = ? AND COALESCE(text, '') = ?`,
      [op.clientId, op.kind, op.text ?? ''],
    );
    await this.applyServerMessages([server]);
  }

  /** The server refused the change for good: roll the message back and say why. */
  async failOp(op: MessageOp, reason: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = await tx.get<{
        prev_text: string;
        prev_mentions: string;
        prev_edited_at: string | null;
      }>('SELECT prev_text, prev_mentions, prev_edited_at FROM message_ops WHERE client_id = ?', [
        op.clientId,
      ]);
      if (!row) return;
      await tx.run('DELETE FROM message_ops WHERE client_id = ?', [op.clientId]);
      await tx.run(
        'UPDATE messages SET text = ?, mentions = ?, edited_at = ?, deleted_at = NULL, error = ? WHERE client_id = ?',
        [
          row.prev_text,
          row.prev_mentions,
          row.prev_edited_at,
          `${op.kind === 'edit' ? 'Edit' : 'Delete'} not saved: ${reason}`,
          op.clientId,
        ],
      );
    });
    this.events.emit('messages', { conversationId: op.conversationId });
    this.events.emit('outbox', undefined);
  }

  /** Messages that mention you, newest first (for Activity). */
  async listMentions(limit = 50): Promise<LocalMessage[]> {
    return this.hydrate(
      await this.db.all<MessageRow>(
        `${MESSAGE_SELECT} WHERE m.deleted_at IS NULL AND m.sender_id != ? AND m.mentions LIKE ?
         ORDER BY m.created_at DESC LIMIT ?`,
        [this.selfId, `%"${this.selfId.replace(/[%_"]/g, '')}"%`, limit],
      ),
    );
  }

  /** Row to LocalMessage, with your queued reaction changes overlaid. */
  private async hydrate(rows: readonly MessageRow[]): Promise<LocalMessage[]> {
    const ids = rows.map((r) => r.message_id).filter((id): id is string => !!id);
    const ops = ids.length
      ? await this.db.all<{ message_id: string; emoji: string; op: 'add' | 'remove' }>(
          `SELECT message_id, emoji, op FROM reaction_ops WHERE message_id IN (${ids.map(() => '?').join(',')})
           ORDER BY enqueued_at`,
          ids,
        )
      : [];
    const clientIds = rows.map((r) => r.client_id);
    const files = clientIds.length
      ? await this.db.all<FileRow>(
          `SELECT * FROM message_files WHERE client_id IN (${clientIds.map(() => '?').join(',')})
           ORDER BY client_id, position`,
          clientIds,
        )
      : [];
    return rows.map((r) => {
      const mine = files.filter((f) => f.client_id === r.client_id);
      const server = parseAttachments(r.attachments);
      const attachments: LocalAttachment[] = r.deleted_at
        ? []
        : server.length
          ? server.map((a) => ({
              attachmentId: a.attachmentId,
              fileName: a.fileName,
              mimeType: a.mimeType,
              sizeBytes: a.sizeBytes,
              width: a.width ?? null,
              height: a.height ?? null,
              localUri: mine.find((f) => f.attachment_id === a.attachmentId)?.local_uri ?? null,
            }))
          : mine.map((f) => ({
              attachmentId: f.attachment_id,
              fileName: f.file_name,
              mimeType: f.mime_type,
              sizeBytes: f.size_bytes,
              width: f.width,
              height: f.height,
              localUri: f.local_uri,
            }));
      return {
        ...toMessage(r),
        reactions: overlayReactions(
          parseReactions(r.reactions),
          ops.filter((o) => o.message_id === r.message_id),
          this.selfId,
        ),
        attachments,
      };
    });
  }

  // ---------------------------------------------------------------- files

  /** Files of a queued message, in order, with the upload progress so far. */
  async pendingFiles(clientId: string): Promise<PendingFile[]> {
    return (
      await this.db.all<FileRow>(
        'SELECT * FROM message_files WHERE client_id = ? ORDER BY position',
        [clientId],
      )
    ).map((f) => ({
      clientId: f.client_id,
      position: f.position,
      localUri: f.local_uri,
      fileName: f.file_name,
      mimeType: f.mime_type,
      sizeBytes: f.size_bytes,
      width: f.width,
      height: f.height,
      attachmentId: f.attachment_id,
    }));
  }

  /** The file is on the server and ready; a retry will not upload it again. */
  async markFileUploaded(clientId: string, position: number, attachmentId: string): Promise<void> {
    await this.db.run(
      'UPDATE message_files SET attachment_id = ? WHERE client_id = ? AND position = ?',
      [attachmentId, clientId, position],
    );
    await this.emitForMessage(clientId);
  }

  /** Local copies no row refers to any more (after a discard or eviction), for cleanup. */
  async liveFileUris(): Promise<Set<string>> {
    return new Set(
      (await this.db.all<{ local_uri: string }>('SELECT local_uri FROM message_files')).map(
        (r) => r.local_uri,
      ),
    );
  }

  // ---------------------------------------------------------------- reactions

  /**
   * Adds your reaction if you have not reacted with this emoji, otherwise removes it.
   * Shows at once; offline toggles collapse into the last intent per message and emoji.
   */
  async toggleReaction(clientId: string, emoji: string): Promise<'add' | 'remove'> {
    const msg = await this.getMessage(clientId);
    if (!msg?.messageId) throw new Error('This message has not been sent yet');
    if (msg.deletedAt) throw new Error('This message was deleted');
    const mine = msg.reactions.some((r) => r.emoji === emoji && r.mine);
    const op = mine ? 'remove' : 'add';
    const server = parseReactions(
      (
        await this.db.get<{ reactions: string }>(
          'SELECT reactions FROM messages WHERE client_id = ?',
          [clientId],
        )
      )?.reactions,
    );
    const serverMine = server.some((r) => r.emoji === emoji && r.userIds.includes(this.selfId));
    if ((op === 'add') !== serverMine) {
      await this.db.run(
        `INSERT INTO reaction_ops (message_id, emoji, op, conversation_id, enqueued_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(message_id, emoji) DO UPDATE SET op = excluded.op, attempts = 0, next_attempt_at = 0, last_error = NULL`,
        [msg.messageId, emoji, op, msg.conversationId, this.now()],
      );
    } else {
      // Back to what the server already has: nothing to send.
      await this.db.run('DELETE FROM reaction_ops WHERE message_id = ? AND emoji = ?', [
        msg.messageId,
        emoji,
      ]);
    }
    this.events.emit('messages', { conversationId: msg.conversationId });
    this.events.emit('outbox', undefined);
    return op;
  }

  async nextDueReaction(): Promise<ReactionOp | undefined> {
    const r = await this.db.get<{
      message_id: string;
      emoji: string;
      op: 'add' | 'remove';
      conversation_id: string;
      attempts: number;
    }>(
      'SELECT * FROM reaction_ops WHERE next_attempt_at <= ? ORDER BY enqueued_at, message_id, emoji LIMIT 1',
      [this.now()],
    );
    return (
      r && {
        messageId: r.message_id,
        emoji: r.emoji,
        op: r.op,
        conversationId: r.conversation_id,
        attempts: r.attempts,
      }
    );
  }

  async markReactionRetry(op: ReactionOp, at: number, error: string): Promise<void> {
    await this.db.run(
      'UPDATE reaction_ops SET attempts = attempts + 1, next_attempt_at = ?, last_error = ? WHERE message_id = ? AND emoji = ?',
      [at, error, op.messageId, op.emoji],
    );
    this.events.emit('outbox', undefined);
  }

  /** Server confirmed (or refused) the intent. A newer opposite intent made meanwhile stays queued. */
  async settleReaction(op: ReactionOp, server?: Message): Promise<void> {
    await this.db.run('DELETE FROM reaction_ops WHERE message_id = ? AND emoji = ? AND op = ?', [
      op.messageId,
      op.emoji,
      op.op,
    ]);
    if (server) await this.applyServerMessages([server]);
    else {
      this.events.emit('messages', { conversationId: op.conversationId });
      this.events.emit('outbox', undefined);
    }
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
    // The server removes notifications for deleted messages; drop the cached copies right away.
    const deleted = messages.filter((m) => m.deletedAt).map((m) => m.messageId);
    if (deleted.length) await this.removeNotificationsFor(deleted);
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
      `INSERT INTO messages (client_id, message_id, conversation_id, sender_id, text, mentions, reply_to, server_seq, change_seq, status, created_at, edited_at, deleted_at, reactions, attachments, message_type, metadata, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(client_id) DO UPDATE SET
         message_id = excluded.message_id, text = excluded.text, mentions = excluded.mentions,
         reply_to = excluded.reply_to, server_seq = excluded.server_seq, change_seq = excluded.change_seq,
         status = excluded.status, created_at = excluded.created_at, edited_at = excluded.edited_at,
         deleted_at = excluded.deleted_at, reactions = excluded.reactions,
         attachments = excluded.attachments, message_type = excluded.message_type,
         metadata = excluded.metadata, error = NULL`,
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
        JSON.stringify(m.deletedAt ? [] : (m.reactions ?? [])),
        JSON.stringify(m.deletedAt ? [] : (m.attachments ?? [])),
        m.messageType ?? 'text',
        JSON.stringify(m.metadata ?? {}),
      ],
    );
    // Server accepted it: the send is done, whichever device sent it.
    await tx.run('DELETE FROM outbox WHERE client_id = ?', [m.clientMessageId]);
    // A local edit/delete the server has not confirmed yet stays visible over the server copy.
    await this.overlayPendingOp(tx, m.clientMessageId);
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
        m.deletedAt
          ? 'Message deleted'
          : m.messageType === 'system'
            ? systemText(m.content.text, m.metadata ?? {})
            : m.content.text || filesPreview(m.attachments ?? []),
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
          `INSERT INTO conversations (conversation_id, kind, name, topic, member_ids, archived_at, my_role, last_change_seq, last_message_at, notify_level)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(conversation_id) DO UPDATE SET
             kind = excluded.kind, name = excluded.name, topic = excluded.topic, member_ids = excluded.member_ids,
             archived_at = excluded.archived_at, my_role = excluded.my_role, notify_level = excluded.notify_level,
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
            c.myNotifyLevel ?? 'all',
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
        for (const table of [
          'reaction_ops',
          'message_ops',
          'outbox',
          'messages',
          'receipts',
          'drafts',
          'notifications',
          'conversations',
        ]) {
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
    const r = await this.db.get<MessageRow>(`${MESSAGE_SELECT} WHERE m.client_id = ?`, [clientId]);
    return r && (await this.hydrate([r]))[0];
  }

  /** Looks a message up by its server id (used for reply previews). */
  async getMessageByServerId(messageId: string): Promise<LocalMessage | undefined> {
    const r = await this.db.get<MessageRow>(`${MESSAGE_SELECT} WHERE m.message_id = ?`, [
      messageId,
    ]);
    return r && (await this.hydrate([r]))[0];
  }

  /**
   * Newest `limit` messages, oldest first. Confirmed messages are ordered by serverSequence;
   * local ones (no sequence yet) follow in creation order, as they would be once sent.
   */
  async listMessages(conversationId: string, limit = 200): Promise<LocalMessage[]> {
    const rows = await this.db.all<MessageRow>(
      `SELECT * FROM (
         ${MESSAGE_SELECT} WHERE m.conversation_id = ?
         ORDER BY m.server_seq IS NULL DESC, m.server_seq DESC, m.created_at DESC, m.client_id DESC
         LIMIT ?
       ) ORDER BY server_seq IS NULL, server_seq, created_at, client_id`,
      [conversationId, limit],
    );
    return this.hydrate(rows);
  }

  async listConversations(): Promise<LocalConversation[]> {
    const rows = await this.db.all<{
      conversation_id: string;
      kind: ConversationKind;
      name: string | null;
      topic: string | null;
      member_ids: string;
      archived_at: string | null;
      my_role: ConversationRole | null;
      last_change_seq: number;
      cursor: number;
      last_message_at: string | null;
      last_preview: string | null;
      unread: number;
      pending: number;
      notify_level: NotifyLevel;
      pending_notify_level: NotifyLevel | null;
    }>(
      `SELECT c.*,
         CASE WHEN c.kind = 'channel_public' AND c.my_role IS NULL THEN 0 ELSE
           (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.conversation_id AND m.sender_id != ? AND m.server_seq > c.read_up_to AND m.deleted_at IS NULL)
         END AS unread,
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
      myRole: r.my_role ?? null,
      lastChangeSeq: r.last_change_seq,
      cursor: r.cursor,
      lastMessageAt: r.last_message_at,
      lastPreview: r.last_preview,
      unread: r.unread,
      pending: r.pending,
      notifyLevel: r.pending_notify_level ?? r.notify_level,
      notifyLevelPending: r.pending_notify_level != null,
    }));
  }

  // ---------------------------------------------------------------- notification level

  /** Sets your level here at once; it is sent when online (offline-safe, last choice wins). */
  async setNotifyLevelLocally(conversationId: string, level: NotifyLevel): Promise<void> {
    await this.db.run(
      `UPDATE conversations SET pending_notify_level = CASE WHEN notify_level = ? THEN NULL ELSE ? END
       WHERE conversation_id = ?`,
      [level, level, conversationId],
    );
    this.events.emit('conversations', undefined);
  }

  /** Demo workspace only: there is no server to confirm the level. */
  async upsertLocalNotifyLevel(conversationId: string, level: NotifyLevel): Promise<void> {
    await this.db.run(
      'UPDATE conversations SET notify_level = ?, pending_notify_level = NULL WHERE conversation_id = ?',
      [level, conversationId],
    );
    this.events.emit('conversations', undefined);
  }

  async pendingNotifyLevels(): Promise<{ conversationId: string; level: NotifyLevel }[]> {
    const rows = await this.db.all<{ conversation_id: string; pending_notify_level: NotifyLevel }>(
      'SELECT conversation_id, pending_notify_level FROM conversations WHERE pending_notify_level IS NOT NULL',
    );
    return rows.map((r) => ({ conversationId: r.conversation_id, level: r.pending_notify_level }));
  }

  /**
   * Clears a sent (or refused) change. Only clears it if it is still the level that was sent,
   * so a newer choice made while the request was in flight is kept and sent next.
   */
  async settleNotifyLevel(conversationId: string, sent: NotifyLevel): Promise<void> {
    await this.db.run(
      'UPDATE conversations SET pending_notify_level = NULL WHERE conversation_id = ? AND pending_notify_level = ?',
      [conversationId, sent],
    );
    this.events.emit('conversations', undefined);
  }

  async getConversation(id: string): Promise<LocalConversation | undefined> {
    return (await this.listConversations()).find((c) => c.conversationId === id);
  }

  async searchMessages(query: string, limit = 50): Promise<LocalMessage[]> {
    const q = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return this.hydrate(
      await this.db.all<MessageRow>(
        `${MESSAGE_SELECT} WHERE m.deleted_at IS NULL AND m.text LIKE ? ESCAPE '\\' ORDER BY m.created_at DESC LIMIT ?`,
        [q, limit],
      ),
    );
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
             FROM messages WHERE server_seq IS NOT NULL AND client_id NOT IN (SELECT client_id FROM outbox) AND client_id NOT IN (SELECT client_id FROM message_ops)
           ) WHERE rn > ?
         )`,
        [this.quota.maxMessagesPerConversation],
      );
      const total = await tx.run(
        `DELETE FROM messages WHERE client_id IN (
           SELECT client_id FROM messages WHERE server_seq IS NOT NULL AND client_id NOT IN (SELECT client_id FROM outbox) AND client_id NOT IN (SELECT client_id FROM message_ops)
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
        `DELETE FROM messages WHERE server_seq IS NOT NULL
           AND client_id NOT IN (SELECT client_id FROM outbox)
           AND client_id NOT IN (SELECT client_id FROM message_ops)`,
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
      for (const table of [
        'reaction_ops',
        'message_ops',
        'outbox',
        'messages',
        'receipts',
        'drafts',
        'conversations',
        'notifications',
        'notification_reads',
        'meetings',
        'kv',
      ])
        await tx.run(`DELETE FROM ${table}`);
    });
    this.events.emit('meetings', undefined);
    this.events.emit('conversations', undefined);
    this.events.emit('outbox', undefined);
    this.events.emit('notifications', undefined);
  }

  // ---------------------------------------------------------------- meetings

  /** Stores meetings from the server or a live event. An older copy never replaces a newer one. */
  async upsertMeetings(meetings: readonly Meeting[]): Promise<void> {
    if (meetings.length === 0) return;
    await this.db.transaction(async (tx) => {
      for (const m of meetings) {
        await tx.run(
          `INSERT INTO meetings (meeting_id, conversation_id, starts_at, ends_at, status, updated_at, data)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(meeting_id) DO UPDATE SET
             conversation_id = excluded.conversation_id, starts_at = excluded.starts_at,
             ends_at = excluded.ends_at, status = excluded.status,
             updated_at = excluded.updated_at, data = excluded.data
           WHERE excluded.updated_at >= meetings.updated_at`,
          [
            m.meetingId,
            m.conversationId,
            m.startsAt,
            m.endsAt,
            m.status,
            m.updatedAt,
            JSON.stringify(m),
          ],
        );
      }
    });
    this.events.emit('meetings', undefined);
  }

  /**
   * The server's full list for a window: meetings in it that the server no longer lists for
   * you (you were removed) are dropped, unless an RSVP for them is still waiting to be sent.
   */
  async replaceMeetings(from: string, to: string, meetings: readonly Meeting[]): Promise<void> {
    const keep = new Set(meetings.map((m) => m.meetingId));
    const rows = await this.db.all<{ meeting_id: string }>(
      'SELECT meeting_id FROM meetings WHERE starts_at < ? AND ends_at > ? AND pending_rsvp IS NULL',
      [to, from],
    );
    const gone = rows.map((r) => r.meeting_id).filter((id) => !keep.has(id));
    if (gone.length)
      await this.db.transaction(async (tx) => {
        for (const id of gone) await tx.run('DELETE FROM meetings WHERE meeting_id = ?', [id]);
      });
    await this.upsertMeetings(meetings);
    if (gone.length && meetings.length === 0) this.events.emit('meetings', undefined);
  }

  /** Meetings overlapping [from, to), soonest first. */
  async listMeetings(from: string, to: string): Promise<LocalMeeting[]> {
    const rows = await this.db.all<{ data: string; pending_rsvp: SentRsvp | null }>(
      'SELECT data, pending_rsvp FROM meetings WHERE starts_at < ? AND ends_at > ? ORDER BY starts_at',
      [to, from],
    );
    return rows.map((r) => this.toLocalMeeting(r));
  }

  async getMeeting(meetingId: string): Promise<LocalMeeting | undefined> {
    const row = await this.db.get<{ data: string; pending_rsvp: SentRsvp | null }>(
      'SELECT data, pending_rsvp FROM meetings WHERE meeting_id = ?',
      [meetingId],
    );
    return row ? this.toLocalMeeting(row) : undefined;
  }

  private toLocalMeeting(r: { data: string; pending_rsvp: SentRsvp | null }): LocalMeeting {
    const m = JSON.parse(r.data) as Meeting;
    const mine = m.attendees.find((a) => a.userId === this.selfId)?.response ?? null;
    return { ...m, myResponse: r.pending_rsvp ?? mine, rsvpPending: r.pending_rsvp != null };
  }

  /** Records your answer here at once; it is sent when online (last choice wins). */
  async setRsvpLocally(meetingId: string, response: SentRsvp): Promise<void> {
    await this.db.run('UPDATE meetings SET pending_rsvp = ? WHERE meeting_id = ?', [
      response,
      meetingId,
    ]);
    this.events.emit('meetings', undefined);
  }

  async pendingRsvps(): Promise<{ meetingId: string; response: SentRsvp }[]> {
    const rows = await this.db.all<{ meeting_id: string; pending_rsvp: SentRsvp }>(
      'SELECT meeting_id, pending_rsvp FROM meetings WHERE pending_rsvp IS NOT NULL',
    );
    return rows.map((r) => ({ meetingId: r.meeting_id, response: r.pending_rsvp }));
  }

  /** Demo workspace only: there is no server, so the answer is written straight into the copy. */
  async applyLocalRsvp(meetingId: string, response: SentRsvp): Promise<void> {
    const m = await this.getMeeting(meetingId);
    if (!m) return;
    const { myResponse: _r, rsvpPending: _p, ...meeting } = m;
    const attendees = meeting.attendees.map((a) =>
      a.userId === this.selfId ? { ...a, response } : a,
    );
    await this.db.run('UPDATE meetings SET data = ?, pending_rsvp = NULL WHERE meeting_id = ?', [
      JSON.stringify({ ...meeting, attendees }),
      meetingId,
    ]);
    this.events.emit('meetings', undefined);
  }

  /** Clears a sent (or refused) answer, unless a newer one was chosen while it was in flight. */
  async settleRsvp(meetingId: string, sent: SentRsvp): Promise<void> {
    await this.db.run(
      'UPDATE meetings SET pending_rsvp = NULL WHERE meeting_id = ? AND pending_rsvp = ?',
      [meetingId, sent],
    );
    this.events.emit('meetings', undefined);
  }

  // ---------------------------------------------------------------- notifications

  /** Cached feed, newest first. */
  async listNotifications(limit = 50): Promise<LocalNotification[]> {
    const rows = await this.db.all<NotificationRow>(
      'SELECT * FROM notifications ORDER BY created_at DESC, notification_id DESC LIMIT ?',
      [limit],
    );
    return rows.map(fromNotificationRow);
  }

  /** Unread count as the server last reported it, less what you have read here since. */
  async notificationUnread(): Promise<number> {
    return Number((await this.getSetting('notifications.unread')) ?? 0);
  }

  /**
   * Replaces the cache with the newest page from the server. Called only once read marks made
   * here have been sent, so the server's read state already includes them.
   */
  async replaceNotifications(page: ListNotificationsResponse): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.run('DELETE FROM notifications');
      for (const n of page.items) await insertNotification(tx, n);
      await setKv(tx, 'notifications.unread', String(page.unreadCount));
    });
    this.events.emit('notifications', undefined);
  }

  /** A notification pushed over the socket. Returns false when it was already cached. */
  async addNotification(n: ServerNotification): Promise<boolean> {
    let added = false;
    await this.db.transaction(async (tx) => {
      added = (await insertNotification(tx, n)) > 0;
      if (added && !n.readAt) {
        const unread = Number((await getKv(tx, 'notifications.unread')) ?? 0);
        await setKv(tx, 'notifications.unread', String(unread + 1));
      }
    });
    if (added) this.events.emit('notifications', undefined);
    return added;
  }

  async setNotificationUnread(count: number): Promise<void> {
    await this.setSetting('notifications.unread', String(Math.max(0, count)));
    this.events.emit('notifications', undefined);
  }

  /**
   * Marks notifications read here at once and, when `queue` is set, records the mark so it
   * reaches the server later (it works offline). Returns how many cached items changed.
   */
  async markNotificationsReadLocally(
    target: MarkNotificationsReadRequest,
    opts: { queue: boolean },
  ): Promise<number> {
    const at = new Date(this.now()).toISOString();
    let changed = 0;
    await this.db.transaction(async (tx) => {
      if ('all' in target) {
        changed = (await tx.run('UPDATE notifications SET read_at = ? WHERE read_at IS NULL', [at]))
          .changes;
        await setKv(tx, 'notifications.unread', '0');
      } else {
        const [clause, params] =
          'conversationId' in target
            ? ['conversation_id = ?', [target.conversationId]]
            : [
                `notification_id IN (${target.notificationIds.map(() => '?').join(',')})`,
                target.notificationIds,
              ];
        if (params.length === 0) return;
        changed = (
          await tx.run(`UPDATE notifications SET read_at = ? WHERE read_at IS NULL AND ${clause}`, [
            at,
            ...params,
          ])
        ).changes;
        const unread = Number((await getKv(tx, 'notifications.unread')) ?? 0);
        await setKv(tx, 'notifications.unread', String(Math.max(0, unread - changed)));
      }
      // Nothing cached changed for a conversation or id list: the server has nothing for us either.
      if (opts.queue && (changed > 0 || 'all' in target))
        await tx.run('INSERT INTO notification_reads (body) VALUES (?)', [JSON.stringify(target)]);
    });
    if (changed > 0 || 'all' in target) this.events.emit('notifications', undefined);
    return changed;
  }

  async nextNotificationRead(): Promise<PendingNotificationRead | null> {
    const r = await this.db.get<{ id: number; body: string; attempts: number }>(
      'SELECT * FROM notification_reads ORDER BY id LIMIT 1',
    );
    return r
      ? { id: r.id, body: JSON.parse(r.body) as MarkNotificationsReadRequest, attempts: r.attempts }
      : null;
  }

  async pendingNotificationReads(): Promise<number> {
    return (
      (await this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM notification_reads'))?.n ?? 0
    );
  }

  async settleNotificationRead(id: number): Promise<void> {
    await this.db.run('DELETE FROM notification_reads WHERE id = ?', [id]);
  }

  async retryNotificationRead(id: number): Promise<void> {
    await this.db.run('UPDATE notification_reads SET attempts = attempts + 1 WHERE id = ?', [id]);
  }

  /** Drops cached notifications for messages that were deleted. */
  async removeNotificationsFor(messageIds: readonly string[]): Promise<void> {
    if (messageIds.length === 0) return;
    let removed = 0;
    await this.db.transaction(async (tx) => {
      const marks = messageIds.map(() => '?').join(',');
      const unreadGone =
        (
          await tx.get<{ n: number }>(
            `SELECT COUNT(*) AS n FROM notifications WHERE read_at IS NULL AND message_id IN (${marks})`,
            [...messageIds],
          )
        )?.n ?? 0;
      removed = (
        await tx.run(`DELETE FROM notifications WHERE message_id IN (${marks})`, [...messageIds])
      ).changes;
      if (unreadGone > 0) {
        const unread = Number((await getKv(tx, 'notifications.unread')) ?? 0);
        await setKv(tx, 'notifications.unread', String(Math.max(0, unread - unreadGone)));
      }
    });
    if (removed > 0) this.events.emit('notifications', undefined);
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

interface NotificationRow {
  notification_id: string;
  kind: NotificationKind;
  conversation_id: string;
  message_id: string;
  actor_id: string;
  preview: string;
  created_at: string;
  read_at: string | null;
}

const fromNotificationRow = (r: NotificationRow): LocalNotification => ({
  notificationId: r.notification_id,
  kind: r.kind,
  conversationId: r.conversation_id,
  messageId: r.message_id,
  actorId: r.actor_id,
  preview: r.preview,
  createdAt: r.created_at,
  readAt: r.read_at,
});

async function insertNotification(tx: SqlExecutor, n: ServerNotification): Promise<number> {
  return (
    await tx.run(
      `INSERT OR IGNORE INTO notifications (notification_id, kind, conversation_id, message_id, actor_id, preview, created_at, read_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        n.notificationId,
        n.kind,
        n.conversationId,
        n.messageId,
        n.actorId,
        n.preview,
        n.createdAt,
        n.readAt ?? null,
      ],
    )
  ).changes;
}

async function getKv(tx: SqlExecutor, key: string): Promise<string | undefined> {
  return (await tx.get<{ value: string }>('SELECT value FROM kv WHERE key = ?', [key]))?.value;
}

async function setKv(tx: SqlExecutor, key: string, value: string): Promise<void> {
  await tx.run(
    'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value],
  );
}
