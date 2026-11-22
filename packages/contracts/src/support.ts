import { z } from 'zod';

/**
 * Help center queries (docs/help-center.md): anyone can ask a question from Help > Ask a
 * question. A query goes to the organization's owners and admins, or straight to SampConnect
 * support (the super admin console); admins can pass one on to SampConnect support. Both sides
 * reply in a thread and set its status. Every change reaches the asker's devices, the admins
 * and (for SampConnect support) the platform console live (`support:changed`).
 */

export const SUPPORT_STATUSES = ['open', 'in_progress', 'answered', 'resolved'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export const SUPPORT_STATUS_LABELS: Record<SupportStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  answered: 'Answered',
  resolved: 'Resolved',
};

/** Who handles the query: the organization's admins, or SampConnect support. */
export const SUPPORT_ROUTES = ['org', 'platform'] as const;
export type SupportRoute = (typeof SUPPORT_ROUTES)[number];

export const SUPPORT_TOPICS = ['question', 'problem', 'idea', 'account', 'other'] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number];
export const SUPPORT_TOPIC_LABELS: Record<SupportTopic, string> = {
  question: 'How do I…',
  problem: 'Something isn’t working',
  idea: 'Idea or request',
  account: 'My account or access',
  other: 'Something else',
};

/** Who wrote a reply: the asker, an organization admin, or SampConnect support. */
export type SupportSide = 'requester' | 'org' | 'platform';

export const SUPPORT_SUBJECT_MAX = 140;
export const SUPPORT_TEXT_MAX = 4000;

export const CreateSupportQuerySchema = z.object({
  /** Client-generated id: sending the same one twice creates one query (offline retries). */
  clientId: z.string().min(8).max(64),
  subject: z.string().trim().min(3).max(SUPPORT_SUBJECT_MAX),
  body: z.string().trim().min(1).max(SUPPORT_TEXT_MAX),
  topic: z.enum(SUPPORT_TOPICS).default('question'),
  /** The feature guide this is about (FEATURE_HELP id), if any. */
  featureId: z.string().max(40).nullish(),
  route: z.enum(SUPPORT_ROUTES).default('org'),
});
export type CreateSupportQueryRequest = z.input<typeof CreateSupportQuerySchema>;

export const SupportReplySchema = z.object({
  clientId: z.string().min(8).max(64),
  text: z.string().trim().min(1).max(SUPPORT_TEXT_MAX),
});
export type SupportReplyRequest = z.input<typeof SupportReplySchema>;

export const UpdateSupportQuerySchema = z
  .object({
    status: z.enum(SUPPORT_STATUSES).optional(),
    /** Admins only: pass the query on to SampConnect support. */
    route: z.literal('platform').optional(),
  })
  .refine((b) => b.status || b.route, 'Nothing to change');
export type UpdateSupportQueryRequest = z.input<typeof UpdateSupportQuerySchema>;

export interface SupportReply {
  replyId: string;
  side: SupportSide;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: string;
}

export interface SupportQuery {
  queryId: string;
  tenantId: string;
  /** The organization's name (shown in the super admin console). */
  organizationName?: string;
  requesterId: string;
  requesterName: string;
  requesterEmail: string;
  subject: string;
  body: string;
  topic: SupportTopic;
  featureId: string | null;
  route: SupportRoute;
  status: SupportStatus;
  replies: SupportReply[];
  createdAt: string;
  updatedAt: string;
  /** Last reply from the other side, for "new reply" dots. */
  lastReplyAt: string | null;
  lastReplySide: SupportSide | null;
}

/** GET /v1/support/queries (mine), /v1/support/admin/queries and /v1/platform/support/queries. */
export interface SupportQueryList {
  items: SupportQuery[];
}

export const SupportListQuerySchema = z.object({
  status: z.enum([...SUPPORT_STATUSES, 'active', 'all'] as const).default('all'),
});

/** Live: a query you asked, handle as an admin, or handle as SampConnect support changed. */
export interface SupportChangedEvent {
  queryId: string;
  tenantId: string;
}
