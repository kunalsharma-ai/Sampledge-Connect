import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import {
  AI_TRANSCRIPTION_INTEGRATION_ID,
  TRANSCRIPT_MAX_BYTES,
  isAudioAttachment,
  isVideoAttachment,
  type AiStatus,
  type AiTranscript,
  type RecordingKind,
} from '@sampledge/contracts';
import { AppError, forbidden, notFound } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import type { AiTranscriptDoc, AttachmentDoc } from '../database/documents.js';
import { TenantDb } from '../database/tenant-db.js';
import { AuditService } from '../audit/audit.service.js';
import { AttachmentsService } from '../attachments/attachments.service.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service.js';
import { REDIS, RateLimitService } from '../redis/redis.module.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import {
  AI_TRANSCRIPTION_PROVIDER,
  SttClient,
  SttUnavailableError,
  sttSettingsFromValues,
  type SttSettings,
} from './transcription.js';

const SWEEP_MS = 20_000;
/** Jobs per tenant per sweep; each can take minutes on a CPU. */
const JOBS_PER_SWEEP = 2;
/** Recordings older than this are not queued automatically. */
const AUTO_WINDOW_MS = 7 * 86_400_000;
/** A job stuck in `processing` this long (API restarted mid-job) is queued again. */
const STALE_MS = 30 * 60_000;
const MAX_ATTEMPTS = 3;
/** Characters of one transcript the assistant reads (summaries, search). */
export const TRANSCRIPT_READ_CHARS = 8_000;

type Config = AiStatus['transcription'];

/**
 * Transcripts of call recordings, voice messages and recorded video, made by the
 * organization's own speech-to-text server. Nothing is sent anywhere else. Reading a
 * transcript needs the same access as playing the recording; deleting the recording
 * deletes its transcript.
 */
@Injectable()
export class TranscriptsService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger('Transcripts');
  private timer: NodeJS.Timeout | null = null;
  private sweeping = false;
  /** Tests swap in a fake server. */
  fetchImpl: typeof fetch = fetch;

  constructor(
    private readonly db: TenantDb,
    private readonly store: IntegrationSettingsService,
    private readonly attachments: AttachmentsService,
    private readonly conversations: ConversationsService,
    private readonly audit: AuditService,
    private readonly rateLimit: RateLimitService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  onModuleInit() {
    this.store.register(AI_TRANSCRIPTION_PROVIDER, {
      test: async (values) => {
        const s = sttSettingsFromValues(values);
        if (!s) return { ok: false, message: 'Server URL and model are required' };
        return new SttClient(s, this.fetchImpl).test();
      },
    });
    if (this.cfg.NODE_ENV === 'test') return; // tests call sweep() directly
    this.timer = setInterval(() => void this.sweep().catch(() => undefined), SWEEP_MS);
    this.timer.unref();
  }
  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------- settings ----------

  async settings(tenantId: string): Promise<SttSettings | null> {
    try {
      const r = await this.store.get(tenantId, AI_TRANSCRIPTION_INTEGRATION_ID);
      return r?.enabled ? sttSettingsFromValues(r.values) : null;
    } catch (e) {
      this.log.warn(`speech-to-text settings for ${tenantId} are invalid: ${(e as Error).message}`);
      return null;
    }
  }

  async config(tenantId: string): Promise<Config> {
    const s = await this.settings(tenantId);
    return {
      configured: !!s,
      autoTranscribeCalls: !!s?.autoTranscribeCalls,
      autoTranscribeVoice: !!s?.autoTranscribeVoice,
    };
  }

  private async aiEnabled(tenantId: string): Promise<boolean> {
    const s = await this.db
      .for(tenantId)
      .tenant_settings.findOne({}, { projection: { aiEnabled: 1 } });
    return s?.aiEnabled !== false;
  }

  // ---------- API ----------

  /** The recording, checked exactly like playing it (404 when the caller can't read it). */
  private async media(ctx: TenantContext, attachmentId: string): Promise<AttachmentDoc> {
    if (!(await this.aiEnabled(ctx.tenantId)))
      throw forbidden('The AI assistant is turned off for your organization');
    const a = await this.attachments.get(ctx, attachmentId).catch((e: unknown) => {
      if (e instanceof AppError && e.code === 'FORBIDDEN') throw notFound('Attachment');
      throw e;
    });
    if (a.status !== 'ready' || !(isAudioAttachment(a) || isVideoAttachment(a)))
      throw new AppError('VALIDATION_FAILED', 'Only audio and video recordings have transcripts');
    if (a.deletedAt) throw notFound('Attachment');
    return a;
  }

  private view(a: AttachmentDoc, doc: AiTranscriptDoc | null, configured: boolean): AiTranscript {
    if (!doc)
      return {
        attachmentId: a._id,
        conversationId: a.conversationId,
        messageId: a.messageId,
        status: configured ? 'none' : 'not_configured',
        text: null,
        segments: [],
        language: null,
        model: null,
        error: null,
        updatedAt: null,
      };
    return {
      attachmentId: a._id,
      conversationId: a.conversationId,
      messageId: a.messageId,
      status: doc.status,
      text: doc.status === 'done' ? doc.text : null,
      segments: doc.status === 'done' ? doc.segments : [],
      language: doc.language,
      model: doc.model,
      error: doc.status === 'failed' ? doc.error : null,
      updatedAt: doc.updatedAt.toISOString(),
    };
  }

  async get(ctx: TenantContext, attachmentId: string): Promise<AiTranscript> {
    const a = await this.media(ctx, attachmentId);
    const doc = await this.db.for(ctx.tenantId).ai_transcripts.findOne({ attachmentId });
    const configured = !!(await this.settings(ctx.tenantId));
    return this.view(a, doc, configured);
  }

  /** Queue a transcript (or a retry after a failure). Done transcripts are returned as they are. */
  async request(ctx: TenantContext, attachmentId: string): Promise<AiTranscript> {
    const a = await this.media(ctx, attachmentId);
    await this.rateLimit.consume('ai', `${ctx.tenantId}:${ctx.userId}`);
    const settings = await this.settings(ctx.tenantId);
    if (!settings)
      throw new AppError(
        'UNAVAILABLE',
        'No speech-to-text server is set up. An admin can add one in Integrations.',
      );
    const t = this.db.for(ctx.tenantId);
    const now = new Date();
    const existing = await t.ai_transcripts.findOne({ attachmentId });
    if (existing && existing.status !== 'failed') return this.view(a, existing, true);
    const doc = await t.ai_transcripts.findOneAndUpdate(
      { attachmentId },
      {
        $set: {
          status: 'queued',
          error: null,
          attempts: 0,
          requestedBy: ctx.userId,
          updatedAt: now,
        },
        $setOnInsert: {
          conversationId: a.conversationId,
          messageId: a.messageId,
          kind: a.recording ?? null,
          text: null,
          segments: [],
          language: null,
          model: null,
          createdAt: now,
        },
      },
      { upsert: true, returnDocument: 'after' },
    );
    void this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'ai.transcript.request',
      target: { type: 'attachment', id: attachmentId },
      metadata: { kind: a.recording ?? null },
    });
    if (this.cfg.NODE_ENV !== 'test')
      void this.sweep(ctx.tenantId).catch((e) => this.log.warn(String(e)));
    return this.view(a, doc, true);
  }

  // ---------- reading for the assistant ----------

  /**
   * Finished transcripts for these messages, cut to what the assistant reads. Callers have
   * already checked access to the messages; recordings deleted since are left out.
   */
  async textsForMessages(tenantId: string, messageIds: string[]): Promise<Map<string, string>> {
    if (!messageIds.length) return new Map();
    const t = this.db.for(tenantId);
    const docs = await t.ai_transcripts
      .find(
        { messageId: { $in: messageIds }, status: 'done' },
        { projection: { messageId: 1, attachmentId: 1, text: 1 } },
      )
      .toArray();
    if (!docs.length) return new Map();
    const live = new Set(
      (
        await t.attachments
          .find(
            { _id: { $in: docs.map((d) => d.attachmentId) }, deletedAt: null },
            { projection: { _id: 1 } },
          )
          .toArray()
      ).map((a) => a._id),
    );
    const out = new Map<string, string>();
    for (const d of docs) {
      if (!d.messageId || !live.has(d.attachmentId) || !d.text?.trim()) continue;
      const prev = out.get(d.messageId);
      const text = d.text.trim().slice(0, TRANSCRIPT_READ_CHARS);
      out.set(d.messageId, prev ? `${prev} ${text}`.slice(0, TRANSCRIPT_READ_CHARS) : text);
    }
    return out;
  }

  // ---------- worker ----------

  /**
   * Queues new call recordings (and voice messages when enabled), runs queued jobs, and
   * removes transcripts of deleted recordings. Returns how many transcripts finished.
   */
  async sweep(onlyTenant?: string): Promise<number> {
    if (this.sweeping) return 0;
    this.sweeping = true;
    let done = 0;
    try {
      const tenants = onlyTenant
        ? [{ _id: onlyTenant }]
        : await this.db.tenants.find({ status: 'active' }, { projection: { _id: 1 } }).toArray();
      for (const { _id: tenantId } of tenants) {
        try {
          done += await this.sweepTenant(tenantId);
        } catch (e) {
          this.log.warn(`transcripts sweep for ${tenantId} failed: ${(e as Error).message}`);
        }
      }
    } finally {
      this.sweeping = false;
    }
    return done;
  }

  private async sweepTenant(tenantId: string): Promise<number> {
    const t = this.db.for(tenantId);
    await this.dropDeleted(tenantId);
    if (!(await this.aiEnabled(tenantId))) return 0;
    const settings = await this.settings(tenantId);
    if (!settings) return 0;
    await this.autoQueue(tenantId, settings);
    await t.ai_transcripts.updateMany(
      { status: 'processing', updatedAt: { $lt: new Date(Date.now() - STALE_MS) } },
      { $set: { status: 'queued', updatedAt: new Date() } },
    );
    const client = new SttClient(settings, this.fetchImpl);
    let done = 0;
    const tried: string[] = [];
    for (let i = 0; i < JOBS_PER_SWEEP; i++) {
      const job = await t.ai_transcripts.findOneAndUpdate(
        { status: 'queued', _id: { $nin: tried } },
        { $set: { status: 'processing', updatedAt: new Date() }, $inc: { attempts: 1 } },
        { sort: { updatedAt: 1 }, returnDocument: 'after' },
      );
      if (!job) break;
      tried.push(job._id);
      if (await this.runJob(tenantId, job, client)) done++;
    }
    return done;
  }

  private async autoQueue(tenantId: string, s: SttSettings) {
    const kinds: RecordingKind[] = [
      ...(s.autoTranscribeCalls ? (['call'] as const) : []),
      ...(s.autoTranscribeVoice ? (['voice'] as const) : []),
    ];
    if (!kinds.length) return;
    const t = this.db.for(tenantId);
    const recent = await t.attachments
      .find(
        {
          recording: { $in: kinds },
          status: 'ready',
          deletedAt: null,
          messageId: { $ne: null },
          createdAt: { $gte: new Date(Date.now() - AUTO_WINDOW_MS) },
        },
        { sort: { createdAt: -1 }, limit: 50 },
      )
      .toArray();
    if (!recent.length) return;
    const have = new Set(
      (
        await t.ai_transcripts
          .find(
            { attachmentId: { $in: recent.map((a) => a._id) } },
            { projection: { attachmentId: 1 } },
          )
          .toArray()
      ).map((d) => d.attachmentId),
    );
    const now = new Date();
    for (const a of recent) {
      if (have.has(a._id)) continue;
      await t.ai_transcripts
        .updateOne(
          { attachmentId: a._id },
          {
            $setOnInsert: {
              conversationId: a.conversationId,
              messageId: a.messageId,
              kind: a.recording ?? null,
              status: 'queued',
              text: null,
              segments: [],
              language: null,
              model: null,
              error: null,
              attempts: 0,
              requestedBy: null,
              createdAt: now,
              updatedAt: now,
            },
          },
          { upsert: true },
        )
        .catch(() => undefined); // a concurrent sweep queued it
    }
  }

  /** Transcripts of recordings deleted by a person or the retention policy go too. */
  private async dropDeleted(tenantId: string) {
    const t = this.db.for(tenantId);
    const rows = await t.ai_transcripts
      .find({}, { projection: { attachmentId: 1 }, sort: { createdAt: -1 }, limit: 2000 })
      .toArray();
    if (!rows.length) return;
    const ids = rows.map((r) => r.attachmentId);
    const live = new Set(
      (
        await t.attachments
          .find({ _id: { $in: ids }, deletedAt: null }, { projection: { _id: 1 } })
          .toArray()
      ).map((a) => a._id),
    );
    const gone = ids.filter((id) => !live.has(id));
    if (gone.length) await t.ai_transcripts.deleteMany({ attachmentId: { $in: gone } });
  }

  private async runJob(tenantId: string, job: AiTranscriptDoc, client: SttClient) {
    const t = this.db.for(tenantId);
    const lock = `lock:ai-transcript:${tenantId}:${job.attachmentId}`;
    if ((await this.redis.set(lock, '1', 'PX', STALE_MS, 'NX')) !== 'OK') return false;
    const fail = async (error: string, retry: boolean) => {
      await t.ai_transcripts.updateOne(
        { _id: job._id },
        {
          $set: {
            status: retry && job.attempts < MAX_ATTEMPTS ? 'queued' : 'failed',
            error,
            updatedAt: new Date(),
          },
        },
      );
    };
    try {
      const a = await t.attachments.findOne({ _id: job.attachmentId });
      if (!a || a.deletedAt || !a.storageKey) {
        await t.ai_transcripts.deleteMany({ _id: job._id });
        return false;
      }
      if ((a.storedBytes ?? a.sizeBytes) > TRANSCRIPT_MAX_BYTES) {
        await fail('This recording is too large to transcribe (over 200 MB).', false);
        return false;
      }
      const audio = await readAll(this.attachments.openStored(a), TRANSCRIPT_MAX_BYTES);
      const started = Date.now();
      const r = await client.transcribe(audio, a.fileName, a.mimeType);
      // The recording may have been deleted while the server worked: keep nothing then.
      const still = await t.attachments.findOne({ _id: a._id, deletedAt: null });
      if (!still) {
        await t.ai_transcripts.deleteMany({ _id: job._id });
        return false;
      }
      await t.ai_transcripts.updateOne(
        { _id: job._id },
        {
          $set: {
            status: 'done',
            text: r.text.slice(0, 1_900_000),
            segments: r.segments.slice(0, 20_000),
            language: r.language,
            model: client.model,
            error: null,
            messageId: a.messageId,
            updatedAt: new Date(),
          },
        },
      );
      await this.reindex(tenantId, a);
      void this.audit.record({
        tenantId,
        actorId: job.requestedBy,
        action: 'ai.transcript.done',
        target: { type: 'attachment', id: a._id },
        metadata: { kind: a.recording ?? null, chars: r.text.length, ms: Date.now() - started },
      });
      return true;
    } catch (e) {
      if (e instanceof SttUnavailableError) {
        await fail(e.message, true);
        this.log.warn(`transcript ${job.attachmentId} for ${tenantId}: ${e.message}`);
        return false;
      }
      await fail('The recording could not be read for transcription.', false);
      this.log.warn(`transcript ${job.attachmentId} for ${tenantId}: ${String(e)}`);
      return false;
    } finally {
      await this.redis.del(lock).catch(() => undefined);
    }
  }

  /** Lowers the search index watermark so the message is embedded again with its transcript. */
  private async reindex(tenantId: string, a: AttachmentDoc) {
    if (!a.messageId) return;
    const t = this.db.for(tenantId);
    const m = await t.messages.findOne(
      { _id: a.messageId },
      { projection: { changeSequence: 1, conversationId: 1 } },
    );
    if (!m) return;
    await t.ai_index_state.updateMany(
      { conversationId: m.conversationId, indexedUpTo: { $gte: m.changeSequence } },
      { $set: { indexedUpTo: m.changeSequence - 1, updatedAt: new Date() } },
    );
  }
}

async function readAll(stream: NodeJS.ReadableStream, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of stream as AsyncIterable<Buffer>) {
    n += c.length;
    if (n > max) throw new Error('recording exceeds the transcription size limit');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}
