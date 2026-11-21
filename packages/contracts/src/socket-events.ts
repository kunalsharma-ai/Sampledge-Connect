import type { Ack } from './errors.js';
import type { Conversation } from './conversations.js';
import type { Message, SendMessageAck, SendMessageRequest } from './messages.js';
import type { AckReceiptRequest, Receipt } from './receipts.js';

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
  'receipt:ack': (req: AckReceiptRequest, ack: (res: Ack<Receipt>) => void) => void;
  'typing:set': (req: { conversationId: string; typing: boolean }) => void;
  'presence:set': (req: { status: PresenceStatus }) => void;
}

export const PRESENCE_STATUSES = ['online', 'away', 'dnd', 'offline'] as const;
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number];

export interface ServerToClientEvents {
  /** A message was created. Also sent to the sender's other devices. */
  'message:new': (message: Message) => void;
  /** A message was edited or soft-deleted. */
  'message:updated': (message: Message) => void;
  'receipt:updated': (receipt: Receipt) => void;
  'typing:update': (e: { conversationId: string; userId: string; typing: boolean }) => void;
  'presence:update': (e: { userId: string; status: PresenceStatus }) => void;
  /** The caller was added to a conversation, or its metadata changed. */
  'conversation:upsert': (conversation: Conversation) => void;
  /** The caller lost access (removed / conversation deleted). Purge local copy. */
  'conversation:revoked': (e: { conversationId: string }) => void;
  /** Access token expired or session revoked; client must refresh and reconnect. */
  'session:expired': (e: { reason: 'token_expired' | 'revoked' }) => void;
}

/** Typing state expires server-side if not refreshed. */
export const TYPING_TTL_MS = 6000;
