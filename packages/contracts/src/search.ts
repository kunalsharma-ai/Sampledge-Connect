import { z } from 'zod';
import { ServerIdSchema } from './ids.js';
import { UserSummarySchema } from './auth.js';

/**
 * Universal Search: one query across messages, people, conversations, files, tasks and meetings.
 * Results only ever include what the caller may already open (conversation membership, public
 * channels in their workspace, tasks they can see, meetings they organise or attend).
 */
export const SEARCH_TYPES = [
  'messages',
  'people',
  'conversations',
  'files',
  'tasks',
  'meetings',
] as const;
export const SearchTypeSchema = z.enum(SEARCH_TYPES);
export type SearchType = z.infer<typeof SearchTypeSchema>;

export const MAX_SEARCH_QUERY = 200;
export const MAX_RECENT_SEARCHES = 10;

const csvTypes = z
  .string()
  .transform((s) => s.split(',').filter(Boolean))
  .pipe(z.array(SearchTypeSchema).min(1));

/** GET /v1/search query string. Operators typed in the box (from:, in:, has:file, before:, after:) are resolved by the client into these. */
export const SearchQuerySchema = z
  .object({
    q: z.string().trim().max(MAX_SEARCH_QUERY).default(''),
    types: csvTypes.optional(),
    /** Only messages and files from this person. */
    from: ServerIdSchema.optional(),
    /** Only inside this conversation. */
    in: ServerIdSchema.optional(),
    /** Only messages that carry a file. */
    hasFile: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
    after: z.iso.datetime().optional(),
    before: z.iso.datetime().optional(),
    /** Per type. */
    limit: z.coerce.number().int().min(1).max(50).default(8),
    /** Skip this many results (per type) for "Show more" on a single type. */
    offset: z.coerce.number().int().min(0).max(500).default(0),
    /** Remember this query in your recent searches (synced to all your devices). */
    remember: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
  })
  .refine((v) => v.q.length > 0 || v.from || v.in || v.hasFile || v.after || v.before, {
    message: 'Type something to search for, or pick a filter',
  });
export type SearchQuery = z.input<typeof SearchQuerySchema>;

/** [start, end) character ranges in `text` that matched the query, for highlighting. */
export const MatchRangeSchema = z.tuple([z.number().int(), z.number().int()]);

export const MessageHitSchema = z.object({
  messageId: ServerIdSchema,
  conversationId: ServerIdSchema,
  senderId: ServerIdSchema,
  /** A window of the message text around the first match (whole text when short). */
  snippet: z.string(),
  matches: z.array(MatchRangeSchema),
  createdAt: z.iso.datetime(),
  serverSequence: z.number().int(),
  replyToMessageId: ServerIdSchema.nullable(),
  fileNames: z.array(z.string()),
});
export type MessageHit = z.infer<typeof MessageHitSchema>;

export const ConversationHitSchema = z.object({
  conversationId: ServerIdSchema,
  kind: z.string(),
  name: z.string().nullable(),
  topic: z.string().nullable(),
  memberIds: z.array(ServerIdSchema),
  isMember: z.boolean(),
  archived: z.boolean(),
});
export type ConversationHit = z.infer<typeof ConversationHitSchema>;

export const FileHitSchema = z.object({
  attachmentId: ServerIdSchema,
  conversationId: ServerIdSchema,
  messageId: ServerIdSchema.nullable(),
  uploaderId: ServerIdSchema,
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  matches: z.array(MatchRangeSchema),
  createdAt: z.iso.datetime(),
});
export type FileHit = z.infer<typeof FileHitSchema>;

export const TaskHitSchema = z.object({
  taskId: ServerIdSchema,
  title: z.string(),
  status: z.string(),
  kind: z.string(),
  assigneeIds: z.array(ServerIdSchema),
  dueAt: z.iso.datetime().nullable(),
  conversationId: ServerIdSchema.nullable(),
  matches: z.array(MatchRangeSchema),
});
export type TaskHit = z.infer<typeof TaskHitSchema>;

export const MeetingHitSchema = z.object({
  meetingId: ServerIdSchema,
  conversationId: ServerIdSchema,
  title: z.string(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  status: z.string(),
  organizerId: ServerIdSchema,
  matches: z.array(MatchRangeSchema),
});
export type MeetingHit = z.infer<typeof MeetingHitSchema>;

export const PersonHitSchema = UserSummarySchema.extend({
  matches: z.array(MatchRangeSchema),
});
export type PersonHit = z.infer<typeof PersonHitSchema>;

const group = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    /** True when there are more results than returned (use offset to page). */
    more: z.boolean(),
  });

export const SearchResponseSchema = z.object({
  query: z.string(),
  /** Lower-cased terms the server matched on (client uses them to highlight offline too). */
  terms: z.array(z.string()),
  messages: group(MessageHitSchema),
  people: group(PersonHitSchema),
  conversations: group(ConversationHitSchema),
  files: group(FileHitSchema),
  tasks: group(TaskHitSchema),
  meetings: group(MeetingHitSchema),
  tookMs: z.number(),
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

export const RecentSearchesSchema = z.object({ recent: z.array(z.string()) });
export type RecentSearches = z.infer<typeof RecentSearchesSchema>;

/** Splits a query into lower-case terms (quoted phrases stay together). */
export function searchTerms(q: string): string[] {
  const out: string[] = [];
  const re = /"([^"]+)"|(\S+)/g;
  for (let m = re.exec(q); m; m = re.exec(q)) {
    const t = (m[1] ?? m[2] ?? '').trim().toLowerCase();
    if (t && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 12);
}

/** Character ranges in `text` where any term occurs (case-insensitive), merged and sorted. */
export function matchRanges(text: string, terms: string[]): [number, number][] {
  if (!text || !terms.length) return [];
  const lower = text.toLowerCase();
  const ranges: [number, number][] = [];
  for (const t of terms) {
    let i = lower.indexOf(t);
    while (i !== -1 && ranges.length < 200) {
      ranges.push([i, i + t.length]);
      i = lower.indexOf(t, i + t.length);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/** True when every term occurs in the text (case-insensitive). */
export function matchesAll(text: string, terms: string[]): boolean {
  const lower = text.toLowerCase();
  return terms.every((t) => lower.includes(t));
}

/**
 * Cuts a window of about `size` characters around the first match and re-bases the ranges onto it.
 * Adds an ellipsis on a cut side.
 */
export function snippetAround(
  text: string,
  terms: string[],
  size = 180,
): { snippet: string; matches: [number, number][] } {
  const all = matchRanges(text, terms);
  if (text.length <= size) return { snippet: text, matches: all };
  const first = all[0]?.[0] ?? 0;
  let start = Math.max(0, first - Math.floor(size / 3));
  const ws = text.lastIndexOf(' ', start);
  if (start > 0 && ws > start - 20) start = ws + 1;
  const end = Math.min(text.length, start + size);
  const lead = start > 0 ? '…' : '';
  const tail = end < text.length ? '…' : '';
  const snippet = lead + text.slice(start, end) + tail;
  const shift = lead.length - start;
  const matches = all
    .filter(([a, b]) => a >= start && b <= end)
    .map(([a, b]) => [a + shift, b + shift] as [number, number]);
  return { snippet, matches };
}

/**
 * Parses search operators out of what was typed: `from:@name`, `in:#channel`, `has:file`,
 * `before:2026-11-01`, `after:2026-10-01`. Unknown operators stay in the text.
 */
export function parseSearchOperators(raw: string): {
  text: string;
  from: string | null;
  in: string | null;
  hasFile: boolean;
  before: string | null;
  after: string | null;
} {
  let from: string | null = null;
  let inName: string | null = null;
  let hasFile = false;
  let before: string | null = null;
  let after: string | null = null;
  const rest: string[] = [];
  const re = /\w+:"[^"]*"|"[^"]*"|\S+/g;
  for (let m = re.exec(raw); m; m = re.exec(raw)) {
    const tok = m[0];
    const op = /^(from|in|has|before|after):(.+)$/i.exec(tok);
    if (!op) {
      rest.push(tok);
      continue;
    }
    const key = op[1]!.toLowerCase();
    const val = op[2]!.replace(/^["@#]+|"$/g, '');
    if (key === 'from') from = val;
    else if (key === 'in') inName = val;
    else if (key === 'has' && /^(file|files|attachment)s?$/i.test(val)) hasFile = true;
    else if (key === 'before' && /^\d{4}-\d{2}-\d{2}$/.test(val)) before = val;
    else if (key === 'after' && /^\d{4}-\d{2}-\d{2}$/.test(val)) after = val;
    else rest.push(tok);
  }
  return { text: rest.join(' '), from, in: inName, hasFile, before, after };
}
