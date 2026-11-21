import type { InboxChangedEvent } from './client-inbox.js';
import type { ScheduledMessage } from './scheduled-messages.js';
import type { Call, CallRingingEvent } from './calls.js';
import type { Ack } from './errors.js';
import type { Meeting, MeetingReminderEvent } from './meetings.js';
import type { Conversation } from './conversations.js';
import type {
  Message,
  SendMessageAck,
  SendMessageRequest,
  SetReactionRequest,
} from './messages.js';
import type { Notification } from './notifications.js';
import type { AckReceiptRequest, Receipt } from './receipts.js';
import type { Approval, Task } from './work.js';

/**
 * Socket.IO event contracts (namespace "/", path "/socket.io").
 * Auth: `io(url, { auth: { token: accessToken } })`. The server derives tenant,
 * user and device from the token and joins the socket to:
 *   t:{tenantId}:u:{userId}            personal room (all of a user's devices)
 *   t:{tenantId}:c:{conversationId}    one room per readable conversation
 *
 * Real-time events are a latency optimization only. They are never the sole
 * delivery path: after any reconnect the client runs cursor sync against
 * MongoDB-backed REST, so a missed event is recovered.
 */
export interface ClientToServerEvents {
  'message:send': (req: SendMessageRequest, ack: (res: Ack<SendMessageAck>) => void) => void;
  /** Idempotent: adding an existing reaction or removing a missing one is a no-op. */
  'reaction:set': (req: SetReactionRequest, ack: (res: Ack<Message>) => void) => void;
  'receipt:ack': (req: AckReceiptRequest, ack: (res: Ack<Receipt>) => void) => void;
  'typing:set': (req: { conversationId: string; typing: boolean }) => void;
  'presence:set': (req: { status: PresenceStatus }) => void;
}

export const PRESENCE_STATUSES = ['online', 'away', 'dnd', 'offline'] as const;
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number];

export interface ServerToClientEvents {
  /** A message was created. Also sent to the sender's other devices. */
  'message:new': (message: Message) => void;
  /** A message was edited, soft-deleted, or its reactions changed. */
  'message:updated': (message: Message) => void;
  'receipt:updated': (receipt: Receipt) => void;
  'typing:update': (e: { conversationId: string; userId: string; typing: boolean }) => void;
  'presence:update': (e: { userId: string; status: PresenceStatus }) => void;
  /** The caller was added to a conversation, or its metadata changed. */
  'conversation:upsert': (conversation: Conversation) => void;
  /** The caller lost access (removed / conversation deleted). Purge local copy. */
  'conversation:revoked': (e: { conversationId: string }) => void;
  /** A new in-app notification for the caller (all of their devices). */
  'notification:new': (notification: Notification) => void;
  /** One of the caller's scheduled messages changed (sent, failed, edited, cancelled). */
  'scheduled:updated': (scheduled: ScheduledMessage) => void;
  /** Notifications were marked read on another device; refetch the unread count. */
  'notification:read': (e: { unreadCount: number }) => void;
  /** You are invited to a call (sent to each invitee's devices). Stop ringing at expiresAt. */
  'call:ringing': (e: CallRingingEvent) => void;
  /** A call in one of your conversations changed (someone joined, left, declined). */
  'call:updated': (call: Call) => void;
  /** A call ended; leave the room and stop ringing. */
  'call:ended': (call: Call) => void;
  /** A meeting you're invited to was created, changed, cancelled, or someone RSVP'd. */
  'meeting:upsert': (meeting: Meeting) => void;
  /** A meeting you're attending starts soon. */
  'meeting:reminder': (e: MeetingReminderEvent) => void;
  /** A Client Inbox conversation you can see changed. Refetch it. */
  'inbox:changed': (e: InboxChangedEvent) => void;
  /** A task you're assigned to or created was created or changed. */
  'task:upsert': (task: Task) => void;
  /** An approval you requested or must decide was created or decided. */
  'approval:upsert': (approval: Approval) => void;
  /**
   * You saved or unsaved a message (sent to all of your devices; nobody else sees bookmarks).
   * Saved lists refetch GET /v1/bookmarks after a reconnect, so a missed event is recovered.
   */
  'bookmark:updated': (e: { messageId: string; conversationId: string; saved: boolean }) => void;
  /**
   * Your own choice in a poll changed (sent to all of your devices). The only live source of it
   * in anonymous polls, where `message:updated` carries counts without voter ids.
   */
  'poll:myVote': (e: { messageId: string; optionIds: string[] }) => void;
  /** Someone in the organization joined, changed role or status, or edited their profile. */
  'directory:updated': (e: { userId: string }) => void;
  /** An organization-wide setting changed; refetch that area. */
  'tenant:updated': (e: { area: TenantArea }) => void;
  /** A project was created or changed; refetch it (the list endpoint applies visibility). */
  'project:changed': (e: { projectId: string }) => void;
  /** Access token expired or session revoked; client must refresh and reconnect. */
  'session:expired': (e: { reason: 'token_expired' | 'revoked' }) => void;
}

export const TENANT_AREAS = ['branding', 'billing', 'integrations', 'ai', 'recordings'] as const;
export type TenantArea = (typeof TENANT_AREAS)[number];

/** Typing state expires server-side if not refreshed. */
export const TYPING_TTL_MS = 6000;
