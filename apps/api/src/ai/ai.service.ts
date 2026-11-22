import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { Filter } from 'mongodb';
import {
  AI_FEATURES,
  AI_PROPOSAL_TTL_MINUTES,
  AiAskRequestSchema,
  AiDigestRequestSchema,
  AiDuplicatesRequestSchema,
  AiSearchRequestSchema,
  AiTranslateRequestSchema,
  ConfirmAiProposalRequestSchema,
  CreateAiProposalRequestSchema,
  SummarizeRequestSchema,
  UpdateAiSettingsRequestSchema,
  classifyActionRisk,
  tenantCan,
  uuidv7,
  type ActionItem,
  type AiAskResponse,
  type AiDigest,
  type AiProjectStatus,
  type Project,
  type AiDuplicates,
  type AiEngine,
  type AiFeature,
  type AiFeatureLevel,
  type AiMeetingSummary,
  type AiPrioritizedNotifications,
  type AiProposal,
  type AiDismissedSuggestions,
  type AiSuggestionEvent,
  AiSuggestionIdSchema,
  type AiSearchHit,
  type AiSearchResponse,
  type AiStatus,
  type AiSuggestedReplies,
  type AiSummary,
  type AiTranslation,
  type Conversation,
  type SendMessageAck,
  type SummaryRange,
} from '@sampledge/contracts';
import { AppError, forbidden, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import type { AiProposalDoc, MessageDoc } from '../database/documents.js';
import { TenantDb } from '../database/tenant-db.js';
import { AuditService } from '../audit/audit.service.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { MessagesService } from '../messages/messages.service.js';
import { toMessage } from '../messages/message.mapper.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { REDIS, RateLimitService } from '../redis/redis.module.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { BasicEngine, cosine, sentences, stem, tokenize } from './basic.js';
import {
  ModelUnavailableError,
  type AiEngineImpl,
  type Member,
  type TranscriptLine,
} from './engine.js';
import { ModelEngine } from './model.js';
import { AI_SETTINGS_SOURCE, type AiSettingsSource } from './settings.js';
import { TranscriptsService } from './transcripts.service.js';
import { ProjectsService } from '../work/projects.service.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';

const RANGE_LIMIT = 400;
const RECENT_LIMIT = 150;
/** Most vectors compared in one search (newest first). Beyond this, use a vector database. */
const MAX_SCAN_VECTORS = 25_000;
/** Messages indexed per request before searching (the background indexer does the rest). */
const INDEX_BUDGET_BASIC = 5_000;
const INDEX_BUDGET_MODEL = 256;
const EMBED_BATCH = 64;
const INDEX_SWEEP_MS = 60_000;
const ENGINE_CACHE_MS = 60_000;

const FEATURE_LEVELS: Record<'basic' | 'model', Record<AiFeature, AiFeatureLevel>> = {
  basic: {
    summaries: 'limited',
    meeting_summaries: 'limited',
    action_items: 'limited',
    semantic_search: 'limited',
    ask: 'limited',
    translation: 'needs_model',
    suggested_replies: 'limited',
    status_digest: 'limited',
    task_suggestions: 'limited',
    duplicate_detection: 'limited',
    notification_priority: 'full',
  },
  model: Object.fromEntries(AI_FEATURES.map((f) => [f, 'full'])) as Record<
    AiFeature,
    AiFeatureLevel
  >,
};

const URGENT_RE =
  /\b(urgent|asap|immediately|today|eod|deadline|blocker|blocked|critical|escalat\w*|overdue|right away)\b/i;
const ATTENTION_RE =
  /\b(blocked|blocker|delay(?:ed)?|late|issue|problem|risk|urgent|escalat\w*|overdue|stuck|concern)\b/i;

type Readable = TranscriptLine & {
  conversationId: string;
  serverSequence: number;
  /** The line includes a recording transcript. */
  transcribed: boolean;
};

/** Text messages, plus call recordings (system messages) that may carry a transcript. */
const READABLE_TYPES: Filter<MessageDoc> = {
  $or: [{ messageType: 'text' }, { 'metadata.recording.attachmentId': { $exists: true } }],
};
/** Characters of a transcript embedded for search (one vector per message). */
const EMBED_TRANSCRIPT_CHARS = 2_000;

/**
 * The private AI assistant. Every method first works out what the caller can read (the same
 * checks chat uses), then gives only that to the engine. Nothing here writes to a conversation
 * except `confirmProposal`, which sends a message as the caller after they confirmed it.
 */
@Injectable()
export class AiService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger('AI');
  private readonly basic = new BasicEngine();
  private readonly engines = new Map<string, { engine: AiEngineImpl; at: number }>();
  private readonly lastError = new Map<string, string>();
  private timer: NodeJS.Timeout | null = null;
  private sweeping = false;

  constructor(
    private readonly db: TenantDb,
    private readonly conversations: ConversationsService,
    private readonly messages: MessagesService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly rateLimit: RateLimitService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(AI_SETTINGS_SOURCE) private readonly settings: AiSettingsSource,
    private readonly transcripts: TranscriptsService,
    private readonly projects: ProjectsService,
    private readonly realtime: RealtimePublisher,
  ) {
    settings.onChange?.((tenantId) => {
      if (tenantId) this.engines.delete(tenantId);
      else this.engines.clear();
    });
  }

  onModuleInit() {
    if (this.cfg.NODE_ENV === 'test') return; // tests call indexPending() directly
    this.timer = setInterval(() => void this.indexPending().catch(() => undefined), INDEX_SWEEP_MS);
    this.timer.unref();
  }
  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------- engine + settings ----------

  private async engineFor(tenantId: string): Promise<AiEngineImpl> {
    const hit = this.engines.get(tenantId);
    if (hit && Date.now() - hit.at < ENGINE_CACHE_MS) return hit.engine;
    let engine: AiEngineImpl = this.basic;
    try {
      const s = await this.settings.get(tenantId);
      if (s) engine = new ModelEngine(s);
    } catch (e) {
      this.lastError.set(tenantId, `Model server settings are invalid: ${(e as Error).message}`);
    }
    this.engines.set(tenantId, { engine, at: Date.now() });
    return engine;
  }

  /** Runs on the tenant's engine; if the model server fails, falls back to the basic engine. */
  private async run<T>(
    tenantId: string,
    fn: (e: AiEngineImpl) => Promise<T>,
  ): Promise<{ value: T; engine: AiEngine }> {
    const engine = await this.engineFor(tenantId);
    if (engine.kind === 'model') {
      try {
        const value = await fn(engine);
        this.lastError.delete(tenantId);
        return { value, engine: 'model' };
      } catch (e) {
        if (!(e instanceof ModelUnavailableError)) throw e;
        this.lastError.set(tenantId, e.message);
        this.log.warn(`model call failed for tenant ${tenantId}: ${e.message}`);
      }
    }
    return { value: await fn(this.basic), engine: 'basic' };
  }

  private async tenantEnabled(tenantId: string): Promise<boolean> {
    const s = await this.db
      .for(tenantId)
      .tenant_settings.findOne({}, { projection: { aiEnabled: 1 } });
    return s?.aiEnabled !== false;
  }

  /** Every AI feature call: AI must be on, and per-user rate limits apply. */
  private async gate(ctx: TenantContext): Promise<void> {
    if (!(await this.tenantEnabled(ctx.tenantId)))
      throw forbidden('The AI assistant is turned off for your organization');
    await this.rateLimit.consume('ai', `${ctx.tenantId}:${ctx.userId}`);
  }

  async status(ctx: TenantContext): Promise<AiStatus> {
    const enabled = await this.tenantEnabled(ctx.tenantId);
    const engine = await this.engineFor(ctx.tenantId);
    return {
      enabled,
      engine: enabled ? engine.kind : 'off',
      model: engine.chatModel,
      features: FEATURE_LEVELS[engine.kind],
      canManage: tenantCan(ctx.role, 'ai.manage'),
      lastError: this.lastError.get(ctx.tenantId) ?? null,
      transcription: await this.transcripts.config(ctx.tenantId),
    };
  }

  async updateSettings(ctx: TenantContext, input: unknown): Promise<AiStatus> {
    if (!tenantCan(ctx.role, 'ai.manage')) throw forbidden();
    const req = parse(UpdateAiSettingsRequestSchema, input);
    await this.db.for(ctx.tenantId).tenant_settings.updateOne(
      {},
      {
        $set: { aiEnabled: req.enabled, updatedAt: new Date(), updatedBy: ctx.userId },
        // Keep the recordings defaults when this creates the settings row.
        $setOnInsert: { recordingRetentionDays: null, callRecordingEnabled: true },
      },
      { upsert: true },
    );
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: req.enabled ? 'ai.enabled' : 'ai.disabled',
      target: { type: 'tenant', id: ctx.tenantId },
    });
    this.realtime.toTenant(ctx.tenantId, 'tenant:updated', { area: 'ai' });
    return this.status(ctx);
  }

  // ---------- reading (access-checked) ----------

  private async names(tenantId: string, ids: string[]): Promise<Map<string, string>> {
    const users = await this.db
      .for(tenantId)
      .users.find({ _id: { $in: [...new Set(ids)] } }, { projection: { displayName: 1 } })
      .toArray();
    return new Map(users.map((u) => [u._id, u.displayName]));
  }

  private toLines(
    docs: MessageDoc[],
    names: Map<string, string>,
    transcripts: Map<string, string> = new Map(),
  ): Readable[] {
    return docs
      .filter((m) => !m.deletedAt && (m.messageType === 'text' || transcripts.has(m._id)))
      .map((m) => {
        const heard = transcripts.get(m._id);
        // Recordings with a transcript are read as speech, not listed as shared files.
        const files = (m.attachments ?? [])
          .filter((a) => !a.deletedAt && !(heard && a.recording))
          .map((a) => a.fileName);
        const text = [
          m.messageType === 'text' ? m.content.text.trim() : '',
          files.length ? `[shared ${files.join(', ')}]` : '',
          heard ?? '',
        ]
          .filter(Boolean)
          .join(' ');
        return {
          messageId: m._id,
          conversationId: m.conversationId,
          serverSequence: m.serverSequence,
          senderId: m.senderId,
          senderName: names.get(m.senderId) ?? 'Someone',
          text,
          at: m.createdAt,
          transcribed: !!heard,
        };
      })
      .filter((l) => l.text);
  }

  /** Names and finished transcripts for these (already access-checked) messages. */
  private async linesFor(tenantId: string, docs: MessageDoc[], extraIds: string[] = []) {
    const [names, transcripts] = await Promise.all([
      this.names(tenantId, [...docs.map((d) => d.senderId), ...extraIds]),
      this.transcripts.textsForMessages(
        tenantId,
        docs
          .filter((d) => (d.attachments ?? []).some((a) => a.recording && !a.deletedAt))
          .map((d) => d._id),
      ),
    ]);
    return { names, lines: this.toLines(docs, names, transcripts) };
  }

  private async members(ctx: TenantContext, conv: { conversationId: string }): Promise<Member[]> {
    const ids = await this.conversations.memberIds(ctx.tenantId, conv.conversationId);
    const names = await this.names(ctx.tenantId, ids);
    return ids.map((userId) => ({ userId, name: names.get(userId) ?? 'Someone' }));
  }

  private async rangeLines(ctx: TenantContext, conversationId: string, range: SummaryRange) {
    const t = this.db.for(ctx.tenantId);
    const filter: Record<string, unknown> = {
      conversationId,
      deletedAt: null,
      ...READABLE_TYPES,
    };
    if (range === 'day') filter.createdAt = { $gte: new Date(Date.now() - 86_400_000) };
    if (range === 'week') filter.createdAt = { $gte: new Date(Date.now() - 7 * 86_400_000) };
    if (range === 'unread') {
      const r = await t.message_receipts.findOne({ conversationId, userId: ctx.userId });
      filter.serverSequence = { $gt: r?.readUpTo ?? 0 };
      filter.senderId = { $ne: ctx.userId };
    }
    const docs = await t.messages
      .find(filter, {
        sort: { serverSequence: -1 },
        limit: range === 'recent' ? RECENT_LIMIT : RANGE_LIMIT,
      })
      .toArray();
    docs.reverse();
    return (await this.linesFor(ctx.tenantId, docs)).lines;
  }

  private mapActionItems(
    items: {
      text: string;
      assignee: string | null;
      due: string | null;
      messageId: string | null;
    }[],
    members: Member[],
  ): ActionItem[] {
    const byName = new Map<string, string>();
    for (const m of members) {
      byName.set(m.name.toLowerCase(), m.userId);
      const first = m.name.split(/\s+/)[0]!.toLowerCase();
      if (![...members].some((o) => o !== m && o.name.split(/\s+/)[0]!.toLowerCase() === first))
        byName.set(first, m.userId);
    }
    return items.map((a) => ({
      text: a.text,
      assigneeId: a.assignee
        ? (byName.get(a.assignee.replace(/^@/, '').toLowerCase()) ?? null)
        : null,
      due: a.due,
      messageId: a.messageId,
    }));
  }

  // ---------- summaries ----------

  async summarizeConversation(
    ctx: TenantContext,
    conversationId: string,
    input: unknown,
  ): Promise<AiSummary> {
    await this.gate(ctx);
    const req = parse(SummarizeRequestSchema, input ?? {});
    const { conversation } = await this.conversations.authorize(
      ctx,
      conversationId,
      'conversation.read',
    );
    const lines = await this.rangeLines(ctx, conversationId, req.range);
    const members = await this.members(ctx, { conversationId });
    const fromSequence = lines[0]?.serverSequence ?? 0;
    const toSequence = lines.at(-1)?.serverSequence ?? 0;
    const engine = await this.engineFor(ctx.tenantId);
    const heard = lines.filter((l) => l.transcribed).length;
    const key = `${req.range}:${fromSequence}:${toSequence}:${lines.length}:t${heard}:${engine.kind}:${engine.chatModel ?? ''}`;
    const t = this.db.for(ctx.tenantId);

    const cached = lines.length ? await t.ai_summaries.findOne({ conversationId, key }) : null;
    let out: AiSummary;
    if (cached) {
      out = cached.payload as unknown as AiSummary;
    } else {
      const { value, engine: used } = await this.run(ctx.tenantId, (e) =>
        e.summarize({ title: conversation.name ?? 'Direct message', lines, members }),
      );
      out = {
        conversationId,
        range: req.range,
        summary:
          !lines.length && req.range === 'unread' ? 'You’re all caught up here.' : value.summary,
        highlights: value.highlights,
        decisions: value.decisions,
        actionItems: this.mapActionItems(value.actionItems, members),
        openQuestions: value.openQuestions,
        messageCount: lines.length,
        participantIds: [...new Set(lines.map((l) => l.senderId))],
        fromSequence,
        toSequence,
        engine: used,
        generatedAt: new Date().toISOString(),
      };
      if (lines.length && used === engine.kind)
        await t.ai_summaries
          .updateOne(
            { conversationId, key },
            { $set: { payload: out as unknown as Record<string, unknown>, createdAt: new Date() } },
            { upsert: true },
          )
          .catch(() => undefined);
    }
    void this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'ai.summary',
      target: { type: 'conversation', id: conversationId },
      metadata: { range: req.range, messages: lines.length, engine: out.engine },
    });
    return out;
  }

  /** AI on for the organization (minutes then start blank for people to write when off). */
  async enabledFor(tenantId: string): Promise<boolean> {
    return this.tenantEnabled(tenantId);
  }

  /** The organization has a model server (minutes written in any language, translation). */
  async hasModel(tenantId: string): Promise<boolean> {
    return (await this.engineFor(tenantId)).kind === 'model';
  }

  /**
   * Content for minutes of meeting. The caller (MinutesService) has already checked that the
   * person may read the call and its conversation; lines are data, never instructions.
   */
  async draftMinutes(
    ctx: TenantContext,
    input: {
      title: string;
      agenda: string;
      lines: TranscriptLine[];
      members: Member[];
      language: string;
    },
  ) {
    await this.gate(ctx);
    const { value, engine } = await this.run(ctx.tenantId, (e) =>
      e.summarize({ ...input, purpose: 'minutes' }),
    );
    void this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'ai.minutes',
      metadata: { lines: input.lines.length, engine, language: input.language },
    });
    return { value, engine, actionItems: this.mapActionItems(value.actionItems, input.members) };
  }

  async summarizeMeeting(ctx: TenantContext, meetingId: string): Promise<AiMeetingSummary> {
    await this.gate(ctx);
    const m = await this.db.for(ctx.tenantId).meetings.findOne({ _id: meetingId });
    if (!m) throw notFound('Meeting');
    // The summary reads the meeting chat, so the caller must be able to read that chat.
    await this.conversations.authorize(ctx, m.conversationId, 'conversation.read').catch(() => {
      throw notFound('Meeting');
    });
    const from = new Date(Math.min(m.startsAt.getTime() - 2 * 3_600_000, m.createdAt.getTime()));
    const to = new Date(m.endsAt.getTime() + 2 * 3_600_000);
    const docs = await this.db
      .for(ctx.tenantId)
      .messages.find(
        {
          conversationId: m.conversationId,
          deletedAt: null,
          ...READABLE_TYPES,
          createdAt: { $gte: from, $lte: to },
        },
        { sort: { serverSequence: -1 }, limit: RANGE_LIMIT },
      )
      .toArray();
    docs.reverse();
    const { lines } = await this.linesFor(ctx.tenantId, docs);
    const heard = lines.filter((l) => l.transcribed).length;
    const members = await this.members(ctx, { conversationId: m.conversationId });
    const { value, engine } = await this.run(ctx.tenantId, (e) =>
      e.summarize({ title: m.title, agenda: m.agenda, lines, members }),
    );
    void this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'ai.meeting_summary',
      target: { type: 'meeting', id: meetingId },
      metadata: { messages: lines.length, transcripts: heard, engine },
    });
    return {
      conversationId: m.conversationId,
      meetingId,
      title: m.title,
      startsAt: m.startsAt.toISOString(),
      summary: value.summary,
      highlights: value.highlights,
      decisions: value.decisions,
      actionItems: this.mapActionItems(value.actionItems, members),
      openQuestions: value.openQuestions,
      messageCount: lines.length,
      participantIds: [...new Set(lines.map((l) => l.senderId))],
      fromSequence: lines[0]?.serverSequence ?? 0,
      toSequence: lines.at(-1)?.serverSequence ?? 0,
      engine,
      generatedAt: new Date().toISOString(),
      transcriptIncluded: heard > 0,
      transcriptCount: heard,
    };
  }

  // ---------- vector index + semantic search ----------

  /**
   * Brings one conversation's vectors up to date for `engine`'s vector space. Edits and
   * deletes bump changeSequence, so they are re-embedded or dropped here too.
   */
  private async indexConversation(
    tenantId: string,
    conversationId: string,
    engine: AiEngineImpl,
    budget: number,
  ): Promise<number> {
    const lockKey = `lock:ai-index:${tenantId}:${conversationId}:${engine.embeddingModelId}`;
    if ((await this.redis.set(lockKey, '1', 'PX', 60_000, 'NX')) !== 'OK') return 0;
    try {
      const t = this.db.for(tenantId);
      const model = engine.embeddingModelId;
      const state = await t.ai_index_state.findOne({ conversationId, model });
      let upTo = state?.indexedUpTo ?? 0;
      let done = 0;
      while (done < budget) {
        const batch = await t.messages
          .find(
            { conversationId, changeSequence: { $gt: upTo } },
            { sort: { changeSequence: 1 }, limit: Math.min(EMBED_BATCH * 4, budget - done) },
          )
          .toArray();
        if (!batch.length) break;
        const heard = await this.transcripts.textsForMessages(
          tenantId,
          batch.filter((m) => m.attachments?.some((a) => a.recording)).map((m) => m._id),
        );
        const embedText = (m: MessageDoc) => {
          const h = heard.get(m._id)?.slice(0, EMBED_TRANSCRIPT_CHARS);
          if (m.messageType !== 'text') return h ?? '';
          return [m.content.text.trim(), h ?? ''].filter(Boolean).join(' ');
        };
        const live = batch.filter((m) => !m.deletedAt && embedText(m));
        const gone = batch.filter((m) => !live.includes(m)).map((m) => m._id);
        if (gone.length) await t.ai_embeddings.deleteMany({ messageId: { $in: gone }, model });
        for (let i = 0; i < live.length; i += EMBED_BATCH) {
          const chunk = live.slice(i, i + EMBED_BATCH);
          const vectors = await engine.embed(chunk.map(embedText));
          for (let j = 0; j < chunk.length; j++) {
            const m = chunk[j]!;
            await t.ai_embeddings.updateOne(
              { messageId: m._id, model },
              {
                $set: {
                  conversationId,
                  senderId: m.senderId,
                  vector: vectors[j]!,
                  changeSequence: m.changeSequence,
                  createdAt: m.createdAt,
                },
              },
              { upsert: true },
            );
          }
        }
        upTo = batch.at(-1)!.changeSequence;
        done += batch.length;
        await t.ai_index_state.updateOne(
          { conversationId, model },
          { $set: { indexedUpTo: upTo, updatedAt: new Date() } },
          { upsert: true },
        );
      }
      return done;
    } finally {
      await this.redis.del(lockKey).catch(() => undefined);
    }
  }

  /** Background indexer: recently active conversations in every tenant. */
  async indexPending(onlyTenant?: string): Promise<number> {
    if (this.sweeping) return 0;
    this.sweeping = true;
    let total = 0;
    try {
      const tenants = onlyTenant
        ? [{ _id: onlyTenant }]
        : await this.db.tenants.find({ status: 'active' }, { projection: { _id: 1 } }).toArray();
      for (const { _id: tenantId } of tenants) {
        if (!(await this.tenantEnabled(tenantId))) continue;
        const engine = await this.engineFor(tenantId);
        const t = this.db.for(tenantId);
        const convs = await t.conversations
          .find(
            { lastMessageAt: { $gte: new Date(Date.now() - 30 * 86_400_000) } },
            {
              sort: { lastMessageAt: -1 },
              limit: 200,
              projection: { _id: 1, lastChangeSequence: 1 },
            },
          )
          .toArray();
        const states = new Map(
          (
            await t.ai_index_state
              .find({
                model: engine.embeddingModelId,
                conversationId: { $in: convs.map((c) => c._id) },
              })
              .toArray()
          ).map((s) => [s.conversationId, s.indexedUpTo]),
        );
        for (const c of convs) {
          if ((states.get(c._id) ?? 0) >= c.lastChangeSequence) continue;
          try {
            total += await this.indexConversation(
              tenantId,
              c._id,
              engine,
              engine.kind === 'model' ? INDEX_BUDGET_MODEL : INDEX_BUDGET_BASIC,
            );
          } catch (e) {
            if (e instanceof ModelUnavailableError) {
              this.lastError.set(tenantId, e.message);
              break;
            }
            throw e;
          }
        }
      }
    } finally {
      this.sweeping = false;
    }
    return total;
  }

  /** Conversation ids the caller can read right now (optionally just one, checked). */
  private async scope(ctx: TenantContext, conversationId?: string): Promise<Conversation[]> {
    if (conversationId) {
      await this.conversations.authorize(ctx, conversationId, 'conversation.read');
      return (await this.conversations.listReadable(ctx)).filter(
        (c) => c.conversationId === conversationId,
      );
    }
    return this.conversations.listReadable(ctx);
  }

  private async vectorSearch(
    ctx: TenantContext,
    convs: Conversation[],
    text: string,
    limit: number,
    minScore: number,
  ): Promise<{ hits: AiSearchHit[]; engine: AiEngine; pendingIndex: number }> {
    const ids = convs.map((c) => c.conversationId);
    if (!ids.length) return { hits: [], engine: 'basic', pendingIndex: 0 };
    const { value, engine } = await this.run(ctx.tenantId, async (e) => {
      // Catch up the index for this scope first (cheap for basic; bounded for a model).
      let budget = e.kind === 'model' ? INDEX_BUDGET_MODEL : INDEX_BUDGET_BASIC;
      const states = new Map(
        (
          await this.db
            .for(ctx.tenantId)
            .ai_index_state.find({ model: e.embeddingModelId, conversationId: { $in: ids } })
            .toArray()
        ).map((s) => [s.conversationId, s.indexedUpTo]),
      );
      let pending = 0;
      for (const c of [...convs].sort((a, b) =>
        (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''),
      )) {
        const behind = c.lastChangeSequence - (states.get(c.conversationId) ?? 0);
        if (behind <= 0) continue;
        if (budget > 0) {
          const n = await this.indexConversation(ctx.tenantId, c.conversationId, e, budget);
          budget -= n;
          pending += Math.max(0, behind - n);
        } else pending += behind;
      }
      const [q] = await e.embed([text]);
      return { q: q!, model: e.embeddingModelId, pending };
    });
    const rows = await this.db
      .for(ctx.tenantId)
      .ai_embeddings.find(
        { model: value.model, conversationId: { $in: ids } },
        {
          sort: { createdAt: -1 },
          limit: MAX_SCAN_VECTORS,
          projection: { messageId: 1, vector: 1 },
        },
      )
      .toArray();
    const top = rows
      .map((r) => ({ id: r.messageId, score: cosine(value.q, r.vector) }))
      .filter((r) => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit * 2);
    // Re-read the messages: anything deleted (or moved out of scope) since indexing is dropped.
    const docs = await this.db
      .for(ctx.tenantId)
      .messages.find({
        _id: { $in: top.map((x) => x.id) },
        conversationId: { $in: ids },
        deletedAt: null,
      })
      .toArray();
    const byId = new Map(docs.map((d) => [d._id, d]));
    const picked = top.filter((x) => byId.has(x.id)).slice(0, limit);
    const heard = await this.transcripts.textsForMessages(
      ctx.tenantId,
      picked
        .map((x) => byId.get(x.id)!)
        .filter((d) => d.attachments?.some((a) => a.recording))
        .map((d) => d._id),
    );
    const hits = picked.flatMap((x) => {
      const d = byId.get(x.id)!;
      const h = heard.get(d._id);
      // A recording whose transcript is gone (recording deleted) no longer matches.
      if (d.messageType !== 'text' && !h) return [];
      const excerpt = h ? bestExcerpt(h, text) : '';
      return [
        {
          messageId: d._id,
          conversationId: d.conversationId,
          senderId: d.senderId,
          text:
            d.messageType === 'text'
              ? [d.content.text, excerpt && `(voice: “${excerpt}”)`].filter(Boolean).join(' ')
              : `${d.content.text}: “${excerpt}”`,
          createdAt: d.createdAt.toISOString(),
          score: Math.round(Math.max(0, Math.min(1, x.score)) * 1000) / 1000,
          fromTranscript: !!h,
        },
      ];
    });
    return { hits, engine, pendingIndex: value.pending };
  }

  async search(ctx: TenantContext, input: unknown): Promise<AiSearchResponse> {
    await this.gate(ctx);
    const req = parse(AiSearchRequestSchema, input);
    const convs = await this.scope(ctx, req.conversationId);
    const r = await this.vectorSearch(ctx, convs, req.query, req.limit, 0.12);
    void this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'ai.search',
      target: req.conversationId ? { type: 'conversation', id: req.conversationId } : null,
      metadata: { hits: r.hits.length, engine: r.engine },
    });
    return r;
  }

  async duplicates(ctx: TenantContext, input: unknown): Promise<AiDuplicates> {
    await this.gate(ctx);
    const req = parse(AiDuplicatesRequestSchema, input);
    const convs = await this.scope(ctx, req.conversationId);
    const engine = await this.engineFor(ctx.tenantId);
    const r = await this.vectorSearch(
      ctx,
      convs,
      req.text,
      5,
      engine.kind === 'model' && engine.embeddingModelId.startsWith('model:') ? 0.8 : 0.45,
    );
    return { matches: r.hits, engine: r.engine };
  }

  private where(c: Conversation | undefined, me: string, names: Map<string, string>): string {
    if (!c) return 'a conversation';
    if (c.kind === 'dm') {
      const other = c.memberIds.find((id) => id !== me);
      return `your DM with ${(other && names.get(other)) ?? 'someone'}`;
    }
    return c.kind.startsWith('channel') ? `#${c.name ?? 'channel'}` : (c.name ?? 'a group');
  }

  async ask(ctx: TenantContext, input: unknown): Promise<AiAskResponse> {
    await this.gate(ctx);
    const req = parse(AiAskRequestSchema, input);
    const convs = await this.scope(ctx, req.conversationId);
    const found = await this.vectorSearch(ctx, convs, req.question, 8, 0.15);
    const byConv = new Map(convs.map((c) => [c.conversationId, c]));
    const memberIds = convs.filter((c) => c.kind === 'dm').flatMap((c) => c.memberIds);
    const names = await this.names(ctx.tenantId, [
      ...found.hits.map((h) => h.senderId),
      ...memberIds,
    ]);
    const sources = found.hits.map((h) => ({
      messageId: h.messageId,
      senderId: h.senderId,
      senderName: names.get(h.senderId) ?? 'Someone',
      text: h.text,
      at: new Date(h.createdAt),
      where: this.where(byConv.get(h.conversationId), ctx.userId, names),
    }));
    const { value, engine } = await this.run(ctx.tenantId, (e) =>
      e.answer({ question: req.question, history: req.history ?? [], sources }),
    );
    void this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'ai.ask',
      target: req.conversationId ? { type: 'conversation', id: req.conversationId } : null,
      metadata: { sources: sources.length, engine },
    });
    return { answer: value, sources: found.hits, engine };
  }

  // ---------- translation + replies ----------

  async translate(ctx: TenantContext, input: unknown): Promise<AiTranslation> {
    await this.gate(ctx);
    const req = parse(AiTranslateRequestSchema, input);
    const m = await this.db.for(ctx.tenantId).messages.findOne({ _id: req.messageId });
    if (!m || m.deletedAt) throw notFound('Message');
    await this.conversations.authorize(ctx, m.conversationId, 'conversation.read').catch(() => {
      throw notFound('Message');
    });
    const engine = await this.engineFor(ctx.tenantId);
    let text: string | null = null;
    let used: AiEngine = 'basic';
    if (engine.kind === 'model' && m.content.text.trim()) {
      try {
        text = await engine.translate(m.content.text, req.targetLanguage);
        used = 'model';
        this.lastError.delete(ctx.tenantId);
      } catch (e) {
        if (!(e instanceof ModelUnavailableError)) throw e;
        this.lastError.set(ctx.tenantId, e.message);
        throw new AppError(
          'UNAVAILABLE',
          'The model server is not answering right now. Try again shortly.',
        );
      }
    }
    return { messageId: m._id, targetLanguage: req.targetLanguage, text, engine: used };
  }

  async suggestReplies(ctx: TenantContext, conversationId: string): Promise<AiSuggestedReplies> {
    await this.gate(ctx);
    await this.conversations.authorize(ctx, conversationId, 'conversation.read');
    const docs = await this.db
      .for(ctx.tenantId)
      .messages.find(
        { conversationId, deletedAt: null, messageType: 'text' },
        { sort: { serverSequence: -1 }, limit: 30 },
      )
      .toArray();
    docs.reverse();
    const names = await this.names(ctx.tenantId, [...docs.map((d) => d.senderId), ctx.userId]);
    const lines = this.toLines(docs, names);
    const last = [...lines].reverse().find((l) => l.senderId !== ctx.userId) ?? null;
    if (!last) return { conversationId, replyToMessageId: null, suggestions: [], engine: 'basic' };
    const { value, engine } = await this.run(ctx.tenantId, (e) =>
      e.suggestReplies({ lines, meId: ctx.userId, meName: names.get(ctx.userId) ?? 'me' }),
    );
    return {
      conversationId,
      replyToMessageId: last.messageId,
      suggestions: value.slice(0, 3),
      engine,
    };
  }

  // ---------- digest, priority ----------

  async digest(ctx: TenantContext, input: unknown): Promise<AiDigest> {
    await this.gate(ctx);
    const req = parse(AiDigestRequestSchema, input ?? {});
    const since = new Date(Date.now() - (req.sinceHours ?? 168) * 3_600_000);
    const readable = await this.conversations.listReadable(ctx);
    let chosen: Conversation[];
    if (req.conversationIds?.length) {
      const allowed = new Map(readable.map((c) => [c.conversationId, c]));
      // Ids the caller cannot read are skipped silently (never confirmed to exist).
      chosen = req.conversationIds
        .map((id) => allowed.get(id))
        .filter((c): c is Conversation => !!c);
    } else {
      chosen = readable
        .filter((c) => c.myRole !== null && c.lastMessageAt && new Date(c.lastMessageAt) >= since)
        .sort((a, b) => b.lastMessageAt!.localeCompare(a.lastMessageAt!))
        .slice(0, 8);
    }
    // Linked projects (Samptrek or Connect), only those whose channel the caller can read.
    const projects = new Map<string, AiProjectStatus>();
    for (const p of await this.projects.list(ctx).catch(() => [] as Project[]))
      if (p.conversationId && !projects.has(p.conversationId))
        projects.set(p.conversationId, projectStatus(p));
    if (!req.conversationIds?.length) {
      // Projects that need attention are in the digest even when their channel is quiet.
      const have = new Set(chosen.map((c) => c.conversationId));
      const byId = new Map(readable.map((c) => [c.conversationId, c]));
      const extra = [...projects.entries()]
        .filter(([id, p]) => !have.has(id) && p.concerns.length && byId.has(id))
        .slice(0, 4)
        .map(([id]) => byId.get(id)!);
      chosen = [...chosen, ...extra];
    }
    const engine = await this.engineFor(ctx.tenantId);
    let used: AiEngine = engine.kind;
    const items: AiDigest['items'] = [];
    for (const c of chosen) {
      const t = this.db.for(ctx.tenantId);
      const docs = await t.messages
        .find(
          {
            conversationId: c.conversationId,
            deletedAt: null,
            ...READABLE_TYPES,
            createdAt: { $gte: since },
          },
          { sort: { serverSequence: -1 }, limit: 200 },
        )
        .toArray();
      docs.reverse();
      const { lines } = await this.linesFor(ctx.tenantId, docs);
      const members = await this.members(ctx, c);
      if (!lines.length) {
        items.push({
          conversationId: c.conversationId,
          summary: 'No activity in this period.',
          status: projects.get(c.conversationId)?.concerns.length ? 'needs_attention' : 'quiet',
          actionItems: [],
          messageCount: 0,
          project: projects.get(c.conversationId) ?? null,
        });
        continue;
      }
      const r = await this.run(ctx.tenantId, (e) =>
        e.summarize({ title: c.name ?? 'Direct message', lines, members }),
      );
      if (r.engine === 'basic') used = 'basic';
      const actionItems = this.mapActionItems(r.value.actionItems, members);
      const project = projects.get(c.conversationId) ?? null;
      const attention =
        !!project?.concerns.length ||
        r.value.openQuestions.length > 0 ||
        lines.slice(-20).some((l) => ATTENTION_RE.test(l.text)) ||
        actionItems.some((a) => a.due && URGENT_RE.test(a.due));
      items.push({
        conversationId: c.conversationId,
        summary: r.value.summary,
        status:
          lines.length < 3 && !attention ? 'quiet' : attention ? 'needs_attention' : 'on_track',
        actionItems,
        messageCount: lines.length,
        project,
      });
    }
    void this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'ai.digest',
      target: null,
      metadata: { conversations: items.length, engine: used },
    });
    return {
      items,
      suggestedTasks: items
        .flatMap((i) => i.actionItems.map((a) => ({ ...a, conversationId: i.conversationId })))
        .slice(0, 20),
      since: since.toISOString(),
      engine: used,
    };
  }

  /** Rules-based ranking (no model needed): mentions, DMs, urgency words, questions, age. */
  async prioritizeNotifications(ctx: TenantContext): Promise<AiPrioritizedNotifications> {
    await this.gate(ctx);
    const page = await this.notifications.list(ctx, { unread: 'true', limit: '100' });
    const convs = new Map(
      (await this.conversations.listReadable(ctx)).map((c) => [c.conversationId, c]),
    );
    const items = page.items.map((n) => {
      const reasons: string[] = [];
      let score = n.kind === 'mention' ? 3 : 2;
      reasons.push(n.kind === 'mention' ? 'You were mentioned' : 'Reply to your message');
      const c = convs.get(n.conversationId);
      if (c?.kind === 'dm') {
        score += 2;
        reasons.push('Direct message');
      } else if (c && c.memberIds.length <= 5) {
        score += 1;
        reasons.push('Small group');
      }
      if (URGENT_RE.test(n.preview)) {
        score += 3;
        reasons.push('Sounds urgent');
      }
      if (/\?\s*$|\?\s/.test(n.preview)) {
        score += 1;
        reasons.push('Asks you something');
      }
      const ageH = (Date.now() - new Date(n.createdAt).getTime()) / 3_600_000;
      if (ageH > 48) {
        score -= 1;
        reasons.push('Older than 2 days');
      }
      if (c?.myNotifyLevel === 'mentions' && n.kind !== 'mention') score -= 1;
      const priority =
        score >= 6 ? ('high' as const) : score >= 4 ? ('normal' as const) : ('low' as const);
      return { notificationId: n.notificationId, priority, score, reasons };
    });
    items.sort((a, b) => b.score - a.score);
    return { items, engine: 'basic' };
  }

  // ---------- drafts that need confirmation ----------

  private toProposal(p: AiProposalDoc): AiProposal {
    const expired = p.status === 'pending' && p.expiresAt.getTime() < Date.now();
    return {
      proposalId: p._id,
      kind: p.kind,
      conversationId: p.conversationId,
      text: p.text,
      risk: p.risk as AiProposal['risk'],
      status: expired ? 'expired' : p.status,
      createdAt: p.createdAt.toISOString(),
      expiresAt: p.expiresAt.toISOString(),
      messageId: p.messageId,
    };
  }

  /** Guests in a conversation make anything sent there external. */
  private async hasExternalAudience(tenantId: string, conversationId: string): Promise<boolean> {
    const ids = await this.conversations.memberIds(tenantId, conversationId);
    return (
      (await this.db
        .for(tenantId)
        .memberships.countDocuments({ userId: { $in: ids }, role: 'guest' })) > 0
    );
  }

  async createProposal(ctx: TenantContext, input: unknown): Promise<AiProposal> {
    await this.gate(ctx);
    const req = parse(CreateAiProposalRequestSchema, input);
    await this.conversations.authorize(ctx, req.conversationId, 'message.send');
    const risk = classifyActionRisk(req.text, {
      externalAudience: await this.hasExternalAudience(ctx.tenantId, req.conversationId),
    });
    const now = new Date();
    const doc = await this.db.for(ctx.tenantId).ai_proposals.insertOne({
      userId: ctx.userId,
      kind: 'send_message',
      conversationId: req.conversationId,
      text: req.text,
      risk,
      status: 'pending',
      clientMessageId: uuidv7(),
      messageId: null,
      createdAt: now,
      expiresAt: new Date(now.getTime() + AI_PROPOSAL_TTL_MINUTES * 60_000),
      confirmedAt: null,
    });
    return this.publishProposal(ctx, doc);
  }

  /** Drafts follow the person across their devices: a draft sent or dismissed on one closes everywhere. */
  private publishProposal(ctx: TenantContext, doc: AiProposalDoc): AiProposal {
    const proposal = this.toProposal(doc);
    this.realtime.toUser(ctx.tenantId, ctx.userId, 'ai:proposal', proposal);
    return proposal;
  }

  private async ownProposal(ctx: TenantContext, proposalId: string): Promise<AiProposalDoc> {
    // Another person's draft is reported as not found.
    const p = await this.db
      .for(ctx.tenantId)
      .ai_proposals.findOne({ _id: proposalId, userId: ctx.userId });
    if (!p) throw notFound('Draft');
    return p;
  }

  async confirmProposal(
    ctx: TenantContext,
    proposalId: string,
    input: unknown,
  ): Promise<{ proposal: AiProposal; message: SendMessageAck['message'] }> {
    await this.gate(ctx);
    const req = parse(ConfirmAiProposalRequestSchema, input);
    const p = await this.ownProposal(ctx, proposalId);
    const t = this.db.for(ctx.tenantId);
    if (p.status === 'confirmed') {
      // Idempotent: the same draft never sends twice.
      const m = await t.messages.findOne({ clientMessageId: p.clientMessageId });
      if (m) return { proposal: this.toProposal(p), message: toMessage(m) };
    }
    if (p.status === 'dismissed') throw new AppError('CONFLICT', 'This draft was dismissed');
    if (p.expiresAt.getTime() < Date.now())
      throw new AppError('CONFLICT', 'This draft expired. Create it again.');
    const text = req.text ?? p.text;
    const risk =
      text === p.text
        ? p.risk
        : classifyActionRisk(text, {
            externalAudience: await this.hasExternalAudience(ctx.tenantId, p.conversationId),
          });
    if (risk.level === 'sensitive' && !req.acknowledgeRisk)
      throw new AppError('VALIDATION_FAILED', 'This draft needs an explicit confirmation', {
        reason: 'RISK_ACK_REQUIRED',
        categories: risk.categories,
      });
    // MessagesService.send re-checks that the caller may still post here.
    const ack = await this.messages.send(ctx, {
      conversationId: p.conversationId,
      clientMessageId: p.clientMessageId,
      content: { text, mentions: [] },
    });
    const now = new Date();
    const updated = await t.ai_proposals.findOneAndUpdate(
      { _id: p._id, userId: ctx.userId },
      {
        $set: {
          status: 'confirmed',
          text,
          risk,
          messageId: ack.message.messageId,
          confirmedAt: now,
          expiresAt: new Date(now.getTime() + 60_000),
        },
      },
      { returnDocument: 'after' },
    );
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'ai.draft.confirmed',
      target: { type: 'message', id: ack.message.messageId },
      metadata: { proposalId: p._id, risk: risk.categories, edited: text !== p.text },
    });
    return { proposal: this.publishProposal(ctx, updated ?? p), message: ack.message };
  }

  async dismissProposal(ctx: TenantContext, proposalId: string): Promise<AiProposal> {
    const p = await this.ownProposal(ctx, proposalId);
    if (p.status !== 'pending') return this.toProposal(p);
    const updated = await this.db
      .for(ctx.tenantId)
      .ai_proposals.findOneAndUpdate(
        { _id: p._id, userId: ctx.userId, status: 'pending' },
        { $set: { status: 'dismissed' } },
        { returnDocument: 'after' },
      );
    // Sent or dismissed meanwhile (another device): report what it is now.
    if (!updated) return this.toProposal(await this.ownProposal(ctx, proposalId));
    return this.publishProposal(ctx, updated);
  }

  /** The caller's dismissed suggested tasks (private to them, kept 180 days). */
  async dismissedSuggestions(ctx: TenantContext): Promise<AiDismissedSuggestions> {
    const rows = await this.db
      .for(ctx.tenantId)
      .ai_suggestion_dismissals.find(
        { userId: ctx.userId },
        { sort: { createdAt: -1 }, limit: 2000 },
      )
      .toArray();
    return { suggestionIds: rows.map((r) => r.suggestionId) };
  }

  /** Idempotent: dismissing twice, or restoring one that isn't dismissed, changes nothing. */
  async setSuggestionDismissed(
    ctx: TenantContext,
    suggestionId: string,
    dismissed: boolean,
  ): Promise<AiSuggestionEvent> {
    const id = parse(AiSuggestionIdSchema, suggestionId);
    const t = this.db.for(ctx.tenantId);
    if (dismissed)
      await t.ai_suggestion_dismissals.updateOne(
        { userId: ctx.userId, suggestionId: id },
        { $setOnInsert: { createdAt: new Date() } },
        { upsert: true },
      );
    else await t.ai_suggestion_dismissals.deleteMany({ userId: ctx.userId, suggestionId: id });
    const e = { suggestionId: id, dismissed };
    this.realtime.toUser(ctx.tenantId, ctx.userId, 'ai:suggestion', e);
    return e;
  }
}

/** The transcript sentence (with its neighbour) that shares the most words with the query. */
export function bestExcerpt(transcript: string, query: string, max = 280): string {
  const q = new Set(tokenize(query).map(stem));
  const parts = sentences(transcript);
  if (!parts.length) return transcript.slice(0, max);
  let best = 0;
  let bestScore = -1;
  parts.forEach((p, i) => {
    const score = tokenize(p).filter((t) => q.has(stem(t))).length;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  const out = [parts[best], parts[best + 1]].filter(Boolean).join(' ');
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

/** A project's status for the digest, with plain reasons when it needs attention. */
export function projectStatus(p: Project, now = new Date()): AiProjectStatus {
  const open = p.milestones.filter(
    (m) =>
      m.status !== 'reached' &&
      m.status !== 'missed' &&
      (m.dueAt === null || new Date(m.dueAt) >= now),
  );
  const next =
    [...open].sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'))[0] ?? null;
  const missed = p.milestones.filter(
    (m) =>
      m.status === 'missed' ||
      (m.status !== 'reached' && m.dueAt !== null && new Date(m.dueAt) < now),
  ).length;
  const concerns: string[] = [];
  if (p.status === 'at_risk') concerns.push('Marked at risk');
  if (p.status === 'on_hold') concerns.push('On hold');
  if (missed) concerns.push(`${missed} milestone${missed === 1 ? '' : 's'} missed`);
  if (p.overdueTasks)
    concerns.push(`${p.overdueTasks} overdue task${p.overdueTasks === 1 ? '' : 's'}`);
  if (p.dueAt && p.status === 'active' && new Date(p.dueAt) < now)
    concerns.push('Past its due date');
  return {
    projectId: p.projectId,
    name: p.name,
    source: p.source,
    status: p.status,
    url: p.url,
    dueAt: p.dueAt,
    nextMilestone: next,
    missedMilestones: missed,
    openTasks: p.openTasks,
    overdueTasks: p.overdueTasks,
    pendingApprovals: p.pendingApprovals,
    concerns,
  };
}
