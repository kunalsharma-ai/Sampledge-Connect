import { Inject, Injectable } from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Transform, type Readable } from 'node:stream';
import {
  CreateUploadRequestSchema,
  DOWNLOAD_URL_TTL_SECONDS,
  UPLOAD_TICKET_TTL_SECONDS,
  type Attachment,
  type AttachmentUrl,
  type UploadTicket,
} from '@sampledge/contracts';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { AppError, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import type { AttachmentDoc } from '../database/documents.js';
import { TenantDb } from '../database/tenant-db.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { RateLimitService } from '../redis/redis.module.js';
import { FILE_STORAGE, type FileStorage } from './file-storage.js';

export function toAttachment(a: AttachmentDoc): Attachment {
  return {
    attachmentId: a._id,
    conversationId: a.conversationId,
    uploaderId: a.uploaderId,
    fileName: a.fileName,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    width: a.width,
    height: a.height,
    status: a.status,
    createdAt: a.createdAt.toISOString(),
  };
}

/** Types a browser may render inline; everything else downloads as a file. */
const INLINE_TYPES = /^(image\/(png|jpeg|gif|webp|avif)|application\/pdf|text\/plain)$/;

@Injectable()
export class AttachmentsService {
  private readonly secret: Buffer;

  constructor(
    private readonly db: TenantDb,
    private readonly conversations: ConversationsService,
    private readonly rateLimit: RateLimitService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {
    // Dev/test: a per-process key (signed URLs simply expire on restart).
    this.secret = cfg.FILES_URL_SECRET ? Buffer.from(cfg.FILES_URL_SECRET) : randomBytes(32);
  }

  async createUpload(ctx: TenantContext, input: unknown): Promise<UploadTicket> {
    const req = parse(CreateUploadRequestSchema, input);
    await this.conversations.authorize(ctx, req.conversationId, 'message.send');
    await this.rateLimit.consume('upload', `${ctx.tenantId}:${ctx.userId}`);
    const doc = await this.db.for(ctx.tenantId).attachments.insertOne({
      conversationId: req.conversationId,
      uploaderId: ctx.userId,
      fileName: req.fileName,
      mimeType: req.mimeType.toLowerCase(),
      sizeBytes: req.sizeBytes,
      storedBytes: null,
      sha256: req.sha256 ?? null,
      width: req.width ?? null,
      height: req.height ?? null,
      status: 'pending',
      storageKey: null,
      messageId: null,
      createdAt: new Date(),
      completedAt: null,
    });
    return {
      uploadId: doc._id,
      uploadUrl: `/v1/uploads/${doc._id}/content`,
      expiresAt: new Date(doc.createdAt.getTime() + UPLOAD_TICKET_TTL_SECONDS * 1000).toISOString(),
      attachment: toAttachment(doc),
    };
  }

  private async ownPending(ctx: TenantContext, uploadId: string): Promise<AttachmentDoc> {
    const a = await this.db.for(ctx.tenantId).attachments.findOne({ _id: uploadId });
    if (!a || a.uploaderId !== ctx.userId) throw notFound('Upload');
    if (a.status !== 'pending') throw new AppError('CONFLICT', 'Upload already completed');
    if (Date.now() - a.createdAt.getTime() > UPLOAD_TICKET_TTL_SECONDS * 1000) {
      throw new AppError('CONFLICT', 'Upload ticket expired; request a new one');
    }
    return a;
  }

  /** Streams the body to storage, enforcing the declared size and optional SHA-256. */
  async putContent(ctx: TenantContext, uploadId: string, body: Readable): Promise<Attachment> {
    const a = await this.ownPending(ctx, uploadId);
    const hash = createHash('sha256');
    const declared = Number(
      (body as Readable & { headers?: Record<string, string> }).headers?.['content-length'],
    );
    if (Number.isFinite(declared) && declared !== a.sizeBytes) {
      body.resume(); // drain and discard
      throw new AppError('VALIDATION_FAILED', 'File size does not match the declared size');
    }
    let bytes = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        bytes += chunk.length;
        if (bytes > a.sizeBytes) {
          // Chunked body larger than declared: stop reading. The source error ends the pipeline.
          body.destroy(new AppError('VALIDATION_FAILED', 'File is larger than declared'));
          return cb();
        }
        hash.update(chunk);
        cb(null, chunk);
      },
    });
    const key = `${ctx.tenantId}/${a._id}`;
    try {
      await this.storage.put(key, body.pipe(meter), {
        tenantId: ctx.tenantId,
        contentType: a.mimeType,
      });
    } catch (e) {
      await this.storage.delete(key).catch(() => undefined);
      if (e instanceof AppError) throw e;
      throw new AppError('VALIDATION_FAILED', 'Upload interrupted');
    }
    const digest = hash.digest('hex');
    if (bytes !== a.sizeBytes || (a.sha256 && a.sha256 !== digest)) {
      await this.storage.delete(key);
      throw new AppError(
        'VALIDATION_FAILED',
        bytes !== a.sizeBytes ? 'File size does not match the declared size' : 'Checksum mismatch',
      );
    }
    const updated = await this.db
      .for(ctx.tenantId)
      .attachments.findOneAndUpdate(
        { _id: a._id, status: 'pending' },
        { $set: { storageKey: key, storedBytes: bytes, sha256: digest } },
        { returnDocument: 'after' },
      );
    return toAttachment(updated!);
  }

  async complete(ctx: TenantContext, uploadId: string): Promise<Attachment> {
    const a = await this.db.for(ctx.tenantId).attachments.findOne({ _id: uploadId });
    if (!a || a.uploaderId !== ctx.userId) throw notFound('Upload');
    if (a.status === 'ready') return toAttachment(a); // idempotent
    if (!a.storageKey || a.storedBytes !== a.sizeBytes) {
      throw new AppError('CONFLICT', 'Upload the file content before completing');
    }
    const updated = await this.db
      .for(ctx.tenantId)
      .attachments.findOneAndUpdate(
        { _id: a._id },
        { $set: { status: 'ready', completedAt: new Date() } },
        { returnDocument: 'after' },
      );
    return toAttachment(updated!);
  }

  async get(ctx: TenantContext, attachmentId: string): Promise<AttachmentDoc> {
    const a = await this.db.for(ctx.tenantId).attachments.findOne({ _id: attachmentId });
    if (!a) throw notFound('Attachment');
    await this.conversations.authorize(ctx, a.conversationId, 'conversation.read');
    if (a.status !== 'ready') {
      if (a.uploaderId !== ctx.userId) throw notFound('Attachment');
    }
    return a;
  }

  private sign(tenantId: string, id: string, exp: number) {
    return createHmac('sha256', this.secret).update(`${tenantId}.${id}.${exp}`).digest('base64url');
  }

  async signedUrl(ctx: TenantContext, attachmentId: string): Promise<AttachmentUrl> {
    const a = await this.get(ctx, attachmentId);
    if (a.status !== 'ready') throw new AppError('CONFLICT', 'Attachment is not ready');
    const exp = Math.floor(Date.now() / 1000) + DOWNLOAD_URL_TTL_SECONDS;
    const path = `/v1/files/${ctx.tenantId}/${a._id}?exp=${exp}&sig=${this.sign(ctx.tenantId, a._id, exp)}`;
    return {
      url: (this.cfg.PUBLIC_API_URL ?? '') + path,
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  }

  /** Verifies a signed URL and returns what to stream. No bearer token: the signature is the capability. */
  async openSigned(tenantId: string, id: string, exp: string, sig: string) {
    const e = Number(exp);
    if (!Number.isInteger(e) || e < Date.now() / 1000)
      throw new AppError('FORBIDDEN', 'Link expired');
    const expected = Buffer.from(this.sign(tenantId, id, e));
    const given = Buffer.from(String(sig));
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      throw new AppError('FORBIDDEN', 'Invalid link');
    }
    const a = await this.db.for(tenantId).attachments.findOne({ _id: id });
    if (!a || a.status !== 'ready' || !a.storageKey) throw notFound('Attachment');
    return {
      stream: this.storage.get(a.storageKey),
      fileName: a.fileName,
      mimeType: a.mimeType,
      size: a.sizeBytes,
      inline: INLINE_TYPES.test(a.mimeType),
    };
  }
}
