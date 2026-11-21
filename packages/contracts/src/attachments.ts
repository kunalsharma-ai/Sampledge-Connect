import { z } from 'zod';
import { ServerIdSchema } from './ids.js';

/** 100 MB per file. */
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;
/** Upload tickets and signed download URLs are short-lived. */
export const UPLOAD_TICKET_TTL_SECONDS = 15 * 60;
export const DOWNLOAD_URL_TTL_SECONDS = 10 * 60;

/** Executable and script types are refused outright; everything else is stored as an opaque file. */
export const BLOCKED_EXTENSIONS = [
  'exe',
  'msi',
  'bat',
  'cmd',
  'com',
  'scr',
  'ps1',
  'vbs',
  'js',
  'jar',
  'sh',
  'app',
  'dmg',
  'apk',
] as const;

/**
 * Recordings are attachments with a `recording` kind. voice/video/screen are clips people
 * record in the composer; call is a call or meeting recording made by the server (SFU egress).
 */
export const RECORDING_KINDS = ['voice', 'video', 'screen', 'call'] as const;
export const RecordingKindSchema = z.enum(RECORDING_KINDS);
export type RecordingKind = z.infer<typeof RecordingKindSchema>;
/** Kinds a client may upload itself (call recordings are made by the server). */
export const CLIENT_RECORDING_KINDS = ['voice', 'video', 'screen'] as const;
/** Chat clips are capped at 30 minutes. */
export const MAX_CLIP_DURATION_MS = 30 * 60_000;

export const ATTACHMENT_STATUSES = ['pending', 'ready'] as const;
export type AttachmentStatus = (typeof ATTACHMENT_STATUSES)[number];

const FileName = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((n) => !/[\\/\u0000-\u001f]/.test(n), 'invalid file name')
  .refine((n) => {
    const ext = n.includes('.') ? n.split('.').pop()!.toLowerCase() : '';
    return !(BLOCKED_EXTENSIONS as readonly string[]).includes(ext);
  }, 'this file type is not allowed');

/** POST /v1/uploads */
export const CreateUploadRequestSchema = z.object({
  conversationId: ServerIdSchema,
  fileName: FileName,
  mimeType: z
    .string()
    .trim()
    .max(127)
    .regex(/^[\w.+-]+\/[\w.+-]+$/, 'invalid MIME type'),
  sizeBytes: z.number().int().positive().max(MAX_ATTACHMENT_BYTES),
  /** Optional hex SHA-256; when given, the server verifies the uploaded bytes against it. */
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  width: z.number().int().positive().max(20000).optional(),
  height: z.number().int().positive().max(20000).optional(),
  /** Set for a clip recorded in the app (voice message, video message, screen recording). */
  recording: z.enum(CLIENT_RECORDING_KINDS).optional(),
  durationMs: z.number().int().positive().max(MAX_CLIP_DURATION_MS).optional(),
});
export type CreateUploadRequest = z.input<typeof CreateUploadRequestSchema>;

export const AttachmentSchema = z.object({
  attachmentId: ServerIdSchema,
  conversationId: ServerIdSchema,
  uploaderId: ServerIdSchema,
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  status: z.enum(ATTACHMENT_STATUSES),
  createdAt: z.string().datetime(),
  /** Recording kind, or null for an ordinary file. Absent on data cached by older clients. */
  recording: RecordingKindSchema.nullable().optional(),
  durationMs: z.number().int().nonnegative().nullable().optional(),
  /** Set once the file was deleted (by a person or by the retention policy). Bytes are gone. */
  deletedAt: z.string().datetime().nullable().optional(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;

/**
 * Response of POST /v1/uploads. The client then sends the raw bytes:
 *   PUT {uploadUrl} with `Authorization: Bearer <access token>` and
 *   `Content-Type: application/octet-stream`, then POST /v1/uploads/:uploadId/complete.
 * `uploadUrl` is a path relative to the API base URL.
 */
export const UploadTicketSchema = z.object({
  uploadId: ServerIdSchema,
  uploadUrl: z.string(),
  expiresAt: z.string().datetime(),
  attachment: AttachmentSchema,
});
export type UploadTicket = z.infer<typeof UploadTicketSchema>;

/**
 * GET /v1/attachments/:id/url: a signed, short-lived download URL (no auth header needed).
 * `url` is absolute when the API has PUBLIC_API_URL set, otherwise a path: resolve it with
 * `new URL(url, apiBaseUrl)`, which handles both.
 */
export const AttachmentUrlSchema = z.object({
  url: z.string(),
  expiresAt: z.string().datetime(),
});
export type AttachmentUrl = z.infer<typeof AttachmentUrlSchema>;

export const isImageAttachment = (a: Pick<Attachment, 'mimeType'>) =>
  /^image\/(png|jpe?g|gif|webp|avif)$/.test(a.mimeType);

export const isAudioAttachment = (a: Pick<Attachment, 'mimeType'>) =>
  /^audio\/(webm|ogg|mpeg|mp4|aac|x-m4a|m4a|wav)$/.test(a.mimeType);
export const isVideoAttachment = (a: Pick<Attachment, 'mimeType'>) =>
  /^video\/(webm|mp4|quicktime)$/.test(a.mimeType);

/** "1:05" or "1:02:03". */
export function formatClipDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = (total % 60).toString().padStart(2, '0');
  return h ? `${h}:${m.toString().padStart(2, '0')}:${s}` : `${m}:${s}`;
}
