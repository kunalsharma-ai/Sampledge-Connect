import { Dexie } from 'dexie';
import {
  backoffDelay,
  deriveConfirmedStatus,
  isRetryable,
  uuidv7,
  type ApiError,
  type Conversation,
  type Message,
  type MessageStatus,
  type Receipt,
  type SyncResponse,
} from '@sampledge/contracts';
import type { ConnectDb, LocalMessage, OutboxItem } from './db.js';
import { NetworkError, ServerError, type Transport } from './transport.js';

export type ConnectivityState = 'offline' | 'connecting' | 'syncing' | 'online';

export interface EngineState {
  connectivity: ConnectivityState;
  /** Messages waiting locally (queued or sending). */
  queued: number;
  failed: number;
  lastSyncAt: number | null;
  /** Paused because the session must be refreshed or re-established. */
  authPaused: boolean;
}

export interface EngineOptions {
  db: ConnectDb;
  transport: Transport;
  tenantId: string;
  userId: string;
  /** Attempts before a retryable failure surfaces as `failed` (with manual retry). */
  maxAttempts?: number;
  backoff?: { baseMs?: number; capMs?: number; floorMs?: number };
  /** Debounce for realtime-triggered sync (gap recovery and cursor advance). */
  syncDebounceMs?: number;
  /** Called when the server says the session expired; host should refresh tokens then call resume(). */
  onSessionExpired?: () => void;
  random?: () => number;
  now?: () => number;
}

type Listener = (s: EngineState) => void;

const toError = (e: unknown): ApiError =>
  e instanceof ServerError
    ? e.error
    : e instanceof NetworkError
      ? { code: 'UNAVAILABLE', message: 'Network unavailable' }
      : { code: 'INTERNAL', message: (e as Error)?.message ?? 'Unknown error' };

/**
 * The offline-first engine. Invariants:
 *  - compose() persists to IndexedDB before any network attempt.
 *  - Nothing is marked `sent` without a server ack (or the message coming back from sync).
 *  - Outbox items are sent oldest first, one at a time per conversation.
 *  - Cursors only advance from sync responses, so missed realtime events are always recovered.
 */
export class SyncEngine {
  private readonly db: ConnectDb;
  private readonly transport: Transport;
  private readonly maxAttempts: number;
  private readonly now: () => number;
  private readonly random: () => number;
  private state: EngineState = {
    connectivity: 'offline',
    queued: 0,
    failed: 0,
    lastSyncAt: null,
    authPaused: false,
  };
  private listeners = new Set<Listener>();
  private networkAvailable = false;
  private flushing: Promise<void> | null = null;
  private flushAgain = false;
  private syncing: Promise<void> | null = null;
  private syncAgain = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private stopped = false;
  readonly typing = new Map<string, Map<string, number>>();
  readonly presence = new Map<string, string>();

  constructor(private readonly opts: EngineOptions) {
    this.db = opts.db;
    this.transport = opts.transport;
    this.maxAttempts = opts.maxAttempts ?? 8;
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;
  }

  // ---------- state ----------

  getState(): EngineState {
    return this.state;
  }
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }
  private patch(p: Partial<EngineState>) {
    this.state = { ...this.state, ...p };
    for (const l of this.listeners) l(this.state);
  }
  private async refreshCounts() {
    const [queued, failed] = await Promise.all([
      this.db.outbox.where('state').anyOf('queued', 'sending').count(),
      this.db.outbox.where('state').equals('failed').count(),
    ]).catch(() => [this.state.queued, this.state.failed]);
    this.patch({ queued, failed });
  }

  // ---------- lifecycle ----------

  /**
   * Startup recovery: anything left `sending` (tab closed mid-request) goes back to
   * `queued` (idempotency makes the resend safe), and every outbox item is guaranteed
   * a visible local message row.
   */
  async start(): Promise<void> {
    this.stopped = false;
    await this.db.transaction('rw', this.db.outbox, this.db.messages, async () => {
      const items = await this.db.outbox.toArray();
      for (const it of items) {
        if (it.state === 'sending')
          await this.db.outbox.update(it.clientMessageId, { state: 'queued' });
        const existing = await this.db.messages.get(it.clientMessageId);
        if (!existing)
          await this.db.messages.put(
            this.localFromOutbox(it, it.state === 'failed' ? 'failed' : 'queued'),
          );
        else if (existing.status === 'sending')
          await this.db.messages.update(it.clientMessageId, { status: 'queued' });
      }
    });
    const last = await this.db.meta.get('lastSyncAt');
    this.patch({ lastSyncAt: (last?.value as number | undefined) ?? null });
    await this.refreshCounts();
  }

  stop() {
    this.stopped = true;
    for (const t of [this.flushTimer, this.syncTimer, this.reconnectTimer]) if (t) clearTimeout(t);
    this.transport.disconnect?.();
  }

  /** Host wires this to `online`/`offline` events and navigator.onLine. */
  setNetworkAvailable(available: boolean) {
    this.networkAvailable = available;
    if (!available) {
      this.patch({ connectivity: 'offline' });
      return;
    }
    this.patch({ connectivity: this.transport.connected ? 'online' : 'connecting' });
    this.reconnectAttempt = 0;
    this.ensureConnected();
    void this.syncNow();
    void this.flush();
  }

  /** After the host refreshed the session. */
  resume() {
    this.patch({ authPaused: false });
    this.ensureConnected();
    void this.syncNow();
    void this.flush();
  }

  private handleSessionExpired() {
    if (this.state.authPaused) return;
    this.patch({ authPaused: true });
    this.opts.onSessionExpired?.();
  }

  private onSocketChange(connected: boolean) {
    if (connected) {
      this.reconnectAttempt = 0;
      this.patch({ connectivity: 'online' });
      void this.syncNow();
      void this.flush();
    } else {
      if (!this.networkAvailable) return this.patch({ connectivity: 'offline' });
      this.patch({ connectivity: 'connecting' });
      this.scheduleReconnect();
    }
  }

  private ensureConnected() {
    if (
      !this.transport.connect ||
      this.transport.connected ||
      this.stopped ||
      this.state.authPaused
    )
      return;
    this.transport.connect({
      onMessage: (m) => void this.applyRealtimeMessage(m),
      onReceipt: (r) => void this.db.receipts.put(r),
      onTyping: (e) => this.applyTyping(e),
      onPresence: (e) => this.presence.set(e.userId, e.status),
      onConversation: (c) => void this.db.conversations.put(c).then(() => this.scheduleSync(0)),
      onRevoked: (id) => void this.purgeConversation(id),
      onConnectionChange: (c) => this.onSocketChange(c),
      onSessionExpired: () => this.handleSessionExpired(),
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.stopped || !this.networkAvailable || this.state.authPaused)
      return;
    const delay = backoffDelay(this.reconnectAttempt++, {
      ...this.opts.backoff,
      random: this.random,
    });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureConnected();
    }, delay);
  }

  // ---------- compose & outbox ----------

  /** Persist first, render immediately (optimistic), then try to send. */
  async compose(
    conversationId: string,
    text: string,
    opts: { mentions?: string[]; replyToMessageId?: string | null } = {},
  ): Promise<LocalMessage> {
    const now = this.now();
    const item: OutboxItem = {
      clientMessageId: uuidv7(now),
      conversationId,
      kind: 'send',
      payload: {
        text,
        mentions: opts.mentions ?? [],
        replyToMessageId: opts.replyToMessageId ?? null,
        composedAt: new Date(now).toISOString(),
      },
      state: 'queued',
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
      lastError: null,
    };
    const local = this.localFromOutbox(item, 'queued');
    await this.db.transaction('rw', this.db.outbox, this.db.messages, async () => {
      await this.db.outbox.add(item);
      await this.db.messages.add(local);
    });
    await this.refreshCounts();
    void this.flush();
    return local;
  }

  private localFromOutbox(it: OutboxItem, status: MessageStatus): LocalMessage {
    return {
      clientMessageId: it.clientMessageId,
      messageId: null,
      tenantId: this.opts.tenantId,
      conversationId: it.conversationId,
      senderId: this.opts.userId,
      messageType: 'text',
      content: { text: it.payload.text, mentions: it.payload.mentions },
      attachmentIds: [],
      replyToMessageId: it.payload.replyToMessageId,
      serverSequence: null,
      changeSequence: null,
      createdAt: it.payload.composedAt,
      editedAt: null,
      deletedAt: null,
      metadata: {},
      status,
      localCreatedAt: it.createdAt,
      error: it.lastError,
    };
  }

  /** Manual retry of a failed message. */
  async retry(clientMessageId: string) {
    await this.db.transaction('rw', this.db.outbox, this.db.messages, async () => {
      await this.db.outbox.update(clientMessageId, {
        state: 'queued',
        attempts: 0,
        nextAttemptAt: this.now(),
        lastError: null,
      });
      await this.db.messages.update(clientMessageId, { status: 'queued', error: null });
    });
    await this.refreshCounts();
    void this.flush();
  }

  /** Discard a failed or queued message that was never confirmed. */
  async discard(clientMessageId: string) {
    await this.db.transaction('rw', this.db.outbox, this.db.messages, async () => {
      const m = await this.db.messages.get(clientMessageId);
      if (m && m.messageId) return; // already on the server; cannot discard locally
      await this.db.outbox.delete(clientMessageId);
      await this.db.messages.delete(clientMessageId);
    });
    await this.refreshCounts();
  }

  /** Send everything due. Re-entrant calls coalesce into one more pass. */
  flush(): Promise<void> {
    if (this.flushing) {
      this.flushAgain = true;
      return this.flushing;
    }
    this.flushing = (async () => {
      try {
        do {
          this.flushAgain = false;
          await this.flushOnce();
        } while (this.flushAgain);
      } finally {
        this.flushing = null;
      }
    })();
    return this.flushing;
  }

  private async flushOnce() {
    if (!this.networkAvailable || this.state.authPaused || this.stopped) return;
    const pending = await this.db.outbox.where('state').equals('queued').sortBy('createdAt');
    const blocked = new Set<string>();
    let nextWake = Infinity;
    for (const item of pending) {
      if (blocked.has(item.conversationId)) continue;
      if (item.nextAttemptAt > this.now()) {
        // Keep per-conversation order: later messages wait for this one.
        blocked.add(item.conversationId);
        nextWake = Math.min(nextWake, item.nextAttemptAt);
        continue;
      }
      const outcome = await this.sendOne(item);
      if (outcome === 'paused') return;
      if (outcome === 'retry') {
        blocked.add(item.conversationId);
        const updated = await this.db.outbox.get(item.clientMessageId);
        if (updated) nextWake = Math.min(nextWake, updated.nextAttemptAt);
      }
    }
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (nextWake !== Infinity) {
      this.flushTimer = setTimeout(() => void this.flush(), Math.max(0, nextWake - this.now()));
    }
  }

  private async sendOne(item: OutboxItem): Promise<'sent' | 'retry' | 'failed' | 'paused'> {
    await this.db.transaction('rw', this.db.outbox, this.db.messages, async () => {
      await this.db.outbox.update(item.clientMessageId, { state: 'sending' });
      await this.db.messages.update(item.clientMessageId, { status: 'sending' });
    });
    try {
      const ack = await this.transport.send({
        conversationId: item.conversationId,
        clientMessageId: item.clientMessageId,
        messageType: 'text',
        content: { text: item.payload.text, mentions: item.payload.mentions },
        replyToMessageId: item.payload.replyToMessageId,
        composedAt: item.payload.composedAt,
      });
      await this.db.transaction('rw', this.db.outbox, this.db.messages, async () => {
        await this.db.outbox.delete(item.clientMessageId);
        await this.upsertServerMessage(ack.message);
      });
      await this.refreshCounts();
      return 'sent';
    } catch (e) {
      const error = toError(e);
      // Confirmed meanwhile (e.g. sync returned it): nothing more to do for this item.
      if (!(await this.db.outbox.get(item.clientMessageId))) return 'sent';
      if (error.code === 'SESSION_EXPIRED' || error.code === 'UNAUTHENTICATED') {
        // Not the message's fault: put it back without spending an attempt.
        await this.db.transaction('rw', this.db.outbox, this.db.messages, async () => {
          await this.db.outbox.update(item.clientMessageId, { state: 'queued' });
          await this.db.messages.update(item.clientMessageId, { status: 'queued' });
        });
        this.handleSessionExpired();
        return 'paused';
      }
      const attempts = item.attempts + 1;
      const retryable = e instanceof NetworkError || isRetryable(error.code);
      if (retryable && attempts < this.maxAttempts) {
        const delay = Math.max(
          error.retryAfterMs ?? 0,
          backoffDelay(attempts - 1, { ...this.opts.backoff, random: this.random }),
        );
        await this.db.transaction('rw', this.db.outbox, this.db.messages, async () => {
          await this.db.outbox.update(item.clientMessageId, {
            state: 'queued',
            attempts,
            nextAttemptAt: this.now() + delay,
            lastError: error,
          });
          await this.db.messages.update(item.clientMessageId, { status: 'queued', error });
        });
        if (e instanceof NetworkError && this.networkAvailable)
          this.patch({ connectivity: 'connecting' });
        return 'retry';
      }
      await this.db.transaction('rw', this.db.outbox, this.db.messages, async () => {
        await this.db.outbox.update(item.clientMessageId, {
          state: 'failed',
          attempts,
          lastError: error,
        });
        await this.db.messages.update(item.clientMessageId, { status: 'failed', error });
      });
      await this.refreshCounts();
      return 'failed';
    }
  }

  // ---------- inbound ----------

  /** Idempotent merge keyed by clientMessageId; never regresses to an older change. */
  private async upsertServerMessage(m: Message) {
    const existing = await this.db.messages.get(m.clientMessageId);
    if (existing?.changeSequence && existing.changeSequence >= m.changeSequence) return;
    await this.db.messages.put({
      ...m,
      status: 'sent',
      localCreatedAt: existing?.localCreatedAt ?? Date.parse(m.createdAt),
      error: null,
    });
    // If this device had it queued (e.g. ack lost, then seen via sync), it is now confirmed.
    await this.db.outbox.delete(m.clientMessageId);
  }

  private async applyRealtimeMessage(m: Message) {
    await this.db.transaction('rw', this.db.messages, this.db.outbox, () =>
      this.upsertServerMessage(m),
    );
    await this.refreshCounts();
    // Cursor advance and gap recovery happen through a (debounced) sync.
    this.scheduleSync(this.opts.syncDebounceMs ?? 1500);
  }

  private applyTyping(e: { conversationId: string; userId: string; typing: boolean }) {
    const m = this.typing.get(e.conversationId) ?? new Map<string, number>();
    if (e.typing) m.set(e.userId, this.now() + 6000);
    else m.delete(e.userId);
    this.typing.set(e.conversationId, m);
  }

  private scheduleSync(ms: number) {
    if (this.syncTimer) return;
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      void this.syncNow();
    }, ms);
  }

  /** Cursor sync until nothing is left. Coalesces concurrent calls. */
  syncNow(): Promise<void> {
    if (this.syncing) {
      this.syncAgain = true;
      return this.syncing;
    }
    this.syncing = (async () => {
      try {
        do {
          this.syncAgain = false;
          await this.syncPass();
        } while (this.syncAgain);
      } finally {
        this.syncing = null;
      }
    })();
    return this.syncing;
  }

  private async syncPass() {
    if (!this.networkAvailable || this.state.authPaused || this.stopped) return;
    const prev = this.state.connectivity;
    this.patch({ connectivity: 'syncing' });
    try {
      for (let page = 0; page < 50; page++) {
        const cursors = await this.db.cursors.toArray();
        const res = await this.transport.sync({ cursors, limitPerConversation: 200 });
        const more = await this.applySync(res);
        if (!more) break;
      }
      const at = this.now();
      await this.db.meta.put({ key: 'lastSyncAt', value: at });
      this.patch({
        lastSyncAt: at,
        connectivity: this.transport.connect
          ? this.transport.connected
            ? 'online'
            : 'connecting'
          : 'online',
      });
    } catch (e) {
      const err = toError(e);
      if (err.code === 'SESSION_EXPIRED' || err.code === 'UNAUTHENTICATED')
        this.handleSessionExpired();
      this.patch({
        connectivity:
          e instanceof NetworkError ? 'connecting' : prev === 'syncing' ? 'online' : prev,
      });
      if (e instanceof NetworkError)
        this.scheduleSync(backoffDelay(1, { ...this.opts.backoff, random: this.random }));
    }
  }

  private async applySync(res: SyncResponse): Promise<boolean> {
    let more = false;
    await this.db.transaction(
      'rw',
      [this.db.messages, this.db.outbox, this.db.conversations, this.db.cursors, this.db.receipts],
      async () => {
        await this.db.conversations.bulkPut(res.conversations);
        for (const r of res.results) {
          for (const m of r.changes) await this.upsertServerMessage(m);
          if (r.receipts.length) await this.db.receipts.bulkPut(r.receipts);
          const cur = await this.db.cursors.get(r.conversationId);
          if (!cur || r.nextCursor > cur.afterChangeSequence) {
            await this.db.cursors.put({
              conversationId: r.conversationId,
              afterChangeSequence: r.nextCursor,
            });
          }
          if (r.hasMore) more = true;
        }
      },
    );
    for (const id of res.revokedConversationIds) await this.purgeConversation(id);
    await this.refreshCounts();
    return more;
  }

  /** Lost access: remove the cached copy. Unsent local drafts are marked failed, not silently dropped. */
  private async purgeConversation(conversationId: string) {
    await this.db.transaction(
      'rw',
      [this.db.messages, this.db.outbox, this.db.conversations, this.db.cursors, this.db.receipts],
      async () => {
        const pending = await this.db.outbox
          .where('conversationId')
          .equals(conversationId)
          .toArray();
        const error: ApiError = {
          code: 'FORBIDDEN',
          message: 'You no longer have access to this conversation',
        };
        for (const p of pending) {
          await this.db.outbox.update(p.clientMessageId, { state: 'failed', lastError: error });
          await this.db.messages.update(p.clientMessageId, { status: 'failed', error });
        }
        const keep = new Set(pending.map((p) => p.clientMessageId));
        const all = await this.db.messages
          .where('[conversationId+localCreatedAt]')
          .between([conversationId, Dexie.minKey], [conversationId, Dexie.maxKey])
          .primaryKeys();
        await this.db.messages.bulkDelete(all.filter((k) => !keep.has(k)));
        await this.db.conversations.delete(conversationId);
        await this.db.cursors.delete(conversationId);
        await this.db.receipts.where('conversationId').equals(conversationId).delete();
      },
    );
    await this.refreshCounts();
  }

  // ---------- receipts & typing ----------

  async markRead(conversationId: string, upToSequence: number) {
    if (upToSequence < 1) return;
    try {
      const r = await this.transport.ackReceipt({ conversationId, kind: 'read', upToSequence });
      await this.db.receipts.put(r);
    } catch {
      /* best effort; next read ack covers it */
    }
  }

  async markDelivered(conversationId: string, upToSequence: number) {
    if (upToSequence < 1) return;
    try {
      await this.transport.ackReceipt({ conversationId, kind: 'delivered', upToSequence });
    } catch {
      /* best effort */
    }
  }

  setTyping(conversationId: string, typing: boolean) {
    this.transport.setTyping?.(conversationId, typing);
  }

  typingIn(conversationId: string): string[] {
    const m = this.typing.get(conversationId);
    if (!m) return [];
    const now = this.now();
    return [...m.entries()].filter(([, exp]) => exp > now).map(([id]) => id);
  }

  // ---------- quota ----------

  /**
   * Evicts the oldest confirmed messages beyond `keepPerConversation` when storage
   * usage exceeds `threshold`. Never touches unsent messages or the outbox.
   */
  async enforceQuota(
    opts: {
      estimate?: () => Promise<{ usage?: number; quota?: number }>;
      threshold?: number;
      keepPerConversation?: number;
    } = {},
  ) {
    const estimate =
      opts.estimate ??
      (() =>
        (globalThis.navigator?.storage?.estimate?.() ?? Promise.resolve({})) as Promise<{
          usage?: number;
          quota?: number;
        }>);
    const { usage, quota } = await estimate();
    if (!usage || !quota || usage / quota < (opts.threshold ?? 0.8)) return 0;
    const keep = opts.keepPerConversation ?? 500;
    let evicted = 0;
    for (const c of await this.db.conversations.toArray()) {
      const confirmed = await this.db.messages
        .where('[conversationId+serverSequence]')
        .between([c.conversationId, Dexie.minKey], [c.conversationId, Dexie.maxKey])
        .primaryKeys();
      if (confirmed.length > keep) {
        const drop = confirmed.slice(0, confirmed.length - keep);
        await this.db.messages.bulkDelete(drop);
        evicted += drop.length;
      }
    }
    return evicted;
  }
}

/** Ordered view of a conversation: confirmed by serverSequence, then unsent by local time. */
export async function listConversationMessages(
  db: ConnectDb,
  conversationId: string,
): Promise<LocalMessage[]> {
  const rows = await db.messages
    .where('[conversationId+localCreatedAt]')
    .between([conversationId, Dexie.minKey], [conversationId, Dexie.maxKey])
    .toArray();
  return sortMessages(rows);
}

export function sortMessages(rows: LocalMessage[]): LocalMessage[] {
  return [...rows].sort((a, b) => {
    if (a.serverSequence != null && b.serverSequence != null)
      return a.serverSequence - b.serverSequence;
    if (a.serverSequence != null) return -1;
    if (b.serverSequence != null) return 1;
    return a.localCreatedAt - b.localCreatedAt;
  });
}

/** Sender-visible status, combining local state with receipt watermarks. */
export function displayStatus(
  m: LocalMessage,
  conversation: Pick<Conversation, 'memberIds'> | undefined,
  receipts: Receipt[],
): MessageStatus {
  if (m.status !== 'sent' || m.serverSequence == null || !conversation) return m.status;
  return deriveConfirmedStatus({
    serverSequence: m.serverSequence,
    senderId: m.senderId,
    memberIds: conversation.memberIds,
    receipts,
  });
}

/** Wipes the identity's local data (logout, device revoked). */
export async function wipeLocalData(db: ConnectDb) {
  db.close();
  await Dexie.delete(db.name);
}
