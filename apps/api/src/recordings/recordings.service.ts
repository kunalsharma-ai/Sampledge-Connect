import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import type { Db } from 'mongodb';
import type { Redis } from 'ioredis';
import {
  DEFAULT_RECORDING_SETTINGS,
  ExportRecordingsRequestSchema,
  ListRecordingsQuerySchema,
  MAX_EXPORT_BYTES,
  RecordingSettingsSchema,
  formatCallDuration,
  tenantCan,
  type ExportRecordingsResponse,
  type Recording,
  type RecordingList,
  type RecordingSettings,
  type RecordingSystemMetadata,
} from '@sampledge/contracts';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { AppError, forbidden, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import type {
  AttachmentDoc,
  CallDoc,
  CallRecordingDoc,
  ConversationDoc,
  TenantSettingsDoc,
} from '../database/documents.js';
import { MONGO_DB } from '../database/database.module.js';
import { TenantDb } from '../database/tenant-db.js';
import { AttachmentsService } from '../attachments/attachments.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { MessagesService } from '../messages/messages.service.js';
import { REDIS } from '../redis/redis.module.js';
import { ZipWriter, safeName } from './zip.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';

const RETENTION_EVERY_MS = 60 * 60_000;
const EXPORT_URL_TTL_S = 30 * 60;
const MODERATOR_ROLES = new Set(['owner', 'moderator']);

/**
 * Recordings library, deletion (manual and by retention policy), backups (single download via
 * signed file links; bulk ZIP export for admins) and import of finished call recordings.
 */
@Injectable()
export class RecordingsService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger(RecordingsService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: TenantDb,
    @Inject(MONGO_DB) private readonly rawDb: Db,
    private readonly attachments: AttachmentsService,
    private readonly conversations: ConversationsService,
    private readonly messages: MessagesService,
    readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly realtime: RealtimePublisher,
  ) {}

  onModuleInit() {
    if (this.cfg.NODE_ENV === 'test') return; // tests call applyRetention() directly
    const run = async () => {
      const ok = await this.redis.set('lock:recordings:retention', '1', 'PX', 10 * 60_000, 'NX');
      if (ok === 'OK') await this.applyRetention();
    };
    this.timer = setInterval(() => void run().catch(() => undefined), RETENTION_EVERY_MS);
    this.timer.unref();
    setTimeout(() => void run().catch(() => undefined), 30_000).unref();
  }
  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------- settings ----------

  async settings(tenantId: string): Promise<RecordingSettings> {
    const s = await this.db.for(tenantId).tenant_settings.findOne({});
    return s
      ? { retentionDays: s.recordingRetentionDays, callRecordingEnabled: s.callRecordingEnabled }
      : DEFAULT_RECORDING_SETTINGS;
  }

  async getSettings(ctx: TenantContext): Promise<RecordingSettings> {
    if (!tenantCan(ctx.role, 'recordings.manage')) throw forbidden();
    return this.settings(ctx.tenantId);
  }

  async setSettings(ctx: TenantContext, input: unknown): Promise<RecordingSettings> {
    if (!tenantCan(ctx.role, 'recordings.manage')) throw forbidden();
    const req = parse(RecordingSettingsSchema, input);
    await this.db.for(ctx.tenantId).tenant_settings.updateOne(
      {},
      {
        $set: {
          recordingRetentionDays: req.retentionDays,
          callRecordingEnabled: req.callRecordingEnabled,
          updatedAt: new Date(),
          updatedBy: ctx.userId,
        },
      },
      { upsert: true },
    );
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'recordings.settings.update',
      metadata: { ...req },
    });
    // Apply a shorter policy straight away rather than waiting for the hourly run.
    if (req.retentionDays)
      void this.applyRetention(new Date(), ctx.tenantId).catch(() => undefined);
    this.realtime.toTenant(ctx.tenantId, 'tenant:updated', { area: 'recordings' });
    return req;
  }

  // ---------- library ----------

  async list(ctx: TenantContext, query: unknown): Promise<RecordingList> {
    const q = parse(ListRecordingsQuerySchema, query ?? {});
    const t = this.db.for(ctx.tenantId);
    const memberships = await t.conversation_members
      .find(
        q.conversationId
          ? { userId: ctx.userId, conversationId: q.conversationId }
          : { userId: ctx.userId },
        { projection: { conversationId: 1, role: 1 } },
      )
      .toArray();
    if (q.conversationId && !memberships.length) {
      await this.conversations.authorize(ctx, q.conversationId, 'conversation.read');
    }
    const roleIn = new Map(memberships.map((m) => [m.conversationId, m.role as string]));
    const convIds = q.conversationId ? [q.conversationId] : [...roleIn.keys()];
    if (!convIds.length) return { items: [], nextBefore: null };
    const docs = await t.attachments
      .find(
        {
          conversationId: { $in: convIds },
          recording: q.kind ? q.kind : { $type: 'string' },
          status: 'ready',
          deletedAt: null,
          ...(q.before ? { createdAt: { $lt: new Date(q.before) } } : {}),
        } as never,
        { sort: { createdAt: -1 }, limit: q.limit },
      )
      .toArray();
    const settings = await this.settings(ctx.tenantId);
    const names = await this.conversationNames(ctx, [
      ...new Set(docs.map((d) => d.conversationId)),
    ]);
    return {
      items: docs.map((d) =>
        this.toRecording(ctx, d, settings, names, roleIn.get(d.conversationId)),
      ),
      nextBefore: docs.length === q.limit ? docs.at(-1)!.createdAt.toISOString() : null,
    };
  }

  private toRecording(
    ctx: TenantContext,
    d: AttachmentDoc,
    settings: RecordingSettings,
    names: Map<string, string>,
    role: string | undefined,
  ): Recording {
    return {
      recordingId: d._id,
      conversationId: d.conversationId,
      conversationName: names.get(d.conversationId) ?? 'Conversation',
      kind: d.recording!,
      fileName: d.fileName,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      durationMs: d.durationMs ?? null,
      createdBy: d.uploaderId,
      createdAt: d.createdAt.toISOString(),
      expiresAt: settings.retentionDays
        ? new Date(d.createdAt.getTime() + settings.retentionDays * 86_400_000).toISOString()
        : null,
      messageId: d.messageId,
      callId: d.callId ?? null,
      canDelete: this.canDelete(ctx, d, role),
    };
  }

  private canDelete(ctx: TenantContext, d: AttachmentDoc, role: string | undefined) {
    return (
      d.uploaderId === ctx.userId ||
      tenantCan(ctx.role, 'recordings.manage') ||
      (role !== undefined && MODERATOR_ROLES.has(role))
    );
  }

  private async conversationNames(ctx: TenantContext, ids: string[]) {
    const t = this.db.for(ctx.tenantId);
    const convs = ids.length
      ? await t.conversations.find({ _id: { $in: ids } }).toArray()
      : ([] as ConversationDoc[]);
    const otherIds = convs
      .filter((c) => !c.name && c.dmKey)
      .map((c) => c.dmKey!.split(':').find((u) => u !== ctx.userId) ?? ctx.userId);
    const users = otherIds.length
      ? await t.users.find({ _id: { $in: otherIds } }, { projection: { displayName: 1 } }).toArray()
      : [];
    const userName = new Map(users.map((u) => [u._id, u.displayName]));
    return new Map(
      convs.map((c) => {
        if (c.name) return [c._id, c.name] as const;
        const other = c.dmKey?.split(':').find((u) => u !== ctx.userId) ?? ctx.userId;
        return [c._id, userName.get(other) ?? 'Direct message'] as const;
      }),
    );
  }

  /** Manual delete: the person who recorded it, a conversation moderator, or a tenant admin. */
  async remove(ctx: TenantContext, recordingId: string): Promise<{ deleted: true }> {
    const t = this.db.for(ctx.tenantId);
    const d = await t.attachments.findOne({ _id: recordingId });
    if (!d || !d.recording || d.deletedAt) throw notFound('Recording');
    const { membership } = await this.conversations.authorize(
      ctx,
      d.conversationId,
      'conversation.read',
    );
    if (!this.canDelete(ctx, d, membership?.role))
      throw forbidden('Only the person who recorded this, a moderator or an admin can delete it');
    await this.eraseOne(ctx.tenantId, d, ctx.userId);
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'recording.delete',
      target: { type: 'attachment', id: d._id },
      metadata: { kind: d.recording, conversationId: d.conversationId },
    });
    return { deleted: true };
  }

  private async eraseOne(tenantId: string, d: AttachmentDoc, by: string | null) {
    if (!(await this.attachments.erase(tenantId, d, by))) return;
    this.realtime.toConversation(tenantId, d.conversationId, 'recording:changed', {
      recordingId: d._id,
      conversationId: d.conversationId,
      deleted: true,
    });
    if (d.messageId)
      await this.messages
        .markAttachmentDeleted(tenantId, d.messageId, d._id, new Date())
        .catch((e) => this.log.warn(`could not mark ${d._id} deleted on message: ${String(e)}`));
  }

  /** Deletes recordings older than each tenant's retention period. Returns how many. */
  async applyRetention(now = new Date(), onlyTenant?: string): Promise<number> {
    const policies = await this.rawDb
      .collection<TenantSettingsDoc>('tenant_settings')
      .find({
        recordingRetentionDays: { $ne: null },
        ...(onlyTenant ? { tenantId: onlyTenant } : {}),
      })
      .toArray();
    let deleted = 0;
    for (const p of policies) {
      const cutoff = new Date(now.getTime() - p.recordingRetentionDays! * 86_400_000);
      const old = await this.db
        .for(p.tenantId)
        .attachments.find(
          { recording: { $type: 'string' }, deletedAt: null, createdAt: { $lt: cutoff } } as never,
          { limit: 500 },
        )
        .toArray();
      for (const d of old) {
        try {
          await this.eraseOne(p.tenantId, d, null);
          deleted++;
        } catch (e) {
          this.log.warn(`retention delete of ${d._id} failed: ${String(e)}`);
        }
      }
      if (old.length)
        await this.audit.record({
          tenantId: p.tenantId,
          actorId: null,
          action: 'recordings.retention.delete',
          metadata: { count: old.length, retentionDays: p.recordingRetentionDays },
        });
    }
    return deleted;
  }

  // ---------- bulk export ----------

  private exportFilter(req: { from: string; to: string; conversationId?: string }) {
    return {
      recording: { $type: 'string' },
      status: 'ready',
      deletedAt: null,
      createdAt: { $gte: new Date(req.from), $lt: new Date(req.to) },
      ...(req.conversationId ? { conversationId: req.conversationId } : {}),
    } as never;
  }

  private exportPayload(tenantId: string, from: string, to: string, conv: string, exp: number) {
    return `export.${tenantId}.${from}.${to}.${conv}.${exp}`;
  }

  async createExport(ctx: TenantContext, input: unknown): Promise<ExportRecordingsResponse> {
    if (!tenantCan(ctx.role, 'recordings.manage')) throw forbidden();
    const req = parse(ExportRecordingsRequestSchema, input);
    const docs = await this.db
      .for(ctx.tenantId)
      .attachments.find(this.exportFilter(req), { projection: { sizeBytes: 1 } })
      .toArray();
    const totalBytes = docs.reduce((n, d) => n + d.sizeBytes, 0);
    if (totalBytes > MAX_EXPORT_BYTES)
      throw new AppError(
        'VALIDATION_FAILED',
        'That is more than 4 GB of recordings. Choose a shorter date range.',
      );
    const exp = Math.floor(Date.now() / 1000) + EXPORT_URL_TTL_S;
    const conv = req.conversationId ?? '';
    const sig = this.attachments.signPayload(
      this.exportPayload(ctx.tenantId, req.from, req.to, conv, exp),
    );
    const qs = new URLSearchParams({ from: req.from, to: req.to, exp: String(exp), sig });
    if (conv) qs.set('conversationId', conv);
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'recordings.export',
      metadata: { from: req.from, to: req.to, conversationId: conv || null, count: docs.length },
    });
    return {
      url: `${this.cfg.PUBLIC_API_URL ?? ''}/v1/recordings/export/${ctx.tenantId}?${qs}`,
      expiresAt: new Date(exp * 1000).toISOString(),
      count: docs.length,
      totalBytes,
    };
  }

  /** Verifies a signed export link and streams the ZIP into `out`. */
  async streamExport(
    tenantId: string,
    q: { from?: string; to?: string; conversationId?: string; exp?: string; sig?: string },
  ): Promise<{ fileName: string; stream: PassThrough }> {
    const exp = Number(q.exp);
    if (!Number.isInteger(exp) || exp < Date.now() / 1000)
      throw new AppError('FORBIDDEN', 'Link expired');
    const req = parse(ExportRecordingsRequestSchema, {
      from: q.from,
      to: q.to,
      ...(q.conversationId ? { conversationId: q.conversationId } : {}),
    });
    const payload = this.exportPayload(tenantId, req.from, req.to, req.conversationId ?? '', exp);
    if (!this.attachments.verifyPayload(payload, String(q.sig ?? '')))
      throw new AppError('FORBIDDEN', 'Invalid link');

    const t = this.db.for(tenantId);
    const docs = await t.attachments
      .find(this.exportFilter(req), { sort: { createdAt: 1 } })
      .toArray();
    const fake = { tenantId, userId: '' } as TenantContext;
    const names = await this.conversationNames(fake, [
      ...new Set(docs.map((d) => d.conversationId)),
    ]);
    const users = await t.users
      .find(
        { _id: { $in: [...new Set(docs.map((d) => d.uploaderId))] } },
        { projection: { displayName: 1 } },
      )
      .toArray();
    const userName = new Map(users.map((u) => [u._id, u.displayName]));

    const out = new PassThrough();
    const zip = new ZipWriter(out);
    void (async () => {
      const used = new Set<string>();
      const rows = [
        'file,conversation,kind,recorded_by,recorded_at,duration_seconds,size_bytes,recording_id',
      ];
      for (const d of docs) {
        const folder = safeName(names.get(d.conversationId) ?? d.conversationId);
        let path = `${folder}/${d.createdAt.toISOString().slice(0, 19).replace(/:/g, '-')} ${safeName(d.fileName)}`;
        for (let i = 2; used.has(path); i++)
          path = path.replace(/( \(\d+\))?(\.[^./]*)?$/, ` (${i})$2`);
        used.add(path);
        await zip.add(path, this.attachments.openStored(d), d.createdAt);
        rows.push(
          [
            path,
            names.get(d.conversationId) ?? '',
            d.recording,
            userName.get(d.uploaderId) ?? d.uploaderId,
            d.createdAt.toISOString(),
            d.durationMs ? Math.round(d.durationMs / 1000) : '',
            d.sizeBytes,
            d._id,
          ]
            .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
            .join(','),
        );
      }
      await zip.add('manifest.csv', Buffer.from(rows.join('\n') + '\n', 'utf8'));
      await zip.finish();
    })().catch((e) => {
      this.log.warn(`export failed: ${String(e)}`);
      out.destroy(e as Error);
    });
    const day = (s: string) => s.slice(0, 10);
    return { fileName: `recordings ${day(req.from)} to ${day(req.to)}.zip`, stream: out };
  }

  // ---------- call recordings ----------

  /**
   * Moves a finished egress file from the spool folder into tenant storage and posts it in
   * the call's conversation. The file name is the one we chose when starting the recording;
   * nothing from the webhook is used to build a path.
   */
  async importCallRecording(
    call: CallDoc,
    rec: CallRecordingDoc,
    durationMs: number,
  ): Promise<AttachmentDoc | null> {
    const dir = this.cfg.RECORDINGS_SPOOL_DIR;
    if (!dir) return null;
    const path = `${dir.replace(/\/$/, '')}/${rec.fileName}`;
    let size: number;
    try {
      size = (await stat(path)).size;
    } catch {
      this.log.warn(`recording file for call ${call._id} not found at ${path}`);
      await this.postFailed(call, rec);
      return null;
    }
    if (size > this.cfg.RECORDING_MAX_BYTES) {
      this.log.warn(`recording for call ${call._id} is ${size} bytes, over RECORDING_MAX_BYTES`);
      await unlink(path).catch(() => undefined);
      await this.postFailed(call, rec);
      return null;
    }
    const when = rec.startedAt.toISOString().slice(0, 16).replace('T', ' ').replace(':', '-');
    const ext = rec.audioOnly ? 'm4a' : 'mp4';
    const doc = await this.attachments.ingest(
      call.tenantId,
      {
        conversationId: call.conversationId,
        uploaderId: rec.startedBy,
        fileName: `Call recording ${when}.${ext}`,
        mimeType: rec.audioOnly ? 'audio/mp4' : 'video/mp4',
        recording: 'call',
        durationMs,
        callId: call._id,
      },
      createReadStream(path),
    );
    const meta: RecordingSystemMetadata = {
      callId: call._id,
      attachmentId: doc._id,
      startedBy: rec.startedBy,
      startedAt: rec.startedAt.toISOString(),
      durationMs,
      audioOnly: rec.audioOnly,
      failed: false,
    };
    const msg = await this.messages.postSystem(
      call.tenantId,
      call.conversationId,
      rec.startedBy,
      `Call recording · ${formatCallDuration(Math.round(durationMs / 1000))}`,
      { recording: meta },
      [
        {
          attachmentId: doc._id,
          fileName: doc.fileName,
          mimeType: doc.mimeType,
          sizeBytes: doc.sizeBytes,
          width: null,
          height: null,
          createdAt: doc.createdAt,
          recording: 'call',
          durationMs,
        },
      ],
    );
    await this.db
      .for(call.tenantId)
      .attachments.updateOne({ _id: doc._id }, { $set: { messageId: msg.messageId } });
    await unlink(path).catch(() => undefined);
    await this.removeManifest(rec);
    this.realtime.toConversation(call.tenantId, call.conversationId, 'recording:changed', {
      recordingId: doc._id,
      conversationId: call.conversationId,
      deleted: false,
    });
    return { ...doc, messageId: msg.messageId };
  }

  /** Egress writes `<egressId>.json` next to each file; it isn't needed once imported. */
  private async removeManifest(rec: CallRecordingDoc) {
    const dir = this.cfg.RECORDINGS_SPOOL_DIR;
    if (dir && rec.egressId && /^EG_[A-Za-z0-9]+$/.test(rec.egressId))
      await unlink(`${dir.replace(/\/$/, '')}/${rec.egressId}.json`).catch(() => undefined);
  }

  async postFailed(call: CallDoc, rec: CallRecordingDoc) {
    await this.removeManifest(rec);
    await this.messages
      .postSystem(call.tenantId, call.conversationId, rec.startedBy, 'Call recording failed', {
        recording: {
          callId: call._id,
          attachmentId: null,
          startedBy: rec.startedBy,
          startedAt: rec.startedAt.toISOString(),
          durationMs: 0,
          audioOnly: rec.audioOnly,
          failed: true,
        },
      })
      .catch(() => undefined);
  }
}
