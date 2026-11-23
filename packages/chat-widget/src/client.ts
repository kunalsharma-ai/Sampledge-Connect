import { io, type Socket } from 'socket.io-client';
import {
  apiBaseFor,
  backoffDelay,
  socketTarget,
  uuidv7,
  type Conversation,
  type Message,
  type ServerToClientEvents,
  type UserSummary,
  type WidgetSession,
} from '@sampledge/contracts';

export type WidgetStatus = 'connecting' | 'online' | 'offline' | 'expired' | 'error';

/** A message the user wrote here that the server has not confirmed yet. */
export interface PendingMessage {
  clientMessageId: string;
  text: string;
  composedAt: string;
  state: 'queued' | 'sending' | 'failed';
  error?: string;
  attempts: number;
}

export interface WidgetState {
  status: WidgetStatus;
  conversation: Conversation | null;
  /** Server-confirmed messages in display order. */
  messages: Message[];
  pending: PendingMessage[];
  people: Map<string, UserSummary>;
  userId: string;
  error: string | null;
}

type Listener = (s: WidgetState) => void;

export interface WidgetClientOptions {
  /** Your SampConnect address, e.g. https://connect.example.com (its API is at /api). */
  apiUrl: string;
  session: WidgetSession;
  conversationId?: string;
  /** Called to get a fresh session when refresh fails (e.g. ask your server again). */
  renewSession?: () => Promise<WidgetSession>;
  /** Storage for the outbox; defaults to localStorage when available. */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  fetch?: typeof fetch;
}

const safeStorage = (): WidgetClientOptions['storage'] => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
};

/**
 * Headless engine behind <ConnectChat>. Loads the conversation, keeps it live over Socket.IO,
 * refreshes the short-lived token, and sends through a small persisted outbox: a message is
 * stored before it is sent, shown as queued while offline, and retried with backoff. Sends are
 * idempotent (clientMessageId), so a retry never duplicates. A message only shows as sent after
 * the server confirms it.
 */
export class WidgetClient {
  private session: WidgetSession;
  private readonly conversationId: string;
  private readonly f: typeof fetch;
  private readonly storage: WidgetClientOptions['storage'];
  private socket: Socket<ServerToClientEvents> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<Listener>();
  private disposed = false;
  private state: WidgetState;

  /** API base: the site address plus /api (either form is accepted in `apiUrl`). */
  private readonly base: string;

  constructor(private readonly opts: WidgetClientOptions) {
    this.base = apiBaseFor(opts.apiUrl);
    this.session = opts.session;
    const cid = opts.conversationId ?? opts.session.conversationId;
    if (!cid)
      throw new Error('ConnectChat needs a conversationId (or a session created with a record)');
    this.conversationId = cid;
    this.f = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.storage = opts.storage === undefined ? safeStorage() : opts.storage;
    this.state = {
      status: 'connecting',
      conversation: null,
      messages: [],
      pending: this.loadOutbox(),
      people: new Map(),
      userId: opts.session.userId,
      error: null,
    };
  }

  /* ---------- state ---------- */

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }
  getState() {
    return this.state;
  }
  private set(patch: Partial<WidgetState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  private get outboxKey() {
    return `sampledge.widget.outbox:${this.session.tenantId}:${this.session.userId}:${this.conversationId}`;
  }
  private loadOutbox(): PendingMessage[] {
    try {
      const raw = this.storage?.getItem(this.outboxKey);
      const list = raw ? (JSON.parse(raw) as PendingMessage[]) : [];
      // Anything that was mid-flight when the page closed is queued again.
      return list.map((p) => ({ ...p, state: p.state === 'failed' ? 'failed' : 'queued' }));
    } catch {
      return [];
    }
  }
  private saveOutbox(list: PendingMessage[]) {
    this.set({ pending: list });
    try {
      if (list.length) this.storage?.setItem(this.outboxKey, JSON.stringify(list));
      else this.storage?.removeItem(this.outboxKey);
    } catch {
      /* storage full or blocked: the in-memory queue still works for this page */
    }
  }

  /* ---------- lifecycle ---------- */

  async start() {
    this.scheduleRefresh();
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onOnline);
      window.addEventListener('offline', this.onOffline);
    }
    await this.load();
    this.connectSocket();
    void this.flush();
  }

  dispose() {
    this.disposed = true;
    this.socket?.disconnect();
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnline);
      window.removeEventListener('offline', this.onOffline);
    }
    this.listeners.clear();
  }

  private onOnline = () => {
    void this.load().then(() => this.flush());
  };
  private onOffline = () => this.set({ status: 'offline' });

  private async api<T>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
    const res = await this.f(this.base + path, {
      method,
      headers: {
        authorization: `Bearer ${this.session.accessToken}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401 && !retried) {
      await this.refresh();
      return this.api<T>(method, path, body, true);
    }
    const text = await res.text();
    const json = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      const e = new Error(json?.error?.message ?? `HTTP ${res.status}`) as Error & {
        status?: number;
      };
      e.status = res.status;
      throw e;
    }
    return json as T;
  }

  private scheduleRefresh() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    const ms = Math.max(10_000, (this.session.accessTokenExpiresIn - 60) * 1000);
    this.refreshTimer = setTimeout(() => void this.refresh().catch(() => {}), ms);
  }

  private async refresh() {
    try {
      const res = await this.f(`${this.base}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.session.refreshToken }),
      });
      if (!res.ok) throw new Error(`refresh ${res.status}`);
      const s = (await res.json()) as {
        accessToken: string;
        accessTokenExpiresIn: number;
        refreshToken: string;
      };
      this.session = { ...this.session, ...s };
    } catch (e) {
      if (!this.opts.renewSession) {
        this.set({
          status: 'expired',
          error: 'Your chat session ended. Reload the page to continue.',
        });
        throw e;
      }
      this.session = await this.opts.renewSession();
    }
    this.scheduleRefresh();
    if (this.socket) {
      this.socket.auth = { token: this.session.accessToken };
      if (!this.socket.connected) this.socket.connect();
    }
  }

  private async load() {
    try {
      const [conversation, messages, people] = await Promise.all([
        this.api<Conversation>('GET', `/v1/conversations/${this.conversationId}`),
        this.api<Message[]>('GET', `/v1/conversations/${this.conversationId}/messages?limit=100`),
        this.api<UserSummary[]>('GET', '/v1/users').catch(() => [] as UserSummary[]),
      ]);
      this.set({
        conversation,
        messages: [...messages].sort((a, b) => a.serverSequence - b.serverSequence),
        people: new Map(people.map((p) => [p.userId, p])),
        status: this.socket?.connected
          ? 'online'
          : this.state.status === 'online'
            ? 'online'
            : 'connecting',
        error: null,
      });
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 404)
        this.set({ status: 'error', error: 'This conversation is not available to you.' });
      else if (status === undefined) this.set({ status: 'offline' });
      else this.set({ status: 'error', error: (e as Error).message });
    }
  }

  private connectSocket() {
    if (this.disposed) return;
    const t = socketTarget(this.base, globalThis.location?.origin);
    const s: Socket<ServerToClientEvents> = io(t.url, {
      path: t.path,
      auth: { token: this.session.accessToken },
      transports: ['websocket'],
    });
    this.socket = s;
    s.on('connect', () => {
      this.set({ status: 'online' });
      void this.load().then(() => this.flush());
    });
    s.on('disconnect', () => this.set({ status: navigatorOnline() ? 'connecting' : 'offline' }));
    s.on('connect_error', () => this.set({ status: navigatorOnline() ? 'connecting' : 'offline' }));
    s.on('message:new', (m) => this.upsert(m));
    s.on('message:updated', (m) => this.upsert(m));
    s.on('session:expired', () => void this.refresh().catch(() => {}));
  }

  private upsert(m: Message) {
    if (m.conversationId !== this.conversationId) return;
    const others = this.state.messages.filter((x) => x.messageId !== m.messageId);
    this.set({ messages: [...others, m].sort((a, b) => a.serverSequence - b.serverSequence) });
    if (this.state.pending.some((p) => p.clientMessageId === m.clientMessageId))
      this.saveOutbox(this.state.pending.filter((p) => p.clientMessageId !== m.clientMessageId));
  }

  /* ---------- sending ---------- */

  /** Writes to the outbox first, then sends. Returns once the message is stored locally. */
  send(text: string) {
    const t = text.trim();
    if (!t) return;
    const p: PendingMessage = {
      clientMessageId: uuidv7(),
      text: t.slice(0, 8000),
      composedAt: new Date().toISOString(),
      state: 'queued',
      attempts: 0,
    };
    this.saveOutbox([...this.state.pending, p]);
    void this.flush();
  }

  retry(clientMessageId: string) {
    this.saveOutbox(
      this.state.pending.map((p) =>
        p.clientMessageId === clientMessageId
          ? { ...p, state: 'queued', attempts: 0, error: undefined }
          : p,
      ),
    );
    void this.flush();
  }

  discard(clientMessageId: string) {
    this.saveOutbox(this.state.pending.filter((p) => p.clientMessageId !== clientMessageId));
  }

  private flushing = false;
  private async flush() {
    if (this.flushing || this.disposed) return;
    this.flushing = true;
    try {
      for (;;) {
        const next = this.state.pending.find((p) => p.state === 'queued');
        if (!next) break;
        if (!navigatorOnline()) {
          this.set({ status: 'offline' });
          break;
        }
        this.mark(next.clientMessageId, { state: 'sending' });
        try {
          const ack = await this.api<{ message: Message }>(
            'POST',
            `/v1/conversations/${this.conversationId}/messages`,
            {
              conversationId: this.conversationId,
              clientMessageId: next.clientMessageId,
              content: { text: next.text, mentions: [] },
              composedAt: next.composedAt,
            },
          );
          this.upsert(ack.message);
        } catch (e) {
          const status = (e as { status?: number }).status;
          const attempts = next.attempts + 1;
          // 4xx (except 408/429) will not succeed on retry: show it as failed with a retry button.
          if (status && status < 500 && status !== 408 && status !== 429) {
            this.mark(next.clientMessageId, {
              state: 'failed',
              error: (e as Error).message,
              attempts,
            });
            continue;
          }
          this.mark(next.clientMessageId, { state: 'queued', attempts });
          const delay = backoffDelay(attempts);
          if (this.retryTimer) clearTimeout(this.retryTimer);
          this.retryTimer = setTimeout(() => void this.flush(), delay);
          break;
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  private mark(id: string, patch: Partial<PendingMessage>) {
    this.saveOutbox(
      this.state.pending.map((p) => (p.clientMessageId === id ? { ...p, ...patch } : p)),
    );
  }
}

function navigatorOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}
