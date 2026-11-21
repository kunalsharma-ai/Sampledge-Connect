import {
  ERROR_CODES,
  type Attachment,
  type AttachmentUrl,
  type CreateUploadRequest,
  type UploadTicket,
  type AckReceiptRequest,
  type Call,
  type CallJoinResponse,
  type CallMedia,
  type CallsConfig,
  type Conversation,
  type NotifyLevel,
  type PushStatus,
  type RegisterPushTokenRequest,
  type EditMessageRequest,
  type ErrorCode,
  type LoginRequest,
  type Message,
  type Receipt,
  type SendMessageAck,
  type SendMessageRequest,
  type Session,
  type SetReactionRequest,
  type SyncRequest,
  type SyncResponse,
} from '@sampledge/contracts';

import { putFileBytes } from '../lib/localFiles';
import type {
  ListNotificationsQuery,
  ListNotificationsResponse,
  MarkNotificationsReadRequest,
  MarkNotificationsReadResponse,
} from './notificationTypes';

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
  setReaction(req: SetReactionRequest): Promise<Message>;
  /** Ticket, bytes, complete. Returns the ready attachment. */
  uploadFile(req: CreateUploadRequest, localUri: string): Promise<Attachment>;
  /** Short-lived signed download URL, absolute. */
  attachmentUrl(attachmentId: string): Promise<AttachmentUrl>;
  listUsers(): Promise<DirectoryUser[]>;
  listNotifications(q?: ListNotificationsQuery): Promise<ListNotificationsResponse>;
  markNotificationsRead(req: MarkNotificationsReadRequest): Promise<MarkNotificationsReadResponse>;
  setNotifyLevel(conversationId: string, level: NotifyLevel): Promise<Conversation>;
  pushStatus(): Promise<PushStatus>;
  registerPushToken(req: RegisterPushTokenRequest): Promise<PushStatus>;
  callsConfig(): Promise<CallsConfig>;
  activeCalls(): Promise<Call[]>;
  getCall(callId: string): Promise<Call>;
  startCall(conversationId: string, media: CallMedia): Promise<CallJoinResponse>;
  joinCall(callId: string): Promise<CallJoinResponse>;
  callAction(callId: string, action: 'leave' | 'decline' | 'end'): Promise<Call>;
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

  setReaction(req: SetReactionRequest): Promise<Message> {
    return this.request(
      req.op === 'add' ? 'PUT' : 'DELETE',
      `/v1/messages/${encodeURIComponent(req.messageId)}/reactions/${encodeURIComponent(req.emoji)}`,
      undefined,
    );
  }

  async uploadFile(req: CreateUploadRequest, localUri: string): Promise<Attachment> {
    const ticket = await this.request<UploadTicket>('POST', '/v1/uploads', req);
    const token = await this.opts.getAccessToken();
    if (!token) throw new TransportError('Not signed in', 'api', 'UNAUTHENTICATED');
    let res: { status: number; body: string };
    try {
      res = await putFileBytes(new URL(ticket.uploadUrl, this.opts.baseUrl).toString(), localUri, {
        authorization: `Bearer ${token}`,
        'content-type': 'application/octet-stream',
      });
    } catch (err) {
      throw new TransportError(err instanceof Error ? err.message : 'Upload failed', 'network');
    }
    if (res.status < 200 || res.status >= 300) {
      let error: { code?: ErrorCode; message?: string; retryAfterMs?: number } | undefined;
      try {
        error = (JSON.parse(res.body) as { error?: typeof error }).error;
      } catch {
        error = undefined;
      }
      throw new TransportError(
        error?.message ?? `Upload failed (HTTP ${res.status})`,
        'api',
        error?.code ?? codeForStatus(res.status),
        error?.retryAfterMs,
      );
    }
    return this.request(
      'POST',
      `/v1/uploads/${encodeURIComponent(ticket.uploadId)}/complete`,
      undefined,
    );
  }

  async attachmentUrl(attachmentId: string): Promise<AttachmentUrl> {
    const r = await this.request<AttachmentUrl>(
      'GET',
      `/v1/attachments/${encodeURIComponent(attachmentId)}/url`,
      undefined,
    );
    return { ...r, url: new URL(r.url, this.opts.baseUrl).toString() };
  }

  /** Member directory (needs directory.read; guests get FORBIDDEN). */
  listUsers(): Promise<DirectoryUser[]> {
    return this.request('GET', '/v1/users', undefined);
  }

  /** Mentions and replies addressed to you, newest first. */
  listNotifications(q: ListNotificationsQuery = {}): Promise<ListNotificationsResponse> {
    const params = new URLSearchParams();
    if (q.unread) params.set('unread', 'true');
    if (q.before) params.set('before', q.before);
    if (q.limit) params.set('limit', String(q.limit));
    const qs = params.toString();
    return this.request('GET', `/v1/notifications${qs ? `?${qs}` : ''}`, undefined);
  }

  /** Idempotent; returns your unread count after the change. */
  markNotificationsRead(req: MarkNotificationsReadRequest): Promise<MarkNotificationsReadResponse> {
    return this.request('POST', '/v1/notifications/read', req);
  }

  setNotifyLevel(conversationId: string, level: NotifyLevel): Promise<Conversation> {
    return this.request(
      'PUT',
      `/v1/conversations/${encodeURIComponent(conversationId)}/notify-level`,
      {
        level,
      },
    );
  }

  /** Whether the server can send push, and whether this device session has a token stored. */
  pushStatus(): Promise<PushStatus> {
    return this.request('GET', '/v1/push/status', undefined);
  }

  /** Whether this deployment has a media server (calls are hidden when it does not). */
  callsConfig(): Promise<CallsConfig> {
    return this.request('GET', '/v1/calls/config', undefined);
  }

  /** Live calls in your conversations (for join banners). */
  async activeCalls(): Promise<Call[]> {
    const r = await this.request<Call[] | { calls: Call[] }>('GET', '/v1/calls/active', undefined);
    return Array.isArray(r) ? r : r.calls;
  }

  getCall(callId: string): Promise<Call> {
    return this.request('GET', `/v1/calls/${encodeURIComponent(callId)}`, undefined);
  }

  /** Starts a call, or joins the one already live in the conversation. */
  startCall(conversationId: string, media: CallMedia): Promise<CallJoinResponse> {
    return this.request('POST', `/v1/conversations/${encodeURIComponent(conversationId)}/calls`, {
      media,
    });
  }

  joinCall(callId: string): Promise<CallJoinResponse> {
    return this.request('POST', `/v1/calls/${encodeURIComponent(callId)}/join`, {});
  }

  callAction(callId: string, action: 'leave' | 'decline' | 'end'): Promise<Call> {
    return this.request('POST', `/v1/calls/${encodeURIComponent(callId)}/${action}`, {});
  }

  /** Ties a push token to this device session (idempotent; sign-out and revoke clear it). */
  registerPushToken(req: RegisterPushTokenRequest): Promise<PushStatus> {
    return this.request('POST', '/v1/push/token', req);
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
  setReaction = async (): Promise<Message> => this.fail();
  uploadFile = async (): Promise<Attachment> => this.fail();
  attachmentUrl = async (): Promise<AttachmentUrl> => this.fail();
  listUsers = async (): Promise<DirectoryUser[]> => this.fail();
  listNotifications = async (): Promise<ListNotificationsResponse> => this.fail();
  markNotificationsRead = async (): Promise<MarkNotificationsReadResponse> => this.fail();
  setNotifyLevel = async (): Promise<Conversation> => this.fail();
  pushStatus = async (): Promise<PushStatus> => this.fail();
  registerPushToken = async (): Promise<PushStatus> => this.fail();
  callsConfig = async (): Promise<CallsConfig> => this.fail();
  activeCalls = async (): Promise<Call[]> => this.fail();
  getCall = async (): Promise<Call> => this.fail();
  startCall = async (): Promise<CallJoinResponse> => this.fail();
  joinCall = async (): Promise<CallJoinResponse> => this.fail();
  callAction = async (): Promise<Call> => this.fail();
}
