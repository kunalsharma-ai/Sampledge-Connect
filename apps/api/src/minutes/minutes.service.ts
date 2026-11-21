import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  CHAT_EXPORT_MAX_MESSAGES,
  ChatExportRequestSchema,
  DEFAULT_MINUTES_SETTINGS,
  GenerateMinutesRequestSchema,
  ListMinutesQuerySchema,
  MIME_BY_FORMAT,
  MINUTES_EDITABLE_FIELDS,
  MinutesDocumentQuerySchema,
  MinutesSettingsSchema,
  UpdateMinutesRequestSchema,
  canExportChat,
  documentFileName,
  formatCallDuration,
  languageLabel,
  tenantCan,
  uuidv7,
  type CallMinutesResponse,
  type ChatExportAccess,
  type ChatExportFormat,
  type MeetingMinutes,
  type MinutesActionItem,
  type MinutesAttendee,
  type MinutesConfig,
  type MinutesEditableField,
  type MinutesSettings,
  type MinutesSystemMetadata,
} from '@sampledge/contracts';
import { AppError, forbidden, notFound, parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import type {
  CallDoc,
  ConversationDoc,
  MeetingMinutesDoc,
  MessageDoc,
} from '../database/documents.js';
import { TenantDb } from '../database/tenant-db.js';
import { AuditService } from '../audit/audit.service.js';
import {
  ConversationsService,
  type LoadedConversation,
} from '../conversations/conversations.service.js';
import { MessagesService } from '../messages/messages.service.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';
import { RateLimitService } from '../redis/redis.module.js';
import { AiService } from '../ai/ai.service.js';
import { TranscriptsService } from '../ai/transcripts.service.js';
import type { Member, TranscriptLine } from '../ai/engine.js';
import { BrandingService } from '../branding/branding.service.js';
import {
  chatModel,
  chatText,
  fmtTime,
  minutesModel,
  minutesTranscriptRows,
  safeTimeZone,
  type Brand,
} from '../documents/build.js';
import { logoFromDataUrl } from '../documents/model.js';
import { renderPdf } from '../documents/pdf.js';
import { renderDocx } from '../documents/docx.js';
import type { ChatLine } from '../documents/model.js';

/** Chat around the call that still counts as "during the meeting". */
const CHAT_SLACK_MS = 5 * 60_000;
/** Lines handed to the engine (newest kept when longer). */
const MAX_LINES = 1200;

export interface RenderedFile {
  fileName: string;
  mimeType: string;
  body: Buffer;
}

/**
 * Minutes of meeting and chat export. Minutes come from what the organization's own servers
 * already have for a call (attendees, transcripts, kept captions, chat during the call),
 * written up by the private assistant, then reviewed by the people who were in the call
 * before anyone else sees them.
 */
@Injectable()
export class MinutesService {
  constructor(
    private readonly db: TenantDb,
    private readonly conversations: ConversationsService,
    private readonly messages: MessagesService,
    private readonly ai: AiService,
    private readonly transcripts: TranscriptsService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimePublisher,
    private readonly rateLimit: RateLimitService,
  ) {}

  // ---------- organization settings ----------

  async settings(tenantId: string): Promise<MinutesSettings> {
    const s = await this.db
      .for(tenantId)
      .tenant_settings.findOne({}, { projection: { minutes: 1 } });
    const r = MinutesSettingsSchema.safeParse({
      ...DEFAULT_MINUTES_SETTINGS,
      ...(s?.minutes ?? {}),
    });
    return r.success ? r.data : DEFAULT_MINUTES_SETTINGS;
  }

  async getSettings(ctx: TenantContext): Promise<MinutesSettings> {
    if (!tenantCan(ctx.role, 'recordings.manage')) throw forbidden();
    return this.settings(ctx.tenantId);
  }

  async setSettings(ctx: TenantContext, body: unknown): Promise<MinutesSettings> {
    if (!tenantCan(ctx.role, 'recordings.manage')) throw forbidden();
    const req = parse(MinutesSettingsSchema, body);
    const before = await this.settings(ctx.tenantId);
    await this.db.for(ctx.tenantId).tenant_settings.updateOne(
      {},
      {
        $set: { minutes: req, updatedAt: new Date(), updatedBy: ctx.userId },
        $setOnInsert: { recordingRetentionDays: null, callRecordingEnabled: true },
      },
      { upsert: true },
    );
    // Shorter retention applies to captions already kept.
    if (req.captionRetentionDays < before.captionRetentionDays)
      await this.shortenCaptions(ctx.tenantId, req.captionRetentionDays);
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'minutes.settings.update',
      target: { type: 'tenant', id: ctx.tenantId },
      metadata: { ...req },
    });
    this.realtime.toTenant(ctx.tenantId, 'tenant:updated', { area: 'minutes' });
    return req;
  }

  private async shortenCaptions(tenantId: string, days: number) {
    const t = this.db.for(tenantId);
    const rows = await t.call_captions.find({}, { projection: { _id: 1, at: 1 } }).toArray();
    for (const r of rows)
      await t.call_captions.updateOne(
        { _id: r._id },
        { $set: { expiresAt: new Date(r.at.getTime() + days * 86_400_000) } },
      );
  }

  async config(ctx: TenantContext): Promise<MinutesConfig> {
    const s = await this.settings(ctx.tenantId);
    return {
      defaultTemplate: s.defaultTemplate,
      defaultLanguage: s.defaultLanguage,
      chatExport: s.chatExport,
      keepCaptions: s.keepCaptions,
      model: await this.ai.hasModel(ctx.tenantId),
      aiEnabled: await this.ai.enabledFor(ctx.tenantId),
      canManage: tenantCan(ctx.role, 'recordings.manage'),
    };
  }

  // ---------- access ----------

  private async loadCall(ctx: TenantContext, callId: string) {
    const call = await this.db.for(ctx.tenantId).calls.findOne({ _id: callId });
    if (!call) throw notFound('Call');
    const loaded = await this.conversations
      .authorize(ctx, call.conversationId, 'conversation.read')
      .catch(() => {
        throw notFound('Call');
      });
    return { call, loaded };
  }

  /** People in the call, conversation owners and moderators, and organization admins. */
  private isEditor(ctx: TenantContext, loaded: LoadedConversation, editorIds: string[]): boolean {
    if (ctx.role === 'guest') return false;
    if (ctx.role === 'owner' || ctx.role === 'admin') return true;
    const r = loaded.membership?.role;
    if (r === 'owner' || r === 'moderator') return true;
    return editorIds.includes(ctx.userId);
  }

  private callEditors(call: CallDoc): string[] {
    return [
      ...new Set([
        call.startedBy,
        ...call.participants.filter((p) => p.joinedAt).map((p) => p.userId),
      ]),
    ];
  }

  private async view(
    ctx: TenantContext,
    d: MeetingMinutesDoc,
    loaded: LoadedConversation,
  ): Promise<MeetingMinutes> {
    return {
      minutesId: d._id,
      callId: d.callId,
      conversationId: d.conversationId,
      meetingId: d.meetingId,
      title: d.title,
      media: d.media,
      startedAt: d.startedAt.toISOString(),
      endedAt: d.endedAt?.toISOString() ?? null,
      durationSec: d.durationSec,
      attendees: d.attendees,
      agenda: d.agenda,
      summary: d.summary,
      decisions: d.decisions,
      actionItems: d.actionItems,
      openQuestions: d.openQuestions,
      notes: d.notes,
      language: d.language,
      sources: d.sources,
      engine: d.engine,
      status: d.status,
      revision: d.revision,
      createdBy: d.createdBy,
      createdAt: d.createdAt.toISOString(),
      updatedBy: d.updatedBy,
      updatedAt: d.updatedAt.toISOString(),
      sharedBy: d.sharedBy,
      sharedAt: d.sharedAt?.toISOString() ?? null,
      canEdit: this.isEditor(ctx, loaded, d.editorIds),
    };
  }

  /** The minutes, checked: drafts are only for editors (404 otherwise, so nothing leaks). */
  private async load(ctx: TenantContext, minutesId: string) {
    const d = await this.db.for(ctx.tenantId).meeting_minutes.findOne({ _id: minutesId });
    if (!d) throw notFound('Minutes');
    const loaded = await this.conversations
      .authorize(ctx, d.conversationId, 'conversation.read')
      .catch(() => {
        throw notFound('Minutes');
      });
    const editor = this.isEditor(ctx, loaded, d.editorIds);
    if (d.status === 'draft' && !editor) throw notFound('Minutes');
    return { d, loaded, editor };
  }

  private emit(tenantId: string, d: MeetingMinutesDoc, deleted = false) {
    this.realtime.toConversation(tenantId, d.conversationId, 'minutes:changed', {
      minutesId: d._id,
      callId: d.callId,
      conversationId: d.conversationId,
      revision: d.revision,
      deleted,
    });
  }

  // ---------- minutes ----------

  async forCall(ctx: TenantContext, callId: string): Promise<CallMinutesResponse> {
    const { call, loaded } = await this.loadCall(ctx, callId);
    const d = await this.db.for(ctx.tenantId).meeting_minutes.findOne({ callId });
    const editor = this.isEditor(ctx, loaded, d?.editorIds ?? this.callEditors(call));
    const blockedReason =
      call.status === 'live'
        ? 'Minutes can be made once the call ends.'
        : !call.participants.some((p) => p.joinedAt && p.userId !== call.startedBy) &&
            !(call.guests ?? []).some((g) => g.joinedAt)
          ? 'Nobody else joined this call.'
          : null;
    return {
      minutes: d && (d.status === 'shared' || editor) ? await this.view(ctx, d, loaded) : null,
      canCreate: editor && !d && !blockedReason,
      blockedReason: d ? null : blockedReason,
    };
  }

  async list(ctx: TenantContext, query: unknown): Promise<{ items: MeetingMinutes[] }> {
    const q = parse(ListMinutesQuerySchema, query);
    const readable = q.conversationId
      ? [q.conversationId]
      : (await this.conversations.listReadable(ctx)).map((c) => c.conversationId);
    const docs = await this.db
      .for(ctx.tenantId)
      .meeting_minutes.find(
        { conversationId: { $in: readable } },
        { sort: { startedAt: -1 }, limit: q.limit * 2 },
      )
      .toArray();
    const out: MeetingMinutes[] = [];
    const cache = new Map<string, LoadedConversation | null>();
    for (const d of docs) {
      if (!cache.has(d.conversationId))
        cache.set(
          d.conversationId,
          await this.conversations
            .authorize(ctx, d.conversationId, 'conversation.read')
            .catch(() => null),
        );
      const loaded = cache.get(d.conversationId);
      if (!loaded) continue;
      if (d.status === 'draft' && !this.isEditor(ctx, loaded, d.editorIds)) continue;
      out.push(await this.view(ctx, d, loaded));
      if (out.length >= q.limit) break;
    }
    return { items: out };
  }

  async get(ctx: TenantContext, minutesId: string): Promise<MeetingMinutes> {
    const { d, loaded } = await this.load(ctx, minutesId);
    return this.view(ctx, d, loaded);
  }

  /**
   * Creates the draft for a finished call (or writes it again with `regenerate`). Content comes
   * from transcripts (in the chosen language when a translation exists), kept captions and the
   * chat during the call. With AI off, the draft starts blank with the attendees filled in.
   */
  async generate(ctx: TenantContext, callId: string, body: unknown): Promise<MeetingMinutes> {
    const req = parse(GenerateMinutesRequestSchema, body ?? {});
    const { call, loaded } = await this.loadCall(ctx, callId);
    const t = this.db.for(ctx.tenantId);
    const existing = await t.meeting_minutes.findOne({ callId });
    if (!this.isEditor(ctx, loaded, existing?.editorIds ?? this.callEditors(call)))
      throw forbidden(
        'Only people who were in the call, moderators and admins can make its minutes',
      );
    if (call.status === 'live')
      throw new AppError('CONFLICT', 'Minutes can be made once the call ends.');
    if (existing && !req.regenerate) return this.view(ctx, existing, loaded);
    await this.rateLimit.consume('ai', `${ctx.tenantId}:${ctx.userId}`);

    const settings = await this.settings(ctx.tenantId);
    const language = req.language ?? existing?.language ?? settings.defaultLanguage;
    const source = await this.collect(ctx, call, loaded.conversation, language);
    const aiOn = await this.ai.enabledFor(ctx.tenantId);
    let content = {
      summary: '',
      decisions: [] as string[],
      openQuestions: [] as string[],
      actionItems: [] as MinutesActionItem[],
      engine: 'manual' as MeetingMinutesDoc['engine'],
    };
    if (aiOn && source.lines.length) {
      const r = await this.ai.draftMinutes(ctx, {
        title: source.title,
        agenda: source.agenda,
        lines: source.lines,
        members: source.members,
        language,
      });
      const byId = new Map(
        source.attendees.filter((a) => a.userId).map((a) => [a.userId!, a.name]),
      );
      content = {
        summary: [r.value.summary, ...r.value.highlights.map((h) => `• ${h}`)]
          .filter(Boolean)
          .join('\n'),
        decisions: r.value.decisions,
        openQuestions: r.value.openQuestions,
        actionItems: r.actionItems.slice(0, 50).map((a, i) => ({
          id: uuidv7(),
          text: a.text.slice(0, 500),
          ownerId: a.assigneeId,
          ownerName: a.assigneeId
            ? (byId.get(a.assigneeId) ?? null)
            : (r.value.actionItems[i]?.assignee?.slice(0, 120) ?? null),
          due: a.due?.slice(0, 60) ?? null,
          done: false,
        })),
        engine: r.engine === 'model' ? 'model' : 'basic',
      };
    }
    const now = new Date();
    const fields = {
      meetingId: source.meetingId,
      title:
        existing?.title && req.regenerate && existing.fieldRevs.title
          ? existing.title
          : source.title,
      media: call.media,
      startedAt: call.startedAt,
      endedAt: call.endedAt,
      durationSec: call.endedAt
        ? Math.round((call.endedAt.getTime() - call.startedAt.getTime()) / 1000)
        : null,
      attendees: source.attendees,
      agenda: source.agenda,
      summary: content.summary,
      decisions: content.decisions,
      actionItems: content.actionItems,
      openQuestions: content.openQuestions,
      notes: existing?.notes ?? '',
      language,
      sources: source.sources,
      engine: content.engine,
      editorIds: this.callEditors(call),
      updatedBy: ctx.userId,
      updatedAt: now,
    };
    let doc: MeetingMinutesDoc | null;
    if (existing) {
      doc = await t.meeting_minutes.findOneAndUpdate(
        { _id: existing._id },
        {
          $set: { ...fields, fieldRevs: {}, revision: existing.revision + 1 },
        },
        { returnDocument: 'after' },
      );
    } else {
      try {
        doc = await t.meeting_minutes.insertOne({
          callId,
          conversationId: call.conversationId,
          ...fields,
          status: 'draft',
          revision: 1,
          fieldRevs: {},
          createdBy: ctx.userId,
          createdAt: now,
          sharedBy: null,
          sharedAt: null,
          messageId: null,
        });
      } catch (e) {
        // Two people pressed "Make minutes" at once: return the one that won.
        if ((e as { code?: number }).code !== 11000) throw e;
        doc = await t.meeting_minutes.findOne({ callId });
      }
    }
    if (!doc) throw notFound('Minutes');
    void this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: existing ? 'minutes.regenerate' : 'minutes.create',
      target: { type: 'minutes', id: doc._id },
      metadata: { callId, language, engine: content.engine, ...source.sources },
    });
    this.emit(ctx.tenantId, doc);
    return this.view(ctx, doc, loaded);
  }

  /** Everything the minutes are written from, access-checked through the call's conversation. */
  private async collect(
    ctx: TenantContext,
    call: CallDoc,
    conv: ConversationDoc,
    language: string,
  ) {
    const t = this.db.for(ctx.tenantId);
    const end = call.endedAt ?? new Date();
    const meeting = (
      await t.meetings
        .find(
          {
            conversationId: call.conversationId,
            startsAt: {
              $gte: new Date(call.startedAt.getTime() - 12 * 3_600_000),
              $lte: new Date(call.startedAt.getTime() + 12 * 3_600_000),
            },
          },
          { limit: 10 },
        )
        .toArray()
    ).sort(
      (a, b) =>
        Math.abs(a.startsAt.getTime() - call.startedAt.getTime()) -
        Math.abs(b.startsAt.getTime() - call.startedAt.getTime()),
    )[0];

    const userIds = [...new Set([call.startedBy, ...call.participants.map((p) => p.userId)])];
    const users = await t.users
      .find({ _id: { $in: userIds } }, { projection: { displayName: 1 } })
      .toArray();
    const names = new Map(users.map((u) => [u._id, u.displayName]));
    const mins = (a: Date | null, b: Date | null) =>
      a ? Math.max(1, Math.round(((b ?? end).getTime() - a.getTime()) / 60_000)) : null;
    const attendees: MinutesAttendee[] = [
      ...call.participants
        .filter((p) => p.joinedAt)
        .map((p) => ({
          userId: p.userId,
          name: names.get(p.userId) ?? 'Someone',
          guest: false,
          minutes: mins(p.joinedAt, p.leftAt),
        })),
      ...(call.guests ?? [])
        .filter((g) => g.joinedAt)
        .map((g) => ({
          userId: null,
          name: g.name,
          guest: true,
          minutes: mins(g.joinedAt, g.leftAt),
        })),
    ];
    if (!attendees.some((a) => a.userId === call.startedBy))
      attendees.unshift({
        userId: call.startedBy,
        name: names.get(call.startedBy) ?? 'Someone',
        guest: false,
        minutes: mins(call.startedAt, call.endedAt),
      });
    const members: Member[] = attendees.map((a) => ({
      userId: a.userId ?? `guest:${a.name}`,
      name: a.name,
    }));

    // Recording transcripts of this call (the chosen language when translated).
    const recordings = await t.attachments
      .find(
        { callId: call._id, deletedAt: null, status: 'ready' },
        { projection: { _id: 1, messageId: 1 } },
      )
      .toArray();
    const docs = recordings.length
      ? await t.ai_transcripts
          .find({ attachmentId: { $in: recordings.map((r) => r._id) }, status: 'done' })
          .toArray()
      : [];
    const lines: TranscriptLine[] = [];
    const spoken = new Set<string>();
    let reviewed = 0;
    for (const d of docs) {
      if (d.language) spoken.add(d.language);
      if (d.reviewedBy || d.edited) reviewed++;
      const tr =
        d.language !== language
          ? d.translations?.find((x) => x.language === language && x.status === 'done')
          : undefined;
      const segs = (tr ?? d).segments;
      const text = (tr ?? d).text ?? '';
      const rows = segs.length ? segs : text ? [{ startMs: 0, endMs: 0, text }] : [];
      for (const s of rows)
        lines.push({
          messageId: d.messageId ?? d.attachmentId,
          senderId: 'recording',
          senderName: 'Call recording (transcript)',
          text: s.text,
          at: new Date(call.startedAt.getTime() + s.startMs),
        });
    }
    // Kept captions carry who said what; used when there is no transcript.
    const captions = await t.call_captions
      .find({ callId: call._id }, { sort: { at: 1 }, limit: 4000 })
      .toArray();
    if (!docs.length)
      for (const c of captions)
        lines.push({
          messageId: `caption:${c._id}`,
          senderId: c.userId ?? `guest:${c.speaker}`,
          senderName: `${c.speaker} (transcript)`,
          text: c.text,
          at: c.at,
        });
    // Chat during the call.
    const chat = await t.messages
      .find(
        {
          conversationId: call.conversationId,
          messageType: 'text',
          deletedAt: null,
          createdAt: {
            $gte: new Date(call.startedAt.getTime() - CHAT_SLACK_MS),
            $lte: new Date(end.getTime() + CHAT_SLACK_MS),
          },
        },
        { sort: { serverSequence: 1 }, limit: 500 },
      )
      .toArray();
    const chatNames = await this.senderNames(ctx.tenantId, chat);
    for (const m of chat)
      if (m.content.text.trim())
        lines.push({
          messageId: m._id,
          senderId: m.senderId,
          senderName: chatNames.get(m._id) ?? 'Someone',
          text: m.content.text.trim(),
          at: m.createdAt,
        });
    lines.sort((a, b) => a.at.getTime() - b.at.getTime());
    const convName = await this.conversationName(ctx.tenantId, conv);
    return {
      meetingId: meeting?._id ?? null,
      title: meeting?.title ?? `${call.media === 'video' ? 'Video' : 'Voice'} call · ${convName}`,
      agenda: meeting?.agenda ?? '',
      attendees,
      members,
      lines: lines.slice(-MAX_LINES),
      sources: {
        transcripts: docs.length,
        reviewedTranscripts: reviewed,
        captionLines: docs.length ? 0 : captions.length,
        chatMessages: chat.length,
        spokenLanguages: [...spoken],
      },
    };
  }

  async update(ctx: TenantContext, minutesId: string, body: unknown): Promise<MeetingMinutes> {
    const req = parse(UpdateMinutesRequestSchema, body);
    const t = this.db.for(ctx.tenantId);
    for (let attempt = 0; attempt < 5; attempt++) {
      const { d, loaded, editor } = await this.load(ctx, minutesId);
      if (!editor)
        throw forbidden(
          'Only people who were in the call, moderators and admins can edit the minutes',
        );
      const changed = MINUTES_EDITABLE_FIELDS.filter((f) => req[f] !== undefined);
      const conflicts = changed.filter(
        (f) =>
          (d.fieldRevs[f] ?? 0) > req.baseRevision &&
          JSON.stringify(d[f]) !== JSON.stringify(req[f]),
      );
      if (conflicts.length)
        throw new AppError(
          'CONFLICT',
          'Someone else changed the same part of these minutes. Reload to see their version.',
          { current: await this.view(ctx, d, loaded), fields: conflicts },
        );
      const next = d.revision + 1;
      const set: Record<string, unknown> = {
        revision: next,
        updatedBy: ctx.userId,
        updatedAt: new Date(),
      };
      for (const f of changed) {
        set[f] = req[f];
        set[`fieldRevs.${f}`] = next;
      }
      const updated = await t.meeting_minutes.findOneAndUpdate(
        { _id: d._id, revision: d.revision },
        { $set: set },
        { returnDocument: 'after' },
      );
      if (!updated) continue; // someone saved in between: merge again
      void this.audit.record({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: 'minutes.update',
        target: { type: 'minutes', id: d._id },
        metadata: { fields: changed as MinutesEditableField[] },
      });
      this.emit(ctx.tenantId, updated);
      return this.view(ctx, updated, loaded);
    }
    throw new AppError('CONFLICT', 'These minutes are busy. Try again.');
  }

  /** Shares the reviewed minutes with the conversation and posts a card there (idempotent). */
  async share(ctx: TenantContext, minutesId: string): Promise<MeetingMinutes> {
    const { d, loaded, editor } = await this.load(ctx, minutesId);
    if (!editor) throw forbidden();
    if (d.status === 'shared') return this.view(ctx, d, loaded);
    const t = this.db.for(ctx.tenantId);
    const now = new Date();
    const claimed = await t.meeting_minutes.findOneAndUpdate(
      { _id: d._id, status: 'draft' },
      {
        $set: {
          status: 'shared',
          sharedBy: ctx.userId,
          sharedAt: now,
          revision: d.revision + 1,
          updatedAt: now,
          updatedBy: ctx.userId,
        },
      },
      { returnDocument: 'after' },
    );
    if (!claimed) return this.get(ctx, minutesId);
    const meta: MinutesSystemMetadata = {
      minutesId: d._id,
      callId: d.callId,
      title: d.title,
      sharedBy: ctx.userId,
      decisions: d.decisions.length,
      actionItems: d.actionItems.length,
    };
    const msg = await this.messages.postSystem(
      ctx.tenantId,
      d.conversationId,
      ctx.userId,
      `Minutes of meeting · ${d.title}`,
      { minutes: meta },
    );
    const final = await t.meeting_minutes.findOneAndUpdate(
      { _id: d._id },
      { $set: { messageId: msg.messageId } },
      { returnDocument: 'after' },
    );
    void this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'minutes.share',
      target: { type: 'minutes', id: d._id },
      metadata: {
        callId: d.callId,
        decisions: d.decisions.length,
        actionItems: d.actionItems.length,
      },
    });
    this.emit(ctx.tenantId, final ?? claimed);
    return this.view(ctx, final ?? claimed, loaded);
  }

  async remove(ctx: TenantContext, minutesId: string): Promise<{ deleted: true }> {
    const { d, editor } = await this.load(ctx, minutesId);
    if (!editor) throw forbidden();
    const t = this.db.for(ctx.tenantId);
    await t.meeting_minutes.deleteMany({ _id: d._id });
    if (d.messageId)
      await this.messages
        .updateSystem(ctx.tenantId, d.messageId, 'Minutes of meeting deleted', {
          minutes: {
            minutesId: d._id,
            callId: d.callId,
            title: d.title,
            sharedBy: d.sharedBy,
            decisions: 0,
            actionItems: 0,
            deleted: true,
          },
        })
        .catch(() => undefined);
    void this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'minutes.delete',
      target: { type: 'minutes', id: d._id },
      metadata: { callId: d.callId, status: d.status },
    });
    this.emit(ctx.tenantId, d, true);
    return { deleted: true };
  }

  // ---------- documents ----------

  private async brand(tenantId: string): Promise<Brand> {
    const tenant = await this.db.tenants.findOne({ _id: tenantId });
    const b = BrandingService.resolve(tenant);
    return {
      orgName: tenant?.name ?? 'Organization',
      appName: BrandingService.displayName(tenant),
      logo: logoFromDataUrl(b.logo),
      brand: b.primary,
    };
  }

  private async userName(tenantId: string, id: string | null): Promise<string> {
    if (!id) return 'Someone';
    const u = await this.db
      .for(tenantId)
      .users.findOne({ _id: id }, { projection: { displayName: 1 } });
    return u?.displayName ?? 'Someone';
  }

  async document(ctx: TenantContext, minutesId: string, query: unknown): Promise<RenderedFile> {
    const q = parse(MinutesDocumentQuerySchema.extend({ tz: ListTz }), query);
    const { d, loaded } = await this.load(ctx, minutesId);
    await this.rateLimit.consume('documents', `${ctx.tenantId}:${ctx.userId}`);
    const settings = await this.settings(ctx.tenantId);
    const template = q.template ?? settings.defaultTemplate;
    const tz = safeTimeZone(q.tz);
    const t = this.db.for(ctx.tenantId);
    const ids = [...new Set([...d.actionItems.map((a) => a.ownerId).filter(Boolean)])] as string[];
    const owners = new Map(
      (await t.users.find({ _id: { $in: ids } }, { projection: { displayName: 1 } }).toArray()).map(
        (u) => [u._id, u.displayName],
      ),
    );
    const transcript: {
      title: string;
      note: string;
      lines: ReturnType<typeof minutesTranscriptRows>;
    }[] = [];
    if (q.transcript) {
      const recs = await t.attachments
        .find({ callId: d.callId, deletedAt: null }, { projection: { _id: 1 } })
        .toArray();
      const docs = await t.ai_transcripts
        .find({ attachmentId: { $in: recs.map((r) => r._id) }, status: 'done' })
        .toArray();
      for (const x of docs) {
        const tr =
          x.language !== d.language
            ? x.translations?.find((y) => y.language === d.language && y.status === 'done')
            : undefined;
        const src = tr ?? x;
        transcript.push({
          title: tr
            ? `Transcript (${languageLabel(d.language)} translation)`
            : `Transcript (${languageLabel(x.language)})`,
          note: [
            tr
              ? `Translated from ${languageLabel(x.language)}.`
              : 'Machine transcript from the call recording.',
            (tr ?? x).reviewedBy ? 'Checked by a person.' : 'Not checked by a person yet.',
          ].join(' '),
          lines: minutesTranscriptRows(src.segments, src.text),
        });
      }
      if (!docs.length) {
        const caps = await t.call_captions
          .find({ callId: d.callId }, { sort: { at: 1 }, limit: 4000 })
          .toArray();
        if (caps.length)
          transcript.push({
            title: 'Live captions',
            note: 'Kept from live captions during the call, with each speaker’s name.',
            lines: caps.map((c) => ({ at: fmtTime(c.at, tz), speaker: c.speaker, text: c.text })),
          });
      }
    }
    const brand = await this.brand(ctx.tenantId);
    const author = await this.userName(ctx.tenantId, ctx.userId);
    const model = minutesModel(
      {
        title: d.title,
        conversationName: await this.conversationName(ctx.tenantId, loaded.conversation),
        media: d.media,
        startedAt: d.startedAt,
        endedAt: d.endedAt,
        durationSec: d.durationSec,
        attendees: d.attendees,
        agenda: d.agenda,
        summary: d.summary,
        decisions: d.decisions,
        actionItems: d.actionItems,
        openQuestions: d.openQuestions,
        notes: d.notes,
        language: d.language,
        sources: d.sources,
        status: d.status,
        updatedByName: await this.userName(ctx.tenantId, d.updatedBy),
        updatedAt: d.updatedAt,
        sharedByName: d.sharedBy ? await this.userName(ctx.tenantId, d.sharedBy) : null,
        ownerName: (id) => (id ? (owners.get(id) ?? null) : null),
        transcript,
      },
      brand,
      tz,
      author,
    );
    const body =
      q.format === 'docx' ? await renderDocx(model, template) : await renderPdf(model, template);
    void this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'minutes.download',
      target: { type: 'minutes', id: d._id },
      metadata: {
        format: q.format,
        template,
        transcript: q.transcript,
        status: d.status,
        bytes: body.length,
      },
    });
    return {
      fileName: documentFileName('Minutes', d.title, d.startedAt, q.format),
      mimeType: MIME_BY_FORMAT[q.format],
      body,
    };
  }

  // ---------- chat export ----------

  async exportAccess(ctx: TenantContext, conversationId: string): Promise<ChatExportAccess> {
    const loaded = await this.conversations.authorize(ctx, conversationId, 'conversation.read');
    const { chatExport: policy } = await this.settings(ctx.tenantId);
    const allowed = canExportChat(policy, ctx.role, loaded.membership?.role ?? null);
    return {
      allowed,
      policy,
      reason: allowed
        ? null
        : ctx.role === 'guest'
          ? 'Guests can’t export conversations.'
          : policy === 'off'
            ? 'Your organization has turned chat export off.'
            : policy === 'admins'
              ? 'Only organization admins can export conversations.'
              : 'Only conversation owners, moderators and admins can export this conversation.',
    };
  }

  async exportChat(
    ctx: TenantContext,
    conversationId: string,
    body: unknown,
  ): Promise<RenderedFile> {
    const req = parse(ChatExportRequestSchema.and(TzBody), body ?? {});
    const access = await this.exportAccess(ctx, conversationId);
    if (!access.allowed) throw forbidden(access.reason ?? undefined);
    await this.rateLimit.consume('documents', `${ctx.tenantId}:${ctx.userId}`);
    const loaded = await this.conversations.authorize(ctx, conversationId, 'conversation.read');
    const conv = loaded.conversation;
    const t = this.db.for(ctx.tenantId);
    const tz = safeTimeZone(req.tz);
    const from = req.from ? new Date(req.from) : null;
    const to = req.to ? new Date(req.to) : null;
    const filter: Record<string, unknown> = {
      conversationId,
      ...(req.includeSystem ? {} : { messageType: { $ne: 'system' } }),
    };
    if (from || to)
      filter.createdAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
    const docs = await t.messages
      .find(filter as never, { sort: { serverSequence: 1 }, limit: CHAT_EXPORT_MAX_MESSAGES + 1 })
      .toArray();
    const truncated = docs.length > CHAT_EXPORT_MAX_MESSAGES;
    if (truncated) docs.length = CHAT_EXPORT_MAX_MESSAGES;
    const names = await this.senderNames(ctx.tenantId, docs);
    const heard = req.includeTranscripts
      ? await this.transcripts.textsForMessages(
          ctx.tenantId,
          docs
            .filter((d) => (d.attachments ?? []).some((a) => a.recording && !a.deletedAt))
            .map((d) => d._id),
        )
      : new Map<string, string>();
    const lines: (ChatLine & { date: Date })[] = docs.map((m) => ({
      date: m.createdAt,
      at: fmtTime(m.createdAt, tz),
      who: names.get(m._id) ?? 'Someone',
      text: m.deletedAt ? 'This message was deleted.' : systemText(m),
      system: m.messageType === 'system' || !!m.deletedAt,
      edited: !!m.editedAt && !m.deletedAt,
      files: m.deletedAt
        ? []
        : (m.attachments ?? []).map((a) => (a.deletedAt ? `${a.fileName} (deleted)` : a.fileName)),
      transcript: heard.get(m._id) ?? null,
    }));
    const memberCount = (await this.conversations.memberIds(ctx.tenantId, conversationId)).length;
    const exportedBy = await this.userName(ctx.tenantId, ctx.userId);
    const input = {
      conversationName: await this.conversationName(ctx.tenantId, conv),
      kindLabel: KIND_LABEL[conv.kind] ?? 'Conversation',
      memberCount,
      from,
      to,
      exportedBy,
      exportedAt: new Date(),
      lines,
      truncated,
      language: 'en',
    };
    const brand = await this.brand(ctx.tenantId);
    const settings = await this.settings(ctx.tenantId);
    const format: ChatExportFormat = req.format;
    const body2 =
      format === 'txt'
        ? Buffer.from(chatText(input, brand, tz), 'utf8')
        : format === 'docx'
          ? await renderDocx(chatModel(input, brand, tz), settings.defaultTemplate)
          : await renderPdf(chatModel(input, brand, tz), settings.defaultTemplate);
    await this.audit.record({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'conversation.export',
      target: { type: 'conversation', id: conversationId },
      metadata: {
        format,
        messages: lines.length,
        from: req.from ?? null,
        to: req.to ?? null,
        includeSystem: req.includeSystem,
        includeTranscripts: req.includeTranscripts,
        truncated,
      },
    });
    return {
      fileName: documentFileName('Chat', input.conversationName, new Date(), format),
      mimeType: MIME_BY_FORMAT[format],
      body: body2,
    };
  }

  // ---------- helpers ----------

  /** Display name per message: members by profile, guests by the name they gave. */
  private async senderNames(tenantId: string, docs: MessageDoc[]): Promise<Map<string, string>> {
    const ids = [...new Set(docs.map((d) => d.senderId).filter((s) => !s.startsWith('guest:')))];
    const users = await this.db
      .for(tenantId)
      .users.find({ _id: { $in: ids } }, { projection: { displayName: 1 } })
      .toArray();
    const byId = new Map(users.map((u) => [u._id, u.displayName]));
    const out = new Map<string, string>();
    for (const d of docs) {
      const guest = (d.metadata as { guest?: { name?: string } } | undefined)?.guest?.name;
      out.set(d._id, guest ? `${guest} (guest)` : (byId.get(d.senderId) ?? 'Someone'));
    }
    return out;
  }

  private async conversationName(tenantId: string, c: ConversationDoc): Promise<string> {
    if (c.name) return c.kind.startsWith('channel') ? `#${c.name}` : c.name;
    const ids = await this.conversations.memberIds(tenantId, c._id);
    const users = await this.db
      .for(tenantId)
      .users.find({ _id: { $in: ids } }, { projection: { displayName: 1 } })
      .toArray();
    return (
      users
        .map((u) => u.displayName)
        .sort()
        .join(', ') || 'Conversation'
    );
  }
}

const KIND_LABEL: Record<string, string> = {
  dm: 'Direct message',
  group: 'Group chat',
  channel_public: 'Public channel',
  channel_private: 'Private channel',
};

/** Readable text for system messages (call cards, recordings, minutes); user text as is. */
function systemText(m: MessageDoc): string {
  if (m.messageType !== 'system') return m.content.text;
  const meta = (m.metadata ?? {}) as {
    call?: { media?: string; status?: string; durationSec?: number | null };
    recording?: { durationMs?: number; failed?: boolean };
  };
  if (meta.call) {
    const media = meta.call.media === 'video' ? 'Video call' : 'Voice call';
    if (meta.call.status === 'ended')
      return `${media} ended · ${formatCallDuration(meta.call.durationSec ?? 0)}`;
    if (meta.call.status === 'missed') return `Missed ${media.toLowerCase()}`;
    if (meta.call.status === 'declined') return `${media} declined`;
    return `${media} started`;
  }
  if (meta.recording) return meta.recording.failed ? 'Call recording failed' : 'Call recording';
  return m.content.text || 'Event';
}

const ListTz = z.string().max(64).optional();
const TzBody = z.object({ tz: z.string().max(64).optional() });
