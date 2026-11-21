import {
  ERROR_CODES,
  type AckReceiptRequest,
  type EditMessageRequest,
  type ErrorCode,
  type LoginRequest,
  type Message,
  type Receipt,
  type SendMessageAck,
  type SendMessageRequest,
  type Session,
  type SyncRequest,
  type SyncResponse,
} from '@sampledge/contracts';

/** Why a request failed, in terms the offline queue can act on. */
export class TransportError extends Error {
  constructor(
    message: string,
    readonly kind: 'network' | 'api' | 'not_configured',
    readonly code?: ErrorCode,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'TransportError';
  }

  get retryable(): boolean {
    if (this.kind === 'network') return true;
    if (this.kind === 'not_configured') return true; // stays queued until a server is connected
    return this.code ? ERROR_CODES[this.code].retryable : false;
  }

  get isAuth(): boolean {
    return this.code === 'SESSION_EXPIRED' || this.code === 'UNAUTHENTICATED';
  }
}

/** The REST surface the mobile app uses. */
export interface ApiTransport {
  login(req: LoginRequest): Promise<Session>;
  refresh(refreshToken: string): Promise<Session>;
  sendMessage(req: SendMessageRequest): Promise<SendMessageAck>;
  sync(req: SyncRequest): Promise<SyncResponse>;
  ackReceipt(req: AckReceiptRequest): Promise<Receipt>;
  editMessage(messageId: string, req: EditMessageRequest): Promise<Message>;
  deleteMessage(messageId: string): Promise<Message>;
  listUsers(): Promise<DirectoryUser[]>;
}

export interface DirectoryUser {
  userId: string;
  displayName: string;
  email: string;
  role: string;
  title: string | null;
  status: string;
  presence?: string;
}

export interface HttpTransportOptions {
  baseUrl: string;
  getAccessToken: () => Promise<string | undefined>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** fetch-based client for the Sampledge Connect API (`/v1/...`). */
export class HttpTransport implements ApiTransport {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: HttpTransportOptions) {
    this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a));
  }

  login(req: LoginRequest): Promise<Session> {
    return this.request('POST', '/v1/auth/login', req, false);
  }

  refresh(refreshToken: string): Promise<Session> {
    return this.request('POST', '/v1/auth/refresh', { refreshToken }, false);
  }

  sendMessage(req: SendMessageRequest): Promise<SendMessageAck> {
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
    return this.request('POST', '/v1/messages/receipts', req);
  }

  editMessage(messageId: string, req: EditMessageRequest): Promise<Message> {
    return this.request('PATCH', `/v1/messages/${encodeURIComponent(messageId)}`, req);
  }

  deleteMessage(messageId: string): Promise<Message> {
    return this.request('DELETE', `/v1/messages/${encodeURIComponent(messageId)}`, undefined);
  }

  /** Member directory (needs directory.read; guests get FORBIDDEN). */
  listUsers(): Promise<DirectoryUser[]> {
    return this.request('GET', '/v1/users', undefined);
  }

  private async request<T>(method: string, path: string, body: unknown, auth = true): Promise<T> {
    const hasBody = method !== 'GET' && body !== undefined;
    const headers: Record<string, string> = { accept: 'application/json' };
    if (hasBody) headers['content-type'] = 'application/json';
    if (auth) {
      const token = await this.opts.getAccessToken();
      if (!token) throw new TransportError('Not signed in', 'api', 'UNAUTHENTICATED');
      headers.authorization = `Bearer ${token}`;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 20_000);
    let res: Response;
    try {
      res = await this.fetchImpl(new URL(path, this.opts.baseUrl).toString(), {
        method,
        headers,
        body: hasBody ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      throw new TransportError(
        err instanceof Error ? err.message : 'Network request failed',
        'network',
      );
    } finally {
      clearTimeout(timer);
    }
    // REST returns the body directly on 2xx and `{ error: ApiError }` otherwise.
    // (The `{ ok, data }` envelope is only used for Socket.IO acks.)
    const json = (await res.json().catch(() => undefined)) as unknown;
    if (res.ok) return json as T;
    const error =
      json && typeof json === 'object' && 'error' in json
        ? (json as { error?: { code?: ErrorCode; message?: string; retryAfterMs?: number } }).error
        : undefined;
    const code = error?.code ?? codeForStatus(res.status);
    const retryAfter = error?.retryAfterMs ?? retryAfterHeader(res.headers.get('retry-after'));
    throw new TransportError(error?.message ?? `HTTP ${res.status}`, 'api', code, retryAfter);
  }
}

function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
    case 422:
      return 'VALIDATION_FAILED';
    case 401:
      return 'SESSION_EXPIRED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 429:
      return 'RATE_LIMITED';
    case 503:
      return 'UNAVAILABLE';
    default:
      return 'INTERNAL';
  }
}

function retryAfterHeader(v: string | null): number | undefined {
  if (!v) return undefined;
  const seconds = Number(v);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

/**
 * Used by the explicitly labelled local demo workspace, which has no server.
 * Every call fails as "not configured", so messages visibly stay queued on the device.
 */
export class NoServerTransport implements ApiTransport {
  private fail(): never {
    throw new TransportError('No server connected', 'not_configured');
  }
  login = async (): Promise<Session> => this.fail();
  refresh = async (): Promise<Session> => this.fail();
  sendMessage = async (): Promise<SendMessageAck> => this.fail();
  sync = async (): Promise<SyncResponse> => this.fail();
  ackReceipt = async (): Promise<Receipt> => this.fail();
  editMessage = async (): Promise<Message> => this.fail();
  deleteMessage = async (): Promise<Message> => this.fail();
  listUsers = async (): Promise<DirectoryUser[]> => this.fail();
}
