import {
  ERROR_CODES,
  type NetworkSignupRequest,
  type AdminOverview,
  type AuditPage,
  type AuditQuery,
  type InviteMemberRequest,
  type UserSummary,
  type UpdateProfileRequest,
  type BrandingInput,
  type BrandingView,
  type AiAskRequest,
  type AiAskResponse,
  type AiDigest,
  type AiDigestRequest,
  type AiMeetingSummary,
  type AiProposal,
  type AiSearchRequest,
  type AiSearchResponse,
  type AiStatus,
  type AiSuggestedReplies,
  type AiSummary,
  type AiTranscript,
  type UpdateTranscriptRequest,
  type AiTranslation,
  type ConfirmAiProposalRequest,
  type SummaryRange,
  type Attachment,
  type Approval,
  type Bookmark,
  type CreateApprovalRequest,
  type CreateTaskRequest,
  type DecideApprovalRequest,
  type Task,
  type UpdateTaskRequest,
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
  type ChatThemeId,
  type ChatThemePolicy,
  type ChatThemeState,
  type CallAppearance,
  type CallBackgroundChoice,
  type CallBackgroundPolicyInput,
  type CallBackgroundState,
  type CallCaptionResponse,
  type CallMinutesResponse,
  type ChatExportAccess,
  type ChatExportRequest,
  type GenerateMinutesRequest,
  type MeetingMinutes,
  type MinutesConfig,
  type MinutesDocumentQuery,
  type UpdateMinutesRequest,
  type IntegrationTestResult,
  type IntegrationValues,
  type IntegrationView,
  type ModerationActionRequest,
  type ModerationQueue,
  type ModerationReport,
  type NetworkAdminView,
  type NetworkSuspensions,
  type ReportStatus,
  type Recording,
  type RecordingKind,
  type RecordingList,
  type FileList,
  type UserStatus,
  type DndSchedule,
  type PresenceInfo,
  type ListFilesQuery,
  type Conversation,
  type CreateConversationRequest,
  type CreateMeetingRequest,
  type BookingPage,
  type CreateBookingPageRequest,
  type UpdateBookingPageRequest,
  type FindTimesRequest,
  type FindTimesResponse,
  type Meeting,
  type RsvpResponse,
  type SeriesScope,
  type RecentSearches,
  type SearchResponse,
  type SearchType,
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

import { downloadDocument, putFileBytes } from '../lib/localFiles';
import type {
  ListNotificationsQuery,
  ListNotificationsResponse,
  MarkNotificationsReadRequest,
  MarkNotificationsReadResponse,
} from './notificationTypes';

import { networkAllows } from '../lib/networkSpace';
/** Why a request failed, in terms the offline queue can act on. */
export interface TaskQuery {
  scope: 'mine' | 'created' | 'conversation' | 'all';
  conversationId?: string;
  status?: 'active' | 'done' | 'any';
}

export interface ApprovalQuery {
  scope: 'to_decide' | 'requested' | 'conversation' | 'all';
  conversationId?: string;
  status?: 'pending' | 'decided' | 'any';
}

function workQuery(q: TaskQuery | ApprovalQuery): string {
  const p = new URLSearchParams({ scope: q.scope });
  if (q.conversationId) p.set('conversationId', q.conversationId);
  if (q.status) p.set('status', q.status);
  return p.toString();
}

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

/** GET /v1/search parameters (operators typed in the box are resolved before this). */
export interface SearchParams {
  q?: string;
  types?: SearchType[];
  from?: string;
  in?: string;
  hasFile?: boolean;
  after?: string;
  before?: string;
  limit?: number;
  offset?: number;
}

export interface StatusMediaMeta {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}
export type NetworkMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export interface DeviceRegistration {
  deviceId: string;
  name: string;
  platform: 'ios' | 'android';
}

/** The REST surface the mobile app uses. */
export interface ApiTransport {
  /** A Session, or a two-step challenge to finish with verifyMfa. */
  login(req: LoginRequest): Promise<LoginResponse>;
  verifyMfa(challengeId: string, code: string): Promise<Session>;
  /** Swaps the one-time code from a single sign-on return for the session. */
  ssoExchange(code: string, codeVerifier: string): Promise<Session>;
  refresh(refreshToken: string): Promise<Session>;
  /** Work session → its SampConnect Network session (linked once). */
  linkNetwork(req: { device: DeviceRegistration }): Promise<Session>;
  /** Free personal SampConnect Network account. */
  signUpPersonal(req: NetworkSignupRequest): Promise<Session>;
  /** Any SampConnect Network call (`/v1/network/...`): the screens read and act through it. */
  network<T = unknown>(method: NetworkMethod, path: string, body?: unknown): Promise<T>;
  /** Any Client Inbox call (`/v1/inbox/...`, `/v1/connectors...`). */
  inbox<T = unknown>(method: NetworkMethod, path: string, body?: unknown): Promise<T>;
  /** Uploads a status photo or video; returns its attachment id for POST /v1/network/statuses. */
  uploadStatusMedia(meta: StatusMediaMeta, localUri: string): Promise<string>;
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
  /** Your own profile fields (PATCH /v1/me/profile); "" or null clears one. */
  updateProfile(req: UpdateProfileRequest): Promise<DirectoryUser>;
  /** A cropped, compressed square photo as a data URL (PUT /v1/me/avatar). */
  setAvatar(image: string): Promise<DirectoryUser>;
  removeAvatar(): Promise<DirectoryUser>;
  listNotifications(q?: ListNotificationsQuery): Promise<ListNotificationsResponse>;
  markNotificationsRead(req: MarkNotificationsReadRequest): Promise<MarkNotificationsReadResponse>;
  setNotifyLevel(conversationId: string, level: NotifyLevel): Promise<Conversation>;
  pushStatus(): Promise<PushStatus>;
  registerPushToken(req: RegisterPushTokenRequest): Promise<PushStatus>;
  callsConfig(): Promise<CallsConfig>;
  /** Your chat theme, the organization's rules and the theme in effect. */
  getChatTheme(): Promise<ChatThemeState>;
  setChatTheme(themeId: ChatThemeId | null): Promise<ChatThemeState>;
  /** Owners and admins: the default theme and which themes people may choose. */
  setChatThemePolicy(policy: ChatThemePolicy): Promise<ChatThemeState>;
  /** Your background in calls, the organization rules and the branding for the company one. */
  getCallBackground(): Promise<CallBackgroundState>;
  setCallBackground(choice: CallBackgroundChoice): Promise<CallBackgroundState>;
  /** Sends a JPEG kept on this device as your own background (selects it). */
  uploadCallBackground(localUri: string, name?: string): Promise<CallBackgroundState>;
  removeCallBackgroundImage(imageId?: string): Promise<CallBackgroundState>;
  setCallAppearance(appearance: CallAppearance): Promise<CallBackgroundState>;
  addOrganizationCallBackground(localUri: string, name?: string): Promise<CallBackgroundState>;
  removeOrganizationCallBackground(imageId: string): Promise<CallBackgroundState>;
  /** Owners and admins: the organization default and whether the company background is required. */
  setCallBackgroundPolicy(policy: CallBackgroundPolicyInput): Promise<CallBackgroundState>;
  minutesConfig(): Promise<MinutesConfig>;
  callMinutes(callId: string): Promise<CallMinutesResponse>;
  generateMinutes(callId: string, req: GenerateMinutesRequest): Promise<MeetingMinutes>;
  listMinutes(conversationId: string): Promise<MeetingMinutes[]>;
  updateMinutes(minutesId: string, req: UpdateMinutesRequest): Promise<MeetingMinutes>;
  shareMinutes(minutesId: string): Promise<MeetingMinutes>;
  deleteMinutes(minutesId: string): Promise<void>;
  /** Saves the minutes as PDF or Word on this device; returns where. */
  downloadMinutes(minutesId: string, q: MinutesDocumentQuery, fileName: string): Promise<string>;
  chatExportAccess(conversationId: string): Promise<ChatExportAccess>;
  /** Saves the conversation as PDF, Word or text on this device; returns where. */
  exportChat(conversationId: string, req: ChatExportRequest, fileName: string): Promise<string>;
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
  /** `scope: 'series'` cancels every upcoming meeting of a recurring series. */
  cancelMeeting(meetingId: string, scope?: SeriesScope): Promise<Meeting>;
  /** `scope: 'series'` answers for every upcoming meeting of a recurring series. */
  rsvp(
    meetingId: string,
    response: Exclude<RsvpResponse, 'pending'>,
    scope?: SeriesScope,
  ): Promise<Meeting>;
  findTimes(req: FindTimesRequest): Promise<FindTimesResponse>;
  getWorkingHours(): Promise<WorkingHours>;
  setWorkingHours(hours: WorkingHours): Promise<WorkingHours>;
  /** Recordings library, newest first; page with `before` = the previous page's nextBefore. */
  listRecordings(q: RecordingsQuery): Promise<RecordingList>;
  /** GET /v1/files: every file in conversations you can read, newest first. */
  listFiles(q: ListFilesQuery): Promise<FileList>;
  /** PUT /v1/me/status: replaces your availability and custom status. */
  setStatus(status: UserStatus): Promise<PresenceInfo>;
  /** PUT /v1/me/dnd-schedule: replaces your quiet hours. */
  setDndSchedule(schedule: DndSchedule): Promise<PresenceInfo>;
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
  /** PUT /v1/conversations/:id/forwarding (private channels and groups). */
  setForwarding(conversationId: string, allowed: boolean): Promise<Conversation>;
  listTasks(q: TaskQuery): Promise<Task[]>;
  getTask(taskId: string): Promise<Task>;
  createTask(req: CreateTaskRequest): Promise<Task>;
  updateTask(taskId: string, req: UpdateTaskRequest): Promise<Task>;
  listApprovals(q: ApprovalQuery): Promise<Approval[]>;
  getApproval(approvalId: string): Promise<Approval>;
  createApproval(req: CreateApprovalRequest): Promise<Approval>;
  decideApproval(approvalId: string, req: DecideApprovalRequest): Promise<Approval>;
  cancelApproval(approvalId: string): Promise<Approval>;
  listBookingPages(): Promise<BookingPage[]>;
  /** Universal Search: only what you may open (docs/search.md). */
  search(q: SearchParams): Promise<SearchResponse>;
  getRecentSearches(): Promise<string[]>;
  setRecentSearches(recent: readonly string[]): Promise<string[]>;
  createBookingPage(req: CreateBookingPageRequest): Promise<BookingPage>;
  updateBookingPage(id: string, req: UpdateBookingPageRequest): Promise<BookingPage>;
  deleteBookingPage(id: string): Promise<{ deleted: true }>;
  getBranding(): Promise<BrandingView>;
  adminOverview(): Promise<AdminOverview>;
  auditLog(q: AuditQuery): Promise<AuditPage>;
  inviteMember(req: InviteMemberRequest): Promise<UserSummary>;
  updateMember(
    userId: string,
    patch: { role?: 'admin' | 'member' | 'guest'; status?: 'active' | 'deactivated' },
  ): Promise<UserSummary>;
  resetMemberMfa(userId: string): Promise<void>;
  listAllDevices(): Promise<DeviceSession[]>;
  saveBranding(input: BrandingInput): Promise<BrandingView>;
  aiStatus(): Promise<AiStatus>;
  setAiEnabled(enabled: boolean): Promise<AiStatus>;
  aiSummarize(conversationId: string, range: SummaryRange): Promise<AiSummary>;
  aiSummarizeMeeting(meetingId: string): Promise<AiMeetingSummary>;
  aiReplies(conversationId: string): Promise<AiSuggestedReplies>;
  aiSearch(req: AiSearchRequest): Promise<AiSearchResponse>;
  aiAsk(req: AiAskRequest): Promise<AiAskResponse>;
  aiTranslate(messageId: string, targetLanguage: string): Promise<AiTranslation>;
  aiDigest(req: AiDigestRequest): Promise<AiDigest>;
  aiPropose(conversationId: string, text: string): Promise<AiProposal>;
  aiConfirm(proposalId: string, req: ConfirmAiProposalRequest): Promise<AiProposal>;
  aiDismiss(proposalId: string): Promise<AiProposal>;
  aiTranscript(attachmentId: string, queue?: boolean): Promise<AiTranscript>;
  updateTranscript(attachmentId: string, req: UpdateTranscriptRequest): Promise<AiTranscript>;
  translateTranscript(attachmentId: string, language: string): Promise<AiTranscript>;
  deleteRecording(recordingId: string): Promise<void>;
  startCallRecording(callId: string): Promise<Call>;
  stopCallRecording(callId: string): Promise<Call>;
  /** Live captions: a few seconds of my own microphone, sent as raw audio; returns the text. */
  transcribeCaption(callId: string, clip: Blob): Promise<CallCaptionResponse>;
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
  /** Administration → SampConnect Network (members.manage); `canModerate` for platform operators. */
  networkAdmin(): Promise<NetworkAdminView>;
  /** Platform operators: every SampConnect Network report, and suspensions. */
  moderationQueue(status: ReportStatus): Promise<ModerationQueue>;
  moderationAct(reportId: string, body: ModerationActionRequest): Promise<ModerationReport>;
  networkSuspensions(): Promise<NetworkSuspensions>;
  restoreSuspension(kind: 'users' | 'communities', id: string): Promise<void>;
  /** Super admin console (docs/super-admin.md): any route under /v1/platform/. */
  platformRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T>;
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
  /** Profile photo as a full URL (resolved against the server address), or null for initials. */
  avatarUrl?: string | null;
  department?: string | null;
  phone?: string | null;
  bio?: string | null;
  /** IANA time zone, e.g. "Asia/Kolkata". */
  timeZone?: string | null;
  /** Availability and custom status (absent on older servers). */
  userStatus?: UserStatus | null;
  /** Quiet hours, when set. */
  dndSchedule?: DndSchedule | null;
}

export interface HttpTransportOptions {
  baseUrl: string;
  getAccessToken: () => Promise<string | undefined>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** A SampConnect Network session: organization-only routes are refused without a request. */
  networkSpace?: boolean;
}

/** fetch-based client for the SampConnect API (`/v1/...`). */
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

  ssoExchange(code: string, codeVerifier: string): Promise<Session> {
    return this.request('POST', '/v1/auth/sso/exchange', { code, codeVerifier }, false);
  }

  refresh(refreshToken: string): Promise<Session> {
    return this.request('POST', '/v1/auth/refresh', { refreshToken }, false);
  }

  linkNetwork(req: { device: DeviceRegistration }): Promise<Session> {
    return this.request('POST', '/v1/network/link', req);
  }

  signUpPersonal(req: NetworkSignupRequest): Promise<Session> {
    return this.request('POST', '/v1/network/public/signup', req, false);
  }

  network<T = unknown>(method: NetworkMethod, path: string, body?: unknown): Promise<T> {
    if (!path.startsWith('/v1/network/')) throw new Error(`Not a network path: ${path}`);
    return this.request<T>(method, path, body).then((r) => withAbsoluteMedia(r, this.opts.baseUrl));
  }

  /** Client Inbox and its channels (`/v1/inbox/...`, `/v1/connectors...`). */
  inbox<T = unknown>(method: NetworkMethod, path: string, body?: unknown): Promise<T> {
    if (!path.startsWith('/v1/inbox/') && !path.startsWith('/v1/connectors'))
      throw new Error(`Not an inbox path: ${path}`);
    return this.request<T>(method, path, body);
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

  async uploadStatusMedia(meta: StatusMediaMeta, localUri: string): Promise<string> {
    const ticket = await this.request<UploadTicket>('POST', '/v1/network/status-media', meta);
    await this.putRaw(ticket.uploadUrl, localUri, 'application/octet-stream');
    await this.request(
      'POST',
      `/v1/uploads/${encodeURIComponent(ticket.uploadId)}/complete`,
      undefined,
    );
    return ticket.uploadId;
  }

  async uploadFile(req: CreateUploadRequest, localUri: string): Promise<Attachment> {
    const ticket = await this.request<UploadTicket>('POST', '/v1/uploads', req);
    await this.putRaw(ticket.uploadUrl, localUri, 'application/octet-stream');
    return this.request(
      'POST',
      `/v1/uploads/${encodeURIComponent(ticket.uploadId)}/complete`,
      undefined,
    );
  }

  /** Streams a file on this device as the raw request body. Returns the response text. */
  private async putRaw(
    path: string,
    localUri: string,
    contentType: string,
    method: 'PUT' | 'POST' = 'PUT',
  ): Promise<string> {
    const token = await this.opts.getAccessToken();
    if (!token) throw new TransportError('Not signed in', 'api', 'UNAUTHENTICATED');
    let res: { status: number; body: string };
    try {
      res = await putFileBytes(
        new URL(path, this.opts.baseUrl).toString(),
        localUri,
        { authorization: `Bearer ${token}`, 'content-type': contentType },
        method,
      );
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
    return res.body;
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
    return this.request<DirectoryUser[]>('GET', '/v1/users', undefined).then((l) =>
      l.map((u) => this.withAvatar(u)),
    );
  }

  /** Photo paths come relative to the server; images need the full address. */
  private withAvatar<T extends { avatarUrl?: string | null }>(u: T): T {
    return u.avatarUrl
      ? { ...u, avatarUrl: new URL(u.avatarUrl, this.opts.baseUrl).toString() }
      : u;
  }

  updateProfile(req: UpdateProfileRequest): Promise<DirectoryUser> {
    return this.request<DirectoryUser>('PATCH', '/v1/me/profile', req).then((u) =>
      this.withAvatar(u),
    );
  }

  setAvatar(image: string): Promise<DirectoryUser> {
    return this.request<DirectoryUser>('PUT', '/v1/me/avatar', { image }).then((u) =>
      this.withAvatar(u),
    );
  }

  removeAvatar(): Promise<DirectoryUser> {
    return this.request<DirectoryUser>('DELETE', '/v1/me/avatar', undefined).then((u) =>
      this.withAvatar(u),
    );
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
  getChatTheme(): Promise<ChatThemeState> {
    return this.request('GET', '/v1/me/chat-theme', undefined);
  }

  setChatTheme(themeId: ChatThemeId | null): Promise<ChatThemeState> {
    return this.request('PUT', '/v1/me/chat-theme', { themeId });
  }

  setChatThemePolicy(policy: ChatThemePolicy): Promise<ChatThemeState> {
    return this.request('PUT', '/v1/admin/chat-themes', policy);
  }

  getCallBackground(): Promise<CallBackgroundState> {
    return this.request<CallBackgroundState>('GET', '/v1/me/call-background', undefined).then((s) =>
      this.withBackgroundUrl(s),
    );
  }

  setCallBackground(choice: CallBackgroundChoice): Promise<CallBackgroundState> {
    return this.request<CallBackgroundState>('PUT', '/v1/me/call-background', choice).then((s) =>
      this.withBackgroundUrl(s),
    );
  }

  async uploadCallBackground(localUri: string, name?: string): Promise<CallBackgroundState> {
    const q = name ? `?name=${encodeURIComponent(name)}` : '';
    const body = await this.putRaw(`/v1/me/call-backgrounds${q}`, localUri, 'image/jpeg', 'POST');
    return this.withBackgroundUrl(JSON.parse(body) as CallBackgroundState);
  }

  removeCallBackgroundImage(imageId?: string): Promise<CallBackgroundState> {
    return this.request<CallBackgroundState>(
      'DELETE',
      imageId
        ? `/v1/me/call-backgrounds/${encodeURIComponent(imageId)}`
        : '/v1/me/call-background/image',
      undefined,
    ).then((s) => this.withBackgroundUrl(s));
  }

  setCallAppearance(appearance: CallAppearance): Promise<CallBackgroundState> {
    return this.request<CallBackgroundState>('PUT', '/v1/me/call-appearance', appearance).then(
      (s) => this.withBackgroundUrl(s),
    );
  }

  async addOrganizationCallBackground(
    localUri: string,
    name?: string,
  ): Promise<CallBackgroundState> {
    const q = name ? `?name=${encodeURIComponent(name)}` : '';
    const body = await this.putRaw(
      `/v1/admin/call-backgrounds/images${q}`,
      localUri,
      'image/jpeg',
      'POST',
    );
    return this.withBackgroundUrl(JSON.parse(body) as CallBackgroundState);
  }

  removeOrganizationCallBackground(imageId: string): Promise<CallBackgroundState> {
    return this.request<CallBackgroundState>(
      'DELETE',
      `/v1/admin/call-backgrounds/images/${encodeURIComponent(imageId)}`,
      undefined,
    ).then((s) => this.withBackgroundUrl(s));
  }

  setCallBackgroundPolicy(policy: CallBackgroundPolicyInput): Promise<CallBackgroundState> {
    return this.request<CallBackgroundState>('PUT', '/v1/admin/call-backgrounds', policy).then(
      (s) => this.withBackgroundUrl(s),
    );
  }

  minutesConfig(): Promise<MinutesConfig> {
    return this.request('GET', '/v1/minutes/config', undefined);
  }

  callMinutes(callId: string): Promise<CallMinutesResponse> {
    return this.request('GET', `/v1/calls/${encodeURIComponent(callId)}/minutes`, undefined);
  }

  generateMinutes(callId: string, req: GenerateMinutesRequest): Promise<MeetingMinutes> {
    return this.request('POST', `/v1/calls/${encodeURIComponent(callId)}/minutes`, req);
  }

  async listMinutes(conversationId: string): Promise<MeetingMinutes[]> {
    const r = await this.request<{ items: MeetingMinutes[] }>(
      'GET',
      `/v1/minutes?conversationId=${encodeURIComponent(conversationId)}`,
      undefined,
    );
    return r.items;
  }

  updateMinutes(minutesId: string, req: UpdateMinutesRequest): Promise<MeetingMinutes> {
    return this.request('PATCH', `/v1/minutes/${encodeURIComponent(minutesId)}`, req);
  }

  shareMinutes(minutesId: string): Promise<MeetingMinutes> {
    return this.request('POST', `/v1/minutes/${encodeURIComponent(minutesId)}/share`, {});
  }

  async deleteMinutes(minutesId: string): Promise<void> {
    await this.request('DELETE', `/v1/minutes/${encodeURIComponent(minutesId)}`, undefined);
  }

  async downloadMinutes(
    minutesId: string,
    q: MinutesDocumentQuery,
    fileName: string,
  ): Promise<string> {
    const qs = new URLSearchParams({
      format: q.format ?? 'pdf',
      ...(q.template ? { template: q.template } : {}),
      ...(q.transcript ? { transcript: '1' } : {}),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    return this.document(
      `/v1/minutes/${encodeURIComponent(minutesId)}/document?${qs}`,
      'GET',
      undefined,
      fileName,
    );
  }

  chatExportAccess(conversationId: string): Promise<ChatExportAccess> {
    return this.request(
      'GET',
      `/v1/conversations/${encodeURIComponent(conversationId)}/export`,
      undefined,
    );
  }

  exportChat(conversationId: string, req: ChatExportRequest, fileName: string): Promise<string> {
    return this.document(
      `/v1/conversations/${encodeURIComponent(conversationId)}/export`,
      'POST',
      req,
      fileName,
    );
  }

  private async document(
    path: string,
    method: string,
    body: unknown,
    fileName: string,
  ): Promise<string> {
    const token = await this.opts.getAccessToken();
    if (!token) throw new TransportError('Not signed in', 'api', 'UNAUTHENTICATED');
    try {
      return await downloadDocument(
        new URL(path, this.opts.baseUrl).toString(),
        {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            ...(body ? { 'content-type': 'application/json' } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
        fileName,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Download failed';
      const status = (err as { status?: number }).status;
      // The API answered (a refusal): its own words. Otherwise the connection failed.
      throw status
        ? new TransportError(msg, 'api', codeForStatus(status))
        : new TransportError(msg, 'network');
    }
  }

  private withBackgroundUrl(s: CallBackgroundState): CallBackgroundState {
    const abs = (u: string) => new URL(u, this.opts.baseUrl).toString();
    return {
      ...s,
      customImageUrl: s.customImageUrl ? abs(s.customImageUrl) : null,
      uploads: (s.uploads ?? []).map((u) => ({ ...u, url: abs(u.url) })),
    };
  }

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

  cancelMeeting(meetingId: string, scope: SeriesScope = 'occurrence'): Promise<Meeting> {
    return this.request('POST', `/v1/meetings/${encodeURIComponent(meetingId)}/cancel`, {
      scope,
    });
  }

  rsvp(
    meetingId: string,
    response: Exclude<RsvpResponse, 'pending'>,
    scope: SeriesScope = 'occurrence',
  ): Promise<Meeting> {
    return this.request('POST', `/v1/meetings/${encodeURIComponent(meetingId)}/rsvp`, {
      response,
      scope,
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

  setStatus(status: UserStatus): Promise<PresenceInfo> {
    return this.request('PUT', '/v1/me/status', status);
  }

  setDndSchedule(schedule: DndSchedule): Promise<PresenceInfo> {
    return this.request('PUT', '/v1/me/dnd-schedule', schedule);
  }

  listFiles(q: ListFilesQuery): Promise<FileList> {
    const p = new URLSearchParams();
    for (const k of ['q', 'kind', 'in', 'from', 'before'] as const) {
      const v = q[k];
      if (v) p.set(k, String(v));
    }
    p.set('limit', String(q.limit ?? 40));
    return this.request('GET', `/v1/files?${p.toString()}`, undefined);
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

  listTasks(q: TaskQuery): Promise<Task[]> {
    return this.request('GET', `/v1/tasks?${workQuery(q)}`, undefined);
  }

  getTask(taskId: string): Promise<Task> {
    return this.request('GET', `/v1/tasks/${encodeURIComponent(taskId)}`, undefined);
  }

  createTask(req: CreateTaskRequest): Promise<Task> {
    return this.request('POST', '/v1/tasks', req);
  }

  updateTask(taskId: string, req: UpdateTaskRequest): Promise<Task> {
    return this.request('PATCH', `/v1/tasks/${encodeURIComponent(taskId)}`, req);
  }

  listApprovals(q: ApprovalQuery): Promise<Approval[]> {
    return this.request('GET', `/v1/approvals?${workQuery(q)}`, undefined);
  }

  search(q: SearchParams): Promise<SearchResponse> {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q))
      if (v !== undefined && v !== null && v !== '')
        p.set(k, Array.isArray(v) ? v.join(',') : String(v));
    return this.request('GET', `/v1/search?${p.toString()}`, undefined);
  }

  async getRecentSearches(): Promise<string[]> {
    return (await this.request<RecentSearches>('GET', '/v1/search/recent', undefined)).recent;
  }

  async setRecentSearches(recent: readonly string[]): Promise<string[]> {
    return (await this.request<RecentSearches>('PUT', '/v1/search/recent', { recent })).recent;
  }

  listBookingPages(): Promise<BookingPage[]> {
    return this.request('GET', '/v1/booking-pages', undefined);
  }

  createBookingPage(req: CreateBookingPageRequest): Promise<BookingPage> {
    return this.request('POST', '/v1/booking-pages', req);
  }

  updateBookingPage(id: string, req: UpdateBookingPageRequest): Promise<BookingPage> {
    return this.request('PATCH', `/v1/booking-pages/${encodeURIComponent(id)}`, req);
  }

  deleteBookingPage(id: string): Promise<{ deleted: true }> {
    return this.request('DELETE', `/v1/booking-pages/${encodeURIComponent(id)}`, undefined);
  }

  getApproval(approvalId: string): Promise<Approval> {
    return this.request('GET', `/v1/approvals/${encodeURIComponent(approvalId)}`, undefined);
  }

  createApproval(req: CreateApprovalRequest): Promise<Approval> {
    return this.request('POST', '/v1/approvals', req);
  }

  decideApproval(approvalId: string, req: DecideApprovalRequest): Promise<Approval> {
    return this.request('POST', `/v1/approvals/${encodeURIComponent(approvalId)}/decision`, req);
  }

  cancelApproval(approvalId: string): Promise<Approval> {
    return this.request('POST', `/v1/approvals/${encodeURIComponent(approvalId)}/cancel`, {});
  }

  getBranding(): Promise<BrandingView> {
    return this.request('GET', '/v1/branding', undefined);
  }

  adminOverview(): Promise<AdminOverview> {
    return this.request('GET', '/v1/admin/overview', undefined);
  }

  auditLog(q: AuditQuery): Promise<AuditPage> {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') p.set(k, String(v));
    return this.request('GET', `/v1/admin/audit?${p.toString()}`, undefined);
  }

  inviteMember(req: InviteMemberRequest): Promise<UserSummary> {
    return this.request('POST', '/v1/users', req);
  }

  updateMember(
    userId: string,
    patch: { role?: 'admin' | 'member' | 'guest'; status?: 'active' | 'deactivated' },
  ): Promise<UserSummary> {
    return this.request('PATCH', `/v1/users/${encodeURIComponent(userId)}`, patch);
  }

  resetMemberMfa(userId: string): Promise<void> {
    return this.request('POST', `/v1/users/${encodeURIComponent(userId)}/mfa/reset`, {});
  }

  listAllDevices(): Promise<DeviceSession[]> {
    return this.request('GET', '/v1/devices?all=true', undefined);
  }

  saveBranding(input: BrandingInput): Promise<BrandingView> {
    return this.request('PUT', '/v1/branding', input);
  }

  aiStatus(): Promise<AiStatus> {
    return this.request('GET', '/v1/ai/status', undefined);
  }

  setAiEnabled(enabled: boolean): Promise<AiStatus> {
    return this.request('PUT', '/v1/ai/settings', { enabled });
  }

  aiSummarize(conversationId: string, range: SummaryRange): Promise<AiSummary> {
    return this.request(
      'POST',
      `/v1/ai/conversations/${encodeURIComponent(conversationId)}/summary`,
      { range },
    );
  }

  aiSummarizeMeeting(meetingId: string): Promise<AiMeetingSummary> {
    return this.request('POST', `/v1/ai/meetings/${encodeURIComponent(meetingId)}/summary`, {});
  }

  aiReplies(conversationId: string): Promise<AiSuggestedReplies> {
    return this.request(
      'POST',
      `/v1/ai/conversations/${encodeURIComponent(conversationId)}/replies`,
      {},
    );
  }

  aiSearch(req: AiSearchRequest): Promise<AiSearchResponse> {
    return this.request('POST', '/v1/ai/search', req);
  }

  aiAsk(req: AiAskRequest): Promise<AiAskResponse> {
    return this.request('POST', '/v1/ai/ask', req);
  }

  aiTranslate(messageId: string, targetLanguage: string): Promise<AiTranslation> {
    return this.request('POST', '/v1/ai/translate', { messageId, targetLanguage });
  }

  aiDigest(req: AiDigestRequest): Promise<AiDigest> {
    return this.request('POST', '/v1/ai/digest', req);
  }

  aiPropose(conversationId: string, text: string): Promise<AiProposal> {
    return this.request('POST', '/v1/ai/proposals', {
      kind: 'send_message',
      conversationId,
      text,
    });
  }

  aiConfirm(proposalId: string, req: ConfirmAiProposalRequest): Promise<AiProposal> {
    return this.request('POST', `/v1/ai/proposals/${encodeURIComponent(proposalId)}/confirm`, req);
  }

  aiDismiss(proposalId: string): Promise<AiProposal> {
    return this.request('POST', `/v1/ai/proposals/${encodeURIComponent(proposalId)}/dismiss`, {});
  }

  aiTranscript(attachmentId: string, queue = false): Promise<AiTranscript> {
    return this.request(
      queue ? 'POST' : 'GET',
      `/v1/ai/transcripts/${encodeURIComponent(attachmentId)}`,
      queue ? {} : undefined,
    );
  }

  updateTranscript(attachmentId: string, req: UpdateTranscriptRequest): Promise<AiTranscript> {
    return this.request('PATCH', `/v1/ai/transcripts/${encodeURIComponent(attachmentId)}`, req);
  }

  translateTranscript(attachmentId: string, language: string): Promise<AiTranscript> {
    return this.request(
      'POST',
      `/v1/ai/transcripts/${encodeURIComponent(attachmentId)}/translations`,
      { language },
    );
  }

  setForwarding(conversationId: string, allowed: boolean): Promise<Conversation> {
    return this.request(
      'PUT',
      `/v1/conversations/${encodeURIComponent(conversationId)}/forwarding`,
      { allowed },
    );
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

  transcribeCaption(callId: string, clip: Blob): Promise<CallCaptionResponse> {
    return this.request('POST', `/v1/calls/${encodeURIComponent(callId)}/captions`, clip);
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

  networkAdmin(): Promise<NetworkAdminView> {
    return this.request('GET', '/v1/admin/network', undefined);
  }

  moderationQueue(status: ReportStatus): Promise<ModerationQueue> {
    return this.request('GET', `/v1/platform/network/reports?status=${status}`, undefined);
  }

  moderationAct(reportId: string, body: ModerationActionRequest): Promise<ModerationReport> {
    return this.request(
      'POST',
      `/v1/platform/network/reports/${encodeURIComponent(reportId)}/action`,
      body,
    );
  }

  platformRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    if (!path.startsWith('/v1/platform/')) throw new Error('Not a platform route');
    return this.request<T>(method, path, body);
  }

  networkSuspensions(): Promise<NetworkSuspensions> {
    return this.request('GET', '/v1/platform/network/suspensions', undefined);
  }

  restoreSuspension(kind: 'users' | 'communities', id: string): Promise<void> {
    return this.request(
      'DELETE',
      `/v1/platform/network/suspensions/${kind}/${encodeURIComponent(id)}`,
      undefined,
    );
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
    if (this.opts.networkSpace && !networkAllows(method, path))
      throw new TransportError('This is not available in SampConnect Network', 'api', 'FORBIDDEN');
    const hasBody = method !== 'GET' && body !== undefined;
    const headers: Record<string, string> = { accept: 'application/json' };
    // Audio clips go as they are; everything else as JSON.
    const raw = typeof Blob !== 'undefined' && body instanceof Blob;
    if (hasBody)
      headers['content-type'] = raw ? body.type || 'application/octet-stream' : 'application/json';
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
        body: hasBody ? (raw ? body : JSON.stringify(body)) : undefined,
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
  ssoExchange = async (): Promise<Session> => this.fail();
  refresh = async (): Promise<Session> => this.fail();
  linkNetwork = async (): Promise<Session> => this.fail();
  signUpPersonal = async (): Promise<Session> => this.fail();
  network = async <T>(): Promise<T> => this.fail();
  inbox = async <T>(): Promise<T> => this.fail();
  uploadStatusMedia = async (): Promise<string> => this.fail();
  sendMessage = async (): Promise<SendMessageAck> => this.fail();
  sync = async (): Promise<SyncResponse> => this.fail();
  ackReceipt = async (): Promise<Receipt> => this.fail();
  editMessage = async (): Promise<Message> => this.fail();
  deleteMessage = async (): Promise<Message> => this.fail();
  setReaction = async (): Promise<Message> => this.fail();
  uploadFile = async (): Promise<Attachment> => this.fail();
  attachmentUrl = async (): Promise<AttachmentUrl> => this.fail();
  listUsers = async (): Promise<DirectoryUser[]> => this.fail();
  updateProfile = async (): Promise<DirectoryUser> => this.fail();
  setAvatar = async (): Promise<DirectoryUser> => this.fail();
  removeAvatar = async (): Promise<DirectoryUser> => this.fail();
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
  listFiles = async (): Promise<FileList> => this.fail();
  setStatus = async (): Promise<PresenceInfo> => this.fail();
  setDndSchedule = async (): Promise<PresenceInfo> => this.fail();
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
  setForwarding = async (): Promise<Conversation> => this.fail();
  listTasks = async (): Promise<Task[]> => this.fail();
  getTask = async (): Promise<Task> => this.fail();
  createTask = async (): Promise<Task> => this.fail();
  updateTask = async (): Promise<Task> => this.fail();
  listApprovals = async (): Promise<Approval[]> => this.fail();
  getApproval = async (): Promise<Approval> => this.fail();
  createApproval = async (): Promise<Approval> => this.fail();
  decideApproval = async (): Promise<Approval> => this.fail();
  cancelApproval = async (): Promise<Approval> => this.fail();
  listBookingPages = async (): Promise<BookingPage[]> => this.fail();
  search = async (): Promise<SearchResponse> => this.fail();
  getRecentSearches = async (): Promise<string[]> => this.fail();
  setRecentSearches = async (): Promise<string[]> => this.fail();
  createBookingPage = async (): Promise<BookingPage> => this.fail();
  updateBookingPage = async (): Promise<BookingPage> => this.fail();
  deleteBookingPage = async (): Promise<{ deleted: true }> => this.fail();
  getBranding = async (): Promise<BrandingView> => this.fail();
  adminOverview = async (): Promise<AdminOverview> => this.fail();
  auditLog = async (): Promise<AuditPage> => this.fail();
  inviteMember = async (): Promise<UserSummary> => this.fail();
  updateMember = async (): Promise<UserSummary> => this.fail();
  resetMemberMfa = async (): Promise<void> => this.fail();
  listAllDevices = async (): Promise<DeviceSession[]> => this.fail();
  saveBranding = async (): Promise<BrandingView> => this.fail();
  aiStatus = async (): Promise<AiStatus> => this.fail();
  setAiEnabled = async (): Promise<AiStatus> => this.fail();
  aiSummarize = async (): Promise<AiSummary> => this.fail();
  aiSummarizeMeeting = async (): Promise<AiMeetingSummary> => this.fail();
  aiReplies = async (): Promise<AiSuggestedReplies> => this.fail();
  aiSearch = async (): Promise<AiSearchResponse> => this.fail();
  aiAsk = async (): Promise<AiAskResponse> => this.fail();
  aiTranslate = async (): Promise<AiTranslation> => this.fail();
  aiDigest = async (): Promise<AiDigest> => this.fail();
  aiPropose = async (): Promise<AiProposal> => this.fail();
  aiConfirm = async (): Promise<AiProposal> => this.fail();
  aiDismiss = async (): Promise<AiProposal> => this.fail();
  aiTranscript = async (): Promise<AiTranscript> => this.fail();
  updateTranscript = async (): Promise<AiTranscript> => this.fail();
  translateTranscript = async (): Promise<AiTranscript> => this.fail();
  startCallRecording = async (): Promise<Call> => this.fail();
  stopCallRecording = async (): Promise<Call> => this.fail();
  transcribeCaption = async (): Promise<CallCaptionResponse> => this.fail();
  getChatTheme = async (): Promise<ChatThemeState> => this.fail();
  setChatTheme = async (): Promise<ChatThemeState> => this.fail();
  setChatThemePolicy = async (): Promise<ChatThemeState> => this.fail();
  getCallBackground = async (): Promise<CallBackgroundState> => this.fail();
  setCallBackground = async (): Promise<CallBackgroundState> => this.fail();
  uploadCallBackground = async (): Promise<CallBackgroundState> => this.fail();
  removeCallBackgroundImage = async (): Promise<CallBackgroundState> => this.fail();
  setCallAppearance = async (): Promise<CallBackgroundState> => this.fail();
  addOrganizationCallBackground = async (): Promise<CallBackgroundState> => this.fail();
  removeOrganizationCallBackground = async (): Promise<CallBackgroundState> => this.fail();
  setCallBackgroundPolicy = async (): Promise<CallBackgroundState> => this.fail();
  minutesConfig = async (): Promise<MinutesConfig> => this.fail();
  callMinutes = async (): Promise<CallMinutesResponse> => this.fail();
  generateMinutes = async (): Promise<MeetingMinutes> => this.fail();
  listMinutes = async (): Promise<MeetingMinutes[]> => this.fail();
  updateMinutes = async (): Promise<MeetingMinutes> => this.fail();
  shareMinutes = async (): Promise<MeetingMinutes> => this.fail();
  deleteMinutes = async (): Promise<void> => this.fail();
  downloadMinutes = async (): Promise<string> => this.fail();
  chatExportAccess = async (): Promise<ChatExportAccess> => this.fail();
  exportChat = async (): Promise<string> => this.fail();
  lobbyDecision = async (): Promise<Call> => this.fail();
  guestLink = async (): Promise<{ url: string }> => this.fail();
  resendGuestInvite = async (): Promise<void> => this.fail();
  listIntegrations = async (): Promise<IntegrationView[]> => this.fail();
  saveIntegration = async (): Promise<IntegrationView> => this.fail();
  testIntegration = async (): Promise<IntegrationTestResult> => this.fail();
  resetIntegration = async (): Promise<IntegrationView> => this.fail();
  networkAdmin = async (): Promise<NetworkAdminView> => this.fail();
  moderationQueue = async (): Promise<ModerationQueue> => this.fail();
  moderationAct = async (): Promise<ModerationReport> => this.fail();
  networkSuspensions = async (): Promise<NetworkSuspensions> => this.fail();
  platformRequest = async <T>(): Promise<T> => this.fail();
  restoreSuspension = async (): Promise<void> => this.fail();
}

/**
 * Status media come back with a signed path that is relative when the server has no public API
 * URL set; the phone needs it absolute to show the photo or video.
 */
export function withAbsoluteMedia<T>(value: T, baseUrl: string): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== 'object') return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (
        k === 'media' &&
        x &&
        typeof x === 'object' &&
        typeof (x as { url?: unknown }).url === 'string'
      ) {
        const m = x as { url: string };
        out[k] = { ...m, url: m.url.startsWith('/') ? new URL(m.url, baseUrl).toString() : m.url };
      } else out[k] = walk(x);
    }
    return out;
  };
  return walk(value) as T;
}
