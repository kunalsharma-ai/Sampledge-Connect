import { io, type Socket } from 'socket.io-client';
import type {
  Ack,
  AckReceiptRequest,
  ClientToServerEvents,
  PresenceStatus,
  Receipt,
  SendMessageAck,
  SendMessageRequest,
  ServerToClientEvents,
} from '@sampledge/contracts';
import type { LocalStore } from '../db/store';
import { Emitter } from '../lib/emitter';
import { TransportError } from './transport';

export type SocketState = 'disconnected' | 'connecting' | 'connected';

type RealtimeEvents = {
  state: SocketState;
  typing: { conversationId: string; userId: string; typing: boolean };
  presence: { userId: string; status: PresenceStatus };
  /** Server says the token is no longer valid. */
  sessionExpired: undefined;
  /** Something arrived that the cursor sync should confirm (missed-event recovery). */
  needsSync: undefined;
};

/**
 * Socket.IO link for low-latency delivery. Every event it receives is also recoverable
 * through cursor sync, which runs after each (re)connect, so a dropped event is never lost.
 */
export class RealtimeClient {
  readonly events = new Emitter<RealtimeEvents>();
  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
  private _state: SocketState = 'disconnected';

  constructor(
    private readonly url: string,
    private readonly store: LocalStore,
    private readonly getToken: () => Promise<string | undefined>,
  ) {}

  get state(): SocketState {
    return this._state;
  }

  connect(): void {
    if (this.socket) {
      if (!this.socket.connected) this.socket.connect();
      return;
    }
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(this.url, {
      transports: ['websocket'],
      // Called on every (re)connect attempt so a refreshed token is always used.
      auth: (cb) => void this.getToken().then((token) => cb({ token })),
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 30_000,
      randomizationFactor: 0.5, // jitter
    });
    this.socket = socket;
    this.setState('connecting');
    socket.on('connect', () => {
      this.setState('connected');
      this.events.emit('needsSync', undefined);
    });
    socket.on('disconnect', () => this.setState('disconnected'));
    socket.io.on('reconnect_attempt', () => this.setState('connecting'));
    socket.on('connect_error', () => this.setState('disconnected'));

    socket.on('message:new', (m) => void this.store.applyServerMessages([m]));
    socket.on('message:updated', (m) => void this.store.applyServerMessages([m]));
    socket.on('receipt:updated', (r) => void this.store.applyReceipts([r]));
    socket.on('conversation:upsert', (c) => {
      void this.store.upsertConversations([c]);
      this.events.emit('needsSync', undefined);
    });
    socket.on(
      'conversation:revoked',
      ({ conversationId }) => void this.store.purgeConversations([conversationId]),
    );
    socket.on('typing:update', (t) => this.events.emit('typing', t));
    socket.on('presence:update', (p) => this.events.emit('presence', p));
    socket.on('session:expired', () => {
      socket.disconnect();
      this.events.emit('sessionExpired', undefined);
    });
  }

  /** Reconnect with a fresh token (after a refresh). */
  reconnect(): void {
    this.socket?.disconnect();
    this.socket?.connect();
  }

  disconnect(): void {
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
    this.setState('disconnected');
  }

  async sendMessage(req: SendMessageRequest): Promise<SendMessageAck> {
    return unwrap(await this.emitWithAck('message:send', req));
  }

  async ackReceipt(req: AckReceiptRequest): Promise<Receipt> {
    return unwrap(await this.emitWithAck('receipt:ack', req));
  }

  setTyping(conversationId: string, typing: boolean): void {
    if (this.socket?.connected) this.socket.emit('typing:set', { conversationId, typing });
  }

  private async emitWithAck<T>(
    event: 'message:send' | 'receipt:ack',
    payload: unknown,
  ): Promise<Ack<T>> {
    const socket = this.socket;
    if (!socket?.connected) throw new TransportError('Realtime link is offline', 'network');
    try {
      return (await (
        socket.timeout(10_000) as unknown as {
          emitWithAck: (e: string, p: unknown) => Promise<Ack<T>>;
        }
      ).emitWithAck(event, payload)) as Ack<T>;
    } catch {
      throw new TransportError('Timed out waiting for the server', 'network');
    }
  }

  private setState(s: SocketState): void {
    if (s === this._state) return;
    this._state = s;
    this.events.emit('state', s);
  }
}

function unwrap<T>(ack: Ack<T>): T {
  if (ack.ok) return ack.data;
  throw new TransportError(ack.error.message, 'api', ack.error.code, ack.error.retryAfterMs);
}
