import { io, type Socket } from 'socket.io-client';
import {
  ERROR_CODES,
  type Ack,
  type AckReceiptRequest,
  type ApiError,
  type ClientToServerEvents,
  type Conversation,
  type Message,
  type Receipt,
  type SendMessageAck,
  type SendMessageRequest,
  type ServerToClientEvents,
  type SyncRequest,
  type SyncResponse,
} from '@sampledge/contracts';

/** Raised for transport-level failures (no response). Always retryable. */
export class NetworkError extends Error {
  readonly retryable = true;
}

/** Raised when the server answered with an ApiError. */
export class ServerError extends Error {
  constructor(readonly error: ApiError) {
    super(error.message);
  }
}

export interface RealtimeHandlers {
  onMessage(m: Message): void;
  onReceipt(r: Receipt): void;
  onTyping(e: { conversationId: string; userId: string; typing: boolean }): void;
  onPresence(e: { userId: string; status: string }): void;
  onConversation(c: Conversation): void;
  onRevoked(conversationId: string): void;
  onConnectionChange(connected: boolean): void;
  onSessionExpired(): void;
}

/** What the engine needs from the network. Implemented over Socket.IO + fetch, and faked in tests. */
export interface Transport {
  send(req: SendMessageRequest): Promise<SendMessageAck>;
  sync(req: SyncRequest): Promise<SyncResponse>;
  ackReceipt(req: AckReceiptRequest): Promise<Receipt>;
  setTyping?(conversationId: string, typing: boolean): void;
  connect?(handlers: RealtimeHandlers): void;
  disconnect?(): void;
  readonly connected?: boolean;
}

export interface HttpSocketTransportOptions {
  baseUrl: string;
  /** Returns a currently valid access token (refreshing if needed), or null if signed out. */
  getAccessToken(): Promise<string | null>;
  fetch?: typeof fetch;
  /** Request timeout; a hung request is treated as a network failure. */
  timeoutMs?: number;
}

/**
 * Production transport: Socket.IO for sends and live events when connected,
 * REST fallback for sends, REST for sync. Socket reconnection is driven by the
 * engine (exponential backoff with jitter), not by socket.io's own retry loop.
 */
export class HttpSocketTransport implements Transport {
  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
  private handlers: RealtimeHandlers | null = null;

  constructor(private readonly opts: HttpSocketTransportOptions) {}

  get connected(): boolean {
    return this.socket?.connected ?? false;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.opts.getAccessToken();
    if (!token) throw new ServerError({ code: 'SESSION_EXPIRED', message: 'Not signed in' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 15_000);
    let res: Response;
    try {
      res = await (this.opts.fetch ?? fetch)(this.opts.baseUrl + path, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      throw new NetworkError((e as Error).message);
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text().catch(() => '');
    const json = text ? (JSON.parse(text) as unknown) : undefined;
    if (!res.ok) {
      const err = (json as { error?: ApiError } | undefined)?.error;
      if (err && err.code in ERROR_CODES) throw new ServerError(err);
      throw new ServerError({
        code: res.status >= 500 ? 'UNAVAILABLE' : 'INTERNAL',
        message: `HTTP ${res.status}`,
      });
    }
    return json as T;
  }

  private async emit<T>(event: 'message:send' | 'receipt:ack', payload: unknown): Promise<T> {
    const s = this.socket!;
    let ack: Ack<T>;
    try {
      const emitter = s.timeout(this.opts.timeoutMs ?? 15_000) as unknown as {
        emitWithAck(ev: string, p: unknown): Promise<Ack<T>>;
      };
      ack = await emitter.emitWithAck(event, payload);
    } catch (e) {
      throw new NetworkError((e as Error).message);
    }
    if (!ack.ok) throw new ServerError(ack.error);
    return ack.data;
  }

  send(req: SendMessageRequest): Promise<SendMessageAck> {
    if (this.connected) return this.emit('message:send', req);
    return this.request(
      'POST',
      `/v1/conversations/${encodeURIComponent(req.conversationId)}/messages`,
      req,
    );
  }

  sync(req: SyncRequest): Promise<SyncResponse> {
    return this.request('POST', '/v1/sync', req);
  }

  ackReceipt(req: AckReceiptRequest): Promise<Receipt> {
    if (this.connected) return this.emit('receipt:ack', req);
    return this.request('POST', '/v1/messages/receipts', req);
  }

  setTyping(conversationId: string, typing: boolean) {
    this.socket?.emit('typing:set', { conversationId, typing });
  }

  connect(handlers: RealtimeHandlers) {
    this.handlers = handlers;
    if (this.socket) {
      if (!this.socket.connected) this.socket.connect();
      return;
    }
    const s: Socket<ServerToClientEvents, ClientToServerEvents> = io(this.opts.baseUrl, {
      transports: ['websocket'],
      reconnection: false,
      autoConnect: false,
      auth: (cb) => {
        void this.opts.getAccessToken().then((token) => cb({ token }));
      },
    });
    s.on('connect', () => this.handlers?.onConnectionChange(true));
    s.on('disconnect', () => this.handlers?.onConnectionChange(false));
    s.on('connect_error', (err) => {
      const code = (err as Error & { data?: ApiError }).data?.code;
      if (code === 'SESSION_EXPIRED' || code === 'UNAUTHENTICATED')
        this.handlers?.onSessionExpired();
      this.handlers?.onConnectionChange(false);
    });
    s.on('message:new', (m) => this.handlers?.onMessage(m));
    s.on('message:updated', (m) => this.handlers?.onMessage(m));
    s.on('receipt:updated', (r) => this.handlers?.onReceipt(r));
    s.on('typing:update', (e) => this.handlers?.onTyping(e));
    s.on('presence:update', (e) => this.handlers?.onPresence(e));
    s.on('conversation:upsert', (c) => this.handlers?.onConversation(c));
    s.on('conversation:revoked', (e) => this.handlers?.onRevoked(e.conversationId));
    s.on('session:expired', () => this.handlers?.onSessionExpired());
    this.socket = s;
    s.connect();
  }

  disconnect() {
    this.socket?.disconnect();
  }
}
