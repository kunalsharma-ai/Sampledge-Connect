import {
  ERROR_CODES,
  type Attachment,
  type Bookmark,
  type CreatePollRequest,
  type CreateScheduledMessageRequest,
  type PostingPolicy,
  type ScheduledMessage,
  type UpdateScheduledMessageRequest,
  type MyPollVote,
  type AttachmentUrl,
  type CreateUploadRequest,
  type UploadTicket,
  type AckReceiptRequest,
  type Call,
  type CallJoinResponse,
  type CallMedia,
  type CallsConfig,
  type IntegrationTestResult,
  type IntegrationValues,
  type IntegrationView,
  type Recording,
  type RecordingKind,
  type RecordingList,
  type Conversation,
  type CreateConversationRequest,
  type CreateMeetingRequest,
  type FindTimesRequest,
  type FindTimesResponse,
  type Meeting,
  type RsvpResponse,
  type UpdateMeetingRequest,
  type WorkingHours,
  type NotifyLevel,
  type PushStatus,
  type RegisterPushTokenRequest,
  type EditMessageRequest,
  type ErrorCode,
  type LoginRequest,
  type LoginResponse,
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
  /** A Session, or a two-step challenge to finish with verifyMfa. */
  login(req: LoginRequest): Promise<LoginResponse>;
  verifyMfa(challengeId: string, code: string): Promise<Session>;
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
  /** A DM with someone you already talk to returns the existing conversation. */
  createConversation(req: CreateConversationRequest): Promise<Conversation>;
  getConversation(conversationId: string): Promise<Conversation>;
  /** Join a public channel. */
  joinConversation(conversationId: string): Promise<Conversation>;
  addMembers(conversationId: string, userIds: readonly string[]): Promise<Conversation>;
  /** Removing yourself is leaving. */
  removeMember(conversationId: string, userId: string): Promise<void>;
  setArchived(conversationId: string, archived: boolean): Promise<Conversation>;
  /** Your signed-in device sessions, newest activity first. */
  listDevices(): Promise<DeviceSession[]>;
  revokeDevice(sessionId: string): Promise<void>;
  /** Ends this device session on the server (also drops its push token). */
  logout(): Promise<void>;
  /** Your meetings overlapping [from, to) (max 62 days), cancelled ones included. */
  listMeetings(from: string, to: string): Promise<Meeting[]>;
  getMeeting(meetingId: string): Promise<Meeting>;
  createMeeting(req: CreateMeetingRequest): Promise<Meeting>;
  updateMeeting(meetingId: string, req: UpdateMeetingRequest): Promise<Meeting>;
  cancelMeeting(meetingId: string): Promise<Meeting>;
  rsvp(meetingId: string, response: Exclude<RsvpResponse, 'pending'>): Promise<Meeting>;
  findTimes(req: FindTimesRequest): Promise<FindTimesResponse>;
  getWorkingHours(): Promise<WorkingHours>;
  setWorkingHours(hours: WorkingHours): Promise<WorkingHours>;
  /** Recordings library, newest first; page with `before` = the previous page's nextBefore. */
  listRecordings(q: RecordingsQuery): Promise<RecordingList>;
  /** Pins or unpins for everyone in the conversation; returns the updated message. */
  pinMessage(messageId: string, pinned: boolean): Promise<Message>;
  /** Messages you saved for later, newest first. */
  listBookmarks(): Promise<Bookmark[]>;
  setBookmark(messageId: string, saved: boolean): Promise<void>;
  createPoll(conversationId: string, req: CreatePollRequest): Promise<Message>;
  /** Replaces your choice; [] withdraws it. Returns the message with new counts. */
  votePoll(messageId: string, optionIds: string[]): Promise<Message>;
  myPollVote(messageId: string): Promise<MyPollVote>;
  closePoll(messageId: string): Promise<Message>;
  /** Your own scheduled messages (scheduled and failed unless a status is given). */
  listScheduled(conversationId?: string): Promise<ScheduledMessage[]>;
  scheduleMessage(
    conversationId: string,
    req: CreateScheduledMessageRequest,
  ): Promise<ScheduledMessage>;
  updateScheduled(id: string, req: UpdateScheduledMessageRequest): Promise<ScheduledMessage>;
  cancelScheduled(id: string): Promise<ScheduledMessage>;
  sendScheduledNow(id: string): Promise<ScheduledMessage>;
  setPostingPolicy(conversationId: string, policy: PostingPolicy): Promise<Conversation>;
  deleteRecording(recordingId: string): Promise<void>;
  startCallRecording(callId: string): Promise<Call>;
  stopCallRecording(callId: string): Promise<Call>;
  /** Let a guest in from the lobby, or turn them away (anyone in the call; first answer wins). */
  lobbyDecision(callId: string, guestId: string, decision: 'admit' | 'deny'): Promise<Call>;
  guestLink(meetingId: string, guestId: string): Promise<{ url: string }>;
  resendGuestInvite(meetingId: string, guestId: string): Promise<void>;
  /** Administration, Integrations (integrations.manage): settings stored in the database. */
  listIntegrations(): Promise<IntegrationView[]>;
  saveIntegration(
    id: string,
    enabled: boolean,
    values: IntegrationValues,
  ): Promise<IntegrationView>;
  testIntegration(id: string, values?: IntegrationValues): Promise<IntegrationTestResult>;
  resetIntegration(id: string): Promise<IntegrationView>;
}

/** A signed-in device session, from GET /v1/devices. */
export interface RecordingsQuery {
  conversationId?: string;
  kind?: RecordingKind;
  before?: string;
  limit?: number;
}

export type { Recording };

export interface DeviceSession {
  sessionId: string;
  userId: string;
  deviceId: string;
  name: string;
  platform: string;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
  /** The session making the request (this phone). */
  current: boolean;
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

  login(req: LoginRequest): Promise<LoginResponse> {
    return this.request('POST', '/v1/auth/login', req, false);
  }

  verifyMfa(challengeId: string, code: string): Promise<Session> {
    return this.request('POST', '/v1/auth/mfa/verify', { challengeId, code }, false);
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

  createConversation(req: CreateConversationRequest): Promise<Conversation> {
    return this.request('POST', '/v1/conversations', req);
  }

  getConversation(conversationId: string): Promise<Conversation> {
    return this.request(
      'GET',
      `/v1/conversations/${encodeURIComponent(conversationId)}`,
      undefined,
    );
  }

  joinConversation(conversationId: string): Promise<Conversation> {
    return this.request('POST', `/v1/conversations/${encodeURIComponent(conversationId)}/join`, {});
  }

  addMembers(conversationId: string, userIds: readonly string[]): Promise<Conversation> {
    return this.request('POST', `/v1/conversations/${encodeURIComponent(conversationId)}/members`, {
      userIds,
    });
  }

  removeMember(conversationId: string, userId: string): Promise<void> {
    return this.request(
      'DELETE',
      `/v1/conversations/${encodeURIComponent(conversationId)}/members/${encodeURIComponent(userId)}`,
      undefined,
    );
  }

  setArchived(conversationId: string, archived: boolean): Promise<Conversation> {
    return this.request('PATCH', `/v1/conversations/${encodeURIComponent(conversationId)}`, {
      archived,
    });
  }

  listDevices(): Promise<DeviceSession[]> {
    return this.request('GET', '/v1/devices', undefined);
  }

  revokeDevice(sessionId: string): Promise<void> {
    return this.request('DELETE', `/v1/devices/${encodeURIComponent(sessionId)}`, undefined);
  }

  logout(): Promise<void> {
    return this.request('POST', '/v1/auth/logout', {});
  }

  listMeetings(from: string, to: string): Promise<Meeting[]> {
    const q = new URLSearchParams({ from, to, includeCancelled: 'true' });
    return this.request('GET', `/v1/meetings?${q.toString()}`, undefined);
  }

  getMeeting(meetingId: string): Promise<Meeting> {
    return this.request('GET', `/v1/meetings/${encodeURIComponent(meetingId)}`, undefined);
  }

  createMeeting(req: CreateMeetingRequest): Promise<Meeting> {
    return this.request('POST', '/v1/meetings', req);
  }

  updateMeeting(meetingId: string, req: UpdateMeetingRequest): Promise<Meeting> {
    return this.request('PATCH', `/v1/meetings/${encodeURIComponent(meetingId)}`, req);
  }

  cancelMeeting(meetingId: string): Promise<Meeting> {
    return this.request('POST', `/v1/meetings/${encodeURIComponent(meetingId)}/cancel`, {});
  }

  rsvp(meetingId: string, response: Exclude<RsvpResponse, 'pending'>): Promise<Meeting> {
    return this.request('POST', `/v1/meetings/${encodeURIComponent(meetingId)}/rsvp`, {
      response,
    });
  }

  findTimes(req: FindTimesRequest): Promise<FindTimesResponse> {
    return this.request('POST', '/v1/meetings/find-times', req);
  }

  getWorkingHours(): Promise<WorkingHours> {
    return this.request('GET', '/v1/me/working-hours', undefined);
  }

  setWorkingHours(hours: WorkingHours): Promise<WorkingHours> {
    return this.request('PUT', '/v1/me/working-hours', hours);
  }

  listRecordings(q: RecordingsQuery): Promise<RecordingList> {
    const p = new URLSearchParams();
    if (q.conversationId) p.set('conversationId', q.conversationId);
    if (q.kind) p.set('kind', q.kind);
    if (q.before) p.set('before', q.before);
    p.set('limit', String(q.limit ?? 30));
    return this.request('GET', `/v1/recordings?${p.toString()}`, undefined);
  }

  deleteRecording(recordingId: string): Promise<void> {
    return this.request('DELETE', `/v1/recordings/${encodeURIComponent(recordingId)}`, undefined);
  }

  pinMessage(messageId: string, pinned: boolean): Promise<Message> {
    return this.request(
      pinned ? 'PUT' : 'DELETE',
      `/v1/messages/${encodeURIComponent(messageId)}/pin`,
      undefined,
    );
  }

  async listBookmarks(): Promise<Bookmark[]> {
    const r = await this.request<{ items: Bookmark[] }>('GET', '/v1/bookmarks', undefined);
    return r.items;
  }

  createPoll(conversationId: string, req: CreatePollRequest): Promise<Message> {
    return this.request(
      'POST',
      `/v1/conversations/${encodeURIComponent(conversationId)}/polls`,
      req,
    );
  }

  votePoll(messageId: string, optionIds: string[]): Promise<Message> {
    return this.request('PUT', `/v1/messages/${encodeURIComponent(messageId)}/poll/vote`, {
      optionIds,
    });
  }

  myPollVote(messageId: string): Promise<MyPollVote> {
    return this.request(
      'GET',
      `/v1/messages/${encodeURIComponent(messageId)}/poll/vote`,
      undefined,
    );
  }

  closePoll(messageId: string): Promise<Message> {
    return this.request('POST', `/v1/messages/${encodeURIComponent(messageId)}/poll/close`, {});
  }

  listScheduled(conversationId?: string): Promise<ScheduledMessage[]> {
    const q = conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : '';
    return this.request('GET', `/v1/scheduled-messages${q}`, undefined);
  }

  scheduleMessage(
    conversationId: string,
    req: CreateScheduledMessageRequest,
  ): Promise<ScheduledMessage> {
    return this.request(
      'POST',
      `/v1/conversations/${encodeURIComponent(conversationId)}/scheduled-messages`,
      req,
    );
  }

  updateScheduled(id: string, req: UpdateScheduledMessageRequest): Promise<ScheduledMessage> {
    return this.request('PATCH', `/v1/scheduled-messages/${encodeURIComponent(id)}`, req);
  }

  cancelScheduled(id: string): Promise<ScheduledMessage> {
    return this.request('DELETE', `/v1/scheduled-messages/${encodeURIComponent(id)}`, undefined);
  }

  sendScheduledNow(id: string): Promise<ScheduledMessage> {
    return this.request('POST', `/v1/scheduled-messages/${encodeURIComponent(id)}/send-now`, {});
  }

  setPostingPolicy(conversationId: string, policy: PostingPolicy): Promise<Conversation> {
    return this.request(
      'PUT',
      `/v1/conversations/${encodeURIComponent(conversationId)}/posting-policy`,
      { policy },
    );
  }

  async setBookmark(messageId: string, saved: boolean): Promise<void> {
    await this.request(
      saved ? 'PUT' : 'DELETE',
      `/v1/messages/${encodeURIComponent(messageId)}/bookmark`,
      undefined,
    );
  }

  startCallRecording(callId: string): Promise<Call> {
    return this.request('POST', `/v1/calls/${encodeURIComponent(callId)}/recording/start`, {});
  }

  stopCallRecording(callId: string): Promise<Call> {
    return this.request('POST', `/v1/calls/${encodeURIComponent(callId)}/recording/stop`, {});
  }

  lobbyDecision(callId: string, guestId: string, decision: 'admit' | 'deny'): Promise<Call> {
    return this.request(
      'POST',
      `/v1/calls/${encodeURIComponent(callId)}/lobby/${encodeURIComponent(guestId)}/${decision}`,
      {},
    );
  }

  guestLink(meetingId: string, guestId: string): Promise<{ url: string }> {
    return this.request(
      'GET',
      `/v1/meetings/${encodeURIComponent(meetingId)}/guests/${encodeURIComponent(guestId)}/link`,
      undefined,
    );
  }

  resendGuestInvite(meetingId: string, guestId: string): Promise<void> {
    return this.request(
      'POST',
      `/v1/meetings/${encodeURIComponent(meetingId)}/guests/${encodeURIComponent(guestId)}/resend`,
      {},
    );
  }

  listIntegrations(): Promise<IntegrationView[]> {
    return this.request('GET', '/v1/admin/integrations', undefined);
  }

  saveIntegration(
    id: string,
    enabled: boolean,
    values: IntegrationValues,
  ): Promise<IntegrationView> {
    return this.request('PUT', `/v1/admin/integrations/${encodeURIComponent(id)}`, {
      enabled,
      values,
    });
  }

  testIntegration(id: string, values?: IntegrationValues): Promise<IntegrationTestResult> {
    return this.request(
      'POST',
      `/v1/admin/integrations/${encodeURIComponent(id)}/test`,
      values ? { values } : {},
    );
  }

  resetIntegration(id: string): Promise<IntegrationView> {
    return this.request('DELETE', `/v1/admin/integrations/${encodeURIComponent(id)}`, undefined);
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
  login = async (): Promise<LoginResponse> => this.fail();
  verifyMfa = async (): Promise<Session> => this.fail();
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
  createConversation = async (): Promise<Conversation> => this.fail();
  getConversation = async (): Promise<Conversation> => this.fail();
  joinConversation = async (): Promise<Conversation> => this.fail();
  addMembers = async (): Promise<Conversation> => this.fail();
  removeMember = async (): Promise<void> => this.fail();
  setArchived = async (): Promise<Conversation> => this.fail();
  listDevices = async (): Promise<DeviceSession[]> => this.fail();
  revokeDevice = async (): Promise<void> => this.fail();
  logout = async (): Promise<void> => this.fail();
  listMeetings = async (): Promise<Meeting[]> => this.fail();
  getMeeting = async (): Promise<Meeting> => this.fail();
  createMeeting = async (): Promise<Meeting> => this.fail();
  updateMeeting = async (): Promise<Meeting> => this.fail();
  cancelMeeting = async (): Promise<Meeting> => this.fail();
  rsvp = async (): Promise<Meeting> => this.fail();
  findTimes = async (): Promise<FindTimesResponse> => this.fail();
  getWorkingHours = async (): Promise<WorkingHours> => this.fail();
  setWorkingHours = async (): Promise<WorkingHours> => this.fail();
  listRecordings = async (): Promise<RecordingList> => this.fail();
  deleteRecording = async (): Promise<void> => this.fail();
  pinMessage = async (): Promise<Message> => this.fail();
  listBookmarks = async (): Promise<Bookmark[]> => this.fail();
  setBookmark = async (): Promise<void> => this.fail();
  createPoll = async (): Promise<Message> => this.fail();
  votePoll = async (): Promise<Message> => this.fail();
  myPollVote = async (): Promise<MyPollVote> => this.fail();
  closePoll = async (): Promise<Message> => this.fail();
  listScheduled = async (): Promise<ScheduledMessage[]> => this.fail();
  scheduleMessage = async (): Promise<ScheduledMessage> => this.fail();
  updateScheduled = async (): Promise<ScheduledMessage> => this.fail();
  cancelScheduled = async (): Promise<ScheduledMessage> => this.fail();
  sendScheduledNow = async (): Promise<ScheduledMessage> => this.fail();
  setPostingPolicy = async (): Promise<Conversation> => this.fail();
  startCallRecording = async (): Promise<Call> => this.fail();
  stopCallRecording = async (): Promise<Call> => this.fail();
  lobbyDecision = async (): Promise<Call> => this.fail();
  guestLink = async (): Promise<{ url: string }> => this.fail();
  resendGuestInvite = async (): Promise<void> => this.fail();
  listIntegrations = async (): Promise<IntegrationView[]> => this.fail();
  saveIntegration = async (): Promise<IntegrationView> => this.fail();
  testIntegration = async (): Promise<IntegrationTestResult> => this.fail();
  resetIntegration = async (): Promise<IntegrationView> => this.fail();
}
