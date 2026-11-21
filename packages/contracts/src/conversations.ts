import { z } from 'zod';

/**
 * Per-conversation notification level for the caller.
 * all: mentions, replies and (in DMs) every message notify. mentions: only @mentions notify.
 * none: nothing notifies; unread counts still work.
 */
export const NOTIFY_LEVELS = ['all', 'mentions', 'none'] as const;
export const NotifyLevelSchema = z.enum(NOTIFY_LEVELS);
export type NotifyLevel = z.infer<typeof NotifyLevelSchema>;
export const SetNotifyLevelRequestSchema = z.object({ level: NotifyLevelSchema });
import { ServerIdSchema } from './ids.js';
import { ConversationRoleSchema } from './permissions.js';

/**
 * One collection backs every kind of conversation. A "channel" is a
 * conversation whose kind is channel_public or channel_private.
 * Planned kinds: 'project' (Samptrek-linked), 'department', 'external' (client inbox).
 */
export const CONVERSATION_KINDS = ['dm', 'group', 'channel_public', 'channel_private'] as const;
export const ConversationKindSchema = z.enum(CONVERSATION_KINDS);
export type ConversationKind = z.infer<typeof ConversationKindSchema>;

export const ConversationSchema = z.object({
  conversationId: ServerIdSchema,
  tenantId: ServerIdSchema,
  workspaceId: ServerIdSchema,
  kind: ConversationKindSchema,
  /** null for DMs; the UI shows the other member's name. */
  name: z.string().nullable(),
  topic: z.string().nullable(),
  memberIds: z.array(ServerIdSchema),
  createdBy: ServerIdSchema,
  createdAt: z.string().datetime(),
  archivedAt: z.string().datetime().nullable(),
  /** Highest changeSequence assigned in this conversation. */
  lastChangeSequence: z.number().int().nonnegative(),
  lastMessageAt: z.string().datetime().nullable(),
  /** Caller's own membership details. */
  myRole: ConversationRoleSchema.nullable(),
  /** The caller's notification level for this conversation (default 'all'). */
  myNotifyLevel: NotifyLevelSchema.default('all'),
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const GROUP_MAX_MEMBERS = 256;

const ChannelName = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} _.-]*$/u, 'use letters, numbers, spaces, - _ .');

export const CreateConversationRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('dm'), memberIds: z.array(ServerIdSchema).length(1) }),
  z.object({
    kind: z.literal('group'),
    memberIds: z.array(ServerIdSchema).min(2).max(GROUP_MAX_MEMBERS),
    name: z.string().trim().max(80).optional(),
  }),
  z.object({
    kind: z.enum(['channel_public', 'channel_private']),
    name: ChannelName,
    topic: z.string().trim().max(250).optional(),
    memberIds: z.array(ServerIdSchema).max(500).default([]),
  }),
]);
export type CreateConversationRequest = z.input<typeof CreateConversationRequestSchema>;

export const AddMembersRequestSchema = z.object({
  userIds: z.array(ServerIdSchema).min(1).max(500),
});
