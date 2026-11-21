import {
  backoffDelay,
  type Message,
  type SendMessageAck,
  type SendMessageRequest,
  type SetReactionRequest,
} from '@sampledge/contracts';
import type { SessionManager } from '../auth/session';
import type { LocalStore } from '../db/store';
import { Emitter } from '../lib/emitter';
import { OutboxProcessor } from '../sync/outbox';
import type { RealtimeClient, SocketState } from '../sync/realtime';
import { SyncEngine } from '../sync/syncEngine';
import { TransportError, type ApiTransport } from '../sync/transport';

/** What the connectivity indicator shows. */
export type Connectivity =
  | 'online' // network up, realtime connected
  | 'connecting' // network up, realtime (re)connecting; REST still used
  | 'offline' // no network: reading the cache, queueing writes
  | 'sessionExpired' // signed out by the server; queue paused
  | 'noServer'; // local demo workspace

export interface EngineState {
  connectivity: Connectivity;
  networkUp: boolean;
  socket: SocketState;
  pending: number;
  syncing: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
}

/**
 * Wires the local store, outbox, cursor sync and realtime link together and reacts
 * to connectivity, app foregrounding and session changes.
 */
export class ConnectEngine {
  readonly events = new Emitter<{ state: EngineState }>();
  private readonly outbox: OutboxProcessor;
  private readonly sync: SyncEngine;
  private _state: EngineState = {
    connectivity: 'offline',
    networkUp: false,
    socket: 'disconnected',
    pending: 0,
    syncing: false,
    lastSyncAt: null,
    lastSyncError: null,
  };
  private unsubs: (() => void)[] = [];
  private syncAttempt = 0;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly store: LocalStore,
    private readonly api: ApiTransport,
    private readonly session: SessionManager,
    private readonly realtime: RealtimeClient | null,
  ) {
    this.sync = new SyncEngine(store, api);
    this.outbox = new OutboxProcessor({
      store,
      send: (req) => this.sendOne(req),
      edit: (id, text, mentions) => api.editMessage(id, { content: { text, mentions } }),
      remove: (id) => api.deleteMessage(id),
      react: (req) => this.reactOne(req),
      canSend: () => this._state.networkUp && session.state === 'active',
      onAuthError: (err) => void this.handleAuthError(err),
    });
  }

  get state(): EngineState {
    return this._state;
  }

  async start(): Promise<void> {
    await this.store.requeueInflight();
    this.patch({ lastSyncAt: (await this.store.getSetting('sync.lastSuccessAt')) ?? null });
    await this.refreshPending();
    this.unsubs.push(
      this.store.events.on('outbox', () => void this.refreshPending()),
      this.session.events.on('state', (s) => {
        if (s === 'active') {
          this.realtime?.reconnect();
          void this.resume();
        }
        this.recompute();
      }),
    );
    if (this.realtime) {
      this.unsubs.push(
        this.realtime.events.on('state', (socket) => this.patch({ socket })),
        this.realtime.events.on('needsSync', () => void this.resume()),
        this.realtime.events.on(
          'sessionExpired',
          () => void this.handleAuthError(new TransportError('expired', 'api', 'SESSION_EXPIRED')),
        ),
      );
    }
    this.recompute();
  }

  stop(): void {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.outbox.stop();
    this.realtime?.disconnect();
    if (this.syncTimer) clearTimeout(this.syncTimer);
  }

  /** Feed from NetInfo. */
  setNetworkUp(up: boolean): void {
    if (up === this._state.networkUp) return;
    this.patch({ networkUp: up });
    if (up) {
      if (this.session.state === 'active') this.realtime?.connect();
      void this.resume();
    }
  }

  /** App returned to the foreground or the user pulled to refresh. */
  async resume(): Promise<void> {
    if (!this._state.networkUp || this.session.state !== 'active') return;
    await Promise.all([this.outbox.kick(), this.runSync()]);
  }

  async send(
    conversationId: string,
    text: string,
    opts: { replyTo?: string | null; mentions?: readonly string[] } = {},
  ): Promise<void> {
    await this.store.enqueueSend({ conversationId, text, ...opts });
    void this.outbox.kick();
  }

  /** Edits a sent message; works offline (queued like a send). */
  async edit(clientId: string, text: string, mentions: readonly string[] = []): Promise<void> {
    await this.store.enqueueEdit(clientId, text, mentions);
    void this.outbox.kick();
  }

  /** Deletes a message for everyone (or discards it if it was never sent). */
  async remove(clientId: string): Promise<void> {
    await this.store.enqueueDelete(clientId);
    void this.outbox.kick();
  }

  async retry(clientId: string): Promise<void> {
    await this.store.retry(clientId);
    void this.outbox.kick();
  }

  discard(clientId: string): Promise<void> {
    return this.store.discardUnsent(clientId);
  }

  /** Records reading locally right away, then acknowledges to the server when possible. */
  async markRead(conversationId: string, upToSequence: number): Promise<void> {
    if (upToSequence <= 0 || !(await this.store.markReadLocally(conversationId, upToSequence)))
      return;
    if (!this._state.networkUp || this.session.state !== 'active') return; // re-acked from read_up_to after next sync (planned)
    const req = { conversationId, kind: 'read' as const, upToSequence };
    try {
      await (this.realtime?.state === 'connected'
        ? this.realtime.ackReceipt(req)
        : this.api.ackReceipt(req));
    } catch {
      // Best effort: the local watermark is kept and unread counts stay correct on this device.
    }
  }

  setTyping(conversationId: string, typing: boolean): void {
    this.realtime?.setTyping(conversationId, typing);
  }

  /** Typing indicators from other members (realtime only; nothing is shown offline). */
  onTyping(
    listener: (e: { conversationId: string; userId: string; typing: boolean }) => void,
  ): () => void {
    return this.realtime?.events.on('typing', listener) ?? (() => undefined);
  }

  /** Toggles your reaction; queued like a send, so it works offline. */
  async toggleReaction(clientId: string, emoji: string): Promise<void> {
    await this.store.toggleReaction(clientId, emoji);
    void this.outbox.kick();
  }

  private async reactOne(req: SetReactionRequest): Promise<Message> {
    if (this.realtime?.state === 'connected') {
      try {
        return await this.realtime.setReaction(req);
      } catch (err) {
        if (!(err instanceof TransportError) || err.kind !== 'network') throw err;
      }
    }
    return this.api.setReaction(req);
  }

  private async sendOne(req: SendMessageRequest): Promise<SendMessageAck> {
    if (this.realtime?.state === 'connected') {
      try {
        return await this.realtime.sendMessage(req);
      } catch (err) {
        if (!(err instanceof TransportError) || err.kind !== 'network') throw err;
        // fall through to REST; same clientMessageId so the server dedupes if both arrived
      }
    }
    return this.api.sendMessage(req);
  }

  private async runSync(): Promise<void> {
    this.patch({ syncing: true });
    try {
      await this.sync.syncAll();
      this.syncAttempt = 0;
      this.patch({ syncing: false, lastSyncAt: new Date().toISOString(), lastSyncError: null });
    } catch (err) {
      const e = err instanceof TransportError ? err : new TransportError(String(err), 'network');
      this.patch({ syncing: false, lastSyncError: e.message });
      if (e.isAuth) return this.handleAuthError(e);
      this.syncAttempt++;
      if (this.syncTimer) clearTimeout(this.syncTimer);
      this.syncTimer = setTimeout(() => void this.resume(), backoffDelay(this.syncAttempt));
    }
  }

  private async handleAuthError(_err: TransportError): Promise<void> {
    const token = await this.session.refresh();
    if (token) {
      this.realtime?.reconnect();
      void this.resume();
    }
    this.recompute();
  }

  private async refreshPending(): Promise<void> {
    this.patch({ pending: await this.store.pendingCount() });
  }

  private patch(p: Partial<EngineState>): void {
    this._state = { ...this._state, ...p };
    this.recompute();
  }

  private recompute(): void {
    const s = this._state;
    const connectivity: Connectivity =
      this.session.state === 'demo'
        ? 'noServer'
        : this.session.state === 'expired'
          ? 'sessionExpired'
          : !s.networkUp
            ? 'offline'
            : s.socket === 'connected' || !this.realtime
              ? 'online'
              : 'connecting';
    this._state = { ...s, connectivity };
    this.events.emit('state', this._state);
  }
}
