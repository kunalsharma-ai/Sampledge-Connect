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

/** GET /v1/attachments/:id/url: a signed, short-lived download URL (no auth header needed). */
export const AttachmentUrlSchema = z.object({
  url: z.string(),
  expiresAt: z.string().datetime(),
});
export type AttachmentUrl = z.infer<typeof AttachmentUrlSchema>;

export const isImageAttachment = (a: Pick<Attachment, 'mimeType'>) =>
  /^image\/(png|jpe?g|gif|webp|avif)$/.test(a.mimeType);
