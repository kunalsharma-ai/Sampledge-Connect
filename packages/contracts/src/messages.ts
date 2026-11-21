import { z } from 'zod';
import { ClientIdSchema, ServerIdSchema } from './ids.js';
import { AttachmentSchema, MAX_ATTACHMENTS_PER_MESSAGE } from './attachments.js';

/**
 * Outgoing message lifecycle as shown to the sender.
 *
 *   draft -> queued -> sending -> sent -> delivered -> read
 *                         \-> failed (manual retry puts it back to queued)
 *
 * Only `sent` and later are server-confirmed. A message is never shown as
 * sent/delivered/read before the server acknowledged its clientMessageId.
 */
export const MESSAGE_STATUSES = [
  'draft',
  'queued',
  'sending',
  'sent',
  'delivered',
  'read',
  'failed',
] as const;
export const MessageStatusSchema = z.enum(MESSAGE_STATUSES);
export type MessageStatus = z.infer<typeof MessageStatusSchema>;

export const MESSAGE_TYPES = ['text', 'system'] as const;
/** Planned (not yet accepted by the server): 'file', 'image', 'voice', 'poll', 'announcement'. */
export const MessageTypeSchema = z.enum(MESSAGE_TYPES);
export type MessageType = z.infer<typeof MessageTypeSchema>;

export const MAX_MESSAGE_LENGTH = 8000;

export const MessageContentSchema = z.object({
  /** Plain text with lightweight markdown. Rich text AST is planned. */
  text: z.string().max(MAX_MESSAGE_LENGTH),
  /** User ids mentioned with @, resolved by the client composer. */
  mentions: z.array(ServerIdSchema).max(100).default([]),
});
export type MessageContent = z.infer<typeof MessageContentSchema>;

/** Most distinct emoji a single message can carry. */
export const MAX_REACTIONS_PER_MESSAGE = 50;
/** userIds returned per reaction; `count` is always the full total. */
export const REACTION_USER_IDS_LIMIT = 20;

/** One emoji grapheme (including ZWJ sequences, skin tones and flags). */
export const ReactionEmojiSchema = z
  .string()
  .min(1)
  .max(32)
  .refine(
    (e) =>
      /^(\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]\uFE0F?\u20E3)/u.test(e) &&
      // Hermes (React Native) may lack Intl.Segmenter: fall back to the length bound only.
      (typeof Intl.Segmenter !== 'function' ||
        [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(e)].length === 1),
    'must be a single emoji',
  );

export const ReactionSchema = z.object({
  emoji: ReactionEmojiSchema,
  /** First reactors, oldest first, capped at REACTION_USER_IDS_LIMIT. */
  userIds: z.array(ServerIdSchema),
  count: z.number().int().positive(),
});
export type Reaction = z.infer<typeof ReactionSchema>;

/** Body of PUT/DELETE reaction and of the `reaction:set` socket event. */
export const SetReactionRequestSchema = z.object({
  messageId: ServerIdSchema,
  emoji: ReactionEmojiSchema,
  op: z.enum(['add', 'remove']),
});
export type SetReactionRequest = z.input<typeof SetReactionRequestSchema>;

/** Most options a poll can offer. */
export const MAX_POLL_OPTIONS = 10;

export const PollOptionSchema = z.object({
  optionId: z.string().min(1).max(32),
  text: z.string().min(1).max(200),
  count: z.number().int().nonnegative(),
  /** Who voted for it, oldest first. Always empty in anonymous polls. */
  voterIds: z.array(ServerIdSchema),
});
export type PollOption = z.infer<typeof PollOptionSchema>;

/**
 * A poll rides on its message (like reactions): votes bump changeSequence and broadcast
 * `message:updated`, so offline clients catch up through ordinary sync.
 */
export const PollSchema = z.object({
  question: z.string().min(1).max(300),
  options: z.array(PollOptionSchema).min(2).max(MAX_POLL_OPTIONS),
  /** Voters may choose more than one option. */
  multiple: z.boolean(),
  /** Counts only; who voted is never shown, not even to admins. */
  anonymous: z.boolean(),
  /** People who voted at least once. */
  totalVoters: z.number().int().nonnegative(),
  /** Closes on its own at this time (null = until someone closes it). */
  closesAt: z.string().datetime().nullable(),
  closedAt: z.string().datetime().nullable(),
  closedBy: ServerIdSchema.nullable(),
});
export type Poll = z.infer<typeof PollSchema>;

/** POST /v1/conversations/:id/polls — creates a poll message. Idempotent on clientMessageId. */
export const CreatePollRequestSchema = z.object({
  clientMessageId: ClientIdSchema,
  question: z.string().trim().min(1).max(300),
  options: z
    .array(z.string().trim().min(1).max(200))
    .min(2)
    .max(MAX_POLL_OPTIONS)
    .refine((o) => new Set(o.map((x) => x.toLowerCase())).size === o.length, 'options must differ'),
  multiple: z.boolean().default(false),
  anonymous: z.boolean().default(false),
  closesAt: z.string().datetime().nullable().default(null),
});
export type CreatePollRequest = z.input<typeof CreatePollRequestSchema>;

/** PUT /v1/messages/:id/poll/vote — replaces the caller's choice; [] withdraws it. */
export const PollVoteRequestSchema = z.object({
  optionIds: z.array(z.string().min(1).max(32)).max(MAX_POLL_OPTIONS),
});
export type PollVoteRequest = z.input<typeof PollVoteRequestSchema>;

/** The caller's own choice (needed for anonymous polls, where voterIds is empty). */
export const MyPollVoteSchema = z.object({
  messageId: ServerIdSchema,
  optionIds: z.array(z.string()),
});
export type MyPollVote = z.infer<typeof MyPollVoteSchema>;

/** Message as stored and returned by the server. */
export const MessageSchema = z.object({
  messageId: ServerIdSchema,
  clientMessageId: ClientIdSchema,
  tenantId: ServerIdSchema,
  conversationId: ServerIdSchema,
  senderId: ServerIdSchema,
  messageType: MessageTypeSchema,
  content: MessageContentSchema,
  attachmentIds: z.array(ServerIdSchema).default([]),
  /** Metadata snapshot of the files attached at send time (bytes via GET /v1/attachments/:id/url). */
  attachments: z.array(AttachmentSchema).default([]),
  replyToMessageId: ServerIdSchema.nullable().default(null),
  /** Monotonic per conversation, assigned once at creation. Defines display order. */
  serverSequence: z.number().int().positive(),
  /**
   * Monotonic per conversation, bumped on every create/edit/delete.
   * Sync cursors are expressed in changeSequence. serverSequence === changeSequence at creation.
   */
  changeSequence: z.number().int().positive(),
  createdAt: z.string().datetime(),
  editedAt: z.string().datetime().nullable().default(null),
  deletedAt: z.string().datetime().nullable().default(null),
  metadata: z.record(z.string(), z.unknown()).default({}),
  /** In first-reacted order. A reaction change bumps changeSequence, so sync carries it. */
  reactions: z.array(ReactionSchema).default([]),
  /** Pinned to the conversation. Pin changes bump changeSequence, so sync carries them. */
  pinned: z
    .object({ pinnedBy: ServerIdSchema, pinnedAt: z.string().datetime() })
    .nullable()
    .default(null),
  /** Set on poll messages. Optional so older payloads and fixtures stay valid. */
  poll: PollSchema.nullable().optional(),
});
export type Message = z.infer<typeof MessageSchema>;

/** Most messages a conversation can have pinned at once. */
export const MAX_PINS_PER_CONVERSATION = 50;

/** A message the caller saved for later. GET /v1/bookmarks, PUT/DELETE /v1/messages/:id/bookmark. */
export const BookmarkSchema = z.object({
  messageId: ServerIdSchema,
  conversationId: ServerIdSchema,
  createdAt: z.string().datetime(),
  /** Current state of the message (edits and deletion show through). */
  message: MessageSchema,
});
export type Bookmark = z.infer<typeof BookmarkSchema>;
export const MAX_BOOKMARKS_PER_USER = 1000;

/** Body of POST /v1/conversations/:id/messages and of the `message:send` socket event. */
export const SendMessageRequestSchema = z
  .object({
    conversationId: ServerIdSchema,
    /** Idempotency key. Re-sending the same id returns the original message. */
    clientMessageId: ClientIdSchema,
    messageType: z.literal('text').default('text'),
    content: MessageContentSchema,
    /** Ready uploads (POST /v1/uploads) by the sender in this conversation. */
    attachmentIds: z.array(ServerIdSchema).max(MAX_ATTACHMENTS_PER_MESSAGE).default([]),
    replyToMessageId: ServerIdSchema.nullable().default(null),
    /** Client clock at composition time, informational only; ordering uses serverSequence. */
    composedAt: z.string().datetime().optional(),
  })
  .refine((r) => r.content.text.trim().length > 0 || (r.attachmentIds?.length ?? 0) > 0, {
    message: 'message text is empty',
    path: ['content', 'text'],
  });
export type SendMessageRequest = z.input<typeof SendMessageRequestSchema>;

export const EditMessageRequestSchema = z.object({
  content: MessageContentSchema.refine((c) => c.text.trim().length > 0, 'message text is empty'),
});
export type EditMessageRequest = z.input<typeof EditMessageRequestSchema>;

export const SendMessageAckSchema = z.object({
  clientMessageId: ClientIdSchema,
  message: MessageSchema,
  /** true when this clientMessageId had already been accepted earlier. */
  duplicate: z.boolean(),
});
export type SendMessageAck = z.infer<typeof SendMessageAckSchema>;

export const ListMessagesQuerySchema = z.object({
  /** Return messages with serverSequence < before (scrolling back in history). */
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
