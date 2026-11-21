import {
  backoffDelay,
  type Message,
  type SendMessageAck,
  type SendMessageRequest,
  type SetReactionRequest,
} from '@sampledge/contracts';
import type { LocalStore, MessageOp, PendingFile } from '../db/store';
import type { QueuedAction } from '../db/work';
import { TransportError } from './transport';

export interface OutboxOptions {
  store: LocalStore;
  /** Sends one message; the socket path is preferred and REST is the fallback (see engine). */
  send: (req: SendMessageRequest) => Promise<SendMessageAck>;
  /** Saves an edit of a sent message (PATCH /v1/messages/:id). */
  edit?: (messageId: string, text: string, mentions: string[]) => Promise<Message>;
  /** Deletes a sent message for everyone (DELETE /v1/messages/:id). */
  remove?: (messageId: string) => Promise<Message>;
  /** Uploads one file (ticket, bytes, complete) and returns its attachment id. */
  upload?: (file: PendingFile, conversationId: string) => Promise<string>;
  /** Adds or removes your reaction (socket `reaction:set`, REST PUT/DELETE as fallback). */
  react?: (req: SetReactionRequest) => Promise<Message>;
  /**
   * Sends one queued action (pin, save, poll, task, approval, scheduled message) and applies
   * the server's answer to the store, completing the action.
   */
  runAction?: (action: QueuedAction) => Promise<void>;
  /** The server refused an action for good: drop it (server state wins) or keep it as failed. */
  refuseAction?: (action: QueuedAction, err: TransportError) => Promise<void>;
  /** Whether it is worth trying right now (network up, signed in, not paused). */
  canSend: () => boolean;
  /** Called when the server says the session is no longer valid. Sending pauses until resumed. */
  onAuthError: (err: TransportError) => void;
  /** Schedule a future drain; returns a cancel function. */
  schedule?: (fn: () => void, ms: number) => () => void;
  now?: () => number;
  random?: () => number;
  /** Retryable server errors (5xx/429) become `failed` after this many attempts so the user sees them. */
  maxServerAttempts?: number;
}

/**
 * Drains the durable outbox one message at a time, oldest first.
 *
 * - Network failures: message goes back to `queued` and is retried with exponential
 *   backoff and full jitter, indefinitely (it is never dropped).
 * - Retryable server errors: same, up to `maxServerAttempts`, then `failed`.
 * - Non-retryable errors (validation, forbidden...): `failed` immediately, with the reason.
 * - Auth errors: the item is requeued and draining pauses until the session is restored.
 *
 * Retrying a clientMessageId is always safe because the server is idempotent on it.
 */
export class OutboxProcessor {
  private running: Promise<void> | null = null;
  private rerun = false;
  private cancelTimer: (() => void) | null = null;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => () => void;

  constructor(private readonly opts: OutboxOptions) {
    this.now = opts.now ?? Date.now;
    this.schedule =
      opts.schedule ??
      ((fn, ms) => {
        const t = setTimeout(fn, ms);
        return () => clearTimeout(t);
      });
  }

  /** Request a drain. Concurrent calls coalesce into at most one extra pass. */
  kick(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.rerun = false;
          await this.drainOnce();
        } while (this.rerun);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  stop(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
  }

  private async drainOnce(): Promise<void> {
    const { store } = this.opts;
    while (this.opts.canSend()) {
      const item = await store.nextDueOutbox();
      if (!item) break;
      const msg = await store.getMessage(item.clientId);
      if (!msg) continue; // cascade-deleted
      await store.markSending(item.clientId);
      try {
        // Files first: each is uploaded once; a retry resumes with the ones not yet on the server.
        const files = await store.pendingFiles(item.clientId);
        const attachmentIds: string[] = [];
        for (const f of files) {
          let id = f.attachmentId;
          if (!id) {
            if (!this.opts.upload)
              throw new TransportError('File uploads are not available', 'not_configured');
            id = await this.opts.upload(f, msg.conversationId);
            await store.markFileUploaded(f.clientId, f.position, id);
          }
          attachmentIds.push(id);
        }
        const ack = await this.opts.send({
          conversationId: msg.conversationId,
          clientMessageId: msg.clientId,
          messageType: 'text',
          content: { text: msg.text, mentions: msg.mentions },
          attachmentIds,
          replyToMessageId: msg.replyTo,
          composedAt: msg.createdAt,
        });
        await store.applyServerMessages([ack.message]);
      } catch (raw) {
        const err =
          raw instanceof TransportError ? raw : new TransportError(String(raw), 'network');
        const attempts = item.attempts + 1;
        if (err.isAuth) {
          await store.markRetry(item.clientId, this.now(), 'Waiting for sign-in');
          this.opts.onAuthError(err);
          break;
        }
        if (err.kind === 'network' || err.kind === 'not_configured') {
          await store.markRetry(
            item.clientId,
            this.now() + backoffDelay(attempts, { random: this.opts.random }),
            err.message,
          );
          break; // the link is down: stop and wait for the timer or a connectivity change
        }
        if (err.retryable && attempts < (this.opts.maxServerAttempts ?? 8)) {
          const delay = err.retryAfterMs ?? backoffDelay(attempts, { random: this.opts.random });
          await store.markRetry(item.clientId, this.now() + delay, err.message);
          continue; // others may still go through
        }
        await store.markFailed(item.clientId, err.message);
      }
    }
    await this.drainOps();
    await this.drainReactions();
    await this.drainActions();
    await this.scheduleNext();
  }

  /** Edits and deletes go after new messages, with the same retry rules. */
  private async drainOps(): Promise<void> {
    const { store, edit, remove } = this.opts;
    if (!edit || !remove) return;
    while (this.opts.canSend()) {
      const op: MessageOp | undefined = await store.nextDueOp();
      if (!op) break;
      try {
        const server =
          op.kind === 'edit'
            ? await edit(op.messageId, op.text ?? '', op.mentions)
            : await remove(op.messageId);
        await store.completeOp(op, server);
      } catch (raw) {
        const err =
          raw instanceof TransportError ? raw : new TransportError(String(raw), 'network');
        const attempts = op.attempts + 1;
        if (err.isAuth) {
          await store.markOpRetry(op.clientId, this.now(), 'Waiting for sign-in');
          this.opts.onAuthError(err);
          break;
        }
        if (err.kind === 'network' || err.kind === 'not_configured') {
          await store.markOpRetry(
            op.clientId,
            this.now() + backoffDelay(attempts, { random: this.opts.random }),
            err.message,
          );
          break;
        }
        if (err.retryable && attempts < (this.opts.maxServerAttempts ?? 8)) {
          const delay = err.retryAfterMs ?? backoffDelay(attempts, { random: this.opts.random });
          await store.markOpRetry(op.clientId, this.now() + delay, err.message);
          continue;
        }
        await store.failOp(op, err.message);
      }
    }
  }

  /**
   * Reactions go last. Only the latest intent per message and emoji is queued, and both
   * operations are idempotent on the server, so retrying is always safe. A refused intent
   * (message deleted, access lost) is dropped and the server's state wins.
   */
  private async drainReactions(): Promise<void> {
    const { store, react } = this.opts;
    if (!react) return;
    while (this.opts.canSend()) {
      const op = await store.nextDueReaction();
      if (!op) break;
      try {
        const server = await react({ messageId: op.messageId, emoji: op.emoji, op: op.op });
        await store.settleReaction(op, server);
      } catch (raw) {
        const err =
          raw instanceof TransportError ? raw : new TransportError(String(raw), 'network');
        const attempts = op.attempts + 1;
        if (err.isAuth) {
          await store.markReactionRetry(op, this.now(), 'Waiting for sign-in');
          this.opts.onAuthError(err);
          break;
        }
        if (err.kind === 'network' || err.kind === 'not_configured') {
          await store.markReactionRetry(
            op,
            this.now() + backoffDelay(attempts, { random: this.opts.random }),
            err.message,
          );
          break;
        }
        if (err.retryable && attempts < (this.opts.maxServerAttempts ?? 8)) {
          const delay = err.retryAfterMs ?? backoffDelay(attempts, { random: this.opts.random });
          await store.markReactionRetry(op, this.now() + delay, err.message);
          continue;
        }
        await store.settleReaction(op);
      }
    }
  }

  /**
   * Everything else goes last, strictly in the order it was done: a backing-off action holds
   * the ones behind it, so an edit never overtakes the create it depends on.
   */
  private async drainActions(): Promise<void> {
    const { store, runAction, refuseAction } = this.opts;
    if (!runAction || !refuseAction) return;
    while (this.opts.canSend()) {
      const a = await store.work.next();
      if (!a?.due) break;
      await store.work.markSending(a.id);
      try {
        await runAction(a);
      } catch (raw) {
        const err =
          raw instanceof TransportError ? raw : new TransportError(String(raw), 'network');
        const attempts = a.attempts + 1;
        if (err.isAuth) {
          await store.work.markRetry(a, this.now(), 'Waiting for sign-in');
          this.opts.onAuthError(err);
          break;
        }
        if (err.kind === 'network' || err.kind === 'not_configured') {
          await store.work.markRetry(
            a,
            this.now() + backoffDelay(attempts, { random: this.opts.random }),
            err.message,
          );
          break;
        }
        if (err.retryable && attempts < (this.opts.maxServerAttempts ?? 8)) {
          const delay = err.retryAfterMs ?? backoffDelay(attempts, { random: this.opts.random });
          await store.work.markRetry(a, this.now() + delay, err.message);
          break;
        }
        await refuseAction(a, err);
      }
    }
  }

  private async scheduleNext(): Promise<void> {
    this.cancelTimer?.();
    this.cancelTimer = null;
    const at = await this.opts.store.nextOutboxWakeAt();
    if (at === undefined) return;
    const delay = Math.max(0, at - this.now());
    if (delay === 0 && !this.opts.canSend()) return; // a connectivity change will kick us
    this.cancelTimer = this.schedule(() => void this.kick(), Math.max(delay, 50));
  }
}
