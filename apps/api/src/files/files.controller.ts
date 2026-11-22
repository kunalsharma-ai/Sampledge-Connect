import { Controller, Get, Injectable, Query, UseGuards } from '@nestjs/common';
import type { Filter } from 'mongodb';
import {
  ListFilesQuerySchema,
  fileKindOf,
  type FileKind,
  type FileList,
} from '@sampledge/contracts';
import { parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { AuthGuard, Ctx } from '../auth/auth.guard.js';
import { TenantDb } from '../database/tenant-db.js';
import type { AttachmentDoc } from '../database/documents.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { toAttachment } from '../attachments/attachments.service.js';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DOC_MIME =
  /^(application\/pdf|text\/|.*(word|excel|spreadsheet|presentation|powerpoint|opendocument))/i;
const DOC_EXT = /\.(pdf|docx?|xlsx?|pptx?|csv|txt|md|odt|ods|odp|rtf)$/i;
const KIND_FILTER: Record<FileKind, Filter<AttachmentDoc>> = {
  images: { mimeType: /^image\//i },
  media: { mimeType: /^(audio|video)\//i },
  documents: {
    mimeType: { $not: /^(image|audio|video)\//i },
    $or: [{ mimeType: DOC_MIME }, { fileName: DOC_EXT }],
  },
  other: {
    $nor: [{ mimeType: /^(image|audio|video)\//i }, { mimeType: DOC_MIME }, { fileName: DOC_EXT }],
  },
};

/**
 * The Files screen: every file shared in conversations the caller can open (members, plus public
 * channels in their workspace), wherever the bytes live (Connect storage or Nextcloud).
 * Downloads go through the usual signed URL, GET /v1/attachments/:id/url.
 */
@Injectable()
export class FilesService {
  constructor(
    private readonly db: TenantDb,
    private readonly conversations: ConversationsService,
  ) {}

  async list(ctx: TenantContext, input: unknown): Promise<FileList> {
    const q = parse(ListFilesQuerySchema, input);
    const readable = await this.conversations.listReadable(ctx);
    const ids = readable.map((c) => c.conversationId).filter((id) => !q.in || id === q.in);
    if (!ids.length) return { items: [], nextBefore: null };
    const and: Filter<AttachmentDoc>[] = [
      { conversationId: { $in: ids } },
      { status: 'ready', messageId: { $ne: null }, deletedAt: null },
    ];
    if (!q.recordings) and.push({ recording: null });
    if (q.kind) and.push(KIND_FILTER[q.kind]);
    if (q.from) and.push({ uploaderId: q.from });
    if (q.before) and.push({ createdAt: { $lt: new Date(q.before) } });
    for (const term of (q.q ?? '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8))
      and.push({ fileName: new RegExp(escapeRe(term), 'i') });
    const rows = await this.db
      .for(ctx.tenantId)
      .attachments.find({ $and: and } as Filter<AttachmentDoc>, {
        sort: { createdAt: -1 },
        limit: q.limit + 1,
        maxTimeMS: 2500,
      })
      .toArray();
    const page = rows.slice(0, q.limit);
    return {
      items: page.map((a) => ({
        ...toAttachment(a),
        sizeBytes: a.storedBytes ?? a.sizeBytes,
        messageId: a.messageId,
        kind: fileKindOf(a.mimeType, a.fileName),
        storage: a.storage?.backend === 'nextcloud' ? 'nextcloud' : 'connect',
      })),
      nextBefore: rows.length > q.limit ? page[page.length - 1]!.createdAt.toISOString() : null,
    };
  }
}

@Controller('v1')
@UseGuards(AuthGuard)
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Get('files')
  list(@Ctx() ctx: TenantContext, @Query() query: Record<string, string>) {
    return this.files.list(ctx, query);
  }
}
