import { z } from 'zod';
import { ServerIdSchema } from './ids.js';
import { RecordingKindSchema } from './attachments.js';

/**
 * Recordings: clips people record in chat (voice, video, screen) and call/meeting recordings
 * made by the self-hosted SFU (LiveKit Egress). Every recording is an attachment in its
 * conversation, stored in the tenant's file storage and opened through signed links.
 * See docs/recordings.md.
 */

/** GET /v1/recordings: recordings in conversations the caller can read, newest first. */
export const ListRecordingsQuerySchema = z.object({
  conversationId: ServerIdSchema.optional(),
  kind: RecordingKindSchema.optional(),
  /** Cursor: createdAt of the last item of the previous page. */
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListRecordingsQuery = z.input<typeof ListRecordingsQuerySchema>;

export const RecordingSchema = z.object({
  recordingId: ServerIdSchema,
  conversationId: ServerIdSchema,
  conversationName: z.string(),
  kind: RecordingKindSchema,
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative().nullable(),
  /** The person who recorded it (for call recordings, who started the recording). */
  createdBy: ServerIdSchema,
  createdAt: z.string().datetime(),
  /** When the retention policy will delete it, or null if it is kept until someone deletes it. */
  expiresAt: z.string().datetime().nullable(),
  /** The message it was posted in. */
  messageId: ServerIdSchema.nullable(),
  callId: ServerIdSchema.nullable(),
  /** Whether the caller may delete it (its creator, a conversation moderator, or a tenant admin). */
  canDelete: z.boolean(),
});
export type Recording = z.infer<typeof RecordingSchema>;

export const RecordingListSchema = z.object({
  items: z.array(RecordingSchema),
  nextBefore: z.string().datetime().nullable(),
});
export type RecordingList = z.infer<typeof RecordingListSchema>;

/** GET/PUT /v1/admin/recording-settings (tenant owners and admins). */
export const RecordingSettingsSchema = z.object({
  /** Delete recordings automatically this many days after they were made. null = keep. */
  retentionDays: z.number().int().min(1).max(3650).nullable(),
  /** Whether people may record calls and meetings in this organization. */
  callRecordingEnabled: z.boolean(),
});
export type RecordingSettings = z.infer<typeof RecordingSettingsSchema>;

export const DEFAULT_RECORDING_SETTINGS: RecordingSettings = {
  retentionDays: null,
  callRecordingEnabled: true,
};

/**
 * POST /v1/admin/recordings/export (owners and admins): a signed, short-lived link to a ZIP
 * of every recording made in [from, to), optionally in one conversation, plus a manifest.csv.
 * Open the link in the browser; it needs no auth header.
 */
export const ExportRecordingsRequestSchema = z
  .object({
    from: z.string().datetime(),
    to: z.string().datetime(),
    conversationId: ServerIdSchema.optional(),
  })
  .refine((r) => Date.parse(r.to) > Date.parse(r.from), {
    message: 'to must be after from',
    path: ['to'],
  });
export type ExportRecordingsRequest = z.input<typeof ExportRecordingsRequestSchema>;

export const ExportRecordingsResponseSchema = z.object({
  url: z.string(),
  expiresAt: z.string().datetime(),
  count: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
});
export type ExportRecordingsResponse = z.infer<typeof ExportRecordingsResponseSchema>;

/** One export is capped so a single ZIP stays manageable; narrow the range for more. */
export const MAX_EXPORT_BYTES = 4 * 1024 * 1024 * 1024 - 1;

// ---------- call recording ----------

/**
 * starting: asked the SFU to start. active: recording now. stopping: asked it to stop,
 * waiting for the file. Everyone in the call sees this state (the "Recording" indicator).
 */
export const CALL_RECORDING_STATUSES = ['starting', 'active', 'stopping'] as const;

export const CallRecordingStateSchema = z.object({
  status: z.enum(CALL_RECORDING_STATUSES),
  startedBy: ServerIdSchema,
  startedAt: z.string().datetime(),
});
export type CallRecordingState = z.infer<typeof CallRecordingStateSchema>;

/**
 * `metadata.recording` on the system message that delivers a finished call recording.
 * The message also carries the file in `attachments` (recording: 'call').
 */
export const RecordingSystemMetadataSchema = z.object({
  callId: ServerIdSchema,
  /** null when the recording failed. */
  attachmentId: ServerIdSchema.nullable(),
  startedBy: ServerIdSchema,
  startedAt: z.string().datetime(),
  durationMs: z.number().int().nonnegative(),
  audioOnly: z.boolean(),
  /** Set when the recording failed and no file was produced. */
  failed: z.boolean().default(false),
});
export type RecordingSystemMetadata = z.infer<typeof RecordingSystemMetadataSchema>;
