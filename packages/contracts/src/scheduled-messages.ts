import { z } from 'zod';
import { ClientIdSchema, ServerIdSchema } from './ids.js';
import { MessageContentSchema } from './messages.js';

/**
 * Messages written now and sent later by the server, as their author. Scheduling needs a
 * connection (the server must hold the message); the send itself uses the stored
 * clientMessageId, so it is idempotent like any other send.
 */
export const SCHEDULED_STATUSES = ['scheduled', 'sent', 'failed', 'cancelled'] as const;
export const ScheduledStatusSchema = z.enum(SCHEDULED_STATUSES);
export type ScheduledStatus = z.infer<typeof ScheduledStatusSchema>;

/** Earliest and latest allowed send times, relative to now. */
export const SCHEDULE_MIN_LEAD_MS = 60_000;
export const SCHEDULE_MAX_LEAD_MS = 365 * 24 * 3600_000;
/** Pending scheduled messages per user. */
export const MAX_SCHEDULED_PER_USER = 100;

export const ScheduledMessageSchema = z.object({
  scheduledId: ServerIdSchema,
  conversationId: ServerIdSchema,
  clientMessageId: ClientIdSchema,
  content: MessageContentSchema,
  replyToMessageId: ServerIdSchema.nullable(),
  sendAt: z.string().datetime(),
  status: ScheduledStatusSchema,
  /** Set once sent. */
  messageId: ServerIdSchema.nullable(),
  /** Why sending failed (for example the author left the conversation). */
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ScheduledMessage = z.infer<typeof ScheduledMessageSchema>;

/** POST /v1/conversations/:id/scheduled-messages */
export const CreateScheduledMessageRequestSchema = z.object({
  clientMessageId: ClientIdSchema,
  content: MessageContentSchema.refine((c) => c.text.trim().length > 0, 'message text is empty'),
  replyToMessageId: ServerIdSchema.nullable().default(null),
  sendAt: z.string().datetime(),
});
export type CreateScheduledMessageRequest = z.input<typeof CreateScheduledMessageRequestSchema>;

/** PATCH /v1/scheduled-messages/:id — only while still scheduled. */
export const UpdateScheduledMessageRequestSchema = z
  .object({
    content: MessageContentSchema.refine((c) => c.text.trim().length > 0, 'message text is empty'),
    sendAt: z.string().datetime(),
  })
  .partial()
  .refine((r) => r.content || r.sendAt, 'nothing to change');
export type UpdateScheduledMessageRequest = z.input<typeof UpdateScheduledMessageRequestSchema>;

/** GET /v1/scheduled-messages?conversationId=&status= (default: scheduled and failed). */
export const ListScheduledMessagesQuerySchema = z.object({
  conversationId: ServerIdSchema.optional(),
  status: ScheduledStatusSchema.optional(),
});
