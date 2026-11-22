import { z } from 'zod';
import { ServerIdSchema } from './ids.js';
import type { ConversationRole, TenantRole } from './permissions.js';

/**
 * Minutes of meeting, chat export and document downloads. See docs/minutes.md.
 *
 * Minutes are made after a voice or video call from what the organization's own servers
 * already have: the call's attendees, recording transcripts, saved captions (when the
 * organization keeps them) and the chat during the call. They start as a draft that the
 * people in the call review and edit, and only then are shared with the conversation.
 */

// ---------- documents ----------

export const DOCUMENT_FORMATS = ['pdf', 'docx'] as const;
export const DocumentFormatSchema = z.enum(DOCUMENT_FORMATS);
export type DocumentFormat = z.infer<typeof DocumentFormatSchema>;

/** Chat export can also be plain text. */
export const CHAT_EXPORT_FORMATS = ['pdf', 'docx', 'txt'] as const;
export const ChatExportFormatSchema = z.enum(CHAT_EXPORT_FORMATS);
export type ChatExportFormat = z.infer<typeof ChatExportFormatSchema>;

export const MINUTES_TEMPLATES = ['classic', 'modern', 'executive', 'compact'] as const;
export const MinutesTemplateSchema = z.enum(MINUTES_TEMPLATES);
export type MinutesTemplate = z.infer<typeof MinutesTemplateSchema>;

/** Names and one-line descriptions shown in the template picker (web and mobile). */
export const MINUTES_TEMPLATE_INFO: Record<
  MinutesTemplate,
  { label: string; description: string }
> = {
  classic: {
    label: 'Classic',
    description: 'Serif type, centred title and ruled sections. Formal board minutes.',
  },
  modern: {
    label: 'Modern',
    description: 'Your brand colour, clean sans-serif and an action table.',
  },
  executive: {
    label: 'Executive',
    description: 'Dark header band, key facts panel and decisions first.',
  },
  compact: {
    label: 'Compact',
    description: 'Dense one-pager with checkboxes, ideal for stand-ups.',
  },
};

export const MIME_BY_FORMAT: Record<ChatExportFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain; charset=utf-8',
};

// ---------- languages ----------

/**
 * Languages offered for transcripts, translations and minutes. Whisper detects about 100
 * spoken languages on its own; these are the ones the pickers list (ISO 639-1).
 */
export const TRANSCRIPT_LANGUAGES = [
  ['en', 'English'],
  ['hi', 'Hindi'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
  ['nl', 'Dutch'],
  ['pl', 'Polish'],
  ['sv', 'Swedish'],
  ['da', 'Danish'],
  ['no', 'Norwegian'],
  ['fi', 'Finnish'],
  ['cs', 'Czech'],
  ['ro', 'Romanian'],
  ['hu', 'Hungarian'],
  ['el', 'Greek'],
  ['tr', 'Turkish'],
  ['ru', 'Russian'],
  ['uk', 'Ukrainian'],
  ['ar', 'Arabic'],
  ['he', 'Hebrew'],
  ['fa', 'Persian'],
  ['ur', 'Urdu'],
  ['bn', 'Bengali'],
  ['pa', 'Punjabi'],
  ['gu', 'Gujarati'],
  ['mr', 'Marathi'],
  ['ta', 'Tamil'],
  ['te', 'Telugu'],
  ['kn', 'Kannada'],
  ['ml', 'Malayalam'],
  ['th', 'Thai'],
  ['vi', 'Vietnamese'],
  ['id', 'Indonesian'],
  ['ms', 'Malay'],
  ['tl', 'Tagalog'],
  ['zh', 'Chinese'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['sw', 'Swahili'],
] as const;

export const LanguageCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/, 'a language code such as en or hi');

const LANGUAGE_NAMES = new Map<string, string>(TRANSCRIPT_LANGUAGES.map(([c, n]) => [c, n]));

/** "Hindi" for `hi`; the code itself when unknown. */
export function languageLabel(code: string | null | undefined): string {
  if (!code) return 'Unknown language';
  return LANGUAGE_NAMES.get(code.toLowerCase().split('-')[0]!) ?? code;
}

/** Languages written right to left (paragraph direction in documents). */
export const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'yi']);

// ---------- minutes ----------

export const MinutesAttendeeSchema = z.object({
  /** null for external guests. */
  userId: ServerIdSchema.nullable(),
  name: z.string(),
  guest: z.boolean(),
  /** Time spent in the call, when known. */
  minutes: z.number().int().nonnegative().nullable(),
});
export type MinutesAttendee = z.infer<typeof MinutesAttendeeSchema>;

export const MinutesActionItemSchema = z.object({
  id: z.string().min(1).max(64),
  text: z.string().trim().min(1).max(500),
  ownerId: ServerIdSchema.nullable().default(null),
  /** Shown when the owner is not a member (a guest, or a name nobody matched). */
  ownerName: z.string().trim().max(120).nullable().default(null),
  /** As written ("by Friday") or a date. */
  due: z.string().trim().max(60).nullable().default(null),
  done: z.boolean().default(false),
});
export type MinutesActionItem = z.infer<typeof MinutesActionItemSchema>;

export const MINUTES_STATUSES = ['draft', 'shared'] as const;
export type MinutesStatus = (typeof MINUTES_STATUSES)[number];

/** Where the content came from, shown under the minutes so readers know what to trust. */
export const MinutesSourcesSchema = z.object({
  /** Recording transcripts used. */
  transcripts: z.number().int().nonnegative(),
  /** Transcripts a person reviewed (corrected or marked checked). */
  reviewedTranscripts: z.number().int().nonnegative(),
  /** Saved caption lines used (speaker-labelled). */
  captionLines: z.number().int().nonnegative(),
  /** Chat messages sent during the call. */
  chatMessages: z.number().int().nonnegative(),
  /** Spoken languages heard (ISO 639-1). */
  spokenLanguages: z.array(z.string()),
});
export type MinutesSources = z.infer<typeof MinutesSourcesSchema>;

export const MeetingMinutesSchema = z.object({
  minutesId: ServerIdSchema,
  callId: ServerIdSchema,
  conversationId: ServerIdSchema,
  /** The scheduled meeting this call belonged to, when there was one. */
  meetingId: ServerIdSchema.nullable(),
  title: z.string(),
  media: z.enum(['audio', 'video']),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  durationSec: z.number().int().nonnegative().nullable(),
  attendees: z.array(MinutesAttendeeSchema),
  agenda: z.string(),
  summary: z.string(),
  decisions: z.array(z.string()),
  actionItems: z.array(MinutesActionItemSchema),
  openQuestions: z.array(z.string()),
  notes: z.string(),
  /** Language the minutes are written in. */
  language: z.string(),
  sources: MinutesSourcesSchema,
  /** basic: built-in extractive engine; model: the organization's model server; manual: AI off. */
  engine: z.enum(['basic', 'model', 'manual']),
  status: z.enum(MINUTES_STATUSES),
  /** Bumped by every change; send it back as `baseRevision`. */
  revision: z.number().int().nonnegative(),
  createdBy: ServerIdSchema,
  createdAt: z.string().datetime(),
  updatedBy: ServerIdSchema,
  updatedAt: z.string().datetime(),
  sharedBy: ServerIdSchema.nullable(),
  sharedAt: z.string().datetime().nullable(),
  /** The caller may edit, share, regenerate and delete (people in the call, moderators, admins). */
  canEdit: z.boolean(),
});
export type MeetingMinutes = z.infer<typeof MeetingMinutesSchema>;

/** GET /v1/calls/:callId/minutes */
export const CallMinutesResponseSchema = z.object({
  minutes: MeetingMinutesSchema.nullable(),
  /** The caller may create minutes for this call. */
  canCreate: z.boolean(),
  /** Why minutes can't be made yet ("The call is still in progress"). */
  blockedReason: z.string().nullable(),
});
export type CallMinutesResponse = z.infer<typeof CallMinutesResponseSchema>;

/** POST /v1/calls/:callId/minutes: create the draft, or write it again (`regenerate`). */
export const GenerateMinutesRequestSchema = z.object({
  /** Language to write the minutes in; defaults to the organization default. */
  language: LanguageCodeSchema.optional(),
  /** Replace the draft's content with a fresh one (keeps attendees' edits only when false). */
  regenerate: z.boolean().default(false),
});
export type GenerateMinutesRequest = z.input<typeof GenerateMinutesRequestSchema>;

/**
 * PATCH /v1/minutes/:id. Send only the fields you changed with the revision you started
 * from. A field someone else changed since then is a conflict (409 with the current minutes);
 * other fields merge. Offline edits replay through the action queue (`minutes|<id>`).
 */
export const UpdateMinutesRequestSchema = z
  .object({
    baseRevision: z.number().int().nonnegative(),
    title: z.string().trim().min(1).max(200).optional(),
    agenda: z.string().max(4000).optional(),
    summary: z.string().max(8000).optional(),
    decisions: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
    actionItems: z.array(MinutesActionItemSchema).max(100).optional(),
    openQuestions: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
    notes: z.string().max(20_000).optional(),
  })
  .refine((v) => Object.keys(v).length > 1, 'Change at least one field');
export type UpdateMinutesRequest = z.input<typeof UpdateMinutesRequestSchema>;

/** Fields of the minutes that can be edited (per-field merge). */
export const MINUTES_EDITABLE_FIELDS = [
  'title',
  'agenda',
  'summary',
  'decisions',
  'actionItems',
  'openQuestions',
  'notes',
] as const;
export type MinutesEditableField = (typeof MINUTES_EDITABLE_FIELDS)[number];

/** GET /v1/minutes?conversationId= */
export const ListMinutesQuerySchema = z.object({
  conversationId: ServerIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const MinutesListResponseSchema = z.object({ items: z.array(MeetingMinutesSchema) });
export type MinutesListResponse = z.infer<typeof MinutesListResponseSchema>;

/** GET /v1/minutes/:id/document?format=&template= */
export const MinutesDocumentQuerySchema = z.object({
  format: DocumentFormatSchema.default('pdf'),
  template: MinutesTemplateSchema.optional(),
  /** Add the full transcript as an appendix. */
  transcript: z
    .enum(['0', '1', 'true', 'false'])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
});
export type MinutesDocumentQuery = z.input<typeof MinutesDocumentQuerySchema>;

/** Metadata of the system message posted when minutes are shared (`metadata.minutes`). */
export const MinutesSystemMetadataSchema = z.object({
  minutesId: ServerIdSchema,
  callId: ServerIdSchema,
  title: z.string(),
  sharedBy: ServerIdSchema,
  decisions: z.number().int().nonnegative(),
  actionItems: z.number().int().nonnegative(),
});
export type MinutesSystemMetadata = z.infer<typeof MinutesSystemMetadataSchema>;

/** Payload of `minutes:changed` (conversation room). Refetch; drafts stay access-checked. */
export const MinutesChangedEventSchema = z.object({
  minutesId: ServerIdSchema,
  callId: ServerIdSchema,
  conversationId: ServerIdSchema,
  revision: z.number().int().nonnegative(),
  deleted: z.boolean(),
});
export type MinutesChangedEvent = z.infer<typeof MinutesChangedEventSchema>;

// ---------- chat export ----------

/**
 * Who may export a conversation (Administration › Minutes and export). Guests never can.
 * `members`: anyone who can read it; `moderators`: conversation owners and moderators plus
 * organization admins; `admins`: organization owners and admins; `off`: nobody.
 */
export const CHAT_EXPORT_POLICIES = ['members', 'moderators', 'admins', 'off'] as const;
export const ChatExportPolicySchema = z.enum(CHAT_EXPORT_POLICIES);
export type ChatExportPolicy = z.infer<typeof ChatExportPolicySchema>;

export const CHAT_EXPORT_POLICY_LABEL: Record<ChatExportPolicy, string> = {
  members: 'Everyone in the conversation',
  moderators: 'Conversation owners, moderators and admins',
  admins: 'Organization owners and admins only',
  off: 'Nobody (export turned off)',
};

/** Same rule on the server and in both apps, so buttons match what the server allows. */
export function canExportChat(
  policy: ChatExportPolicy,
  tenantRole: TenantRole,
  conversationRole: ConversationRole | null,
): boolean {
  if (tenantRole === 'guest' || policy === 'off') return false;
  const admin = tenantRole === 'owner' || tenantRole === 'admin';
  if (policy === 'admins') return admin;
  if (policy === 'moderators')
    return admin || conversationRole === 'owner' || conversationRole === 'moderator';
  return true;
}

/** POST /v1/conversations/:id/export: the file comes back as the response body. */
export const ChatExportRequestSchema = z
  .object({
    format: ChatExportFormatSchema.default('pdf'),
    /** Inclusive range; omit for the whole conversation. */
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    /** Call cards, recordings and other system events. */
    includeSystem: z.boolean().default(true),
    /** Add each recording's transcript under it. */
    includeTranscripts: z.boolean().default(false),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, 'The start must be before the end');
export type ChatExportRequest = z.input<typeof ChatExportRequestSchema>;

/** Most messages in one export. */
export const CHAT_EXPORT_MAX_MESSAGES = 20_000;

/** GET /v1/conversations/:id/export: may the caller export, and why not. */
export const ChatExportAccessSchema = z.object({
  allowed: z.boolean(),
  policy: ChatExportPolicySchema,
  reason: z.string().nullable(),
});
export type ChatExportAccess = z.infer<typeof ChatExportAccessSchema>;

// ---------- organization settings ----------

/** GET/PUT /v1/admin/minutes-settings (owners and admins). */
export const MinutesSettingsSchema = z.object({
  chatExport: ChatExportPolicySchema.default('members'),
  /** Template used when someone downloads without choosing one. */
  defaultTemplate: MinutesTemplateSchema.default('modern'),
  /** Language minutes are written in unless the person picks another. */
  defaultLanguage: LanguageCodeSchema.default('en'),
  /**
   * Keep live caption text (with each speaker's name) until the minutes are made, so minutes
   * can say who said what. Everyone in the call is told. Off by default.
   */
  keepCaptions: z.boolean().default(false),
  /** Days saved captions are kept (minutes keep their own text). */
  captionRetentionDays: z.number().int().min(1).max(365).default(30),
});
export type MinutesSettings = z.infer<typeof MinutesSettingsSchema>;
export const DEFAULT_MINUTES_SETTINGS: MinutesSettings = MinutesSettingsSchema.parse({});

/** `GET /v1/minutes/config` for every member: what the apps should offer. */
export const MinutesConfigSchema = z.object({
  defaultTemplate: MinutesTemplateSchema,
  defaultLanguage: z.string(),
  chatExport: ChatExportPolicySchema,
  keepCaptions: z.boolean(),
  /** The organization has a model server (written minutes in any language, translation). */
  model: z.boolean(),
  /** The AI assistant is on (otherwise minutes start blank for people to fill in). */
  aiEnabled: z.boolean(),
  canManage: z.boolean(),
});
export type MinutesConfig = z.infer<typeof MinutesConfigSchema>;

/** File name for a download: "Minutes - Weekly sync - 2026-11-21.pdf". */
export function documentFileName(kind: string, title: string, date: Date, ext: string): string {
  const safe = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  const d = date.toISOString().slice(0, 10);
  return `${kind} - ${safe || 'Untitled'} - ${d}.${ext}`;
}
