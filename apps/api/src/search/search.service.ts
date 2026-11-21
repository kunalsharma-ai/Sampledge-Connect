import { Injectable } from '@nestjs/common';
import type { Filter } from 'mongodb';
import {
  MAX_RECENT_SEARCHES,
  MAX_SEARCH_QUERY,
  RecentSearchesSchema,
  SEARCH_TYPES,
  SearchQuerySchema,
  matchRanges,
  searchTerms,
  snippetAround,
  type Conversation,
  type RecentSearches,
  type SearchResponse,
  type SearchType,
} from '@sampledge/contracts';
import { parse } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { TenantDb } from '../database/tenant-db.js';
import type { AttachmentDoc, MeetingDoc, MessageDoc, UserDoc } from '../database/documents.js';
import { toUserSummary } from '../auth/auth.service.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { WorkStore } from '../integrations/collections.js';
import type { TaskDoc } from '../integrations/docs.js';
import { TasksService } from '../work/tasks.service.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Every term must occur in one of `fields` (case-insensitive substring, so partial words match). */
function allTerms<T>(terms: string[], fields: string[]): Filter<T> {
  if (!terms.length) return {};
  return {
    $and: terms.map((t) => {
      const rx = new RegExp(escapeRe(t), 'i');
      return { $or: fields.map((f) => ({ [f]: rx })) };
    }),
  } as Filter<T>;
}
/** Bounded so one broad query can never hold the database for long. */
const MAX_TIME_MS = 2500;

/**
 * Universal Search. Scope is computed from the caller first (readable conversations, visible
 * tasks, own meetings) and every query is filtered to it, so a result can never reveal a
 * conversation or item the caller could not open anyway.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly db: TenantDb,
    private readonly conversations: ConversationsService,
    private readonly store: WorkStore,
    private readonly tasks: TasksService,
    private readonly realtime: RealtimePublisher,
  ) {}

  async search(ctx: TenantContext, input: unknown): Promise<SearchResponse> {
    const started = Date.now();
    const q = parse(SearchQuerySchema, input);
    const terms = searchTerms(q.q);
    const types = new Set<SearchType>(q.types ?? SEARCH_TYPES);
    const readable = await this.conversations.listReadable(ctx);
    const scope = q.in ? readable.filter((c) => c.conversationId === q.in) : readable;
    const ids = scope.map((c) => c.conversationId);
    const created: { $gte?: Date; $lt?: Date } = {};
    if (q.after) created.$gte = new Date(q.after);
    if (q.before) created.$lt = new Date(q.before);
    const dated = Object.keys(created).length ? created : null;
    // People, conversations, tasks and meetings have no sender or attachment, so the
    // message-only filters narrow the search to messages and files.
    const messageFiltersOnly = !!(q.from || q.hasFile);
    const page = { limit: q.limit, offset: q.offset };
    const empty = { items: [], more: false };

    const [messages, files, people, convs, tasks, meetings] = await Promise.all([
      types.has('messages') ? this.messages(ctx, ids, terms, q, dated, page) : empty,
      types.has('files') ? this.files(ctx, ids, terms, q.from, dated, page) : empty,
      types.has('people') && terms.length && !messageFiltersOnly && !q.in
        ? this.people(ctx, readable, terms, page)
        : empty,
      types.has('conversations') && terms.length && !messageFiltersOnly && !q.in
        ? this.convs(ctx, readable, terms, page)
        : empty,
      types.has('tasks') && terms.length && !messageFiltersOnly
        ? this.taskHits(ctx, terms, q.in ?? null, page)
        : empty,
      types.has('meetings') && terms.length && !messageFiltersOnly
        ? this.meetingHits(ctx, ids, terms, q.in ?? null, dated, page)
        : empty,
    ]);
    return {
      query: q.q,
      terms,
      messages,
      files,
      people,
      conversations: convs,
      tasks,
      meetings,
      tookMs: Date.now() - started,
    } as SearchResponse;
  }

  private slice<T>(rows: T[], page: { limit: number; offset: number }) {
    return { rows: rows.slice(0, page.limit), more: rows.length > page.limit };
  }

  private async messages(
    ctx: TenantContext,
    ids: string[],
    terms: string[],
    q: { from?: string; hasFile?: boolean },
    dated: { $gte?: Date; $lt?: Date } | null,
    page: { limit: number; offset: number },
  ) {
    if (!ids.length) return { items: [], more: false };
    const filter: Filter<MessageDoc> = {
      conversationId: { $in: ids },
      deletedAt: null,
      messageType: 'text',
      ...allTerms<MessageDoc>(terms, ['content.text', 'attachments.fileName', 'poll.question']),
      ...(q.from ? { senderId: q.from } : {}),
      ...(q.hasFile ? { 'attachments.0': { $exists: true } } : {}),
      ...(dated ? { createdAt: dated } : {}),
    };
    const rows = await this.db
      .for(ctx.tenantId)
      .messages.find(filter, {
        sort: { createdAt: -1 },
        skip: page.offset,
        limit: page.limit + 1,
        maxTimeMS: MAX_TIME_MS,
        projection: {
          conversationId: 1,
          senderId: 1,
          content: 1,
          createdAt: 1,
          serverSequence: 1,
          replyToMessageId: 1,
          attachments: 1,
          poll: 1,
        },
      })
      .toArray();
    const { rows: kept, more } = this.slice(rows, page);
    return {
      more,
      items: kept.map((m) => {
        const text = m.content?.text || m.poll?.question || '';
        const { snippet, matches } = snippetAround(text, terms);
        return {
          messageId: m._id,
          conversationId: m.conversationId,
          senderId: m.senderId,
          snippet,
          matches,
          createdAt: m.createdAt.toISOString(),
          serverSequence: m.serverSequence,
          replyToMessageId: m.replyToMessageId ?? null,
          fileNames: (m.attachments ?? []).filter((a) => !a.deletedAt).map((a) => a.fileName),
        };
      }),
    };
  }

  private async files(
    ctx: TenantContext,
    ids: string[],
    terms: string[],
    from: string | undefined,
    dated: { $gte?: Date; $lt?: Date } | null,
    page: { limit: number; offset: number },
  ) {
    if (!ids.length) return { items: [], more: false };
    const filter: Filter<AttachmentDoc> = {
      conversationId: { $in: ids },
      status: 'ready',
      messageId: { $ne: null },
      deletedAt: null,
      ...allTerms<AttachmentDoc>(terms, ['fileName']),
      ...(from ? { uploaderId: from } : {}),
      ...(dated ? { createdAt: dated } : {}),
    };
    const rows = await this.db
      .for(ctx.tenantId)
      .attachments.find(filter, {
        sort: { createdAt: -1 },
        skip: page.offset,
        limit: page.limit + 1,
        maxTimeMS: MAX_TIME_MS,
      })
      .toArray();
    const { rows: kept, more } = this.slice(rows, page);
    return {
      more,
      items: kept.map((a) => ({
        attachmentId: a._id,
        conversationId: a.conversationId,
        messageId: a.messageId,
        uploaderId: a.uploaderId,
        fileName: a.fileName,
        mimeType: a.mimeType,
        sizeBytes: a.storedBytes ?? a.sizeBytes,
        matches: matchRanges(a.fileName, terms),
        createdAt: a.createdAt.toISOString(),
      })),
    };
  }

  private async people(
    ctx: TenantContext,
    readable: Conversation[],
    terms: string[],
    page: { limit: number; offset: number },
  ) {
    const t = this.db.for(ctx.tenantId);
    // Guests only see the people they share a conversation with, like everywhere else.
    const guestScope =
      ctx.role === 'guest'
        ? { _id: { $in: [...new Set(readable.flatMap((c) => c.memberIds))] } }
        : {};
    const rows = await t.users
      .find(
        {
          status: 'active',
          ...guestScope,
          ...allTerms<UserDoc>(terms, ['displayName', 'email', 'title', 'department']),
        } as Filter<UserDoc>,
        {
          sort: { displayName: 1 },
          skip: page.offset,
          limit: page.limit + 1,
          maxTimeMS: MAX_TIME_MS,
        },
      )
      .toArray();
    const { rows: kept, more } = this.slice(rows, page);
    const roles = new Map(
      (await t.memberships.find({ userId: { $in: kept.map((u) => u._id) } }).toArray()).map((m) => [
        m.userId,
        m.role,
      ]),
    );
    return {
      more,
      items: kept.map((u) => ({
        ...toUserSummary(u, roles.get(u._id) ?? 'member'),
        matches: matchRanges(u.displayName, terms),
      })),
    };
  }

  private async convs(
    ctx: TenantContext,
    readable: Conversation[],
    terms: string[],
    page: { limit: number; offset: number },
  ) {
    // DMs are found by the other person's name.
    const others = [
      ...new Set(
        readable
          .filter((c) => c.kind === 'dm')
          .flatMap((c) => c.memberIds.filter((id) => id !== ctx.userId)),
      ),
    ];
    const names = new Map(
      (
        await this.db
          .for(ctx.tenantId)
          .users.find({ _id: { $in: others } }, { projection: { displayName: 1 } })
          .toArray()
      ).map((u) => [u._id, u.displayName]),
    );
    const label = (c: Conversation) =>
      c.kind === 'dm'
        ? c.memberIds
            .filter((id) => id !== ctx.userId)
            .map((id) => names.get(id) ?? '')
            .join(' ')
        : `${c.name ?? ''} ${c.topic ?? ''}`;
    const hits = readable
      .filter((c) => {
        const s = label(c).toLowerCase();
        return terms.every((t) => s.includes(t));
      })
      // Joined conversations first, then by recent activity (listReadable's order).
      .sort((a, b) => Number(!!b.myRole) - Number(!!a.myRole));
    const window = hits.slice(page.offset, page.offset + page.limit + 1);
    const { rows: kept, more } = this.slice(window, page);
    return {
      more,
      items: kept.map((c) => ({
        conversationId: c.conversationId,
        kind: c.kind,
        name: c.name,
        topic: c.topic,
        memberIds: c.memberIds,
        isMember: !!c.myRole,
        archived: !!c.archivedAt,
      })),
    };
  }

  private async taskHits(
    ctx: TenantContext,
    terms: string[],
    inConversation: string | null,
    page: { limit: number; offset: number },
  ) {
    const rows = await this.store
      .for(ctx.tenantId)
      .tasks.find(
        {
          ...allTerms<TaskDoc>(terms, ['title', 'description']),
          ...(inConversation ? { conversationId: inConversation } : {}),
        } as Filter<TaskDoc>,
        { sort: { updatedAt: -1 }, limit: 300, maxTimeMS: MAX_TIME_MS },
      )
      .toArray();
    const visible: TaskDoc[] = [];
    for (const t of rows) {
      if (visible.length > page.offset + page.limit) break;
      if (await this.tasks.canSee(ctx, t)) visible.push(t);
    }
    const { rows: kept, more } = this.slice(visible.slice(page.offset), page);
    return {
      more,
      items: kept.map((t) => ({
        taskId: t._id,
        title: t.title,
        status: t.status,
        kind: t.kind,
        assigneeIds: t.assigneeIds,
        dueAt: t.dueAt?.toISOString() ?? null,
        conversationId: t.conversationId,
        matches: matchRanges(t.title, terms),
      })),
    };
  }

  private async meetingHits(
    ctx: TenantContext,
    ids: string[],
    terms: string[],
    inConversation: string | null,
    dated: { $gte?: Date; $lt?: Date } | null,
    page: { limit: number; offset: number },
  ) {
    const mine = inConversation
      ? { conversationId: inConversation }
      : {
          $or: [
            { organizerId: ctx.userId },
            { 'attendees.userId': ctx.userId },
            { conversationId: { $in: ids } },
          ],
        };
    const rows = await this.db
      .for(ctx.tenantId)
      .meetings.find(
        {
          ...mine,
          ...allTerms<MeetingDoc>(terms, ['title', 'agenda']),
          ...(dated ? { startsAt: dated } : {}),
        } as Filter<MeetingDoc>,
        {
          sort: { startsAt: -1 },
          skip: page.offset,
          limit: page.limit + 1,
          maxTimeMS: MAX_TIME_MS,
        },
      )
      .toArray();
    // A conversation filter must still respect readability.
    const readable = new Set(ids);
    const allowed = rows.filter(
      (m) =>
        !inConversation ||
        readable.has(m.conversationId) ||
        m.organizerId === ctx.userId ||
        m.attendees.some((a) => a.userId === ctx.userId),
    );
    const { rows: kept, more } = this.slice(allowed, page);
    return {
      more,
      items: kept.map((m) => ({
        meetingId: m._id,
        conversationId: m.conversationId,
        title: m.title,
        startsAt: m.startsAt.toISOString(),
        endsAt: m.endsAt.toISOString(),
        status: m.status,
        organizerId: m.organizerId,
        matches: matchRanges(m.title, terms),
      })),
    };
  }

  // ---------- recent searches (synced across your devices) ----------

  async recent(ctx: TenantContext): Promise<RecentSearches> {
    const row = await this.db.for(ctx.tenantId).search_history.findOne({ userId: ctx.userId });
    return { recent: row?.recent ?? [] };
  }

  /** Replaces the list (idempotent, so the offline queue can retry it safely). */
  async setRecent(ctx: TenantContext, input: unknown): Promise<RecentSearches> {
    const req = parse(RecentSearchesSchema, input);
    const seen = new Set<string>();
    const recent: string[] = [];
    for (const raw of req.recent) {
      const s = raw.trim().slice(0, MAX_SEARCH_QUERY);
      const k = s.toLowerCase();
      if (!s || seen.has(k)) continue;
      seen.add(k);
      recent.push(s);
      if (recent.length >= MAX_RECENT_SEARCHES) break;
    }
    await this.db
      .for(ctx.tenantId)
      .search_history.updateOne(
        { userId: ctx.userId },
        { $set: { recent, updatedAt: new Date() } },
        { upsert: true },
      );
    this.realtime.toUser(ctx.tenantId, ctx.userId, 'search:recent', { recent });
    return { recent };
  }
}
