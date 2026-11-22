import { z } from 'zod';
import { ServerIdSchema } from './ids.js';
import { AttachmentSchema } from './attachments.js';

/** Files screen: every file shared in conversations you can open, newest first. */
export const FILE_KINDS = ['documents', 'images', 'media', 'other'] as const;
export const FileKindSchema = z.enum(FILE_KINDS);
export type FileKind = z.infer<typeof FileKindSchema>;

export function fileKindOf(mimeType: string, fileName = ''): FileKind {
  const m = mimeType.toLowerCase();
  if (m.startsWith('image/')) return 'images';
  if (m.startsWith('audio/') || m.startsWith('video/')) return 'media';
  if (
    m === 'application/pdf' ||
    m.startsWith('text/') ||
    m.includes('word') ||
    m.includes('excel') ||
    m.includes('spreadsheet') ||
    m.includes('presentation') ||
    m.includes('powerpoint') ||
    m.includes('opendocument') ||
    /\.(pdf|docx?|xlsx?|pptx?|csv|txt|md|odt|ods|odp|rtf)$/i.test(fileName)
  )
    return 'documents';
  return 'other';
}

/** GET /v1/files */
export const ListFilesQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  kind: FileKindSchema.optional(),
  in: ServerIdSchema.optional(),
  from: ServerIdSchema.optional(),
  /** Include call and voice recordings (they also have their own screen). */
  recordings: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  /** Cursor: createdAt of the last item of the previous page. */
  before: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});
export type ListFilesQuery = z.input<typeof ListFilesQuerySchema>;

export const FileItemSchema = AttachmentSchema.extend({
  messageId: ServerIdSchema.nullable(),
  kind: FileKindSchema,
  /** Where the bytes live, so admins can see Nextcloud is in use. */
  storage: z.enum(['connect', 'nextcloud']),
});
export type FileItem = z.infer<typeof FileItemSchema>;

export const FileListSchema = z.object({
  items: z.array(FileItemSchema),
  nextBefore: z.iso.datetime().nullable(),
});
export type FileList = z.infer<typeof FileListSchema>;
