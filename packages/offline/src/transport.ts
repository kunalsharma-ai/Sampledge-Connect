import { io, type Socket } from 'socket.io-client';
import {
  socketTarget,
  type InboxChangedEvent,
  ERROR_CODES,
  type Ack,
  type ScheduledMessage,
  type Call,
  type CallRingingEvent,
  type Approval,
  type Task,
  type Meeting,
  type MeetingReminderEvent,
  type AckReceiptRequest,
  type ApiError,
  type ClientToServerEvents,
  type Conversation,
  type Message,
  type Notification,
  type Receipt,
  type SendMessageAck,
  type SendMessageRequest,
  type SetReactionRequest,
  type ServerToClientEvents,
  type SyncRequest,
  type SyncResponse,
  type MeetingsArea,
  type TenantArea,
  type AiProposal,
} from '@sampledge/contracts';
import type { NetworkChangedEvent, PlatformChangedEvent } from '@sampledge/contracts';

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
  /** In-app notification events for the signed-in user (optional for transports that lack them). */
  onNotification?(e: NotificationEvent): void;
  /** Call lifecycle events (optional for transports that lack them). */
  onCall?(e: CallEvent): void;
  /** Meeting invites/changes and reminders (optional for transports that lack them). */
  onMeeting?(e: MeetingEvent): void;
  /** A Client Inbox conversation the user can see changed (optional). */
  onInbox?(e: InboxChangedEvent): void;
  /** One of the caller's scheduled messages changed. */
  onScheduled?(s: ScheduledMessage): void;
  /** Task and approval changes for the signed-in user (optional). */
  onWork?(e: WorkEvent): void;
  /** SampConnect Network changes (requests, follows, statuses, communities) for the signed-in user. */
  onNetwork?(e: NetworkChangedEvent): void;
  /** Saved messages, people, organization settings and projects changed (optional). */
  onChange?(e: ChangeEvent): void;
}

/**
 * Something changed that the app keeps outside the message store. Screens refetch the
 * affected data. `reconnected` means live events may have been missed: refetch everything shown.
 */
export type ChangeEvent =
  | { type: 'bookmark'; messageId: string; conversationId: string; saved: boolean }
  | { type: 'pollVote'; messageId: string; optionIds: string[] }
  /** Your recent searches changed on one of your devices. */
  | { type: 'searchRecent'; recent: string[] }
  | { type: 'chatTheme'; themeId: string | null }
  | { type: 'directory'; userId: string }
  | { type: 'tenant'; area: TenantArea }
  | { type: 'project'; projectId: string }
  /** One of my AI drafts was created, sent or dismissed (on any of my devices). */
  | { type: 'aiProposal'; proposal: AiProposal }
  /** I dismissed or restored a suggested task (on any of my devices). */
  | { type: 'aiSuggestion'; suggestionId: string; dismissed: boolean }
  | { type: 'meetings'; area: MeetingsArea }
  | { type: 'recording'; recordingId: string; conversationId: string; deleted: boolean }
  /** Minutes of a call in this conversation were made, edited, shared or deleted. */
  | {
      type: 'minutes';
      minutesId: string;
      callId: string;
      conversationId: string;
      revision: number;
      deleted: boolean;
    }
  /** A transcript finished, was translated, corrected or checked. */
  | { type: 'transcript'; attachmentId: string; conversationId: string; revision: number }
  /** A module record in this conversation was linked or updated, or a record action ran. */
  | {
      type: 'records';
      conversationId: string;
      linkId: string;
      reason: 'linked' | 'updated' | 'action';
    }
  /** Platform operators: the SampConnect Network report queue or suspensions changed. */
  | { type: 'moderation'; scope: 'reports' | 'suspensions' }
  /** Platform admins: an area of the super admin console changed (`me`: your own role). */
  | { type: 'platform'; area: PlatformChangedEvent['area']; tenantId?: string }
  /** A Help center query you asked or handle changed (any device, admins, support). */
  | { type: 'support'; queryId: string }
  | { type: 'reconnected' }
  | { type: 'action'; key: string; ok: boolean; result?: unknown; error?: ApiError };

export type WorkEvent = { type: 'task'; task: Task } | { type: 'approval'; approval: Approval };

export type MeetingEvent =
  { type: 'upsert'; meeting: Meeting } | { type: 'reminder'; reminder: MeetingReminderEvent };

export type CallEvent =
  | { type: 'ringing'; ringing: CallRingingEvent }
  | { type: 'updated'; call: Call }
  | { type: 'ended'; call: Call };

export type NotificationEvent =
  { type: 'new'; notification: Notification } | { type: 'read'; unreadCount: number };

/** What the engine needs from the network. Implemented over Socket.IO + fetch, and faked in tests. */
export interface Transport {
  send(req: SendMessageRequest): Promise<SendMessageAck>;
  sync(req: SyncRequest): Promise<SyncResponse>;
  ackReceipt(req: AckReceiptRequest): Promise<Receipt>;
  react?(req: SetReactionRequest): Promise<Message>;
  setTyping?(conversationId: string, typing: boolean): void;
  /** Any authenticated REST call (used by the action queue). */
  request?<T>(method: string, path: string, body?: unknown): Promise<T>;
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

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let token: string | null;
    try {
      token = await this.opts.getAccessToken();
    } catch (e) {
      // Could not refresh because the network is down: that's a network failure, not an auth one.
      throw new NetworkError((e as Error).message);
    }
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

  private async emit<T>(
    event: 'message:send' | 'receipt:ack' | 'reaction:set',
    payload: unknown,
  ): Promise<T> {
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

  react(req: SetReactionRequest): Promise<Message> {
    if (this.connected) return this.emit('reaction:set', req);
    return this.request(
      req.op === 'add' ? 'PUT' : 'DELETE',
      `/v1/messages/${encodeURIComponent(req.messageId)}/reactions/${encodeURIComponent(req.emoji)}`,
    );
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
    // The API base may be a path on this site (`/api`); socket.io needs origin + engine path.
    const t = socketTarget(this.opts.baseUrl, globalThis.location?.origin);
    const s: Socket<ServerToClientEvents, ClientToServerEvents> = io(t.url, {
      path: t.path,
      transports: ['websocket'],
      reconnection: false,
      autoConnect: false,
      auth: (cb) => {
        this.opts.getAccessToken().then(
          (token) => cb({ token }),
          () => cb({ token: null }),
        );
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
    s.on('notification:new', (n) =>
      this.handlers?.onNotification?.({ type: 'new', notification: n }),
    );
    s.on('notification:read', (e) =>
      this.handlers?.onNotification?.({ type: 'read', unreadCount: e.unreadCount }),
    );
    s.on('call:ringing', (e) => this.handlers?.onCall?.({ type: 'ringing', ringing: e }));
    s.on('call:updated', (call) => this.handlers?.onCall?.({ type: 'updated', call }));
    s.on('call:ended', (call) => this.handlers?.onCall?.({ type: 'ended', call }));
    s.on('meeting:upsert', (meeting) => this.handlers?.onMeeting?.({ type: 'upsert', meeting }));
    s.on('meeting:reminder', (r) => this.handlers?.onMeeting?.({ type: 'reminder', reminder: r }));
    s.on('inbox:changed', (e) => this.handlers?.onInbox?.(e));
    s.on('scheduled:updated', (x) => this.handlers?.onScheduled?.(x));
    s.on('task:upsert', (task) => this.handlers?.onWork?.({ type: 'task', task }));
    s.on('approval:upsert', (approval) => this.handlers?.onWork?.({ type: 'approval', approval }));
    s.on('network:changed', (e) => this.handlers?.onNetwork?.(e));
    s.on('moderation:changed', (e) => this.handlers?.onChange?.({ type: 'moderation', ...e }));
    s.on('platform:changed', (e) => this.handlers?.onChange?.({ type: 'platform', ...e }));
    s.on('support:changed', (e) =>
      this.handlers?.onChange?.({ type: 'support', queryId: e.queryId }),
    );
    s.on('bookmark:updated', (e) => this.handlers?.onChange?.({ type: 'bookmark', ...e }));
    s.on('search:recent', (e) => this.handlers?.onChange?.({ type: 'searchRecent', ...e }));
    s.on('chat-theme:changed', (e) => this.handlers?.onChange?.({ type: 'chatTheme', ...e }));
    s.on('poll:myVote', (e) => this.handlers?.onChange?.({ type: 'pollVote', ...e }));
    s.on('directory:updated', (e) => this.handlers?.onChange?.({ type: 'directory', ...e }));
    s.on('tenant:updated', (e) => this.handlers?.onChange?.({ type: 'tenant', ...e }));
    s.on('project:changed', (e) => this.handlers?.onChange?.({ type: 'project', ...e }));
    s.on('ai:proposal', (proposal) => this.handlers?.onChange?.({ type: 'aiProposal', proposal }));
    s.on('ai:suggestion', (e) => this.handlers?.onChange?.({ type: 'aiSuggestion', ...e }));
    s.on('meetings:changed', (e) => this.handlers?.onChange?.({ type: 'meetings', ...e }));
    s.on('recording:changed', (e) => this.handlers?.onChange?.({ type: 'recording', ...e }));
    s.on('record:changed', (e) => this.handlers?.onChange?.({ type: 'records', ...e }));
    s.on('minutes:changed', (e) => this.handlers?.onChange?.({ type: 'minutes', ...e }));
    s.on('transcript:changed', (e) => this.handlers?.onChange?.({ type: 'transcript', ...e }));
    this.socket = s;
    s.connect();
  }

  disconnect() {
    this.socket?.disconnect();
  }
}
