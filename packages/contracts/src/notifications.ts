import { z } from 'zod';
import { ServerIdSchema } from './ids.js';

/**
 * In-app notifications (Phase 1b). A per-user inbox of things that need the user's
 * attention. Today: being @mentioned, and replies to your messages. Notifications for
 * conversations the user can no longer read are hidden, never shown.
 */
export const NOTIFICATION_KINDS = ['mention', 'reply'] as const;
export const NotificationKindSchema = z.enum(NOTIFICATION_KINDS);
export type NotificationKind = z.infer<typeof NotificationKindSchema>;

/** Characters of message text kept as the preview. */
export const NOTIFICATION_PREVIEW_LENGTH = 140;

export const NotificationSchema = z.object({
  notificationId: ServerIdSchema,
  kind: NotificationKindSchema,
  conversationId: ServerIdSchema,
  messageId: ServerIdSchema,
  actorId: ServerIdSchema,
  /** Plain text, truncated; "N attachments" when the message has only files. */
  preview: z.string(),
  createdAt: z.string().datetime(),
  readAt: z.string().datetime().nullable(),
});
export type Notification = z.infer<typeof NotificationSchema>;

/** GET /v1/notifications?unread=true&before=<notificationId>&limit=50, newest first. */
export const ListNotificationsQuerySchema = z.object({
  unread: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  before: ServerIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const NotificationPageSchema = z.object({
  items: z.array(NotificationSchema),
  unreadCount: z.number().int().nonnegative(),
  /** Pass as `before` for the next (older) page; null at the end. */
  nextBefore: ServerIdSchema.nullable(),
});
export type NotificationPage = z.infer<typeof NotificationPageSchema>;

/** POST /v1/notifications/read: mark some, all, or everything in one conversation as read. Idempotent. */
export const MarkNotificationsReadRequestSchema = z.union([
  z.object({ notificationIds: z.array(ServerIdSchema).min(1).max(200) }),
  z.object({ all: z.literal(true) }),
  z.object({ conversationId: ServerIdSchema }),
]);
export type MarkNotificationsReadRequest = z.infer<typeof MarkNotificationsReadRequestSchema>;
