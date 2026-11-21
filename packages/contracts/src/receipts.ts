import { z } from 'zod';
import { ServerIdSchema } from './ids.js';
import type { MessageStatus } from './messages.js';

/**
 * Receipts use per-member watermarks instead of one row per message:
 * a member who has delivered/read up to sequence N has delivered/read
 * every message with serverSequence <= N in that conversation.
 */
export const ReceiptSchema = z.object({
  conversationId: ServerIdSchema,
  userId: ServerIdSchema,
  deliveredUpTo: z.number().int().nonnegative(),
  readUpTo: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
});
export type Receipt = z.infer<typeof ReceiptSchema>;

export const AckReceiptRequestSchema = z.object({
  conversationId: ServerIdSchema,
  kind: z.enum(['delivered', 'read']),
  upToSequence: z.number().int().positive(),
});
export type AckReceiptRequest = z.infer<typeof AckReceiptRequestSchema>;

/**
 * Conversations above this size do not compute delivered/read for the sender
 * (it would almost never be reached and fan-out is expensive). Status stays `sent`
 * and the UI may show counts instead.
 */
export const RECEIPT_TRACKING_MAX_MEMBERS = 32;

/**
 * Derive the sender-visible status of a server-confirmed message.
 * `delivered` / `read` require every other member to have reached the watermark.
 */
export function deriveConfirmedStatus(params: {
  serverSequence: number;
  senderId: string;
  memberIds: readonly string[];
  receipts: readonly Pick<Receipt, 'userId' | 'deliveredUpTo' | 'readUpTo'>[];
}): Extract<MessageStatus, 'sent' | 'delivered' | 'read'> {
  const recipients = params.memberIds.filter((id) => id !== params.senderId);
  if (recipients.length === 0 || params.memberIds.length > RECEIPT_TRACKING_MAX_MEMBERS) return 'sent';
  const byUser = new Map(params.receipts.map((r) => [r.userId, r]));
  let allRead = true;
  for (const id of recipients) {
    const r = byUser.get(id);
    // Reading implies delivery even if the delivered ack was lost.
    const delivered = Math.max(r?.deliveredUpTo ?? 0, r?.readUpTo ?? 0);
    if (delivered < params.serverSequence) return 'sent';
    if ((r?.readUpTo ?? 0) < params.serverSequence) allRead = false;
  }
  return allRead ? 'read' : 'delivered';
}
