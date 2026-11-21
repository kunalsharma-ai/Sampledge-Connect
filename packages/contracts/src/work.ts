import { z } from 'zod';
import { ServerIdSchema } from './ids.js';
import { SampledgeModuleSchema } from './integrations.js';

/**
 * Tasks, approvals and projects (Phase 2, "conversation-to-action"). See docs/work.md.
 *
 * Tasks and approvals are Connect's own records: they work with no module connected. When one is
 * created in a conversation linked to a module record (a Samptrek project, a Talk2Tax expense...),
 * it carries that record, and the module is told about it through its outbound action
 * (`task.created`, `approval.decided`), sent for real only in live mode.
 */

/** The module record a task, approval or project belongs to. */
export const WorkRecordSchema = z.object({
  module: SampledgeModuleSchema,
  recordType: z.string(),
  externalId: z.string(),
  title: z.string(),
  url: z.string().nullable(),
});
export type WorkRecord = z.infer<typeof WorkRecordSchema>;

export const TASK_STATUSES = ['open', 'in_progress', 'blocked', 'done', 'cancelled'] as const;
export const TaskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const TaskPrioritySchema = z.enum(TASK_PRIORITIES);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

/** task: general work; bug: a QA issue (Sampcode); follow_up: sales follow-up; escalation. */
export const TASK_KINDS = ['task', 'bug', 'follow_up', 'escalation'] as const;
export const TaskKindSchema = z.enum(TASK_KINDS);
export type TaskKind = z.infer<typeof TaskKindSchema>;

export const TaskSchema = z.object({
  taskId: ServerIdSchema,
  title: z.string(),
  description: z.string(),
  kind: TaskKindSchema,
  status: TaskStatusSchema,
  priority: TaskPrioritySchema,
  assigneeIds: z.array(ServerIdSchema),
  createdBy: ServerIdSchema,
  dueAt: z.string().datetime().nullable(),
  conversationId: ServerIdSchema.nullable(),
  /** The chat message this task was created from ("chat-to-task"). */
  sourceMessageId: ServerIdSchema.nullable(),
  /** Short quote of the source message, kept even if the message is later deleted. */
  sourceExcerpt: z.string().nullable(),
  record: WorkRecordSchema.nullable(),
  /** Where it came from: made in Connect, or created by a module event. */
  origin: z.enum(['connect', 'module']),
  /** For tasks pushed to a module: what happened on the last push. */
  moduleSync: z
    .object({
      status: z.enum(['sent', 'failed', 'test_mode', 'not_configured']),
      at: z.string().datetime(),
    })
    .nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});
export type Task = z.infer<typeof TaskSchema>;

export const CreateTaskRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).default(''),
  kind: TaskKindSchema.default('task'),
  priority: TaskPrioritySchema.default('normal'),
  assigneeIds: z.array(ServerIdSchema).max(20).default([]),
  dueAt: z.string().datetime().nullable().default(null),
  conversationId: ServerIdSchema.nullable().default(null),
  sourceMessageId: ServerIdSchema.nullable().default(null),
  /** Idempotency key so an offline retry creates one task. */
  clientRequestId: z.string().uuid().optional(),
});
export type CreateTaskRequest = z.input<typeof CreateTaskRequestSchema>;

export const UpdateTaskRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(4000),
    status: TaskStatusSchema,
    priority: TaskPrioritySchema,
    assigneeIds: z.array(ServerIdSchema).max(20),
    dueAt: z.string().datetime().nullable(),
  })
  .partial()
  .refine((r) => Object.keys(r).length > 0, 'nothing to update');
export type UpdateTaskRequest = z.input<typeof UpdateTaskRequestSchema>;

/** GET /v1/tasks?scope=mine|created|conversation|all&conversationId=&status=open */
export const ListTasksQuerySchema = z.object({
  scope: z.enum(['mine', 'created', 'conversation', 'record', 'all']).default('mine'),
  conversationId: ServerIdSchema.optional(),
  linkId: ServerIdSchema.optional(),
  status: z.enum(['active', 'done', 'any']).default('active'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const APPROVAL_CATEGORIES = [
  'general',
  'pricing',
  'survey',
  'expense',
  'budget',
  'invoice',
  'leave',
] as const;
export const ApprovalCategorySchema = z.enum(APPROVAL_CATEGORIES);
export type ApprovalCategory = z.infer<typeof ApprovalCategorySchema>;

export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export const ApprovalStatusSchema = z.enum(APPROVAL_STATUSES);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const MoneySchema = z.object({
  /** Minor units (cents) to avoid floating point. */
  amountMinor: z.number().int().nonnegative().max(1e15),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/, 'ISO 4217 code'),
});
export type Money = z.infer<typeof MoneySchema>;

export const ApprovalDecisionSchema = z.object({
  userId: ServerIdSchema,
  decision: z.enum(['approve', 'reject']),
  comment: z.string(),
  at: z.string().datetime(),
});

export const ApprovalSchema = z.object({
  approvalId: ServerIdSchema,
  title: z.string(),
  description: z.string(),
  category: ApprovalCategorySchema,
  amount: MoneySchema.nullable(),
  requesterId: ServerIdSchema,
  approverIds: z.array(ServerIdSchema),
  /** any: the first decision settles it; all: every approver must approve (one reject settles). */
  policy: z.enum(['any', 'all']),
  decisions: z.array(ApprovalDecisionSchema),
  status: ApprovalStatusSchema,
  conversationId: ServerIdSchema.nullable(),
  sourceMessageId: ServerIdSchema.nullable(),
  record: WorkRecordSchema.nullable(),
  origin: z.enum(['connect', 'module']),
  dueAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  decidedAt: z.string().datetime().nullable(),
});
export type Approval = z.infer<typeof ApprovalSchema>;

export const CreateApprovalRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).default(''),
  category: ApprovalCategorySchema.default('general'),
  amount: MoneySchema.nullable().default(null),
  approverIds: z.array(ServerIdSchema).min(1).max(10),
  policy: z.enum(['any', 'all']).default('any'),
  dueAt: z.string().datetime().nullable().default(null),
  conversationId: ServerIdSchema.nullable().default(null),
  sourceMessageId: ServerIdSchema.nullable().default(null),
  clientRequestId: z.string().uuid().optional(),
});
export type CreateApprovalRequest = z.input<typeof CreateApprovalRequestSchema>;

export const DecideApprovalRequestSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  comment: z.string().trim().max(2000).default(''),
});
export type DecideApprovalRequest = z.input<typeof DecideApprovalRequestSchema>;

/** GET /v1/approvals?scope=to_decide|requested|conversation|all */
export const ListApprovalsQuerySchema = z.object({
  scope: z.enum(['to_decide', 'requested', 'conversation', 'record', 'all']).default('to_decide'),
  conversationId: ServerIdSchema.optional(),
  linkId: ServerIdSchema.optional(),
  status: z.enum(['pending', 'decided', 'any']).default('any'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

/** `metadata.work` on the card a task or approval posts in its conversation. */
export const WorkCardMetadataSchema = z.object({
  kind: z.enum(['task', 'approval']),
  id: ServerIdSchema,
  title: z.string(),
  status: z.string(),
  summary: z.string(),
});
export type WorkCardMetadata = z.infer<typeof WorkCardMetadataSchema>;

export const MilestoneSchema = z.object({
  milestoneId: z.string(),
  title: z.string(),
  dueAt: z.string().datetime().nullable(),
  status: z.enum(['upcoming', 'due', 'reached', 'missed']),
});
export type Milestone = z.infer<typeof MilestoneSchema>;

/**
 * A project: a Samptrek project (kept current by its events) or one made in Connect. Every
 * project has a project channel.
 */
export const ProjectSchema = z.object({
  projectId: ServerIdSchema,
  name: z.string(),
  description: z.string(),
  status: z.enum(['active', 'on_hold', 'at_risk', 'completed', 'cancelled']),
  source: z.enum(['connect', 'samptrek']),
  externalId: z.string().nullable(),
  url: z.string().nullable(),
  conversationId: ServerIdSchema.nullable(),
  ownerIds: z.array(ServerIdSchema),
  dueAt: z.string().datetime().nullable(),
  milestones: z.array(MilestoneSchema),
  openTasks: z.number().int().nonnegative(),
  overdueTasks: z.number().int().nonnegative(),
  pendingApprovals: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const CreateProjectRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(2000).default(''),
  memberIds: z.array(ServerIdSchema).max(100).default([]),
  dueAt: z.string().datetime().nullable().default(null),
  private: z.boolean().default(false),
});
export type CreateProjectRequest = z.input<typeof CreateProjectRequestSchema>;
