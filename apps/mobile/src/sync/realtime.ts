import { io, type Socket } from 'socket.io-client';
import type {
  InboxChangedEvent,
  MinutesChangedEvent,
  TranscriptChangedEvent,
  ModerationChangedEvent,
  NetworkChangedEvent,
  Ack,
  AckReceiptRequest,
  Call,
  CallRingingEvent,
  MeetingReminderEvent,
  ClientToServerEvents,
  Message,
  PresenceStatus,
  Receipt,
  SendMessageAck,
  SendMessageRequest,
  ServerToClientEvents,
  SetReactionRequest,
  ScheduledMessage,
  Task,
  Approval,
  TenantArea,
  BookingPage,
  ChatThemeId,
  MeetingsArea,
} from '@sampledge/contracts';
import type { LocalStore } from '../db/store';
import { Emitter } from '../lib/emitter';
import type { ServerNotification } from './notificationTypes';
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
  /** A mention or reply for you (also sent to your other devices). */
  notification: ServerNotification;
  /** Another of your devices marked notifications read. */
  notificationsRead: { unreadCount: number };
  callRinging: CallRingingEvent;
  /** A call changed or ended (sent to the conversation's members). */
  callUpdated: Call;
  /** A meeting you attend starts soon. */
  meetingReminder: MeetingReminderEvent;
  /** One of your scheduled messages changed (sent, failed, edited on another device). */
  scheduledUpdated: ScheduledMessage;
  /** A task or approval you are involved in was created or changed. */
  work: { kind: 'task'; task: Task } | { kind: 'approval'; approval: Approval };
  /** You saved or unsaved a message (on this or another of your devices). */
  bookmark: { messageId: string; conversationId: string; saved: boolean };
  /** Your own choice in a poll changed (the only live source of it in anonymous polls). */
  myVote: { messageId: string; optionIds: string[] };
  /** Someone in the organization joined, changed role or status, or edited their profile. */
  directory: { userId: string };
  /** An organization-wide setting changed (branding, billing, integrations, AI, recordings). */
  tenant: { area: TenantArea };
  /** A project was created or changed. */
  project: { projectId: string };
  /** A booking page you host was created, changed or deleted (page is null when deleted). */
  booking: { bookingPageId: string; page: BookingPage | null };
  /** You picked a chat theme on one of your devices. */
  chatTheme: { themeId: ChatThemeId | null };
  /** Your recent searches changed on one of your devices. */
  searchRecent: { recent: string[] };
  /** Your booking pages or working hours changed (on any of your devices). */
  meetingsChanged: { area: MeetingsArea };
  /** Minutes of a call in one of your conversations were made, edited, shared or deleted. */
  minutes: MinutesChangedEvent;
  /** A recording transcript was corrected, checked or translated. */
  transcript: TranscriptChangedEvent;
  /** Something in your SampConnect Network changed (on any device, or by someone else). */
  network: NetworkChangedEvent;
  /** Platform operators: the SampConnect Network report queue or suspensions changed. */
  moderation: ModerationChangedEvent;
  /** A Client Inbox conversation you can see changed (or you read it on another device). */
  inbox: InboxChangedEvent;
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
    socket.on('notification:new', (n) => this.events.emit('notification', n));
    socket.on('notification:read', (r) => this.events.emit('notificationsRead', r));
    socket.on('call:ringing', (e) => this.events.emit('callRinging', e));
    socket.on('call:updated', (c) => this.events.emit('callUpdated', c));
    socket.on('call:ended', (c) => this.events.emit('callUpdated', c));
    socket.on('meeting:upsert', (m) => void this.store.upsertMeetings([m]));
    socket.on('meeting:reminder', (e) => {
      void this.store.upsertMeetings([e.meeting]);
      this.events.emit('meetingReminder', e);
    });
    socket.on('scheduled:updated', (m) => this.events.emit('scheduledUpdated', m));
    socket.on('task:upsert', (task) => this.events.emit('work', { kind: 'task', task }));
    socket.on('approval:upsert', (approval) =>
      this.events.emit('work', { kind: 'approval', approval }),
    );
    socket.on('bookmark:updated', (e) => this.events.emit('bookmark', e));
    socket.on('poll:myVote', (e) => this.events.emit('myVote', e));
    socket.on('directory:updated', (e) => this.events.emit('directory', e));
    socket.on('tenant:updated', (e) => this.events.emit('tenant', e));
    socket.on('project:changed', (e) => this.events.emit('project', e));
    socket.on('booking:changed', (e) => this.events.emit('booking', e));
    socket.on('search:recent', (e) => this.events.emit('searchRecent', e));
    socket.on('chat-theme:changed', (e) => this.events.emit('chatTheme', e));
    socket.on('meetings:changed', (e) => this.events.emit('meetingsChanged', e));
    socket.on('minutes:changed', (e) => this.events.emit('minutes', e));
    socket.on('transcript:changed', (e) => this.events.emit('transcript', e));
    socket.on('network:changed', (e) => this.events.emit('network', e));
    socket.on('moderation:changed', (e) => this.events.emit('moderation', e));
    socket.on('inbox:changed', (e) => this.events.emit('inbox', e));
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

  async setReaction(req: SetReactionRequest): Promise<Message> {
    return unwrap(await this.emitWithAck('reaction:set', req));
  }

  setTyping(conversationId: string, typing: boolean): void {
    if (this.socket?.connected) this.socket.emit('typing:set', { conversationId, typing });
  }

  private async emitWithAck<T>(
    event: 'message:send' | 'receipt:ack' | 'reaction:set',
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
