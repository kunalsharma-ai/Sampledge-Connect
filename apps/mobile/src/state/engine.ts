import {
  effectiveStatus,
  type UserStatus,
  type DndSchedule,
  type PresenceInfo,
  MAX_FORWARD_TARGETS,
  uuidv7,
  backoffDelay,
  type CreateConversationRequest,
  type CreateMeetingRequest,
  type FindTimesRequest,
  type FindTimesResponse,
  type Meeting,
  type MeetingReminderEvent,
  type RsvpResponse,
  type SeriesScope,
  MAX_RECENT_SEARCHES,
  type SearchResponse,
  type UpdateMeetingRequest,
  type WorkingHours,
  effectiveChatTheme,
  type ChatThemeId,
  type ChatThemePolicy,
  type ChatThemeState,
  DEFAULT_MESSAGE_EDITING_STATE,
  type EditPollRequest,
  type UpdateApprovalRequest,
  type UpdateConversationRequest,
  type MessageEditHistory,
  type MessageEditingPolicy,
  type MessageEditingState,
  type CallAppearance,
  type CallBackgroundChoice,
  type CallBackgroundPolicyInput,
  type CallBackgroundState,
  type CallMinutesResponse,
  type InboxConversationDetail,
  type UpdateInboxConversationRequest,
  type InboxSettings,
  type ChatExportAccess,
  type ChatExportRequest,
  type MeetingMinutes,
  type MinutesConfig,
  type MinutesDocumentQuery,
  type MinutesChangedEvent,
  documentFileName,
  type Message,
  type NotifyLevel,
  type PushStatus,
  type SendMessageAck,
  type SendMessageRequest,
  type SetReactionRequest,
  type RecordingList,
  type FileList,
  type ListFilesQuery,
  type IntegrationTestResult,
  type IntegrationValues,
  type IntegrationView,
  type ModerationActionKind,
  type ModerationQueue,
  type NetworkAdminView,
  type NetworkSuspensions,
  type ReportStatus,
  type CreatePollRequest,
  type Poll,
  type PostingPolicy,
  type ScheduledMessage,
  type Task,
  type BookingPage,
  type CreateBookingPageRequest,
  type UpdateBookingPageRequest,
  type UpdateProfileRequest,
  type Approval,
  type AdminOverview,
  type AuditPage,
  type AuditQuery,
  type InviteMemberRequest,
  type UserSummary,
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
  type AiTranslation,
  type ConfirmAiProposalRequest,
  type SummaryRange,
  type CreateTaskRequest,
  type UpdateTaskRequest,
  type CreateApprovalRequest,
  type DecideApprovalRequest,
  SCHEDULE_MIN_LEAD_MS,
  type TenantArea,
  type PlatformChangedEvent,
  DEFAULT_GREETING_POLICY,
  GreetingPolicySchema,
  type GreetingCard,
  type GreetingPolicy,
} from '@sampledge/contracts';
import { isNetworkTenant } from '../auth/session';
import { NETWORK_SCOPES, pathInScopes, type NetworkScope } from '../lib/networkSpace';
import type { PendingInbox } from '../lib/inbox';
import type { SessionManager } from '../auth/session';
import type {
  LocalMessage,
  LocalNotification,
  LocalSearch,
  LocalFile,
  LocalFilesQuery,
  LocalStore,
  PendingFileInput,
} from '../db/store';
import {
  approvalMatches,
  isLocalId,
  LOCAL_PREFIX,
  taskMatches,
  type ActionInput,
  type ActionKind,
  type LocalApproval,
  type LocalBookingPage,
  type LocalBookmark,
  type LocalKind,
  type LocalScheduled,
  type LocalTask,
  type QueuedAction,
  type MinutesPatch,
  type TranscriptPatch,
} from '../db/work';
import {
  transcriptRequest,
  withPendingTranscript,
  type TranscriptionSettings,
} from '../lib/transcript';
import { Emitter } from '../lib/emitter';
import { forwardSnapshot } from '../lib/forward';
import type { MarkNotificationsReadRequest } from '../sync/notificationTypes';
import { deleteLocalFile, pruneLocalFiles } from '../lib/localFiles';
import { OutboxProcessor } from '../sync/outbox';
import { CallController } from './calls';
import type { RealtimeClient, SocketState } from '../sync/realtime';
import { SyncEngine } from '../sync/syncEngine';
import {
  isLocalUpload,
  localUploadUri,
  UNKNOWN_CALL_BACKGROUND,
  withPendingCallBackground,
} from '../lib/callBackground';
import {
  TransportError,
  type ApiTransport,
  type DeviceSession,
  type DirectoryUser,
  type ApprovalQuery,
  type RecordingsQuery,
  type TaskQuery,
  type SearchParams,
} from '../sync/transport';

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
  /** Why the notification feed could not be loaded (null when it is current or not tried yet). */
  notificationsError: string | null;
}

/**
 * Wires the local store, outbox, cursor sync and realtime link together and reacts
 * to connectivity, app foregrounding and session changes.
 */
/** Settings key for the server's copy of your recent searches. */
const HOURS_KEY = 'workingHours';
/** Settings key for the server's copy of your chat theme and the organization's rules. */
const THEME_KEY = 'chatTheme';
/** Settings key for the organization's message editing rules (docs/editing.md). */
const EDITING_KEY = 'messageEditing';
const GREETING_KEY = 'greetingPolicy';
const RECENT_KEY = 'search.recent';
/** Settings key for the server's copy of your call background, the rules and the branding. */
const CALL_BG_KEY = 'callBackground';
/** Settings keys for minutes: the organization's options, and the minutes of each call. */
const MINUTES_CONFIG_KEY = 'minutes.config';
const TRANSCRIPTION_KEY = 'ai.transcription';
const transcriptKey = (attachmentId: string) => `transcript.${attachmentId}`;
const NET_PREFIX = 'net:';
/** Settings keys for Help center questions, by their API path. */
const SUPPORT_PREFIX = 'support:';
const supportKey = (path: string) => `${SUPPORT_PREFIX}${path}`;
const netKey = (path: string) => `${NET_PREFIX}${path}`;
const minutesKey = (callId: string) => `minutes.call.${callId}`;
const minutesListKey = (conversationId: string) => `minutes.list.${conversationId}`;
/** Settings keys for the Client Inbox: each list and conversation read, by its API path. */
const INBOX_PREFIX = 'inbox:';
const inboxKey = (path: string) => `${INBOX_PREFIX}${path}`;
const inboxDetailPath = (id: string) => `/v1/inbox/conversations/${encodeURIComponent(id)}`;

export class ConnectEngine {
  readonly events = new Emitter<{
    state: EngineState;
    /** A new unread notification arrived live (drives the in-app banner). */
    notification: LocalNotification;
    /** A meeting you attend starts soon (drives the reminder banner). */
    meetingReminder: MeetingReminderEvent;
    /** The set of messages you saved for later changed. */
    bookmarks: ReadonlySet<string>;
    /** One of your scheduled messages changed here, on another device or by being sent. */
    scheduled: ScheduledMessage | null;
    /** A task or approval you are involved in was created or changed (here or live). */
    work: { kind: 'task' | 'approval' } | null;
    /** The server refused a change made on this device (shown briefly; server state wins). */
    actionRefused: { kind: ActionKind; reason: string; label?: string };
    /**
     * SampConnect Network data changed (`scope` from the server, or null for a change queued or
     * read here): screens re-read what they show.
     */
    network: { scope: NetworkScope | null };
    /** Platform operators: the report queue or suspensions changed (live, or after a reconnect). */
    moderation: { scope: 'reports' | 'suspensions' | null };
    /** Platform admins: a console area changed (live), or null after a reconnect: reload. */
    platform: { area: PlatformChangedEvent['area'] | null; tenantId?: string };
    branding: BrandingView;
    /** An admin added or changed a member on this device (other devices see it on sync). */
    members: UserSummary;
    /** An admin changed an organization setting elsewhere; screens showing it reload. */
    tenant: { area: TenantArea };
    /** A project changed (for the projects screen when it ships on mobile). */
    project: { projectId: string };
    /** A booking page you host changed here, on another device or by a co-host. */
    booking: { bookingPageId: string } | null;
    /** Your own profile changed on this phone, or a change of it reached the server. */
    profile: null;
    /** Your recent searches changed here or on another of your devices. */
    recentSearches: string[];
    /** Your working hours changed here or on another device. */
    workingHours: WorkingHours;
    /** Your chat theme or the organization's rules changed, here or elsewhere. */
    chatTheme: ChatThemeState;
    /** The organization's message editing rules, or what your role may do, changed. */
    messageEditing: MessageEditingState;
    /** The organization's greeting card rules changed. */
    greetingPolicy: GreetingPolicy;
    /** Your call background, the organization's rules or the branding changed, here or elsewhere. */
    callBackground: CallBackgroundState;
    /** Minutes of a call changed here, on another device or by someone else. */
    minutes: { callId: string; conversationId: string };
    /** A recording transcript was corrected, checked or translated. */
    transcript: { attachmentId: string };
    /**
     * The Client Inbox changed (a conversation, or null for "re-read everything"): here, on
     * another of your devices or by another agent. Screens re-read the cache.
     */
    inbox: { conversationId: string | null };
    /** Help center questions changed (here, on another device, or by an admin or support). */
    support: { queryId: string | null };
  }>();
  private readonly outbox: OutboxProcessor;
  /** Call signalling (live calls, ringing, the call you are in). */
  readonly calls: CallController;
  private readonly sync: SyncEngine;
  private _state: EngineState = {
    connectivity: 'offline',
    networkUp: false,
    socket: 'disconnected',
    pending: 0,
    syncing: false,
    lastSyncAt: null,
    lastSyncError: null,
    notificationsError: null,
  };
  private unsubs: (() => void)[] = [];
  private syncAttempt = 0;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private notificationsRun: Promise<void> | null = null;
  private notificationsAgain = false;
  private levelsRun: Promise<void> | null = null;
  private rsvpRun: Promise<void> | null = null;
  private meetingsRun: Promise<void> | null = null;
  private workRun: Promise<void> | null = null;

  constructor(
    readonly store: LocalStore,
    private readonly api: ApiTransport,
    private readonly session: SessionManager,
    private readonly realtime: RealtimeClient | null,
  ) {
    this.sync = new SyncEngine(store, api, { overlay: (users) => this.overlayProfile(users) });
    this.calls = new CallController(api, store.selfUserId);
    this.outbox = new OutboxProcessor({
      store,
      send: (req) => this.sendOne(req),
      edit: (id, text, mentions) => api.editMessage(id, { content: { text, mentions } }),
      remove: (id) => api.deleteMessage(id),
      react: (req) => this.reactOne(req),
      upload: async (f, conversationId) =>
        (
          await api.uploadFile(
            {
              conversationId,
              fileName: f.fileName,
              mimeType: f.mimeType,
              sizeBytes: f.sizeBytes,
              ...(f.width ? { width: f.width } : {}),
              ...(f.height ? { height: f.height } : {}),
              ...(f.recording ? { recording: f.recording } : {}),
              ...(f.recording && f.durationMs ? { durationMs: Math.round(f.durationMs) } : {}),
            },
            f.localUri,
          )
        ).attachmentId,
      runAction: (a) => this.runAction(a),
      refuseAction: (a, err) => this.refuseAction(a, err),
      canSend: () => this._state.networkUp && session.state === 'active',
      onAuthError: (err) => void this.handleAuthError(err),
    });
  }

  get state(): EngineState {
    return this._state;
  }

  async start(): Promise<void> {
    await this.store.requeueInflight();
    await this.store.work.requeueInflight();
    // Copies of files whose message was discarded or evicted.
    const live = await this.store.liveFileUris();
    for (const p of await this.store.work.pendingCallBackground())
      if (p.kind === 'callbg.image') live.add(p.localUri);
    for (const p of await this.store.work.pendingNetwork()) if (p.media) live.add(p.media.localUri);
    pruneLocalFiles(live);
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
      this.calls.attach(this.realtime);
      this.unsubs.push(
        this.realtime.events.on('state', (socket) => this.patch({ socket })),
        this.realtime.events.on('needsSync', () => void this.resume()),
        this.realtime.events.on('state', (s) => s === 'connected' && void this.calls.refresh()),
        this.realtime.events.on('notification', (n) => void this.receiveNotification(n)),
        this.realtime.events.on('scheduledUpdated', (m) => {
          void this.store.work
            .upsert('scheduled', [m])
            .then(() => this.events.emit('scheduled', m));
        }),
        this.realtime.events.on('work', (w) => {
          void (
            w.kind === 'task'
              ? this.store.work.upsert('task', [w.task])
              : this.store.work.upsert('approval', [w.approval])
          ).then(() => this.events.emit('work', { kind: w.kind }));
        }),
        this.realtime.events.on('bookmark', (b) => void this.receiveBookmark(b)),
        // Names and the people picker follow profile and membership changes made anywhere.
        this.realtime.events.on('directory', () => void this.sync.refreshDirectory()),
        this.realtime.events.on('tenant', (e) => void this.receiveTenant(e.area)),
        this.realtime.events.on('project', (e) => this.events.emit('project', e)),
        this.realtime.events.on('booking', (e) => void this.receiveBooking(e)),
        this.realtime.events.on('searchRecent', (e) => void this.receiveRecent(e.recent)),
        this.realtime.events.on(
          'chatTheme',
          () => void this.refreshChatTheme().catch(() => undefined),
        ),
        this.realtime.events.on('meetingsChanged', (e) => {
          if (e.area === 'working_hours') void this.refreshWorkingHours().catch(() => undefined);
          if (e.area === 'call_background')
            void this.refreshCallBackground().catch(() => undefined);
        }),
        this.realtime.events.on('minutes', (e) => void this.receiveMinutes(e)),
        this.realtime.events.on('transcript', (e) => void this.receiveTranscript(e.attachmentId)),
        this.realtime.events.on('network', (e) => void this.refreshNetwork([e.scope], e.scope)),
        this.realtime.events.on('moderation', (e) => this.events.emit('moderation', e)),
        this.realtime.events.on(
          'state',
          (s) => s === 'connected' && this.events.emit('moderation', { scope: null }),
        ),
        this.realtime.events.on('platform', (e) => this.events.emit('platform', e)),
        this.realtime.events.on('support', (e) => void this.refreshSupport(e.queryId)),
        this.realtime.events.on(
          'state',
          (s) => s === 'connected' && this.events.emit('platform', { area: null }),
        ),
        this.realtime.events.on('inbox', (e) => void this.refreshInbox(e.conversationId)),
        this.realtime.events.on('myVote', (v) => {
          void this.store.work.setVote(v.messageId, v.optionIds).then(async () => {
            const m = await this.store.getMessageByServerId(v.messageId);
            if (m) this.store.notifyMessages(m.conversationId);
          });
        }),
        this.realtime.events.on('meetingReminder', (e) => {
          const mine = e.meeting.attendees.find((a) => a.userId === this.store.selfUserId);
          if (e.meeting.status === 'scheduled' && mine?.response !== 'declined')
            this.events.emit('meetingReminder', e);
        }),
        this.realtime.events.on('notificationsRead', ({ unreadCount }) => {
          void this.store.setNotificationUnread(unreadCount);
          void this.refreshNotifications();
        }),
        this.realtime.events.on(
          'sessionExpired',
          () => void this.handleAuthError(new TransportError('expired', 'api', 'SESSION_EXPIRED')),
        ),
      );
    }
    this.recompute();
  }

  stop(): void {
    this.calls.stop();
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

  /**
   * The app left or returned to the foreground. In the background the realtime link is closed
   * so the server treats this device as away (and can push to it); it reopens on return.
   */
  setForeground(foreground: boolean): void {
    if (!foreground) return this.realtime?.disconnect();
    if (this._state.networkUp && this.session.state === 'active') this.realtime?.connect();
    void this.resume();
  }

  /** App returned to the foreground or the user pulled to refresh. */
  async resume(): Promise<void> {
    if (!this._state.networkUp || this.session.state !== 'active') return;
    if (this.inNetwork) {
      // SampConnect Network has chat, calls and its own lists, but no meetings or work items.
      await Promise.all([
        this.outbox
          .kick()
          .then(() =>
            Promise.all([this.refreshWork(), this.refreshNetwork(), this.refreshSupport()]),
          ),
        this.runSync(),
        this.refreshNotifications(),
        this.flushNotifyLevels(),
        this.calls.refresh(),
      ]);
      return;
    }
    await Promise.all([
      // Queued changes go first, then the lists are re-read so they reflect them.
      this.outbox.kick().then(() => Promise.all([this.refreshWork(), this.refreshSupport()])),
      this.runSync(),
      this.refreshNotifications(),
      this.flushNotifyLevels(),
      this.calls.refresh(),
      this.flushRsvps().then(() => this.refreshMeetings()),
    ]);
  }

  /**
   * Marks notifications read on this device right away; the mark is queued and sent when
   * online, so read state matches your other devices. Opening a conversation calls this.
   */
  async markNotificationsRead(target: MarkNotificationsReadRequest): Promise<void> {
    const changed = await this.store.markNotificationsReadLocally(target, {
      queue: this.session.state !== 'demo',
    });
    if (changed > 0 || 'all' in target) void this.refreshNotifications();
  }

  /** Server push availability and whether this device session has a token (null without a server). */
  async pushStatus(): Promise<PushStatus | null> {
    if (this.session.state !== 'active' || !this._state.networkUp) return null;
    return this.api.pushStatus();
  }

  /**
   * Ties this install's push token to the signed-in device session. Repeating it is harmless;
   * the server moves a token that another session held (re-login on the same phone).
   */
  async registerPush(token: string, platform: 'ios' | 'android'): Promise<PushStatus | null> {
    if (this.session.state !== 'active' || !this._state.networkUp) return null;
    try {
      return await this.api.registerPushToken({ provider: 'expo', token, platform });
    } catch {
      return null; // tried again on the next foreground
    }
  }

  /** Changes what notifies you in a conversation; works offline and is sent when possible. */
  async setNotifyLevel(conversationId: string, level: NotifyLevel): Promise<void> {
    if (this.session.state === 'demo') {
      // No server: the local choice is the final one.
      return this.store.upsertLocalNotifyLevel(conversationId, level);
    }
    await this.store.setNotifyLevelLocally(conversationId, level);
    await this.flushNotifyLevels();
  }

  /** One flush at a time; a call during a flush waits for it and then runs again. */
  private flushNotifyLevels(): Promise<void> {
    const run = (this.levelsRun ?? Promise.resolve()).then(() => this.sendNotifyLevels());
    const tracked = run.finally(() => {
      if (this.levelsRun === tracked) this.levelsRun = null;
    });
    this.levelsRun = tracked;
    return tracked;
  }

  private async sendNotifyLevels(): Promise<void> {
    if (!this._state.networkUp || this.session.state !== 'active') return;
    for (const { conversationId, level } of await this.store.pendingNotifyLevels()) {
      try {
        await this.store.upsertConversations([
          await this.api.setNotifyLevel(conversationId, level),
        ]);
      } catch (err) {
        if (!(err instanceof TransportError) || err.kind === 'network') return;
        if (err.isAuth) return void this.handleAuthError(err);
        if (err.retryable) return;
        // Refused for good (e.g. no longer a member): fall back to the server's level.
      }
      await this.store.settleNotifyLevel(conversationId, level);
    }
  }

  /**
   * Sends queued read marks, then reloads the newest page of the feed. A call made while a
   * refresh is running waits for it, and that refresh runs once more to pick up the change.
   */
  refreshNotifications(): Promise<void> {
    if (!this._state.networkUp || this.session.state !== 'active') return Promise.resolve();
    if (this.notificationsRun) {
      this.notificationsAgain = true;
      return this.notificationsRun;
    }
    this.notificationsRun = this.runNotifications().finally(() => {
      this.notificationsRun = null;
    });
    return this.notificationsRun;
  }

  private async runNotifications(): Promise<void> {
    try {
      do {
        this.notificationsAgain = false;
        if (!(await this.flushNotificationReads())) return;
        const page = await this.api.listNotifications({ limit: 50 });
        // A read mark made while the request was in flight is sent (and reloaded) next pass.
        if ((await this.store.pendingNotificationReads()) === 0)
          await this.store.replaceNotifications(page);
        else this.notificationsAgain = true;
        this.patch({ notificationsError: null });
      } while (this.notificationsAgain);
    } catch (err) {
      const e = err instanceof TransportError ? err : new TransportError(String(err), 'network');
      this.patch({
        notificationsError:
          e.code === 'NOT_FOUND' ? 'This server does not provide notifications yet.' : e.message,
      });
      if (e.isAuth) void this.handleAuthError(e);
    }
  }

  /** Returns true once nothing is left to send. */
  private async flushNotificationReads(): Promise<boolean> {
    for (;;) {
      const next = await this.store.nextNotificationRead();
      if (!next) return true;
      try {
        const { unreadCount } = await this.api.markNotificationsRead(next.body);
        await this.store.settleNotificationRead(next.id);
        if ((await this.store.pendingNotificationReads()) === 0)
          await this.store.setNotificationUnread(unreadCount);
      } catch (err) {
        if (!(err instanceof TransportError)) throw err;
        if (err.kind === 'network' || err.isAuth) throw err;
        if (err.retryable && next.attempts + 1 < 8) {
          await this.store.retryNotificationRead(next.id);
          throw err;
        }
        // Rejected for good (e.g. a conversation you were removed from): the next reload corrects it.
        await this.store.settleNotificationRead(next.id);
      }
    }
  }

  /** An admin changed an organization setting on another device: pick it up here. */
  private async receiveTenant(area: TenantArea): Promise<void> {
    if (area === 'chat_themes') void this.refreshChatTheme().catch(() => undefined);
    if (area === 'messages') void this.refreshMessageEditing().catch(() => undefined);
    if (area === 'greetings') void this.refreshGreetingPolicy().catch(() => undefined);
    if (area === 'minutes') void this.refreshMinutesConfig().catch(() => undefined);
    if (area === 'inbox') void this.refreshInboxAdmin();
    if (area === 'ai' || area === 'integrations') this.transcriptionCheckedAt = 0;
    if (area === 'calls' || area === 'branding')
      void this.refreshCallBackground().catch(() => undefined);
    if (area === 'branding' && this.online) {
      try {
        this.events.emit('branding', await this.api.getBranding());
      } catch {
        // keep the current look; the next start reloads it
      }
    }
    this.events.emit('tenant', { area });
  }

  /** A save or unsave from another of your devices (or the echo of one made here). */
  private async receiveBookmark(b: {
    messageId: string;
    conversationId: string;
    saved: boolean;
  }): Promise<void> {
    if (!b.saved) await this.store.work.removeBookmark(b.messageId);
    else if (!(await this.store.work.hasBookmark(b.messageId))) {
      const message = await this.localServerMessage(b.messageId);
      if (message)
        await this.store.work.upsert('bookmark', [
          {
            messageId: b.messageId,
            conversationId: b.conversationId,
            createdAt: new Date().toISOString(),
            message,
          },
        ]);
      else void this.listBookmarks().catch(() => undefined);
    }
    await this.emitSaved();
  }

  private async receiveNotification(n: LocalNotification): Promise<void> {
    if ((await this.store.addNotification(n)) && !n.readAt) this.events.emit('notification', n);
  }

  // ------------------------------------------------------------ conversations and members
  //
  // These change who is in a conversation, so the server has to decide them: they need a
  // connection and fail with a readable message instead of being queued.

  /** Why a server-only action cannot run right now, or null when it can. */
  serverActionBlocker(): string | null {
    if (this.session.state === 'demo')
      return 'The demo workspace has no server. Sign in to a server to do this.';
    if (this.session.state !== 'active') return 'Sign in again to do this.';
    if (!this._state.networkUp) return 'You are offline. This needs a connection.';
    return null;
  }

  /** Recordings library (needs a connection: recordings are streamed, not cached). */
  /** The Files screen from the server. Offline, the screen uses {@link filesOnPhone}. */
  listFiles(q: ListFilesQuery): Promise<FileList> {
    return this.serverAction(() => this.api.listFiles(q));
  }

  /** Files in the messages saved on this phone, including ones still waiting to upload. */
  filesOnPhone(q: LocalFilesQuery): Promise<LocalFile[]> {
    return this.store.filesOnPhone(q);
  }

  listRecordings(q: RecordingsQuery): Promise<RecordingList> {
    return this.serverAction(() => this.api.listRecordings(q));
  }

  /** Deletes a recording for everyone; its message then shows "Recording deleted". */
  deleteRecording(recordingId: string): Promise<void> {
    return this.serverAction(() => this.api.deleteRecording(recordingId));
  }

  /** The guest's personal join link (organizer only), to share when email isn't set up. */
  guestLink(meetingId: string, guestId: string): Promise<string> {
    return this.serverAction(async () => (await this.api.guestLink(meetingId, guestId)).url);
  }

  /** Emails the invitation again (organizer). The server explains when email isn't set up. */
  resendGuestInvite(meetingId: string, guestId: string): Promise<void> {
    return this.serverAction(async () => {
      await this.api.resendGuestInvite(meetingId, guestId);
      await this.store.upsertMeetings([await this.api.getMeeting(meetingId)]);
    });
  }

  // ------------------------------------------------ queued actions (work offline, sync everywhere)
  //
  // Pins, saved messages, polls, scheduled messages, tasks and approvals are written to the
  // device first and queued (db/work.ts), then sent in order when a connection allows. Lists are
  // cached so they open offline, refreshed from the server on reconnect, and updated live from
  // your other devices. The server's copy wins once a change is confirmed or refused.

  /** Why a queued action cannot even be recorded (only the demo workspace, which has no server). */
  queueBlocker(): string | null {
    return this.session.state === 'demo'
      ? 'The demo workspace has no server. Sign in to a server to do this.'
      : null;
  }

  private async queue(input: ActionInput): Promise<void> {
    const blocked = this.queueBlocker();
    if (blocked) throw new Error(blocked);
    const r = await this.store.work.enqueue(input);
    if (r.sendNow)
      await this.store.enqueueSend({
        conversationId: r.sendNow.conversationId,
        text: r.sendNow.content.text,
        mentions: r.sendNow.content.mentions ?? [],
        replyTo: r.sendNow.replyToMessageId ?? null,
      });
    if ('conversationId' in input) this.store.notifyMessages(input.conversationId);
    void this.outbox.kick();
  }

  private get online(): boolean {
    return this._state.networkUp && this.session.state === 'active';
  }

  /** Runs a read against the server when online; network trouble keeps the cached copy. */
  private async refreshFrom(run: () => Promise<void>, fresh = true): Promise<void> {
    if (!fresh || !this.online) return;
    try {
      await run();
    } catch (err) {
      if (err instanceof TransportError) {
        if (err.isAuth) void this.handleAuthError(err);
        if (err.kind === 'network' || err.retryable) return;
        if (err.code === 'NOT_FOUND') return;
      }
      throw err;
    }
  }

  /** Pins or unpins for everyone. Works offline; other devices see it through sync. */
  async pinMessage(messageId: string, pinned: boolean): Promise<void> {
    const m = await this.store.getMessageByServerId(messageId);
    if (!m) throw new Error('This message is not on this device.');
    await this.queue({ kind: 'pin', messageId, conversationId: m.conversationId, pinned });
  }

  /** Saved messages, newest first: the cached list, refreshed from the server when online. */
  async listBookmarks(opts: { fresh?: boolean } = {}): Promise<LocalBookmark[]> {
    await this.refreshFrom(async () => {
      const list = await this.api.listBookmarks();
      await this.store.work.replace('bookmark', list, () => true);
      void this.emitSaved();
    }, opts.fresh ?? true);
    return this.store.work.listBookmarks((id) => this.localServerMessage(id));
  }

  /** Message ids you saved, as far as this device knows (queued changes included). */
  savedIds(): Promise<Set<string>> {
    return this.store.work.savedIds();
  }

  private async emitSaved(): Promise<void> {
    this.events.emit('bookmarks', await this.store.work.savedIds());
  }

  setBookmark(messageId: string, saved: boolean): Promise<void> {
    return (async () => {
      const m = await this.store.getMessageByServerId(messageId);
      if (!m) throw new Error('This message is not on this device.');
      await this.queue({ kind: 'bookmark', messageId, conversationId: m.conversationId, saved });
    })();
  }

  /** A server-shaped copy of a message on this device (for a message saved offline). */
  private async localServerMessage(messageId: string): Promise<Message | undefined> {
    const m = await this.store.getMessageByServerId(messageId);
    if (!m?.messageId) return undefined;
    return {
      messageId: m.messageId,
      clientMessageId: m.clientId,
      tenantId: this.session.current?.tenant.tenantId ?? '',
      conversationId: m.conversationId,
      senderId: m.senderId,
      messageType: m.messageType as Message['messageType'],
      content: { text: m.text, mentions: m.mentions },
      attachmentIds: [],
      attachments: [],
      replyToMessageId: m.replyTo,
      serverSequence: m.serverSeq ?? 1,
      changeSequence: m.changeSeq ?? 1,
      createdAt: m.createdAt,
      editedAt: m.editedAt,
      deletedAt: m.deletedAt,
      metadata: m.metadata,
      reactions: [],
      pinned: m.pinned,
      poll: m.poll,
    };
  }

  /** Posts a poll. Shows at once and is posted when possible (idempotent on its client id). */
  async createPoll(
    conversationId: string,
    poll: Omit<CreatePollRequest, 'clientMessageId'>,
  ): Promise<void> {
    const blocked = this.queueBlocker();
    if (blocked) throw new Error(blocked);
    await this.store.enqueuePoll(conversationId, { ...poll, clientMessageId: uuidv7() });
    void this.outbox.kick();
  }

  /** Your current choice in a poll: queued, else cached, else asked once (anonymous polls). */
  async myPollVote(messageId: string, poll: Poll): Promise<string[] | null> {
    const pending = await this.store.work.pendingVote(messageId);
    if (pending) return pending;
    if (!poll.anonymous) {
      const self = this.store.selfUserId;
      return poll.options.filter((o) => o.voterIds.includes(self)).map((o) => o.optionId);
    }
    const cached = await this.store.work.cachedVote(messageId);
    if (cached) return cached;
    if (!this.online) return null;
    try {
      const v = await this.api.myPollVote(messageId);
      await this.store.work.setVote(messageId, v.optionIds);
      return v.optionIds;
    } catch {
      return null;
    }
  }

  async votePoll(messageId: string, optionIds: string[]): Promise<void> {
    const m = await this.store.getMessageByServerId(messageId);
    if (!m) throw new Error('This poll is not on this device.');
    if (m.poll?.anonymous && !(await this.store.work.cachedVote(messageId))) {
      // Remember what the server counted for you so the queued change adjusts counts correctly.
      const before = await this.myPollVote(messageId, m.poll);
      if (before) await this.store.work.setVote(messageId, before);
    }
    await this.queue({ kind: 'poll.vote', messageId, conversationId: m.conversationId, optionIds });
  }

  /** Change a poll nobody has voted on yet. Queued; the server refuses once someone votes. */
  async editPoll(messageId: string, request: EditPollRequest): Promise<void> {
    const m = await this.store.getMessageByServerId(messageId);
    if (!m) throw new Error('This poll is not on this device.');
    await this.queue({ kind: 'poll.edit', messageId, conversationId: m.conversationId, request });
  }

  /** Rename a group or channel, or change its description. Queued, so it works offline. */
  async updateConversation(
    conversationId: string,
    patch: UpdateConversationRequest,
  ): Promise<void> {
    await this.queue({ kind: 'conversation.update', conversationId, patch });
  }

  async closePoll(messageId: string): Promise<void> {
    const m = await this.store.getMessageByServerId(messageId);
    if (!m) throw new Error('This poll is not on this device.');
    await this.queue({ kind: 'poll.close', messageId, conversationId: m.conversationId });
  }

  /** Your scheduled messages (scheduled and failed), soonest first: cached, refreshed online. */
  async listScheduled(
    conversationId?: string,
    opts: { fresh?: boolean } = {},
  ): Promise<LocalScheduled[]> {
    await this.refreshFrom(async () => {
      const list = await this.api.listScheduled(conversationId);
      await this.store.work.replace<ScheduledMessage>(
        'scheduled',
        list,
        (s) =>
          (!conversationId || s.conversationId === conversationId) &&
          (s.status === 'scheduled' || s.status === 'failed'),
      );
    }, opts.fresh ?? true);
    return this.store.work.listScheduled(conversationId);
  }

  /**
   * The server holds it and sends it as you at `sendAt`, even with this phone off. Scheduling
   * works offline too: it reaches the server when you reconnect (sent at once if the time passed).
   */
  async scheduleMessage(
    conversationId: string,
    text: string,
    sendAt: Date,
    opts: { mentions?: string[]; replyTo?: string | null } = {},
  ): Promise<LocalScheduled> {
    const clientMessageId = uuidv7();
    const localId = `${LOCAL_PREFIX}${clientMessageId}`;
    await this.queue({
      kind: 'scheduled.create',
      localId,
      conversationId,
      request: {
        clientMessageId,
        content: { text, mentions: opts.mentions ?? [] },
        replyToMessageId: opts.replyTo ?? null,
        sendAt: sendAt.toISOString(),
      },
    });
    this.events.emit('scheduled', null);
    return (await this.store.work.listScheduled(conversationId)).find(
      (s) => s.scheduledId === localId,
    )!;
  }

  async rescheduleMessage(id: string, sendAt: Date): Promise<void> {
    await this.queue({ kind: 'scheduled.update', scheduledId: id, sendAt: sendAt.toISOString() });
    this.events.emit('scheduled', null);
  }

  async cancelScheduled(id: string): Promise<void> {
    await this.queue({ kind: 'scheduled.cancel', scheduledId: id });
    this.events.emit('scheduled', null);
  }

  async sendScheduledNow(id: string): Promise<void> {
    await this.queue({ kind: 'scheduled.sendNow', scheduledId: id });
    this.events.emit('scheduled', null);
  }

  // ------------------------------------------------ tasks and approvals (cached, queued offline)

  async listTasks(q: TaskQuery, opts: { fresh?: boolean } = {}): Promise<LocalTask[]> {
    await this.refreshFrom(async () => {
      const list = await this.api.listTasks(q);
      await this.store.work.replace<Task>('task', list, (t) =>
        taskMatches(t, q, this.store.selfUserId),
      );
    }, opts.fresh ?? true);
    return this.store.work.listTasks(q);
  }

  async getTask(taskId: string, opts: { fresh?: boolean } = {}): Promise<LocalTask> {
    const id = await this.store.work.resolveId(taskId);
    if (id && !isLocalId(id))
      await this.refreshFrom(
        async () => this.store.work.upsert('task', [await this.api.getTask(id)]),
        opts.fresh ?? true,
      );
    const t = await this.store.work.getTask(taskId);
    if (!t)
      throw new Error(this.online ? 'Task not found.' : 'This task is not on this device yet.');
    return t;
  }

  /** Creates a task (its card is posted in the conversation). Works offline; retry-safe. */
  async createTask(req: Omit<CreateTaskRequest, 'clientRequestId'>): Promise<LocalTask> {
    const clientRequestId = uuidv7();
    const localId = `${LOCAL_PREFIX}${clientRequestId}`;
    await this.queue({ kind: 'task.create', localId, request: { ...req, clientRequestId } });
    this.events.emit('work', { kind: 'task' });
    return (await this.store.work.getTask(localId))!;
  }

  async updateTask(taskId: string, req: UpdateTaskRequest): Promise<LocalTask | undefined> {
    await this.queue({ kind: 'task.update', taskId, patch: req });
    this.events.emit('work', { kind: 'task' });
    return this.store.work.getTask(taskId);
  }

  async listApprovals(q: ApprovalQuery, opts: { fresh?: boolean } = {}): Promise<LocalApproval[]> {
    await this.refreshFrom(async () => {
      const list = await this.api.listApprovals(q);
      await this.store.work.replace<Approval>('approval', list, (a) =>
        approvalMatches(a, q, this.store.selfUserId),
      );
    }, opts.fresh ?? true);
    return this.store.work.listApprovals(q);
  }

  async getApproval(approvalId: string, opts: { fresh?: boolean } = {}): Promise<LocalApproval> {
    const id = await this.store.work.resolveId(approvalId);
    if (id && !isLocalId(id))
      await this.refreshFrom(
        async () => this.store.work.upsert('approval', [await this.api.getApproval(id)]),
        opts.fresh ?? true,
      );
    const a = await this.store.work.getApproval(approvalId);
    if (!a)
      throw new Error(
        this.online ? 'Approval not found.' : 'This approval is not on this device yet.',
      );
    return a;
  }

  async createApproval(
    req: Omit<CreateApprovalRequest, 'clientRequestId'>,
  ): Promise<LocalApproval> {
    const clientRequestId = uuidv7();
    const localId = `${LOCAL_PREFIX}${clientRequestId}`;
    await this.queue({ kind: 'approval.create', localId, request: { ...req, clientRequestId } });
    this.events.emit('work', { kind: 'approval' });
    return (await this.store.work.getApproval(localId))!;
  }

  async decideApproval(approvalId: string, req: DecideApprovalRequest): Promise<void> {
    await this.queue({ kind: 'approval.decide', approvalId, request: req });
    this.events.emit('work', { kind: 'approval' });
  }

  /** Fix your request before anyone decides (queued; shows at once). */
  async updateApproval(approvalId: string, patch: UpdateApprovalRequest): Promise<void> {
    await this.queue({ kind: 'approval.update', approvalId, patch });
    this.events.emit('work', { kind: 'approval' });
  }

  async cancelApproval(approvalId: string): Promise<void> {
    await this.queue({ kind: 'approval.cancel', approvalId });
    this.events.emit('work', { kind: 'approval' });
  }

  // ------------------------------------------------ booking pages (cached, queued offline)

  /** Booking pages you host: the copy on this phone, refreshed when online. */
  async listBookingPages(opts: { fresh?: boolean } = {}): Promise<LocalBookingPage[]> {
    await this.refreshFrom(async () => {
      const list = await this.api.listBookingPages();
      await this.store.work.replace<BookingPage>('booking', list, () => true);
    }, opts.fresh ?? true);
    return this.store.work.listBookingPages();
  }

  async getBookingPage(id: string): Promise<LocalBookingPage> {
    const p = await this.store.work.getBookingPage(id);
    if (!p) throw new Error('This booking page is not on this phone.');
    return p;
  }

  /** Creates a booking page (you are always a host). Works offline. */
  async createBookingPage(req: CreateBookingPageRequest): Promise<LocalBookingPage> {
    const localId = `${LOCAL_PREFIX}${uuidv7()}`;
    await this.queue({ kind: 'booking.create', localId, request: req });
    this.events.emit('booking', { bookingPageId: localId });
    return (await this.store.work.getBookingPage(localId))!;
  }

  async updateBookingPage(id: string, patch: UpdateBookingPageRequest): Promise<void> {
    await this.queue({ kind: 'booking.update', bookingPageId: id, patch });
    this.events.emit('booking', { bookingPageId: id });
  }

  async deleteBookingPage(id: string): Promise<void> {
    await this.queue({ kind: 'booking.delete', bookingPageId: id });
    this.events.emit('booking', { bookingPageId: id });
  }

  private async receiveBooking(e: { bookingPageId: string; page: BookingPage | null }) {
    if (e.page && e.page.hostIds.includes(this.store.selfUserId))
      await this.store.work.upsert('booking', [e.page]);
    else await this.store.work.removeBooking(e.bookingPageId);
    this.events.emit('booking', { bookingPageId: e.bookingPageId });
  }

  // ------------------------------------------------ your profile (queued offline, last write wins)

  /** Your profile as everyone will see it, with changes made on this phone applied. */
  async myProfile(): Promise<DirectoryUser | null> {
    const raw = await this.store.getSetting('directory');
    const self = raw
      ? ((JSON.parse(raw) as DirectoryUser[]).find((u) => u.userId === this.store.selfUserId) ??
        null)
      : null;
    if (self) return self;
    const u = this.session.current?.user;
    if (!u) return null;
    const [mine] = await this.overlayProfile([
      { ...u, title: u.title ?? null, status: 'active', role: u.role } as DirectoryUser,
    ]);
    return mine ?? null;
  }

  /**
   * Edits your name, title, department, phone, about and time zone. Works offline: shown at once
   * on this phone and sent when you reconnect; the newest value of each field wins.
   */
  async updateProfile(patch: UpdateProfileRequest): Promise<void> {
    if (!Object.keys(patch).length) return;
    await this.queue({ kind: 'profile.update', patch });
    await this.sync.rederiveDirectory();
    this.events.emit('profile', null);
  }

  /**
   * Your availability and custom status (emoji, text, when it clears). Works offline: shown at
   * once on this phone and sent when you reconnect; every device and teammate then updates.
   */
  async setStatus(status: UserStatus): Promise<void> {
    await this.queue({ kind: 'status.set', status });
    await this.sync.rederiveDirectory();
    this.events.emit('profile', null);
  }

  /** Recurring quiet hours (no push notifications). Works offline like {@link setStatus}. */
  async setDndSchedule(schedule: DndSchedule): Promise<void> {
    await this.queue({ kind: 'dnd.set', schedule });
    await this.sync.rederiveDirectory();
    this.events.emit('profile', null);
  }

  /** A new photo (already cropped and compressed to a data URL). Works offline. */
  async setAvatar(image: string): Promise<void> {
    await this.queue({ kind: 'avatar.set', image });
    await this.sync.rederiveDirectory();
    this.events.emit('profile', null);
  }

  async removeAvatar(): Promise<void> {
    await this.queue({ kind: 'avatar.remove' });
    await this.sync.rederiveDirectory();
    this.events.emit('profile', null);
  }

  // ------------------------------------------------------------ Universal Search

  /**
   * Everything you may open that matches, from the server (needs a connection). Offline, the
   * search screen uses {@link searchOnPhone} instead.
   */
  search(q: SearchParams): Promise<SearchResponse> {
    return this.serverAction(() => this.api.search(q));
  }

  /** Messages saved on this phone that match, including ones not sent yet. */
  searchOnPhone(q: LocalSearch): Promise<LocalMessage[]> {
    return this.store.searchMessagesBy(q);
  }

  /** Your recent searches, newest first: your unsent change, else the server's last copy. */
  async recentSearches(): Promise<string[]> {
    const pending = await this.store.work.pendingRecentSearches();
    if (pending) return pending;
    const raw = await this.store.getSetting(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  }

  /** Puts a search at the top of your recent ones (on every device; works offline). */
  async rememberSearch(query: string): Promise<void> {
    const q = query.trim();
    if (!q) return;
    const now = await this.recentSearches();
    const next = [q, ...now.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(
      0,
      MAX_RECENT_SEARCHES,
    );
    if (next.join('\n') === now.join('\n')) return;
    await this.saveRecent(next);
  }

  async forgetSearch(query: string): Promise<void> {
    await this.saveRecent((await this.recentSearches()).filter((x) => x !== query));
  }

  async clearRecentSearches(): Promise<void> {
    await this.saveRecent([]);
  }

  private async saveRecent(recent: string[]): Promise<void> {
    if (this.session.state === 'demo')
      await this.store.setSetting(RECENT_KEY, JSON.stringify(recent));
    else await this.queue({ kind: 'search.recent', recent });
    this.events.emit('recentSearches', recent);
  }

  private async receiveRecent(recent: string[]): Promise<void> {
    await this.store.setSetting(RECENT_KEY, JSON.stringify(recent));
    await this.emitRecent();
  }

  private async emitRecent(): Promise<void> {
    this.events.emit('recentSearches', await this.recentSearches());
  }

  private async refreshRecentSearches(): Promise<void> {
    await this.receiveRecent(await this.api.getRecentSearches());
  }

  /** Lays your unsent profile changes over the server's directory. */
  private async overlayProfile(users: DirectoryUser[]): Promise<DirectoryUser[]> {
    const { patch, avatar, status, dndSchedule } = await this.store.work.pendingProfile();
    if (!Object.keys(patch).length && avatar === undefined && !status && !dndSchedule) return users;
    const clean = (v: string | null | undefined) =>
      v === undefined ? undefined : v?.trim() || null;
    return users.map((u) => {
      if (u.userId !== this.store.selfUserId) return u;
      const next: DirectoryUser = { ...u };
      if (patch.displayName?.trim()) next.displayName = patch.displayName.trim();
      for (const k of ['title', 'department', 'phone', 'bio', 'timeZone'] as const) {
        const v = clean(patch[k]);
        if (v !== undefined) next[k] = v;
      }
      if (avatar !== undefined) next.avatarUrl = avatar;
      if (status) next.userStatus = status;
      if (dndSchedule) next.dndSchedule = dndSchedule;
      return next;
    });
  }

  private async receivePresence(p: PresenceInfo): Promise<void> {
    const raw = await this.store.getSetting('directory.server');
    const list = raw ? (JSON.parse(raw) as DirectoryUser[]) : [];
    const self = this.store.selfUserId;
    await this.store.setSetting(
      'directory.server',
      JSON.stringify(
        list.map((u) =>
          u.userId === self ? { ...u, userStatus: p.status, dndSchedule: p.dndSchedule } : u,
        ),
      ),
    );
  }

  /** The server answered a profile change: keep its copy of you, then re-apply what is left. */
  private async receiveSelf(u: DirectoryUser): Promise<void> {
    const raw = await this.store.getSetting('directory.server');
    const list = raw ? (JSON.parse(raw) as DirectoryUser[]) : [];
    const next = list.some((x) => x.userId === u.userId)
      ? list.map((x) => (x.userId === u.userId ? { ...x, ...u } : x))
      : [...list, u];
    await this.store.setSetting('directory.server', JSON.stringify(next));
  }

  /** Try again something created here that the server refused. */
  async retryLocal(kind: LocalKind, localId: string): Promise<void> {
    await this.store.work.retry(localId, kind);
    void this.outbox.kick();
  }

  /** Forget something created here that the server refused. */
  async discardLocal(kind: LocalKind, localId: string): Promise<void> {
    await this.store.work.discard(localId, kind);
    if (kind === 'booking') this.events.emit('booking', null);
    else this.events.emit(kind === 'scheduled' ? 'scheduled' : 'work', null as never);
  }

  /** Sends one queued action and applies the server's answer (called by the outbox). */
  private async runAction(a: QueuedAction): Promise<void> {
    const w = this.store.work;
    const i = a.input;
    const need = async (id: string): Promise<string> => {
      const r = await w.resolveId(id);
      if (!r) throw new TransportError('Waiting for it to be created', 'api', 'CONFLICT');
      return r;
    };
    switch (i.kind) {
      case 'pin':
        await this.store.applyServerMessages([await this.api.pinMessage(i.messageId, i.pinned)]);
        break;
      case 'bookmark':
        await this.api.setBookmark(i.messageId, i.saved);
        if (!i.saved) await w.removeBookmark(i.messageId);
        else if (!(await w.hasBookmark(i.messageId))) {
          const message = await this.localServerMessage(i.messageId);
          if (message)
            await w.upsert('bookmark', [
              {
                messageId: i.messageId,
                conversationId: i.conversationId,
                createdAt: new Date(a.enqueuedAt).toISOString(),
                message,
              },
            ]);
        }
        break;
      case 'poll.create': {
        const m = await this.api.createPoll(i.conversationId, i.request);
        await w.setVote(m.messageId, []);
        await w.complete(a);
        await this.store.applyServerMessages([m]);
        return;
      }
      case 'poll.vote': {
        const m = await this.api.votePoll(i.messageId, i.optionIds);
        await w.setVote(i.messageId, i.optionIds);
        await w.complete(a);
        await this.store.applyServerMessages([m]);
        return;
      }
      case 'poll.close':
        await this.store.applyServerMessages([await this.api.closePoll(i.messageId)]);
        break;
      case 'poll.edit':
        await this.store.applyServerMessages([await this.api.editPoll(i.messageId, i.request)]);
        break;
      case 'conversation.update':
        await this.store.upsertConversations([
          await this.api.updateConversation(i.conversationId, i.patch),
        ]);
        break;
      case 'task.create':
        await w.settleCreate(a, { kind: 'task', data: await this.api.createTask(i.request) });
        this.events.emit('work', { kind: 'task' });
        return;
      case 'task.update':
        await w.upsert('task', [await this.api.updateTask(await need(i.taskId), i.patch)]);
        break;
      case 'approval.create':
        await w.settleCreate(a, {
          kind: 'approval',
          data: await this.api.createApproval(i.request),
        });
        this.events.emit('work', { kind: 'approval' });
        return;
      case 'approval.decide':
        await w.upsert('approval', [
          await this.api.decideApproval(await need(i.approvalId), i.request),
        ]);
        break;
      case 'approval.cancel':
        await w.upsert('approval', [await this.api.cancelApproval(await need(i.approvalId))]);
        break;
      case 'approval.update':
        await w.upsert('approval', [
          await this.api.updateApproval(await need(i.approvalId), i.patch),
        ]);
        break;
      case 'scheduled.create':
        try {
          const m = await this.api.scheduleMessage(i.conversationId, i.request);
          await w.settleCreate(a, { kind: 'scheduled', data: m });
        } catch (err) {
          // Made offline and the time passed before it reached the server: send it now instead.
          if (
            err instanceof TransportError &&
            err.code === 'VALIDATION_FAILED' &&
            Date.parse(i.request.sendAt) < Date.now() + SCHEDULE_MIN_LEAD_MS
          ) {
            await w.discard(i.localId, 'scheduled');
            await this.store.enqueueSend({
              conversationId: i.conversationId,
              text: i.request.content.text,
              mentions: i.request.content.mentions ?? [],
              replyTo: i.request.replyToMessageId ?? null,
            });
          } else throw err;
        }
        this.events.emit('scheduled', null);
        return;
      case 'scheduled.update':
        await w.upsert('scheduled', [
          await this.api.updateScheduled(await need(i.scheduledId), { sendAt: i.sendAt }),
        ]);
        break;
      case 'scheduled.cancel':
        await w.upsert('scheduled', [await this.api.cancelScheduled(await need(i.scheduledId))]);
        break;
      case 'scheduled.sendNow':
        await w.upsert('scheduled', [await this.api.sendScheduledNow(await need(i.scheduledId))]);
        void this.runSync();
        break;
      case 'booking.create': {
        let page: BookingPage;
        try {
          page = await this.api.createBookingPage(i.request);
        } catch (err) {
          // The link is the page's identity: if the first try reached the server but its answer
          // was lost, the retry finds our own page under that link.
          const slug = i.request.slug.trim().toLowerCase();
          const own =
            err instanceof TransportError && err.code === 'CONFLICT'
              ? (await this.api.listBookingPages()).find(
                  (p) => p.slug === slug && p.createdBy === this.store.selfUserId,
                )
              : undefined;
          if (!own) throw err;
          page = own;
        }
        await w.settleCreate(a, { kind: 'booking', data: page });
        this.events.emit('booking', { bookingPageId: page.bookingPageId });
        return;
      }
      case 'booking.update': {
        const page = await this.api.updateBookingPage(await need(i.bookingPageId), i.patch);
        if (page.hostIds.includes(this.store.selfUserId)) await w.upsert('booking', [page]);
        else await w.removeBooking(page.bookingPageId);
        break;
      }
      case 'profile.update':
        await this.receiveSelf(await this.api.updateProfile(i.patch));
        break;
      case 'avatar.set':
        await this.receiveSelf(await this.api.setAvatar(i.image));
        break;
      case 'avatar.remove':
        await this.receiveSelf(await this.api.removeAvatar());
        break;
      case 'status.set': {
        // Queued while offline long enough to have expired: it has cleared itself by now.
        const s = effectiveStatus(i.status, new Date());
        await this.receivePresence(await this.api.setStatus(s));
        break;
      }
      case 'dnd.set':
        await this.receivePresence(await this.api.setDndSchedule(i.schedule));
        break;
      case 'theme.set':
        await this.store.setSetting(
          THEME_KEY,
          JSON.stringify(await this.api.setChatTheme(i.themeId)),
        );
        break;
      case 'transcript.update':
        await this.saveTranscript(
          await this.api.updateTranscript(
            i.attachmentId,
            transcriptRequest(i.language, i.baseRevision, i.patch),
          ),
        );
        break;
      case 'minutes.update': {
        const m = await this.api.updateMinutes(i.minutesId, {
          baseRevision: i.baseRevision,
          ...i.patch,
        });
        await this.saveMinutes(m);
        break;
      }
      case 'callbg.set':
        await this.saveCallBackground(await this.api.setCallBackground(i.choice));
        break;
      case 'callbg.image':
        await this.saveCallBackground(await this.api.uploadCallBackground(i.localUri, i.name));
        deleteLocalFile(i.localUri);
        break;
      case 'callbg.imageRemove':
        await this.saveCallBackground(await this.api.removeCallBackgroundImage(i.imageId));
        break;
      case 'callbg.appearance':
        await this.saveCallBackground(await this.api.setCallAppearance(i.appearance));
        break;
      case 'hours.set':
        await this.store.setSetting(
          HOURS_KEY,
          JSON.stringify(await this.api.setWorkingHours(i.hours)),
        );
        break;
      case 'inbox.reply':
        await this.api.inbox('POST', `${inboxDetailPath(i.inboxId)}/replies`, {
          clientMessageId: i.clientMessageId,
          text: i.text,
          ...(i.templateId ? { templateId: i.templateId } : {}),
        });
        // The timeline has it before the waiting copy goes, so it never blinks out.
        await this.inboxLoad(inboxDetailPath(i.inboxId)).catch(() => undefined);
        break;
      case 'inbox.note':
        await this.api.inbox('POST', `${inboxDetailPath(i.inboxId)}/notes`, {
          clientNoteId: i.clientNoteId,
          text: i.text,
          mentions: i.mentions,
        });
        await this.inboxLoad(inboxDetailPath(i.inboxId)).catch(() => undefined);
        break;
      case 'inbox.update':
        await this.store.setSetting(
          inboxKey(inboxDetailPath(i.inboxId)),
          JSON.stringify(await this.api.inbox('PATCH', inboxDetailPath(i.inboxId), i.patch)),
        );
        break;
      case 'inbox.read':
        await this.api.inbox('PUT', `${inboxDetailPath(i.inboxId)}/read`);
        break;
      case 'inbox.settings':
        await this.store.setSetting(
          inboxKey('/v1/inbox/settings'),
          JSON.stringify(await this.api.inbox('PUT', '/v1/inbox/settings', i.settings)),
        );
        break;
      case 'support.act':
        await this.api.support(i.method, i.path, i.body);
        break;
      case 'net.act': {
        let body = i.body;
        if (i.media) {
          const { localUri, ...meta } = i.media;
          const attachmentId = await this.api.uploadStatusMedia(meta, localUri);
          body = { ...(body as object), attachmentId };
        }
        await this.api.network(i.method, i.path, body);
        if (i.media) deleteLocalFile(i.media.localUri);
        break;
      }
      case 'search.recent':
        await this.store.setSetting(
          RECENT_KEY,
          JSON.stringify(await this.api.setRecentSearches(i.recent)),
        );
        break;
      case 'booking.delete':
        try {
          await this.api.deleteBookingPage(await need(i.bookingPageId));
        } catch (err) {
          // Already gone (deleted by a co-host): that is what we wanted.
          if (!(err instanceof TransportError && err.code === 'NOT_FOUND')) throw err;
        }
        await w.removeBooking((await w.resolveId(i.bookingPageId)) ?? i.bookingPageId);
        break;
    }
    await w.complete(a);
    this.afterAction(a);
  }

  /**
   * The server refused an action for good. Creates stay, marked as not sent, so nothing you
   * wrote is lost; other changes are dropped and the server's copy shows again.
   */
  private async refuseAction(a: QueuedAction, err: TransportError): Promise<void> {
    const reason =
      err.code === 'FORBIDDEN' ? 'You do not have permission to do that.' : err.message;
    const i = a.input;
    if (i.kind === 'support.act') {
      // A question is kept (Retry or Discard) so nothing written is lost; a status change drops.
      if (i.method === 'POST') await this.store.work.fail(a, reason);
      else await this.store.work.complete(a);
      this.afterAction(a);
      this.events.emit('actionRefused', { kind: i.kind, reason, label: i.label });
      return;
    }
    if (i.kind === 'net.act') {
      // The server's copy shows again (they blocked you, the request was already answered...).
      await this.store.work.complete(a);
      this.afterAction(a);
      this.events.emit('actionRefused', { kind: i.kind, reason: err.message, label: i.label });
      return;
    }
    if (i.kind === 'inbox.reply' || i.kind === 'inbox.note') {
      // Kept with the reason, so nothing written to a client is lost (Retry or Discard).
      await this.store.work.fail(a, reason);
      this.afterAction(a);
      this.events.emit('actionRefused', { kind: i.kind, reason });
      return;
    }
    if (i.kind === 'inbox.update' || i.kind === 'inbox.read' || i.kind === 'inbox.settings') {
      // The server's copy shows again (no longer yours to change, closed elsewhere...).
      await this.store.work.complete(a);
      this.afterAction(a);
      this.events.emit('actionRefused', { kind: i.kind, reason });
      return;
    }
    if (i.kind === 'poll.create') {
      await this.store.work.fail(a, reason);
      await this.store.markPollFailed(i.request.clientMessageId, reason);
    } else if (i.kind.endsWith('.create')) await this.store.work.fail(a, reason);
    else {
      await this.store.work.complete(a);
      // Re-read what the server has now (cancelled, decided elsewhere, no longer allowed...).
      void this.refreshWork().catch(() => undefined);
    }
    this.afterAction(a);
    this.events.emit('actionRefused', { kind: i.kind, reason });
  }

  private afterAction(a: QueuedAction): void {
    const i = a.input;
    if ('conversationId' in i) this.store.notifyMessages(i.conversationId);
    if (i.kind === 'bookmark') void this.emitSaved();
    if (i.kind === 'support.act') void this.refreshSupport();
    if (i.kind === 'net.act') {
      this.events.emit('network', { scope: null });
      void this.refreshNetwork(i.scopes);
    }
    if (i.kind.startsWith('inbox.') && 'inboxId' in i) void this.refreshInbox(i.inboxId);
    if (i.kind === 'inbox.settings') void this.refreshInboxAdmin();
    if (i.kind.startsWith('scheduled.')) this.events.emit('scheduled', null);
    if (i.kind.startsWith('task.')) this.events.emit('work', { kind: 'task' });
    if (i.kind.startsWith('approval.')) this.events.emit('work', { kind: 'approval' });
    if (i.kind.startsWith('booking.')) this.events.emit('booking', null);
    if (i.kind === 'search.recent') void this.emitRecent();
    if (i.kind === 'theme.set') void this.emitChatTheme();
    if (i.kind.startsWith('callbg.')) void this.emitCallBackground();
    if (i.kind === 'transcript.update')
      // Saved or refused (someone corrected the same line): show the server's copy either way.
      void this.refreshTranscript(i.attachmentId).catch(() =>
        this.events.emit('transcript', { attachmentId: i.attachmentId }),
      );
    if (i.kind === 'minutes.update')
      // Saved or refused (someone changed the same part): show the server's copy either way.
      void this.refreshCallMinutes(i.callId).catch(() => this.emitMinutesFor(i.callId));
    if (i.kind === 'hours.set')
      void this.getWorkingHours()
        .then((h) => this.events.emit('workingHours', h))
        .catch(() => undefined);
    if (
      i.kind === 'profile.update' ||
      i.kind.startsWith('avatar.') ||
      i.kind === 'status.set' ||
      i.kind === 'dnd.set'
    )
      void this.sync.rederiveDirectory().then(() => this.events.emit('profile', null));
  }

  /**
   * Reconciles the cached lists with the server after a reconnect, once queued changes are
   * sent, so a phone that was offline shows what changed elsewhere. One run at a time.
   */
  refreshWork(): Promise<void> {
    if (!this.online) return Promise.resolve();
    if (this.inNetwork)
      // Only saved messages exist in the network; the rest is organization-only.
      return this.listBookmarks().then(
        () => undefined,
        () => undefined,
      );
    this.workRun ??= (async () => {
      try {
        await Promise.allSettled([
          this.listTasks({ scope: 'mine', status: 'active' }),
          this.listTasks({ scope: 'created', status: 'active' }),
          this.listApprovals({ scope: 'to_decide', status: 'pending' }),
          this.listApprovals({ scope: 'requested', status: 'pending' }),
          this.listScheduled(),
          this.listBookmarks(),
          this.listBookingPages(),
          this.refreshRecentSearches(),
          this.refreshWorkingHours(),
          this.refreshChatTheme(),
          this.refreshMessageEditing(),
          this.refreshGreetingPolicy(),
          this.refreshCallBackground(),
          this.refreshInbox(null),
        ]);
        this.events.emit('work', { kind: 'task' });
        this.events.emit('work', { kind: 'approval' });
        this.events.emit('scheduled', null);
        this.events.emit('booking', null);
      } finally {
        this.workRun = null;
      }
    })();
    return this.workRun;
  }

  // ------------------------------------------------------------------ Client Inbox
  //
  // Lists and conversations are cached by API path so the inbox opens offline. Replies, notes,
  // field changes and read marks are saved here first and sent in order (db/work.ts); the
  // server's copy wins once they land. `inbox:changed` and reconnects re-read what is cached.

  /** The cached copy of an inbox list or conversation (shown at once, and offline). */
  async inboxCached<T>(path: string): Promise<T | undefined> {
    const raw = await this.store.getSetting(inboxKey(path));
    return raw ? (JSON.parse(raw) as T) : undefined;
  }

  /**
   * Reads an inbox path from the server and caches it; offline it keeps the cached copy.
   * Throws when the server refuses (no access, gone), so the screen can say why.
   */
  async inboxLoad<T>(path: string): Promise<T | undefined> {
    // Searches are not kept: every query would leave a copy behind.
    const keep = !/[?&]q=/.test(path);
    if (this.online) {
      try {
        const value = await this.api.inbox<T>('GET', path);
        if (!keep) return value;
        await this.store.setSetting(inboxKey(path), JSON.stringify(value));
      } catch (err) {
        if (err instanceof TransportError) {
          if (err.isAuth) void this.handleAuthError(err);
          if (err.code === 'NOT_FOUND' || err.code === 'FORBIDDEN')
            await this.store.deleteSetting(inboxKey(path));
          if (err.kind !== 'network' && !err.retryable) throw err;
        }
      }
    }
    return keep ? this.inboxCached<T>(path) : undefined;
  }

  /** Inbox changes made here that have not reached the server yet (refused posts too). */
  inboxPending(): Promise<PendingInbox> {
    return this.store.work.pendingInbox();
  }

  private async inboxQueue(input: ActionInput & { inboxId: string }): Promise<void> {
    await this.queue(input);
    this.events.emit('inbox', { conversationId: input.inboxId });
  }

  /** A reply to the client. Saved here first; the server sends it on through the channel. */
  inboxReply(inboxId: string, text: string, templateId?: string): Promise<void> {
    return this.inboxQueue({
      kind: 'inbox.reply',
      inboxId,
      clientMessageId: uuidv7(),
      text: text.trim(),
      ...(templateId ? { templateId } : {}),
    });
  }

  /** An internal note: only agents see it, and it is never sent to the client. */
  inboxNote(inboxId: string, text: string, mentions: string[] = []): Promise<void> {
    return this.inboxQueue({
      kind: 'inbox.note',
      inboxId,
      clientNoteId: uuidv7(),
      text: text.trim(),
      mentions,
    });
  }

  /** Status, priority, assignee, team, tags, subject or snooze; the latest choice wins. */
  inboxUpdate(inboxId: string, patch: UpdateInboxConversationRequest): Promise<void> {
    return this.inboxQueue({ kind: 'inbox.update', inboxId, patch });
  }

  /** Marks it read for you on all your devices (personal to each agent). */
  inboxMarkRead(inboxId: string): Promise<void> {
    if (this.session.state === 'demo') return Promise.resolve();
    return this.inboxQueue({ kind: 'inbox.read', inboxId });
  }

  async inboxRetry(actionId: string): Promise<void> {
    await this.store.work.retryAction(actionId);
    this.events.emit('inbox', { conversationId: null });
    void this.outbox.kick();
  }

  async inboxDiscard(actionId: string): Promise<void> {
    await this.store.work.discardAction(actionId);
    this.events.emit('inbox', { conversationId: null });
  }

  /**
   * Inbox changes the server has to decide on the spot (escalate, link a record, log a
   * handoff message, start a handoff conversation, retry a delivery, channel admin). They need
   * a connection; everyone who can see the conversation gets `inbox:changed`.
   */
  inboxServer<T>(
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    inboxId: string | null = null,
  ): Promise<T> {
    return this.serverAction(async () => {
      const r = await this.api.inbox<T>(method, path, body);
      const d = r as unknown as InboxConversationDetail | undefined;
      const id = inboxId ?? d?.conversation?.conversationId ?? null;
      if (id && d?.conversation?.conversationId === id)
        await this.store.setSetting(inboxKey(inboxDetailPath(id)), JSON.stringify(d));
      await this.refreshInbox(id);
      return r;
    });
  }

  /**
   * Inbox settings as saved on this phone: the server's copy, or the one waiting to be sent.
   * Owners and admins can change them offline; the latest save wins.
   */
  async inboxSettings(): Promise<InboxSettings | undefined> {
    return (
      (await this.store.work.pendingInboxSettings()) ??
      (await this.inboxCached<InboxSettings>('/v1/inbox/settings'))
    );
  }

  async saveInboxSettings(settings: InboxSettings): Promise<void> {
    await this.queue({ kind: 'inbox.settings', settings });
    this.events.emit('inbox', { conversationId: null });
  }

  /**
   * Channels, templates and settings changed (here, on another device or by another admin):
   * re-read the ones on this phone, then tell the screens.
   */
  async refreshInboxAdmin(): Promise<void> {
    if (this.inNetwork) return;
    if (this.online) {
      const keys = (await this.store.settingKeys(INBOX_PREFIX))
        .map((k) => k.slice(INBOX_PREFIX.length))
        .filter((p) => !p.startsWith('/v1/inbox/conversations'));
      await Promise.allSettled(keys.map((p) => this.inboxLoad(p)));
    }
    this.events.emit('inbox', { conversationId: null });
  }

  /**
   * Re-reads the cached inbox lists and this conversation (every cached one when null), then
   * tells the screens. Runs on `inbox:changed`, after each queued change and on reconnect.
   */
  async refreshInbox(conversationId: string | null = null): Promise<void> {
    if (this.inNetwork) return;
    if (this.online) {
      const keys = (await this.store.settingKeys(INBOX_PREFIX)).map((k) =>
        k.slice(INBOX_PREFIX.length),
      );
      const detail = conversationId ? inboxDetailPath(conversationId) : null;
      await Promise.allSettled(
        keys
          .filter(
            (p) =>
              !detail ||
              p === detail ||
              p === '/v1/inbox/conversations' ||
              p.startsWith('/v1/inbox/conversations?'),
          )
          .map((p) => this.inboxLoad(p)),
      );
    }
    this.events.emit('inbox', { conversationId });
  }

  // ------------------------------------------------------------------ SampConnect Network

  // ------------------------------------------------------------ Help center questions

  /** The cached copy of a Help center list or question (shown at once, and offline). */
  async supportCached<T>(path: string): Promise<T | undefined> {
    const raw = await this.store.getSetting(supportKey(path));
    return raw ? (JSON.parse(raw) as T) : undefined;
  }

  /** Reads a Help center path from the server and caches it; offline it keeps the cached copy. */
  async supportLoad<T>(path: string): Promise<T | undefined> {
    if (this.online) {
      try {
        const value = await this.api.support<T>('GET', path);
        await this.store.setSetting(supportKey(path), JSON.stringify(value));
      } catch (err) {
        if (err instanceof TransportError && (err.code === 'NOT_FOUND' || err.code === 'FORBIDDEN'))
          await this.store.deleteSetting(supportKey(path));
      }
    }
    return this.supportCached<T>(path);
  }

  /** Queues a question, reply or status change; it sends in order when possible. */
  async supportAct(input: Omit<Extract<ActionInput, { kind: 'support.act' }>, 'kind'>) {
    await this.queue({ kind: 'support.act', ...input });
    this.events.emit('support', { queryId: null });
  }

  supportPending(): Promise<Extract<ActionInput, { kind: 'support.act' }>[]> {
    return this.store.work.pendingSupport();
  }

  /** Re-reads every cached Help center path (after a live change, a send or a reconnect). */
  async refreshSupport(queryId: string | null = null): Promise<void> {
    const keys = await this.store.settingKeys(SUPPORT_PREFIX);
    await Promise.allSettled(keys.map((k) => this.supportLoad(k.slice(SUPPORT_PREFIX.length))));
    this.events.emit('support', { queryId });
  }

  /** True when this workspace is SampConnect Network (a personal account, or the linked space). */
  get inNetwork(): boolean {
    return isNetworkTenant(this.session.current);
  }

  /** The cached copy of a network list or profile (shown at once, and offline). */
  async netCached<T>(path: string): Promise<T | undefined> {
    const raw = await this.store.getSetting(netKey(path));
    return raw ? (JSON.parse(raw) as T) : undefined;
  }

  /**
   * Reads a network path from the server and caches it; offline (or refused) it keeps the
   * cached copy. Returns what is cached afterwards.
   */
  async netLoad<T>(path: string): Promise<T | undefined> {
    if (this.online) {
      try {
        const value = await this.api.network<T>('GET', path);
        await this.store.setSetting(netKey(path), JSON.stringify(value));
      } catch (err) {
        if (err instanceof TransportError && err.code === 'NOT_FOUND')
          await this.store.deleteSetting(netKey(path));
      }
    }
    return this.netCached<T>(path);
  }

  /** Search needs the server (people choose who can find them); it is not cached. */
  netSearch<T>(q: string): Promise<T> {
    return this.serverAction(() =>
      this.api.network<T>('GET', `/v1/network/search?q=${encodeURIComponent(q.trim())}`),
    );
  }

  /**
   * Queues a network change and sends it when possible, in the order made. Every device and
   * the other person see it through `network:changed` once it lands.
   */
  async netAct(input: Omit<Extract<ActionInput, { kind: 'net.act' }>, 'kind'>): Promise<void> {
    await this.queue({ kind: 'net.act', ...input });
    this.events.emit('network', { scope: null });
  }

  /** Network changes made here that have not reached the server yet. */
  netPending(): Promise<Extract<ActionInput, { kind: 'net.act' }>[]> {
    return this.store.work.pendingNetwork();
  }

  /**
   * Re-reads the cached network paths of these scopes (all of them after a reconnect), then
   * tells the screens. `scope` is what the server said changed.
   */
  async refreshNetwork(
    scopes: readonly NetworkScope[] = NETWORK_SCOPES,
    scope: NetworkScope | null = null,
  ): Promise<void> {
    if (!this.inNetwork) return;
    const keys = await this.store.settingKeys(NET_PREFIX);
    await Promise.allSettled(
      keys
        .map((k) => k.slice(NET_PREFIX.length))
        .filter((p) => pathInScopes(p, scopes))
        .map((p) => this.netLoad(p)),
    );
    // Screens re-read the cache (and load what they show that was never cached).
    this.events.emit('network', { scope });
  }

  // ------------------------------------------------------------ administration (owners, admins)

  /** Everyone in the organization with role and status (fresh from the server). */
  listMembers(): Promise<DirectoryUser[]> {
    return this.serverAction(() => this.api.listUsers());
  }

  adminOverview(): Promise<AdminOverview> {
    return this.serverAction(() => this.api.adminOverview());
  }

  auditLog(q: AuditQuery): Promise<AuditPage> {
    return this.serverAction(() => this.api.auditLog(q));
  }

  /** Adds a member; the plan's seat limit can refuse it (409 with the reason). */
  inviteMember(req: InviteMemberRequest): Promise<UserSummary> {
    return this.serverAction(async () => {
      const u = await this.api.inviteMember(req);
      this.events.emit('members', u);
      void this.runSync();
      return u;
    });
  }

  updateMember(
    userId: string,
    patch: { role?: 'admin' | 'member' | 'guest'; status?: 'active' | 'deactivated' },
  ): Promise<UserSummary> {
    return this.serverAction(async () => {
      const u = await this.api.updateMember(userId, patch);
      this.events.emit('members', u);
      void this.runSync();
      return u;
    });
  }

  resetMemberMfa(userId: string): Promise<void> {
    return this.serverAction(() => this.api.resetMemberMfa(userId));
  }

  resetMemberPassword(userId: string, temporaryPassword: string) {
    return this.serverAction(() => this.api.resetMemberPassword(userId, temporaryPassword));
  }

  changePassword(currentPassword: string, newPassword: string) {
    return this.serverAction(() => this.api.changePassword(currentPassword, newPassword));
  }

  listAllDevices(): Promise<DeviceSession[]> {
    return this.serverAction(() => this.api.listAllDevices());
  }

  /** Sign any device out (admins); the server checks. */
  revokeAnyDevice(sessionId: string): Promise<void> {
    return this.serverAction(() => this.api.revokeDevice(sessionId));
  }

  // ------------------------------------------------------------ white-label branding

  getBranding(): Promise<BrandingView> {
    return this.serverAction(() => this.api.getBranding());
  }

  /** Owners only; the server checks. Emits `branding` so the theme updates at once. */
  saveBranding(input: BrandingInput): Promise<BrandingView> {
    return this.serverAction(async () => {
      const v = await this.api.saveBranding(input);
      this.events.emit('branding', v);
      return v;
    });
  }

  // ------------------------------------------------------------ private AI assistant
  // Kept on the server and optional: failures stay in the screen that asked (docs/ai.md).

  aiStatus(): Promise<AiStatus> {
    return this.serverAction(() => this.api.aiStatus());
  }

  setAiEnabled(enabled: boolean): Promise<AiStatus> {
    return this.serverAction(() => this.api.setAiEnabled(enabled));
  }

  aiSummarize(conversationId: string, range: SummaryRange): Promise<AiSummary> {
    return this.serverAction(() => this.api.aiSummarize(conversationId, range));
  }

  aiSummarizeMeeting(meetingId: string): Promise<AiMeetingSummary> {
    return this.serverAction(() => this.api.aiSummarizeMeeting(meetingId));
  }

  aiReplies(conversationId: string): Promise<AiSuggestedReplies> {
    return this.serverAction(() => this.api.aiReplies(conversationId));
  }

  aiSearch(req: AiSearchRequest): Promise<AiSearchResponse> {
    return this.serverAction(() => this.api.aiSearch(req));
  }

  aiAsk(req: AiAskRequest): Promise<AiAskResponse> {
    return this.serverAction(() => this.api.aiAsk(req));
  }

  aiTranslate(messageId: string, targetLanguage: string): Promise<AiTranslation> {
    return this.serverAction(() => this.api.aiTranslate(messageId, targetLanguage));
  }

  aiDigest(req: AiDigestRequest): Promise<AiDigest> {
    return this.serverAction(() => this.api.aiDigest(req));
  }

  /**
   * Share AI text in a conversation: the server drafts it, and it is sent only when the person
   * confirms (sensitive drafts need `acknowledgeRisk`). The message arrives through sync.
   */
  aiPropose(conversationId: string, text: string): Promise<AiProposal> {
    return this.serverAction(() => this.api.aiPropose(conversationId, text));
  }

  aiConfirm(proposalId: string, req: ConfirmAiProposalRequest): Promise<AiProposal> {
    return this.serverAction(async () => {
      const p = await this.api.aiConfirm(proposalId, req);
      void this.runSync();
      return p;
    });
  }

  aiDismiss(proposalId: string): Promise<AiProposal> {
    return this.serverAction(() => this.api.aiDismiss(proposalId));
  }

  aiTranscript(attachmentId: string, queue = false): Promise<AiTranscript> {
    return this.serverAction(() => this.api.aiTranscript(attachmentId, queue));
  }

  /** Forwarding out of a private channel or group on or off (owners and moderators). */
  setForwarding(conversationId: string, allowed: boolean): Promise<void> {
    return this.serverAction(async () => {
      await this.store.upsertConversations([await this.api.setForwarding(conversationId, allowed)]);
    });
  }

  /** Announcement channel on or off (channel owners and moderators). */
  setPostingPolicy(conversationId: string, policy: PostingPolicy): Promise<void> {
    return this.serverAction(async () => {
      await this.store.upsertConversations([
        await this.api.setPostingPolicy(conversationId, policy),
      ]);
    });
  }

  /** Administration → SampConnect Network: the policy view, with `canModerate` for operators. */
  networkAdmin(): Promise<NetworkAdminView> {
    return this.serverAction(() => this.api.networkAdmin());
  }

  /** Platform operators: review reports and suspensions. Each action needs the server. */
  moderationQueue(status: ReportStatus): Promise<ModerationQueue> {
    return this.serverAction(() => this.api.moderationQueue(status));
  }

  moderationAct(reportId: string, action: ModerationActionKind, note: string) {
    return this.serverAction(() =>
      this.api.moderationAct(reportId, { clientActionId: uuidv7(), action, note }),
    );
  }

  /** Super admin console: needs the server (idempotent where it matters), never queued. */
  platform<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    return this.serverAction(() => this.api.platformRequest<T>(method, path, body));
  }

  networkSuspensions(): Promise<NetworkSuspensions> {
    return this.serverAction(() => this.api.networkSuspensions());
  }

  restoreSuspension(kind: 'users' | 'communities', id: string): Promise<void> {
    return this.serverAction(() => this.api.restoreSuspension(kind, id));
  }

  /** Administration, Integrations. All need a connection; secrets never come back. */
  listIntegrations(): Promise<IntegrationView[]> {
    return this.serverAction(() => this.api.listIntegrations());
  }

  saveIntegration(
    id: string,
    enabled: boolean,
    values: IntegrationValues,
  ): Promise<IntegrationView> {
    return this.serverAction(() => this.api.saveIntegration(id, enabled, values));
  }

  testIntegration(id: string, values?: IntegrationValues): Promise<IntegrationTestResult> {
    return this.serverAction(() => this.api.testIntegration(id, values));
  }

  resetIntegration(id: string): Promise<IntegrationView> {
    return this.serverAction(() => this.api.resetIntegration(id));
  }

  private async serverAction<T>(run: () => Promise<T>): Promise<T> {
    const blocked = this.serverActionBlocker();
    if (blocked) throw new Error(blocked);
    try {
      return await run();
    } catch (err) {
      if (err instanceof TransportError) {
        if (err.isAuth) void this.handleAuthError(err);
        if (err.kind === 'network') throw new Error('Could not reach the server. Try again.');
        if (err.code === 'FORBIDDEN') throw new Error('You do not have permission to do that.');
      }
      throw err;
    }
  }

  /** Starts a DM, group or channel and returns its id (an existing DM is reused). */
  createConversation(req: CreateConversationRequest): Promise<string> {
    return this.serverAction(async () => {
      const c = await this.api.createConversation(req);
      // The server adds your open sockets to its room, so live events start at once.
      await this.store.upsertConversations([c]);
      return c.conversationId;
    });
  }

  /**
   * Makes sure a conversation you were just added to elsewhere (a community group) is on the
   * phone before it opens. False when it is not here yet and there is no connection.
   */
  async ensureConversation(conversationId: string): Promise<boolean> {
    if (await this.store.getConversation(conversationId)) return true;
    if (!this.online) return false;
    try {
      await this.store.upsertConversations([await this.api.getConversation(conversationId)]);
      return true;
    } catch {
      return false;
    }
  }

  /** Joins a public channel you could already read. */
  joinChannel(conversationId: string): Promise<void> {
    return this.serverAction(async () => {
      await this.store.upsertConversations([await this.api.joinConversation(conversationId)]);
      void this.resume();
    });
  }

  addMembers(conversationId: string, userIds: readonly string[]): Promise<void> {
    return this.serverAction(async () => {
      await this.store.upsertConversations([await this.api.addMembers(conversationId, userIds)]);
    });
  }

  /** Removes someone, or leaves when it is you (the local copy is then removed). */
  removeMember(conversationId: string, userId: string): Promise<void> {
    return this.serverAction(async () => {
      await this.api.removeMember(conversationId, userId);
      if (userId === this.store.selfUserId) {
        await this.store.purgeConversations([conversationId]);
        void this.resume(); // a public channel comes back as readable, not joined
      } else {
        await this.store.upsertConversations([await this.api.getConversation(conversationId)]);
      }
    });
  }

  setArchived(conversationId: string, archived: boolean): Promise<void> {
    return this.serverAction(async () => {
      await this.store.upsertConversations([await this.api.setArchived(conversationId, archived)]);
    });
  }

  listDevices(): Promise<DeviceSession[]> {
    return this.serverAction(() => this.api.listDevices());
  }

  revokeDevice(sessionId: string): Promise<void> {
    return this.serverAction(() => this.api.revokeDevice(sessionId));
  }

  /**
   * Ends this device session on the server before local data is wiped, so the refresh token
   * and push token stop working. Best effort: offline, the session simply expires.
   */
  async logoutServer(): Promise<void> {
    if (this.session.state !== 'active' || !this._state.networkUp) return;
    try {
      await this.api.logout();
    } catch {
      // already revoked or unreachable
    }
  }

  // ------------------------------------------------------------------------- meetings

  /** The window kept on the phone: the last week and the next eight. */
  static meetingWindow(now = Date.now()): { from: string; to: string } {
    return {
      from: new Date(now - 7 * 86_400_000).toISOString(),
      to: new Date(now + 55 * 86_400_000).toISOString(),
    };
  }

  /** Reloads your meetings for the cached window. One run at a time. */
  refreshMeetings(): Promise<void> {
    if (!this._state.networkUp || this.session.state !== 'active') return Promise.resolve();
    this.meetingsRun ??= (async () => {
      try {
        const { from, to } = ConnectEngine.meetingWindow();
        await this.store.replaceMeetings(from, to, await this.api.listMeetings(from, to));
      } catch (err) {
        if (err instanceof TransportError && err.isAuth) void this.handleAuthError(err);
        // Otherwise keep the cached copy; the next resume tries again.
      } finally {
        this.meetingsRun = null;
      }
    })();
    return this.meetingsRun;
  }

  /** Answers an invitation. Works offline: the answer shows at once and is sent when possible. */
  async rsvp(
    meetingId: string,
    response: Exclude<RsvpResponse, 'pending'>,
    scope: SeriesScope = 'occurrence',
  ): Promise<void> {
    if (this.session.state === 'demo') return this.store.applyLocalRsvp(meetingId, response, scope);
    await this.store.setRsvpLocally(meetingId, response, scope);
    await this.flushRsvps();
  }

  private flushRsvps(): Promise<void> {
    const run = (this.rsvpRun ?? Promise.resolve()).then(() => this.sendRsvps());
    const tracked = run.finally(() => {
      if (this.rsvpRun === tracked) this.rsvpRun = null;
    });
    this.rsvpRun = tracked;
    return tracked;
  }

  private async sendRsvps(): Promise<void> {
    if (!this._state.networkUp || this.session.state !== 'active') return;
    for (const p of await this.store.pendingRsvps()) {
      try {
        await this.store.upsertMeetings([await this.api.rsvp(p.meetingId, p.response, p.scope)]);
        // The other meetings of the series changed on the server too.
        if (p.scope === 'series') {
          await this.store.settleRsvp(p);
          void this.refreshMeetings();
          continue;
        }
      } catch (err) {
        if (!(err instanceof TransportError) || err.kind === 'network') return;
        if (err.isAuth) return void this.handleAuthError(err);
        if (err.retryable) return;
        // Refused for good (cancelled, or no longer invited): fall back to the server's copy.
      }
      await this.store.settleRsvp(p);
    }
  }

  /** Schedules a meeting. Needs the server: it creates the meeting chat and invites people. */
  createMeeting(req: CreateMeetingRequest): Promise<Meeting> {
    return this.serverAction(async () => {
      const m = await this.api.createMeeting(req);
      await this.store.upsertMeetings([m]);
      void this.resume(); // a new meeting chat syncs in
      return m;
    });
  }

  /** Organizer only. Moving the time resets everyone's answers. */
  updateMeeting(meetingId: string, req: UpdateMeetingRequest): Promise<Meeting> {
    return this.serverAction(async () => {
      const m = await this.api.updateMeeting(meetingId, req);
      await this.store.upsertMeetings([m]);
      // A series change recreates or edits the other upcoming meetings too.
      if (req.scope === 'series') void this.refreshMeetings();
      return m;
    });
  }

  /** `scope: 'series'` cancels this and every later meeting of a recurring series. */
  cancelMeeting(meetingId: string, scope: SeriesScope = 'occurrence'): Promise<void> {
    return this.serverAction(async () => {
      await this.store.upsertMeetings([await this.api.cancelMeeting(meetingId, scope)]);
      if (scope === 'series') void this.refreshMeetings();
    });
  }

  /** Slots where everyone is in working hours and free (busy times come without titles). */
  findTimes(req: FindTimesRequest): Promise<FindTimesResponse> {
    return this.serverAction(() => this.api.findTimes(req));
  }

  /**
   * Your working hours: your unsent change, else the copy on this phone, else the server's.
   * Kept on the phone so the screen opens offline; follows changes made on other devices.
   */
  async getWorkingHours(): Promise<WorkingHours> {
    const pending = await this.store.work.pendingWorkingHours();
    if (pending) return pending;
    const raw = await this.store.getSetting(HOURS_KEY);
    if (raw) return JSON.parse(raw) as WorkingHours;
    return this.serverAction(() => this.refreshWorkingHours());
  }

  /** Saves your working hours. Works offline: shown at once, sent when you reconnect. */
  async setWorkingHours(hours: WorkingHours): Promise<WorkingHours> {
    if (this.session.state === 'demo')
      await this.store.setSetting(HOURS_KEY, JSON.stringify(hours));
    else await this.queue({ kind: 'hours.set', hours });
    this.events.emit('workingHours', hours);
    return hours;
  }

  private async refreshWorkingHours(): Promise<WorkingHours> {
    const hours = await this.api.getWorkingHours();
    await this.store.setSetting(HOURS_KEY, JSON.stringify(hours));
    this.events.emit('workingHours', (await this.store.work.pendingWorkingHours()) ?? hours);
    return hours;
  }

  /**
   * Your chat theme: the server's copy on this phone with your unsent pick laid over it, so
   * conversations look right offline. Null before the first load with no connection.
   */
  async getChatTheme(): Promise<ChatThemeState | null> {
    const raw = await this.store.getSetting(THEME_KEY);
    const saved = raw ? (JSON.parse(raw) as ChatThemeState) : null;
    const pending = await this.store.work.pendingChatTheme();
    if (!saved) {
      if (!pending) return null;
      const policy: ChatThemePolicy = { defaultThemeId: 'default', allowed: null };
      return {
        themeId: pending.themeId,
        policy,
        effective: effectiveChatTheme(pending.themeId, policy),
      };
    }
    if (!pending) return saved;
    return {
      ...saved,
      themeId: pending.themeId,
      effective: effectiveChatTheme(pending.themeId, saved.policy),
    };
  }

  /** Picks a chat theme (null: the organization default). Works offline; follows you to every device. */
  async setChatTheme(themeId: ChatThemeId | null): Promise<void> {
    if (this.session.state === 'demo') {
      const cur = await this.getChatTheme();
      const policy = cur?.policy ?? { defaultThemeId: 'default', allowed: null };
      await this.store.setSetting(
        THEME_KEY,
        JSON.stringify({ themeId, policy, effective: effectiveChatTheme(themeId, policy) }),
      );
    } else await this.queue({ kind: 'theme.set', themeId });
    await this.emitChatTheme();
  }

  /** Owners and admins: the organization default and which themes people may choose. */
  async setChatThemePolicy(policy: ChatThemePolicy): Promise<void> {
    const state = await this.serverAction(() => this.api.setChatThemePolicy(policy));
    await this.store.setSetting(THEME_KEY, JSON.stringify(state));
    await this.emitChatTheme();
  }

  // ------------------------------------------------------------ message editing rules

  /**
   * The organization's editing rules as last seen (kept on the phone so Edit shows or hides
   * correctly offline). The server checks them again when a queued edit is sent.
   */
  async getMessageEditing(): Promise<MessageEditingState> {
    const raw = await this.store.getSetting(EDITING_KEY);
    return raw ? (JSON.parse(raw) as MessageEditingState) : DEFAULT_MESSAGE_EDITING_STATE;
  }

  /** Owners and admins: turn editing on or off, set a time limit, choose who sees history. */
  async setMessageEditing(policy: MessageEditingPolicy): Promise<void> {
    const state = await this.serverAction(() => this.api.setMessageEditing(policy));
    await this.store.setSetting(EDITING_KEY, JSON.stringify(state));
    this.events.emit('messageEditing', state);
  }

  /** Every version of an edited message (needs a connection). */
  messageHistory(messageId: string): Promise<MessageEditHistory> {
    return this.serverAction(() => this.api.messageHistory(messageId));
  }

  private async refreshMessageEditing(): Promise<void> {
    if (this.session.state === 'demo') return;
    const state = await this.api.getMessageEditing();
    await this.store.setSetting(EDITING_KEY, JSON.stringify(state));
    this.events.emit('messageEditing', state);
  }

  /** Greeting card rules as last seen (cached for offline use). */
  async getGreetingPolicy(): Promise<GreetingPolicy> {
    const raw = await this.store.getSetting(GREETING_KEY);
    const r = GreetingPolicySchema.safeParse(raw ? JSON.parse(raw) : {});
    return r.success ? r.data : DEFAULT_GREETING_POLICY;
  }

  /** Owners and admins: turn greeting cards on or off, or hide categories. Needs a connection. */
  async setGreetingPolicy(policy: GreetingPolicy): Promise<void> {
    const r = await this.serverAction(() => this.api.setGreetingPolicy(policy));
    await this.store.setSetting(GREETING_KEY, JSON.stringify(r.policy));
    this.events.emit('greetingPolicy', r.policy);
  }

  private async refreshGreetingPolicy(): Promise<void> {
    const r = await this.api.getGreetingPolicy();
    await this.store.setSetting(GREETING_KEY, JSON.stringify(r.policy));
    this.events.emit('greetingPolicy', r.policy);
  }

  private async refreshChatTheme(): Promise<void> {
    const state = await this.api.getChatTheme();
    await this.store.setSetting(THEME_KEY, JSON.stringify(state));
    await this.emitChatTheme();
  }

  // ------------------------------------------------------------ minutes of meeting

  /** What the apps should offer (templates, languages, export rule). Cached for offline use. */
  async minutesConfig(): Promise<MinutesConfig | null> {
    if (this.online) await this.refreshMinutesConfig().catch(() => undefined);
    const raw = await this.store.getSetting(MINUTES_CONFIG_KEY);
    return raw ? (JSON.parse(raw) as MinutesConfig) : null;
  }

  private async refreshMinutesConfig(): Promise<void> {
    await this.store.setSetting(MINUTES_CONFIG_KEY, JSON.stringify(await this.api.minutesConfig()));
  }

  /**
   * The minutes of a call as last seen on this phone, with edits not sent yet laid over them.
   * Null when this phone has never loaded them.
   */
  async getCallMinutes(callId: string): Promise<CallMinutesResponse | null> {
    const raw = await this.store.getSetting(minutesKey(callId));
    if (!raw) return null;
    const r = JSON.parse(raw) as CallMinutesResponse;
    if (!r.minutes) return r;
    const pending = await this.store.work.pendingMinutes(r.minutes.minutesId);
    return pending ? { ...r, minutes: { ...r.minutes, ...pending } } : r;
  }

  /** Fetches the minutes of a call when online and emits `minutes`. */
  async reloadCallMinutes(callId: string): Promise<void> {
    if (this.online) await this.refreshCallMinutes(callId);
  }

  private async refreshCallMinutes(callId: string): Promise<void> {
    const r = await this.api.callMinutes(callId);
    await this.store.setSetting(minutesKey(callId), JSON.stringify(r));
    if (r.minutes) await this.rememberInList(r.minutes);
    await this.emitMinutesFor(callId);
  }

  /** Minutes made for calls in a conversation (newest first); cached for offline reading. */
  async listMinutes(conversationId: string): Promise<MeetingMinutes[]> {
    if (this.online) {
      try {
        const items = await this.api.listMinutes(conversationId);
        await this.store.setSetting(minutesListKey(conversationId), JSON.stringify(items));
        return items;
      } catch {
        // fall back to the copy on this phone
      }
    }
    const raw = await this.store.getSetting(minutesListKey(conversationId));
    return raw ? (JSON.parse(raw) as MeetingMinutes[]) : [];
  }

  /** Makes the draft (or writes it again from the sources). Needs a connection. */
  async generateMinutes(callId: string, language: string, regenerate = false): Promise<void> {
    const m = await this.serverAction(() =>
      this.api.generateMinutes(callId, { language, regenerate }),
    );
    await this.saveMinutes(m);
  }

  /**
   * Edits fields of the minutes. Shows at once and works offline; edits merge per field, and a
   * field someone else changed meanwhile is refused with their version shown.
   */
  async editMinutes(m: MeetingMinutes, patch: MinutesPatch): Promise<void> {
    const raw = await this.store.getSetting(minutesKey(m.callId));
    const base = raw ? (JSON.parse(raw) as CallMinutesResponse).minutes : null;
    await this.queue({
      kind: 'minutes.update',
      minutesId: m.minutesId,
      callId: m.callId,
      baseRevision: base?.revision ?? m.revision,
      patch,
    });
    await this.emitMinutesFor(m.callId);
  }

  async shareMinutes(m: MeetingMinutes): Promise<void> {
    await this.saveMinutes(await this.serverAction(() => this.api.shareMinutes(m.minutesId)));
  }

  async deleteMinutes(m: MeetingMinutes): Promise<void> {
    await this.serverAction(() => this.api.deleteMinutes(m.minutesId));
    await this.refreshCallMinutes(m.callId).catch(() => undefined);
    await this.dropFromList(m);
  }

  /** Downloads the minutes as PDF or Word; returns the file on this device. */
  downloadMinutes(m: MeetingMinutes, q: MinutesDocumentQuery): Promise<string> {
    const ext = q.format === 'docx' ? 'docx' : 'pdf';
    const name = documentFileName('Minutes', m.title, new Date(m.startedAt), ext);
    return this.serverAction(() => this.api.downloadMinutes(m.minutesId, q, name));
  }

  chatExportAccess(conversationId: string): Promise<ChatExportAccess> {
    return this.serverAction(() => this.api.chatExportAccess(conversationId));
  }

  /** Downloads the conversation as PDF, Word or text; returns the file on this device. */
  exportChat(conversationId: string, title: string, req: ChatExportRequest): Promise<string> {
    const name = documentFileName('Chat', title, new Date(), req.format ?? 'pdf');
    return this.serverAction(() => this.api.exportChat(conversationId, req, name));
  }

  private async receiveMinutes(e: MinutesChangedEvent): Promise<void> {
    if (await this.store.getSetting(minutesKey(e.callId)))
      await this.refreshCallMinutes(e.callId).catch(() => undefined);
    else this.events.emit('minutes', { callId: e.callId, conversationId: e.conversationId });
  }

  private async saveMinutes(m: MeetingMinutes): Promise<void> {
    const raw = await this.store.getSetting(minutesKey(m.callId));
    const prev = raw ? (JSON.parse(raw) as CallMinutesResponse) : null;
    await this.store.setSetting(
      minutesKey(m.callId),
      JSON.stringify({ canCreate: prev?.canCreate ?? true, blockedReason: null, minutes: m }),
    );
    await this.rememberInList(m);
    await this.emitMinutesFor(m.callId);
  }

  private async rememberInList(m: MeetingMinutes): Promise<void> {
    const key = minutesListKey(m.conversationId);
    const raw = await this.store.getSetting(key);
    const list = raw ? (JSON.parse(raw) as MeetingMinutes[]) : [];
    const next = [m, ...list.filter((x) => x.minutesId !== m.minutesId)].sort((a, b) =>
      b.startedAt.localeCompare(a.startedAt),
    );
    await this.store.setSetting(key, JSON.stringify(next));
  }

  private async dropFromList(m: MeetingMinutes): Promise<void> {
    const key = minutesListKey(m.conversationId);
    const raw = await this.store.getSetting(key);
    if (!raw) return;
    const list = (JSON.parse(raw) as MeetingMinutes[]).filter((x) => x.minutesId !== m.minutesId);
    await this.store.setSetting(key, JSON.stringify(list));
    this.events.emit('minutes', { callId: m.callId, conversationId: m.conversationId });
  }

  private async emitMinutesFor(callId: string): Promise<void> {
    const r = await this.getCallMinutes(callId);
    this.events.emit('minutes', { callId, conversationId: r?.minutes?.conversationId ?? '' });
  }

  // ------------------------------------------------------------ recording transcripts

  /**
   * The organization's speech-to-text setup (null: never loaded). Refreshed when online and kept
   * for offline use, so the Transcript button shows on clips you can already read offline.
   */
  async transcriptionSettings(): Promise<TranscriptionSettings | null> {
    // Every clip on screen asks, so ask the server at most once a minute.
    if (this.online && Date.now() - this.transcriptionCheckedAt > 60_000) {
      this.transcriptionCheckedAt = Date.now();
      this.transcriptionFetch = this.api
        .aiStatus()
        .then((s) =>
          this.store.setSetting(
            TRANSCRIPTION_KEY,
            JSON.stringify(s.enabled ? s.transcription : { ...s.transcription, configured: false }),
          ),
        )
        .catch(() => undefined); // keep the copy on this phone
    }
    await this.transcriptionFetch;
    const raw = await this.store.getSetting(TRANSCRIPTION_KEY);
    return raw ? (JSON.parse(raw) as TranscriptionSettings) : null;
  }

  private transcriptionCheckedAt = 0;
  private transcriptionFetch: Promise<void> = Promise.resolve();

  /** A transcript as last seen on this phone, with corrections not sent yet laid over it. */
  async getTranscript(attachmentId: string): Promise<AiTranscript | null> {
    const raw = await this.store.getSetting(transcriptKey(attachmentId));
    if (!raw) return null;
    const t = JSON.parse(raw) as AiTranscript;
    const original = await this.store.work.pendingTranscript(attachmentId, null);
    const translations: Record<string, TranscriptPatch> = {};
    for (const x of t.translations) {
      const p = await this.store.work.pendingTranscript(attachmentId, x.language);
      if (p) translations[x.language] = p;
    }
    if (!original && !Object.keys(translations).length) return t;
    return withPendingTranscript(
      t,
      { original, translations },
      this.store.selfUserId,
      new Date().toISOString(),
    );
  }

  /**
   * Fetches the transcript when online (and asks for one when `request` and there is none yet
   * or the last try failed), then returns what this phone has.
   */
  async loadTranscript(attachmentId: string, request = false): Promise<AiTranscript | null> {
    if (this.online) {
      let t = await this.api.aiTranscript(attachmentId);
      if (request && (t.status === 'none' || t.status === 'failed'))
        t = await this.api.aiTranscript(attachmentId, true);
      await this.saveTranscript(t);
    }
    return this.getTranscript(attachmentId);
  }

  /**
   * Corrects lines of the transcript (`language` null) or a translation, or marks it checked.
   * Shows at once and waits in the queue when offline; a line someone else corrected meanwhile
   * is refused and their version shown.
   */
  async correctTranscript(
    attachmentId: string,
    language: string | null,
    patch: TranscriptPatch,
  ): Promise<void> {
    const raw = await this.store.getSetting(transcriptKey(attachmentId));
    const base = raw ? (JSON.parse(raw) as AiTranscript).revision : 0;
    await this.queue({
      kind: 'transcript.update',
      attachmentId,
      language,
      baseRevision: base,
      patch,
    });
    this.events.emit('transcript', { attachmentId });
  }

  /** Asks for a translation (or a new one). Needs a connection. */
  async translateTranscript(attachmentId: string, language: string): Promise<void> {
    await this.saveTranscript(
      await this.serverAction(() => this.api.translateTranscript(attachmentId, language)),
    );
  }

  private async refreshTranscript(attachmentId: string): Promise<void> {
    await this.saveTranscript(await this.api.aiTranscript(attachmentId));
  }

  private async receiveTranscript(attachmentId: string): Promise<void> {
    // Only transcripts this phone has opened are kept; others load when opened.
    if (await this.store.getSetting(transcriptKey(attachmentId)))
      await this.refreshTranscript(attachmentId).catch(() => undefined);
    else this.events.emit('transcript', { attachmentId });
  }

  private async saveTranscript(t: AiTranscript): Promise<void> {
    await this.store.setSetting(transcriptKey(t.attachmentId), JSON.stringify(t));
    this.events.emit('transcript', { attachmentId: t.attachmentId });
  }

  // ------------------------------------------------------------ call background

  /**
   * Your background in calls: the server's copy on this phone with changes not sent yet laid
   * over it, so the picker shows your pick at once, on or offline.
   */
  async getCallBackground(): Promise<CallBackgroundState> {
    const raw = await this.store.getSetting(CALL_BG_KEY);
    const saved = raw ? (JSON.parse(raw) as CallBackgroundState) : UNKNOWN_CALL_BACKGROUND;
    return withPendingCallBackground(
      saved,
      await this.store.work.pendingCallBackground(),
      await this.store.work.pendingCallAppearance(),
    );
  }

  /** Picks a background. Works offline and follows you to every device. */
  async setCallBackground(choice: CallBackgroundChoice): Promise<void> {
    // An image still on its way is selected by its upload; nothing to send for it.
    if (choice.kind === 'upload' && isLocalUpload(choice.imageId)) return;
    if (this.session.state === 'demo')
      await this.saveCallBackground(
        withPendingCallBackground(await this.getCallBackground(), [{ kind: 'callbg.set', choice }]),
      );
    else await this.queue({ kind: 'callbg.set', choice });
    await this.emitCallBackground();
  }

  /**
   * Adds one of your own backgrounds (a JPEG already in app storage, see prepareCallBackground)
   * and selects it. Works offline: it uploads when you are back online.
   */
  async addCallBackgroundImage(localUri: string, name?: string): Promise<void> {
    const input = { kind: 'callbg.image' as const, localUri, ...(name ? { name } : {}) };
    if (this.session.state === 'demo')
      await this.saveCallBackground(
        withPendingCallBackground(await this.getCallBackground(), [input]),
      );
    else await this.queue(input);
    await this.emitCallBackground();
  }

  /** Removes one of your backgrounds (one picked offline that hasn't uploaded is just dropped). */
  async removeCallBackgroundImage(imageId: string): Promise<void> {
    if (isLocalUpload(imageId)) {
      const uri = localUploadUri(imageId);
      if (await this.store.work.dropPendingCallBackgroundImage(uri)) deleteLocalFile(uri);
      await this.emitCallBackground();
      return;
    }
    const input = { kind: 'callbg.imageRemove' as const, imageId };
    if (this.session.state === 'demo')
      await this.saveCallBackground(
        withPendingCallBackground(await this.getCallBackground(), [input]),
      );
    else await this.queue(input);
    await this.emitCallBackground();
  }

  /** How you look on camera. Works offline and follows you to every device. */
  async setCallAppearance(appearance: CallAppearance): Promise<void> {
    if (this.session.state === 'demo')
      await this.saveCallBackground({ ...(await this.getCallBackground()), appearance });
    else await this.queue({ kind: 'callbg.appearance', appearance });
    await this.emitCallBackground();
  }

  /** Owners and admins: adds a background everyone can pick. Needs a connection. */
  async addOrganizationCallBackground(localUri: string, name?: string): Promise<void> {
    try {
      await this.saveCallBackground(
        await this.serverAction(() => this.api.addOrganizationCallBackground(localUri, name)),
      );
    } finally {
      deleteLocalFile(localUri);
    }
    await this.emitCallBackground();
  }

  async removeOrganizationCallBackground(imageId: string): Promise<void> {
    await this.saveCallBackground(
      await this.serverAction(() => this.api.removeOrganizationCallBackground(imageId)),
    );
    await this.emitCallBackground();
  }

  /** Owners and admins: the default background and whether the company one is required. */
  async setCallBackgroundPolicy(policy: CallBackgroundPolicyInput): Promise<void> {
    await this.saveCallBackground(
      await this.serverAction(() => this.api.setCallBackgroundPolicy(policy)),
    );
    await this.emitCallBackground();
  }

  /** Fetches the latest when online (the picker calls this when it opens). */
  reloadCallBackground(): Promise<void> {
    return this.online ? this.refreshCallBackground().catch(() => undefined) : Promise.resolve();
  }

  private async refreshCallBackground(): Promise<void> {
    await this.saveCallBackground(await this.api.getCallBackground());
    await this.emitCallBackground();
  }

  private saveCallBackground(s: CallBackgroundState): Promise<void> {
    return this.store.setSetting(CALL_BG_KEY, JSON.stringify(s));
  }

  private async emitCallBackground(): Promise<void> {
    this.events.emit('callBackground', await this.getCallBackground());
  }

  private async emitChatTheme(): Promise<void> {
    const s = await this.getChatTheme();
    if (s) this.events.emit('chatTheme', s);
  }

  async send(
    conversationId: string,
    text: string,
    opts: {
      replyTo?: string | null;
      mentions?: readonly string[];
      files?: readonly PendingFileInput[];
      /** Send as a greeting card. Queued like any message, so it works offline. */
      greeting?: GreetingCard;
    } = {},
  ): Promise<void> {
    await this.store.enqueueSend({ conversationId, text, ...opts });
    void this.outbox.kick();
  }

  /**
   * Forwards a message to up to {@link MAX_FORWARD_TARGETS} conversations, each with the same
   * optional comment. Each is an ordinary queued send, so it shows at once and works offline.
   */
  async forward(
    source: LocalMessage,
    targets: readonly string[],
    comment: string,
    from: string | null,
  ): Promise<void> {
    if (!source.messageId) throw new Error('This message has not been sent yet');
    if (targets.length === 0) throw new Error('Pick where to forward it');
    if (targets.length > MAX_FORWARD_TARGETS)
      throw new Error(`You can forward to at most ${MAX_FORWARD_TARGETS} conversations at once`);
    const snapshot = forwardSnapshot(source, from);
    for (const conversationId of targets)
      await this.store.enqueueSend({
        conversationId,
        text: comment,
        forward: { of: source.messageId, snapshot },
      });
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
    if (await this.store.work.pollCreate(clientId)) await this.store.work.retry(clientId, 'poll');
    void this.outbox.kick();
  }

  async discard(clientId: string): Promise<void> {
    if (await this.store.work.pollCreate(clientId)) {
      const m = await this.store.getMessage(clientId);
      await this.store.work.discard(clientId, 'poll');
      if (m) this.store.notifyMessages(m.conversationId);
      return;
    }
    const files = await this.store.pendingFiles(clientId);
    await this.store.discardUnsent(clientId);
    files.forEach((f) => deleteLocalFile(f.localUri));
  }

  /** Signed link to view or download an attachment (valid for a few minutes). */
  attachmentUrl(attachmentId: string): Promise<string> {
    return this.api.attachmentUrl(attachmentId).then((r) => r.url);
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
