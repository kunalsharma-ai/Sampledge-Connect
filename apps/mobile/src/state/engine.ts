import {
  backoffDelay,
  type CreateConversationRequest,
  type CreateMeetingRequest,
  type FindTimesRequest,
  type FindTimesResponse,
  type Meeting,
  type MeetingReminderEvent,
  type RsvpResponse,
  type UpdateMeetingRequest,
  type WorkingHours,
  type Message,
  type NotifyLevel,
  type PushStatus,
  type SendMessageAck,
  type SendMessageRequest,
  type SetReactionRequest,
  type RecordingList,
  type IntegrationTestResult,
  type IntegrationValues,
  type IntegrationView,
  type Bookmark,
} from '@sampledge/contracts';
import type { SessionManager } from '../auth/session';
import type { LocalNotification, LocalStore, PendingFileInput } from '../db/store';
import { Emitter } from '../lib/emitter';
import type { MarkNotificationsReadRequest } from '../sync/notificationTypes';
import { deleteLocalFile, pruneLocalFiles } from '../lib/localFiles';
import { OutboxProcessor } from '../sync/outbox';
import { CallController } from './calls';
import type { RealtimeClient, SocketState } from '../sync/realtime';
import { SyncEngine } from '../sync/syncEngine';
import {
  TransportError,
  type ApiTransport,
  type DeviceSession,
  type RecordingsQuery,
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
export class ConnectEngine {
  readonly events = new Emitter<{
    state: EngineState;
    /** A new unread notification arrived live (drives the in-app banner). */
    notification: LocalNotification;
    /** A meeting you attend starts soon (drives the reminder banner). */
    meetingReminder: MeetingReminderEvent;
    /** The set of messages you saved for later changed. */
    bookmarks: ReadonlySet<string>;
  }>();
  /** Message ids you saved, as of the last list or change on this device. */
  private saved = new Set<string>();
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

  constructor(
    readonly store: LocalStore,
    private readonly api: ApiTransport,
    private readonly session: SessionManager,
    private readonly realtime: RealtimeClient | null,
  ) {
    this.sync = new SyncEngine(store, api);
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
      canSend: () => this._state.networkUp && session.state === 'active',
      onAuthError: (err) => void this.handleAuthError(err),
    });
  }

  get state(): EngineState {
    return this._state;
  }

  async start(): Promise<void> {
    await this.store.requeueInflight();
    // Copies of files whose message was discarded or evicted.
    pruneLocalFiles(await this.store.liveFileUris());
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
    await Promise.all([
      this.outbox.kick(),
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

  /** Pins or unpins for everyone; the change syncs to other devices like an edit. */
  pinMessage(messageId: string, pinned: boolean): Promise<void> {
    return this.serverAction(async () => {
      await this.store.applyServerMessages([await this.api.pinMessage(messageId, pinned)]);
    });
  }

  /** Saved messages, newest first (needs a connection; the list lives on the server). */
  listBookmarks(): Promise<Bookmark[]> {
    return this.serverAction(async () => {
      const list = await this.api.listBookmarks();
      this.saved = new Set(list.map((b) => b.messageId));
      this.events.emit('bookmarks', this.saved);
      return list;
    });
  }

  /** Whether you saved this message, as far as this device knows. */
  isSaved(messageId: string): boolean {
    return this.saved.has(messageId);
  }

  setBookmark(messageId: string, saved: boolean): Promise<void> {
    return this.serverAction(async () => {
      await this.api.setBookmark(messageId, saved);
      this.saved = new Set(this.saved);
      if (saved) this.saved.add(messageId);
      else this.saved.delete(messageId);
      this.events.emit('bookmarks', this.saved);
    });
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
  async rsvp(meetingId: string, response: Exclude<RsvpResponse, 'pending'>): Promise<void> {
    if (this.session.state === 'demo') return this.store.applyLocalRsvp(meetingId, response);
    await this.store.setRsvpLocally(meetingId, response);
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
    for (const { meetingId, response } of await this.store.pendingRsvps()) {
      try {
        await this.store.upsertMeetings([await this.api.rsvp(meetingId, response)]);
      } catch (err) {
        if (!(err instanceof TransportError) || err.kind === 'network') return;
        if (err.isAuth) return void this.handleAuthError(err);
        if (err.retryable) return;
        // Refused for good (cancelled, or no longer invited): fall back to the server's copy.
      }
      await this.store.settleRsvp(meetingId, response);
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
      return m;
    });
  }

  cancelMeeting(meetingId: string): Promise<void> {
    return this.serverAction(async () => {
      await this.store.upsertMeetings([await this.api.cancelMeeting(meetingId)]);
    });
  }

  /** Slots where everyone is in working hours and free (busy times come without titles). */
  findTimes(req: FindTimesRequest): Promise<FindTimesResponse> {
    return this.serverAction(() => this.api.findTimes(req));
  }

  getWorkingHours(): Promise<WorkingHours> {
    return this.serverAction(() => this.api.getWorkingHours());
  }

  setWorkingHours(hours: WorkingHours): Promise<WorkingHours> {
    return this.serverAction(() => this.api.setWorkingHours(hours));
  }

  async send(
    conversationId: string,
    text: string,
    opts: {
      replyTo?: string | null;
      mentions?: readonly string[];
      files?: readonly PendingFileInput[];
    } = {},
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

  async discard(clientId: string): Promise<void> {
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
