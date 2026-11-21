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
  TranslateTranscriptRequestSchema,
  UpdateTranscriptRequestSchema,
  type TranscriptTranslation,
  isAudioAttachment,
  isVideoAttachment,
  type AiStatus,
  type AiTranscript,
  type RecordingKind,
} from '@sampledge/contracts';
import { AppError, forbidden, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import type {
  AiTranscriptDoc,
  AttachmentDoc,
  TranscriptTranslationDoc,
} from '../database/documents.js';
import { TenantDb } from '../database/tenant-db.js';
import { AuditService } from '../audit/audit.service.js';
import { AttachmentsService } from '../attachments/attachments.service.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { IntegrationSettingsService } from '../integration-settings/integration-settings.service.js';
import { REDIS, RateLimitService } from '../redis/redis.module.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';
import { ModelEngine } from './model.js';
import { ModelUnavailableError } from './engine.js';
import { AI_SETTINGS_SOURCE, type AiSettingsSource } from './settings.js';
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
    @Inject(AI_SETTINGS_SOURCE) private readonly modelSettings: AiSettingsSource,
    private readonly realtime: RealtimePublisher,
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
    const model = await this.model(tenantId);
    return {
      configured: !!s,
      autoTranscribeCalls: !!s?.autoTranscribeCalls,
      autoTranscribeVoice: !!s?.autoTranscribeVoice,
      translateTo: s?.translateTo ?? [],
      translation: model ? 'model' : s ? 'english' : 'none',
    };
  }

  /** The organization's model server, for translating transcripts (null: none). */
  private async model(tenantId: string): Promise<ModelEngine | null> {
    try {
      const m = await this.modelSettings.get(tenantId);
      return m ? new ModelEngine(m, this.fetchImpl) : null;
    } catch {
      return null;
    }
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

  private view(
    a: AttachmentDoc,
    doc: AiTranscriptDoc | null,
    configured: boolean,
    canEdit = false,
  ): AiTranscript {
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
        translations: [],
        revision: 0,
        edited: false,
        reviewedBy: null,
        reviewedAt: null,
        canEdit: false,
      };
    const revision = doc.revision ?? 0;
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
      translations: (doc.translations ?? []).map((tr) => translationView(tr, revision, doc)),
      revision,
      edited: !!doc.edited,
      reviewedBy: doc.reviewedBy ?? null,
      reviewedAt: doc.reviewedAt?.toISOString() ?? null,
      canEdit: canEdit && doc.status === 'done',
    };
  }

  /**
   * Who may correct a transcript: who recorded it, people who were in the call, conversation
   * owners and moderators, and organization admins. Readers who were not there may not.
   */
  async canEdit(ctx: TenantContext, a: AttachmentDoc): Promise<boolean> {
    if (ctx.role === 'owner' || ctx.role === 'admin') return true;
    if (a.uploaderId === ctx.userId) return true;
    if (ctx.role === 'guest') return false;
    const t = this.db.for(ctx.tenantId);
    const m = await t.conversation_members.findOne(
      { conversationId: a.conversationId, userId: ctx.userId },
      { projection: { role: 1 } },
    );
    if (m?.role === 'owner' || m?.role === 'moderator') return true;
    if (!a.callId) return false;
    const call = await t.calls.findOne({ _id: a.callId }, { projection: { participants: 1 } });
    return !!call?.participants.some((p) => p.userId === ctx.userId && p.joinedAt);
  }

  async get(ctx: TenantContext, attachmentId: string): Promise<AiTranscript> {
    const a = await this.media(ctx, attachmentId);
    const doc = await this.db.for(ctx.tenantId).ai_transcripts.findOne({ attachmentId });
    const configured = !!(await this.settings(ctx.tenantId));
    return this.view(a, doc, configured, doc ? await this.canEdit(ctx, a) : false);
  }

  /**
   * Correct lines of the original or of a translation, and/or mark it checked. Lines someone
   * else corrected after `baseRevision` are a conflict; other lines merge, so two people
   * fixing different lines (or one fixing lines offline) never lose each other's work.
   */
  async update(ctx: TenantContext, attachmentId: string, body: unknown): Promise<AiTranscript> {
    const req = parse(UpdateTranscriptRequestSchema, body);
    const a = await this.media(ctx, attachmentId);
    if (!(await this.canEdit(ctx, a)))
      throw forbidden(
        'Only people who were in the call, who recorded it or moderators can correct it',
      );
    const t = this.db.for(ctx.tenantId);
    for (let attempt = 0; attempt < 5; attempt++) {
      const doc = await t.ai_transcripts.findOne({ attachmentId });
      if (!doc || doc.status !== 'done')
        throw new AppError('CONFLICT', 'This transcript is not finished yet');
      const revision = doc.revision ?? 0;
      const next = revision + 1;
      const now = new Date();
      const tr = req.language ? doc.translations?.find((x) => x.language === req.language) : null;
      if (req.language && (!tr || tr.status !== 'done')) throw notFound('Translation');
      const target = tr ?? doc;
      const segments = target.segments.map((x) => ({ ...x }));
      const segRevs = [...(target.segmentRevs ?? [])];
      let text = target.text ?? '';
      let changed = false;
      const conflicts: number[] = [];
      for (const e of req.segments ?? []) {
        if (e.index >= segments.length) throw new AppError('VALIDATION_FAILED', 'No such line');
        const clean = e.text.replace(/\s+/g, ' ').trim();
        if (clean === segments[e.index]!.text) continue;
        if ((segRevs[e.index] ?? 0) > req.baseRevision) conflicts.push(e.index);
        segments[e.index]!.text = clean;
        segRevs[e.index] = next;
        changed = true;
      }
      if (req.segments?.length && changed)
        text = segments
          .map((x) => x.text)
          .filter(Boolean)
          .join(' ');
      if (req.text !== undefined && !segments.length && req.text.trim() !== text.trim()) {
        if ((target.textRev ?? 0) > req.baseRevision) conflicts.push(-1);
        text = req.text.trim();
        changed = true;
      }
      if (conflicts.length)
        throw new AppError(
          'CONFLICT',
          'Someone else corrected the same lines. Reload to see their version.',
          { current: this.view(a, doc, true, true), lines: conflicts },
        );
      const reviewed =
        req.reviewed === undefined
          ? {}
          : req.reviewed
            ? { reviewedBy: ctx.userId, reviewedAt: now }
            : { reviewedBy: null, reviewedAt: null };
      if (!changed && req.reviewed === undefined) return this.view(a, doc, true, true);
      const fields = tr
        ? {
            translations: (doc.translations ?? []).map((x) =>
              x.language === tr.language
                ? {
                    ...x,
                    segments,
                    segmentRevs: segRevs,
                    text,
                    ...(changed
                      ? { edited: true, textRev: req.text !== undefined ? next : x.textRev }
                      : {}),
                    ...reviewed,
                    updatedAt: now,
                  }
                : x,
            ),
          }
        : {
            segments,
            segmentRevs: segRevs,
            text,
            ...(changed
              ? { edited: true, textRev: req.text !== undefined ? next : doc.textRev }
              : {}),
            ...reviewed,
          };
      const r = await t.ai_transcripts.updateOne(
        { _id: doc._id, revision: doc.revision ?? { $exists: false } } as never,
        { $set: { ...fields, revision: next, updatedAt: now } },
      );
      if (!r.modifiedCount) continue; // someone else saved in between: merge again
      if (changed && !tr) await this.reindex(ctx.tenantId, a);
      void this.audit.record({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: changed ? 'ai.transcript.correct' : 'ai.transcript.review',
        target: { type: 'attachment', id: attachmentId },
        metadata: {
          language: req.language ?? null,
          lines: req.segments?.length ?? 0,
          reviewed: req.reviewed ?? null,
        },
      });
      this.changed(ctx.tenantId, a.conversationId, attachmentId, next);
      return this.get(ctx, attachmentId);
    }
    throw new AppError('CONFLICT', 'The transcript is busy. Try again.');
  }

  /**
   * Translate a finished transcript (or translate it again). English can come from the
   * speech-to-text server's translate mode; other languages need the AI model server.
   */
  async translate(ctx: TenantContext, attachmentId: string, body: unknown): Promise<AiTranscript> {
    const { language } = parse(TranslateTranscriptRequestSchema, body);
    const a = await this.media(ctx, attachmentId);
    await this.rateLimit.consume('ai', `${ctx.tenantId}:${ctx.userId}`);
    const t = this.db.for(ctx.tenantId);
    const doc = await t.ai_transcripts.findOne({ attachmentId });
    if (!doc || doc.status !== 'done')
      throw new AppError('CONFLICT', 'Translate the transcript once it is finished');
    if (doc.language && doc.language === language.split('-')[0])
      throw new AppError('VALIDATION_FAILED', 'The transcript is already in that language');
    const how = await this.config(ctx.tenantId);
    if (how.translation !== 'model' && language !== 'en')
      throw new AppError(
        'UNAVAILABLE',
        'Translating to languages other than English needs your AI model server. An admin can add one in Integrations.',
      );
    await this.queueTranslations(ctx.tenantId, doc, [language], ctx.userId, true);
    void this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'ai.transcript.translate',
      target: { type: 'attachment', id: attachmentId },
      metadata: { language },
    });
    if (this.cfg.NODE_ENV !== 'test')
      void this.sweep(ctx.tenantId).catch((e) => this.log.warn(String(e)));
    return this.get(ctx, attachmentId);
  }

  private async queueTranslations(
    tenantId: string,
    doc: AiTranscriptDoc,
    languages: string[],
    requestedBy: string | null,
    again: boolean,
  ) {
    const t = this.db.for(tenantId);
    const now = new Date();
    const list = [...(doc.translations ?? [])];
    let touched = false;
    for (const language of languages) {
      if (doc.language && language === doc.language) continue;
      const i = list.findIndex((x) => x.language === language);
      if (i >= 0 && !again && list[i]!.status !== 'failed') continue;
      if (i >= 0 && (list[i]!.status === 'queued' || list[i]!.status === 'processing')) continue;
      const fresh: TranscriptTranslationDoc = {
        language,
        status: 'queued',
        text: null,
        segments: [],
        engine: null,
        error: null,
        attempts: 0,
        sourceRevision: doc.revision ?? 0,
        requestedBy,
        updatedAt: now,
      };
      if (i >= 0) list[i] = fresh;
      else list.push(fresh);
      touched = true;
    }
    if (touched)
      await t.ai_transcripts.updateOne(
        { _id: doc._id },
        { $set: { translations: list.slice(0, 8) } },
      );
  }

  private changed(
    tenantId: string,
    conversationId: string,
    attachmentId: string,
    revision: number,
  ) {
    this.realtime.toConversation(tenantId, conversationId, 'transcript:changed', {
      attachmentId,
      conversationId,
      revision,
    });
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
  async textsForMessages(
    tenantId: string,
    messageIds: string[],
    /** Prefer a finished translation into this language when there is one. */
    language?: string,
  ): Promise<Map<string, string>> {
    if (!messageIds.length) return new Map();
    const t = this.db.for(tenantId);
    const docs = (
      await t.ai_transcripts
        .find(
          { messageId: { $in: messageIds }, status: 'done' },
          { projection: { messageId: 1, attachmentId: 1, text: 1, translations: 1, language: 1 } },
        )
        .toArray()
    ).map((d) => {
      const tr =
        language && d.language !== language
          ? d.translations?.find((x) => x.language === language && x.status === 'done')
          : undefined;
      return tr?.text ? { ...d, text: tr.text } : d;
    });
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
      if (await this.runJob(tenantId, job, client, settings)) done++;
    }
    done += await this.translateQueued(tenantId, client);
    return done;
  }

  /** Runs queued translations: model server for any language, Whisper translate for English. */
  private async translateQueued(tenantId: string, client: SttClient): Promise<number> {
    const t = this.db.for(tenantId);
    const staleBefore = new Date(Date.now() - STALE_MS);
    const stuck = await t.ai_transcripts
      .find(
        { translations: { $elemMatch: { status: 'processing', updatedAt: { $lt: staleBefore } } } },
        { projection: { _id: 1 }, limit: 50 },
      )
      .toArray();
    for (const d of stuck)
      await t.ai_transcripts.updateOne(
        { _id: d._id },
        { $set: { 'translations.$[x].status': 'queued' } } as never,
        { arrayFilters: [{ 'x.status': 'processing', 'x.updatedAt': { $lt: staleBefore } }] },
      );
    const jobs = await t.ai_transcripts
      .find({ 'translations.status': 'queued', status: 'done' }, { limit: JOBS_PER_SWEEP })
      .toArray();
    if (!jobs.length) return 0;
    const model = await this.model(tenantId);
    let done = 0;
    for (const doc of jobs) {
      const tr = doc.translations!.find((x) => x.status === 'queued');
      if (!tr) continue;
      const lock = `lock:ai-translate:${tenantId}:${doc.attachmentId}:${tr.language}`;
      if ((await this.redis.set(lock, '1', 'PX', STALE_MS, 'NX')) !== 'OK') continue;
      const set = async (patch: Partial<TranscriptTranslationDoc>) => {
        await t.ai_transcripts.updateOne(
          { _id: doc._id },
          {
            $set: Object.fromEntries(
              Object.entries({ ...patch, updatedAt: new Date() }).map(([k, v]) => [
                `translations.$[x].${k}`,
                v,
              ]),
            ),
          } as never,
          { arrayFilters: [{ 'x.language': tr.language }] },
        );
      };
      try {
        await set({ status: 'processing', attempts: tr.attempts + 1 });
        let result: { text: string; segments: TranscriptTranslationDoc['segments'] } | null = null;
        let engine: 'model' | 'stt' = 'model';
        if (model) {
          try {
            const lines = doc.segments.length ? doc.segments.map((x) => x.text) : [doc.text ?? ''];
            const out = await model.translateLines(lines, tr.language);
            const segments = doc.segments.map((x, i) => ({ ...x, text: out[i] ?? '' }));
            result = { text: out.filter(Boolean).join(' '), segments };
          } catch (e) {
            if (!(e instanceof ModelUnavailableError) || tr.language !== 'en') throw e;
          }
        }
        if (!result && tr.language === 'en') {
          engine = 'stt';
          const a = await t.attachments.findOne({ _id: doc.attachmentId, deletedAt: null });
          if (!a?.storageKey) throw new Error('recording gone');
          const audio = await readAll(this.attachments.openStored(a), TRANSCRIPT_MAX_BYTES);
          const r = await client.translateToEnglish(audio, a.fileName, a.mimeType);
          result = { text: r.text, segments: r.segments };
        }
        if (!result)
          throw new ModelUnavailableError(
            'Translating to this language needs your AI model server (Integrations).',
          );
        await set({
          status: 'done',
          text: result.text.slice(0, 1_900_000),
          segments: result.segments.slice(0, 20_000),
          segmentRevs: [],
          edited: false,
          reviewedBy: null,
          reviewedAt: null,
          engine,
          error: null,
          sourceRevision: doc.revision ?? 0,
        });
        done++;
        void this.audit.record({
          tenantId,
          actorId: tr.requestedBy,
          action: 'ai.transcript.translated',
          target: { type: 'attachment', id: doc.attachmentId },
          metadata: { language: tr.language, engine, chars: result.text.length },
        });
      } catch (e) {
        const reason =
          e instanceof SttUnavailableError || e instanceof ModelUnavailableError
            ? e.message
            : 'The transcript could not be translated.';
        const retry =
          (e instanceof SttUnavailableError || e instanceof ModelUnavailableError) &&
          tr.attempts + 1 < MAX_ATTEMPTS &&
          !/needs your AI model server/.test(reason);
        await set({ status: retry ? 'queued' : 'failed', error: reason });
        this.log.warn(`translation ${doc.attachmentId}/${tr.language} for ${tenantId}: ${reason}`);
      } finally {
        await this.redis.del(lock).catch(() => undefined);
      }
      this.changed(tenantId, doc.conversationId, doc.attachmentId, doc.revision ?? 0);
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

  private async runJob(
    tenantId: string,
    job: AiTranscriptDoc,
    client: SttClient,
    settings: SttSettings,
  ) {
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
      const fresh = await t.ai_transcripts.findOne({ _id: job._id });
      if (fresh && settings.translateTo.length)
        await this.queueTranslations(tenantId, fresh, settings.translateTo, null, false);
      this.changed(tenantId, a.conversationId, a._id, fresh?.revision ?? 0);
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

function translationView(
  tr: TranscriptTranslationDoc,
  sourceRevision: number,
  doc: AiTranscriptDoc,
): TranscriptTranslation & { outdated: boolean } {
  return {
    language: tr.language,
    status: tr.status,
    text: tr.status === 'done' ? tr.text : null,
    segments: tr.status === 'done' ? tr.segments : [],
    engine: tr.engine,
    error: tr.status === 'failed' ? tr.error : null,
    edited: !!tr.edited,
    reviewedBy: tr.reviewedBy ?? null,
    reviewedAt: tr.reviewedAt?.toISOString() ?? null,
    updatedAt: tr.updatedAt.toISOString(),
    // The original was corrected after this was translated.
    outdated: tr.status === 'done' && !!doc.edited && sourceRevision > tr.sourceRevision,
  };
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
