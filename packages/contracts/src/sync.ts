import { z } from 'zod';
import { ServerIdSchema } from './ids.js';
import { ConversationSchema } from './conversations.js';
import { MessageSchema } from './messages.js';
import { ReceiptSchema } from './receipts.js';

/**
 * Cursor-based synchronization (see docs/offline-sync-protocol.md).
 *
 * The client keeps one cursor per conversation: the highest changeSequence it
 * has applied. POST /v1/sync returns every change (create, edit, delete) with
 * changeSequence > cursor, oldest first, in pages. Sequences are strictly
 * increasing per conversation but may contain gaps, so clients must never wait
 * for a "missing" number; they simply ask again from their cursor.
 */
export const SyncCursorSchema = z.object({
  conversationId: ServerIdSchema,
  afterChangeSequence: z.number().int().nonnegative(),
});

export const SyncRequestSchema = z.object({
  cursors: z.array(SyncCursorSchema).max(500).default([]),
  /** Max changes per conversation in this response. */
  limitPerConversation: z.number().int().min(1).max(500).default(200),
});
export type SyncRequest = z.input<typeof SyncRequestSchema>;

export const SyncConversationResultSchema = z.object({
  conversationId: ServerIdSchema,
  changes: z.array(MessageSchema),
  /** Cursor to store after applying `changes`. */
  nextCursor: z.number().int().nonnegative(),
  /** true when more changes exist beyond this page; call sync again. */
  hasMore: z.boolean(),
  receipts: z.array(ReceiptSchema),
});

export const SyncResponseSchema = z.object({
  /** Every conversation the caller can currently read (authoritative list). */
  conversations: z.array(ConversationSchema),
  results: z.array(SyncConversationResultSchema),
  /** Conversations the client had cursors for but may no longer read; purge locally. */
  revokedConversationIds: z.array(ServerIdSchema),
  serverTime: z.string().datetime(),
});
export type SyncResponse = z.infer<typeof SyncResponseSchema>;
export type SyncConversationResult = z.infer<typeof SyncConversationResultSchema>;
