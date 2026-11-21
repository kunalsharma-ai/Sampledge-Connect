import { z } from 'zod';
import { ServerIdSchema } from './ids.js';
import { MilestoneSchema, ProjectSchema } from './work.js';

/**
 * Private AI assistant (Phase 4). Optional, self-hosted, and never on the chat path.
 *
 * Engines:
 *  - `off`: an admin turned AI off for the organization. Every /v1/ai call returns 403.
 *  - `basic`: built-in, no model server. Extractive summaries, keyword action items and
 *    lexical (hashed) semantic search. Nothing leaves the API process. Translation and free
 *    text answers need a model and say so.
 *  - `model`: the organization's own OpenAI-compatible model server (Ollama, vLLM, LocalAI,
 *    llama.cpp server), configured in Administration > Integrations ("AI model server").
 *
 * Every AI read is checked against the caller's own access: AI only ever sees messages the
 * caller can read right now. AI never sends, deletes or changes anything on its own: it
 * returns drafts, and a draft becomes a message only when the person confirms it.
 */
export const AI_ENGINES = ['off', 'basic', 'model'] as const;
export const AiEngineSchema = z.enum(AI_ENGINES);
export type AiEngine = z.infer<typeof AiEngineSchema>;

export const AI_FEATURES = [
  'summaries',
  'meeting_summaries',
  'action_items',
  'semantic_search',
  'ask',
  'translation',
  'suggested_replies',
  'status_digest',
  'task_suggestions',
  'duplicate_detection',
  'notification_priority',
] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

/** `full`: works. `limited`: works without a model, with less quality. `needs_model`: needs a model server. */
export type AiFeatureLevel = 'full' | 'limited' | 'needs_model';

export const AiStatusSchema = z.object({
  /** false when an admin turned AI off for the organization. */
  enabled: z.boolean(),
  engine: AiEngineSchema,
  /** Chat model name when engine is `model`. */
  model: z.string().nullable(),
  features: z.record(z.string(), z.enum(['full', 'limited', 'needs_model'])),
  /** Whether the caller may change the organization's AI settings. */
  canManage: z.boolean(),
  /** Set when a model server is configured but unreachable on the last call. */
  lastError: z.string().nullable(),
  /** The organization's own speech-to-text server (Integrations › Speech-to-text). */
  transcription: z.object({
    configured: z.boolean(),
    autoTranscribeCalls: z.boolean(),
    autoTranscribeVoice: z.boolean(),
  }),
});
export type AiStatus = z.infer<typeof AiStatusSchema>;

/** PUT /v1/ai/settings (admins). The model server itself is configured in Integrations. */
export const UpdateAiSettingsRequestSchema = z.object({ enabled: z.boolean() });
export type UpdateAiSettingsRequest = z.infer<typeof UpdateAiSettingsRequestSchema>;

/** Which messages a summary covers. */
export const SUMMARY_RANGES = ['unread', 'day', 'week', 'recent'] as const;
export const SummaryRangeSchema = z.enum(SUMMARY_RANGES);
export type SummaryRange = z.infer<typeof SummaryRangeSchema>;

export const ActionItemSchema = z.object({
  text: z.string(),
  /** Person the item is for, when the text names a member (or "I'll" from the sender). */
  assigneeId: ServerIdSchema.nullable(),
  /** Free-text due hint such as "Friday" or "by EOD", as written. */
  due: z.string().nullable(),
  /** Message the item came from, for "jump to message". */
  messageId: ServerIdSchema.nullable(),
});
export type ActionItem = z.infer<typeof ActionItemSchema>;

export const AiSummarySchema = z.object({
  conversationId: ServerIdSchema,
  range: SummaryRangeSchema,
  /** A short paragraph. */
  summary: z.string(),
  highlights: z.array(z.string()),
  decisions: z.array(z.string()),
  actionItems: z.array(ActionItemSchema),
  /** Open questions nobody answered yet. */
  openQuestions: z.array(z.string()),
  messageCount: z.number().int().nonnegative(),
  participantIds: z.array(ServerIdSchema),
  fromSequence: z.number().int().nonnegative(),
  toSequence: z.number().int().nonnegative(),
  engine: AiEngineSchema,
  generatedAt: z.string().datetime(),
});
export type AiSummary = z.infer<typeof AiSummarySchema>;

/** POST /v1/ai/conversations/:conversationId/summary */
export const SummarizeRequestSchema = z.object({ range: SummaryRangeSchema.default('recent') });
export type SummarizeRequest = z.input<typeof SummarizeRequestSchema>;

/** POST /v1/ai/meetings/:meetingId/summary: agenda + the meeting chat around the meeting. */
export const AiMeetingSummarySchema = AiSummarySchema.omit({ range: true }).extend({
  meetingId: ServerIdSchema,
  title: z.string(),
  startsAt: z.string().datetime(),
  /** True when at least one call recording or voice message transcript was read. */
  transcriptIncluded: z.boolean(),
  /** How many transcripts were read (0 without a speech-to-text server). */
  transcriptCount: z.number().int().nonnegative(),
});
export type AiMeetingSummary = z.infer<typeof AiMeetingSummarySchema>;

export const AiSearchHitSchema = z.object({
  messageId: ServerIdSchema,
  conversationId: ServerIdSchema,
  senderId: ServerIdSchema,
  text: z.string(),
  createdAt: z.string().datetime(),
  /** Cosine similarity, 0..1. */
  score: z.number(),
  /** The match is in a call recording or voice message transcript (text holds the excerpt). */
  fromTranscript: z.boolean().default(false),
});
export type AiSearchHit = z.infer<typeof AiSearchHitSchema>;

/** POST /v1/ai/search: meaning-based search across conversations the caller can read. */
export const AiSearchRequestSchema = z.object({
  query: z.string().trim().min(2).max(500),
  conversationId: ServerIdSchema.optional(),
  limit: z.number().int().min(1).max(50).default(10),
});
export type AiSearchRequest = z.input<typeof AiSearchRequestSchema>;
export const AiSearchResponseSchema = z.object({
  hits: z.array(AiSearchHitSchema),
  engine: AiEngineSchema,
  /** Messages in scope that were not indexed yet (search still ran over the rest). */
  pendingIndex: z.number().int().nonnegative(),
});
export type AiSearchResponse = z.infer<typeof AiSearchResponseSchema>;

/** POST /v1/ai/ask: a question answered from messages the caller can read, with sources. */
export const AiAskRequestSchema = z.object({
  question: z.string().trim().min(2).max(1000),
  conversationId: ServerIdSchema.optional(),
  /** Earlier turns of this assistant chat (client-held; never stored on the server). */
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(4000) }))
    .max(10)
    .default([]),
});
export type AiAskRequest = z.input<typeof AiAskRequestSchema>;
export const AiAskResponseSchema = z.object({
  answer: z.string(),
  sources: z.array(AiSearchHitSchema),
  engine: AiEngineSchema,
});
export type AiAskResponse = z.infer<typeof AiAskResponseSchema>;

/** POST /v1/ai/translate */
export const AiTranslateRequestSchema = z.object({
  messageId: ServerIdSchema,
  /** BCP 47 tag, e.g. "es", "de", "hi", "pt-BR". */
  targetLanguage: z
    .string()
    .trim()
    .regex(/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/, 'must be a language tag like "es" or "pt-BR"'),
});
export type AiTranslateRequest = z.infer<typeof AiTranslateRequestSchema>;
export const AiTranslationSchema = z.object({
  messageId: ServerIdSchema,
  targetLanguage: z.string(),
  /** null when no model is configured: the UI says translation needs a model server. */
  text: z.string().nullable(),
  engine: AiEngineSchema,
});
export type AiTranslation = z.infer<typeof AiTranslationSchema>;

/** POST /v1/ai/conversations/:conversationId/replies: short replies to the latest message. */
export const AiSuggestedRepliesSchema = z.object({
  conversationId: ServerIdSchema,
  /** The message being replied to (latest message from someone else), or null. */
  replyToMessageId: ServerIdSchema.nullable(),
  suggestions: z.array(z.string()).max(3),
  engine: AiEngineSchema,
});
export type AiSuggestedReplies = z.infer<typeof AiSuggestedRepliesSchema>;

/** POST /v1/ai/digest: status across several conversations (project status until Samptrek links land). */
export const AiDigestRequestSchema = z.object({
  /** Defaults to the caller's most active readable conversations. */
  conversationIds: z.array(ServerIdSchema).max(20).optional(),
  sinceHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 14)
    .default(24 * 7),
});
export type AiDigestRequest = z.input<typeof AiDigestRequestSchema>;
/** The project linked to a conversation (Samptrek or Connect), as the caller may see it. */
export const AiProjectStatusSchema = z.object({
  projectId: ServerIdSchema,
  name: z.string(),
  source: ProjectSchema.shape.source,
  status: ProjectSchema.shape.status,
  url: z.string().nullable(),
  dueAt: z.string().datetime().nullable(),
  /** The next milestone not yet reached, soonest first. */
  nextMilestone: MilestoneSchema.nullable(),
  missedMilestones: z.number().int().nonnegative(),
  openTasks: z.number().int().nonnegative(),
  overdueTasks: z.number().int().nonnegative(),
  pendingApprovals: z.number().int().nonnegative(),
  /** Plain reasons the project needs attention (empty when on track). */
  concerns: z.array(z.string()),
});
export type AiProjectStatus = z.infer<typeof AiProjectStatusSchema>;

export const AiDigestSchema = z.object({
  items: z.array(
    z.object({
      conversationId: ServerIdSchema,
      summary: z.string(),
      status: z.enum(['on_track', 'needs_attention', 'quiet']),
      actionItems: z.array(ActionItemSchema),
      messageCount: z.number().int().nonnegative(),
      /** Linked project status (Samptrek projects and Connect projects). */
      project: AiProjectStatusSchema.nullable().default(null),
    }),
  ),
  /** Suggested tasks from every item. "Create task" opens the task form for the person to confirm. */
  suggestedTasks: z.array(ActionItemSchema.extend({ conversationId: ServerIdSchema })),
  since: z.string().datetime(),
  engine: AiEngineSchema,
});
export type AiDigest = z.infer<typeof AiDigestSchema>;

/** POST /v1/ai/duplicates: has this been asked or said already? */
export const AiDuplicatesRequestSchema = z.object({
  text: z.string().trim().min(8).max(2000),
  conversationId: ServerIdSchema.optional(),
});
export type AiDuplicatesRequest = z.infer<typeof AiDuplicatesRequestSchema>;
export const AiDuplicatesSchema = z.object({
  matches: z.array(AiSearchHitSchema),
  engine: AiEngineSchema,
});
export type AiDuplicates = z.infer<typeof AiDuplicatesSchema>;

/** GET /v1/ai/notifications/priority: the caller's unread notifications, ranked. */
export const AiPrioritySchema = z.enum(['high', 'normal', 'low']);
export const AiPrioritizedNotificationsSchema = z.object({
  items: z.array(
    z.object({
      notificationId: ServerIdSchema,
      priority: AiPrioritySchema,
      score: z.number(),
      reasons: z.array(z.string()),
    }),
  ),
  engine: AiEngineSchema,
});
export type AiPrioritizedNotifications = z.infer<typeof AiPrioritizedNotificationsSchema>;

// ---------- confirm-before-acting ----------

/**
 * Categories of action AI must never take without explicit confirmation. In this release AI
 * takes no action at all on its own: it drafts, and the person confirms. Drafts touching
 * these categories need a second, explicit acknowledgement.
 */
export const AI_RISK_CATEGORIES = ['financial', 'hr', 'client_facing', 'destructive'] as const;
export type AiRiskCategory = (typeof AI_RISK_CATEGORIES)[number];

export const AiRiskSchema = z.object({
  level: z.enum(['normal', 'sensitive']),
  categories: z.array(z.enum(AI_RISK_CATEGORIES)),
});
export type AiRisk = z.infer<typeof AiRiskSchema>;

const RISK_PATTERNS: Record<AiRiskCategory, RegExp> = {
  financial:
    /\b(invoice|payment|pay(?:out|roll)?|refund|wire|transfer|budget|price|pricing|quote|discount|bid|cost|fee|\$|€|£|₹|usd|eur|inr|purchase order|po number)\b|[$€£₹]\s?\d/i,
  hr: /\b(salary|salaries|compensation|bonus|raise|promotion|terminate|termination|fire[ds]?|dismiss(?:al)?|layoff|disciplinary|performance review|hiring|offer letter|resign(?:ation)?|leave balance|medical leave)\b/i,
  client_facing:
    /\b(client|customer|external|send to (?:the )?(?:client|customer)|panel(?:ist)?s?|respondents?|vendor|supplier|press|public announcement)\b/i,
  destructive:
    /\b(delete|deleting|remove|removing|erase|wipe|purge|drop|cancel(?:ling|led)?|archive|revoke|deactivate|close (?:the )?(?:account|project))\b/i,
};

/** Classifies a drafted action's text. Pure and conservative: false positives only add a checkbox. */
export function classifyActionRisk(
  text: string,
  opts: { externalAudience?: boolean } = {},
): AiRisk {
  const categories = AI_RISK_CATEGORIES.filter((c) => RISK_PATTERNS[c].test(text));
  if (opts.externalAudience && !categories.includes('client_facing'))
    categories.push('client_facing');
  return { level: categories.length ? 'sensitive' : 'normal', categories };
}

export const AI_PROPOSAL_KINDS = ['send_message'] as const;
export const AiProposalSchema = z.object({
  proposalId: ServerIdSchema,
  kind: z.enum(AI_PROPOSAL_KINDS),
  conversationId: ServerIdSchema,
  text: z.string(),
  risk: AiRiskSchema,
  status: z.enum(['pending', 'confirmed', 'dismissed', 'expired']),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  /** Set once confirmed. */
  messageId: ServerIdSchema.nullable(),
});
export type AiProposal = z.infer<typeof AiProposalSchema>;

/** POST /v1/ai/proposals: draft a message (e.g. share a summary). Nothing is sent yet. */
export const CreateAiProposalRequestSchema = z.object({
  kind: z.literal('send_message'),
  conversationId: ServerIdSchema,
  text: z.string().trim().min(1).max(8000),
});
export type CreateAiProposalRequest = z.infer<typeof CreateAiProposalRequestSchema>;

/** POST /v1/ai/proposals/:proposalId/confirm. `acknowledgeRisk` is required for sensitive drafts. */
export const ConfirmAiProposalRequestSchema = z.object({
  confirm: z.literal(true),
  acknowledgeRisk: z.boolean().default(false),
  /** The person may edit the draft before confirming. */
  text: z.string().trim().min(1).max(8000).optional(),
});
export type ConfirmAiProposalRequest = z.input<typeof ConfirmAiProposalRequestSchema>;

/** Proposals expire if not confirmed. */
export const AI_PROPOSAL_TTL_MINUTES = 30;

/** Integration id of the model server in Administration > Integrations. */
export const AI_MODEL_INTEGRATION_ID = 'ai.model';
/** Administration › Integrations: the organization's own speech-to-text server. */
export const AI_TRANSCRIPTION_INTEGRATION_ID = 'ai.transcription';

// ---------- transcripts (call recordings, voice messages, recorded video) ----------

/**
 * `not_configured`: no speech-to-text server. `none`: not transcribed yet.
 * `queued` / `processing` / `done` / `failed`: a transcript job.
 */
export const TRANSCRIPT_STATUSES = [
  'not_configured',
  'none',
  'queued',
  'processing',
  'done',
  'failed',
] as const;
export const TranscriptStatusSchema = z.enum(TRANSCRIPT_STATUSES);
export type TranscriptStatus = z.infer<typeof TranscriptStatusSchema>;

export const TranscriptSegmentSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  text: z.string(),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

/** GET /v1/ai/transcripts/:attachmentId and POST (queue one). */
export const AiTranscriptSchema = z.object({
  attachmentId: ServerIdSchema,
  conversationId: ServerIdSchema,
  messageId: ServerIdSchema.nullable(),
  status: TranscriptStatusSchema,
  text: z.string().nullable(),
  segments: z.array(TranscriptSegmentSchema),
  /** Detected or configured language (ISO 639-1 such as `en`), when known. */
  language: z.string().nullable(),
  model: z.string().nullable(),
  /** Why the last attempt failed, in plain words. */
  error: z.string().nullable(),
  updatedAt: z.string().datetime().nullable(),
});
export type AiTranscript = z.infer<typeof AiTranscriptSchema>;

/** Largest recording sent to the speech-to-text server (bytes are buffered in memory). */
export const TRANSCRIPT_MAX_BYTES = 200 * 1024 * 1024;

// ---------- suggested task → real task ----------

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/**
 * Turns a free-text due hint from an action item ("by Thursday", "EOD", "next week",
 * "Dec 3") into a calendar date (YYYY-MM-DD) in the runtime's local time zone, or null when
 * it can't tell. Used only to prefill the task form; the person checks it before creating.
 */
export function resolveDueHint(hint: string | null | undefined, now = new Date()): string | null {
  if (!hint) return null;
  const h = hint.toLowerCase();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const iso = h.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  if (/\b(today|tonight|eod|end of (the )?day|asap|right away|immediately)\b/.test(h))
    return ymd(today);
  if (/\btomorrow\b/.test(h)) return ymd(addDays(today, 1));
  if (/\bnext week\b/.test(h)) return ymd(addDays(today, (8 - today.getDay()) % 7 || 7));
  if (/\b(this week|end of (the )?week|eow)\b/.test(h)) {
    const d = today.getDay();
    return ymd(d === 0 || d === 6 ? today : addDays(today, 5 - d));
  }
  const wd = WEEKDAYS.findIndex((w) =>
    new RegExp(`\\b${w.slice(0, 3)}(${w.slice(3)})?\\b`).test(h),
  );
  if (wd >= 0) {
    let diff = (wd - today.getDay() + 7) % 7;
    if (/\bnext\b/.test(h) && diff === 0) diff = 7;
    return ymd(addDays(today, diff));
  }
  const m1 = h.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\b/);
  const m2 = h.match(/\b([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  const pick =
    m1 && MONTHS.includes(m1[2]!)
      ? { day: +m1[1]!, mon: MONTHS.indexOf(m1[2]!) }
      : m2 && MONTHS.includes(m2[1]!)
        ? { day: +m2[2]!, mon: MONTHS.indexOf(m2[1]!) }
        : null;
  if (pick && pick.day >= 1 && pick.day <= 31) {
    let d = new Date(today.getFullYear(), pick.mon, pick.day);
    if (d < today) d = new Date(today.getFullYear() + 1, pick.mon, pick.day);
    return ymd(d);
  }
  return null;
}
