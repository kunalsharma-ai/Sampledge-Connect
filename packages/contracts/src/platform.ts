import { z } from 'zod';
import { AuditQuerySchema, type AdminOverview, type AuditEntry } from './admin.js';
import { AssignPlanRequestSchema, type Invoice, type Subscription } from './billing.js';
import {
  TenantPermissionPolicySchema,
  type TenantPermissionPolicy,
  type TenantRole,
} from './permissions.js';

/**
 * Super admin console (docs/super-admin.md): the people who run SampConnect itself, across
 * every organization. Platform admins live in the database with a role; the
 * PLATFORM_ADMIN_EMAILS setting only bootstraps the first super admin.
 */

export const PLATFORM_ROLES = ['owner', 'admin', 'billing', 'support', 'moderator'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const PLATFORM_PERMISSIONS = [
  'overview.view',
  'orgs.view',
  'orgs.manage',
  'orgs.delete',
  'billing.manage',
  'moderation',
  'integrations.manage',
  'support.view',
  'audit.view',
  'admins.manage',
  'permissions.manage',
  'activity.view',
] as const;
export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

const ALL = PLATFORM_PERMISSIONS;
const ROLE_PERMISSIONS: Record<PlatformRole, readonly PlatformPermission[]> = {
  owner: ALL,
  admin: ALL.filter(
    (p) => p !== 'admins.manage' && p !== 'orgs.delete' && p !== 'permissions.manage',
  ),
  billing: ['overview.view', 'orgs.view', 'billing.manage'],
  support: ['overview.view', 'orgs.view', 'support.view', 'audit.view', 'activity.view'],
  moderator: ['overview.view', 'moderation'],
};

export const PLATFORM_ROLE_INFO: Record<PlatformRole, { label: string; description: string }> = {
  owner: {
    label: 'Super admin',
    description:
      'Everything, including what each organization’s people may do, platform admins and deleting organizations.',
  },
  admin: {
    label: 'Platform admin',
    description:
      'Organizations, plans and billing, moderation, platform integrations, the support view and all activity.',
  },
  billing: {
    label: 'Billing',
    description: 'The plan catalog, payments and each organization’s plan.',
  },
  support: {
    label: 'Support',
    description: 'Read-only: organizations, the support view, all activity and the audit log.',
  },
  moderator: {
    label: 'Moderator',
    description: 'Reported content and suspensions on SampConnect Network.',
  },
};

export function platformCan(role: PlatformRole | null | undefined, p: PlatformPermission): boolean {
  return !!role && ROLE_PERMISSIONS[role].includes(p);
}
export function platformPermissions(role: PlatformRole): PlatformPermission[] {
  return [...ROLE_PERMISSIONS[role]];
}

/** GET /v1/platform/me. 403 when you are not a platform admin. */
export interface PlatformMe {
  role: PlatformRole;
  permissions: PlatformPermission[];
  /** You were added from the PLATFORM_ADMIN_EMAILS bootstrap setting, not in the console. */
  bootstrap: boolean;
}

// ─── overview, usage and health ─────────────────────────────────────────────

export interface PlatformHealth {
  api: { version: string; node: string; uptimeSeconds: number };
  mongo: { ok: boolean; latencyMs: number | null };
  redis: { ok: boolean; latencyMs: number | null };
  realtime: { sockets: number };
  migrations: { applied: number; pending: string[] };
  http: { requests: number; serverErrors: number };
  /** Platform-wide integration defaults (payments, email, calls, AI…). Never secrets. */
  integrations: {
    providerId: string;
    name: string;
    enabled: boolean;
    lastTest: { ok: boolean; at: string } | null;
  }[];
}

export interface PlatformOverview {
  organizations: {
    total: number;
    active: number;
    suspended: number;
    pendingDeletion: number;
    newLast30Days: number;
  };
  people: { active: number; twoStepOn: number };
  devices: { active: number; seenLast7Days: number };
  messagesLast7Days: number;
  storageBytes: number;
  /** New organizations per day for the last 30 days, oldest first (YYYY-MM-DD). */
  signups: { day: string; count: number }[];
  subscriptions: { trialing: number; active: number; pastDue: number; none: number };
  /** Organizations on each plan (planId null = no plan). */
  plans: { planId: string | null; name: string; organizations: number }[];
  /** Recurring revenue per month, in minor units, by currency (yearly plans divided by 12). */
  monthlyRevenue: { currency: string; amount: number }[];
  moderation: { openReports: number };
  health: PlatformHealth;
}

// ─── organizations ──────────────────────────────────────────────────────────

export const PLATFORM_ORG_FILTERS = ['all', 'active', 'suspended', 'deleting'] as const;
export type PlatformOrgFilter = (typeof PLATFORM_ORG_FILTERS)[number];

export const PlatformOrgQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(PLATFORM_ORG_FILTERS).default('all'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type PlatformOrgQuery = z.input<typeof PlatformOrgQuerySchema>;

export interface PlatformOrg {
  tenantId: string;
  slug: string;
  name: string;
  status: 'active' | 'suspended';
  createdAt: string;
  members: number;
  storageBytes: number;
  plan: { planId: string; name: string } | null;
  subscription: Subscription;
  suspension: { at: string; reason: string; byName: string } | null;
  /** Deletion requested: everything is erased at this time unless cancelled. */
  deletionScheduledFor: string | null;
  lastActiveAt: string | null;
}

export interface PlatformOrgPage {
  items: PlatformOrg[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PlatformOrgPerson {
  userId: string;
  name: string;
  email: string;
  role: TenantRole;
  status: 'active' | 'deactivated';
  twoStep: boolean;
  lastSeenAt: string | null;
}

/** GET /v1/platform/orgs/:tenantId */
export interface PlatformOrgDetail {
  org: PlatformOrg;
  overview: AdminOverview;
  /** Owners and admins: who to contact. */
  admins: PlatformOrgPerson[];
  invoices: Invoice[];
  /** What super admins did to this organization, newest first. */
  history: PlatformAuditEntry[];
}

/**
 * GET /v1/platform/orgs/:tenantId/support — what support needs to troubleshoot, without
 * signing in as anyone: no messages, files or secrets. Opening it is written to the
 * organization's own audit log.
 */
export interface PlatformSupportView {
  tenantId: string;
  members: (PlatformOrgPerson & { devices: number })[];
  devices: {
    sessionId: string;
    userName: string;
    name: string;
    platform: string;
    lastSeenAt: string;
    revoked: boolean;
  }[];
  integrations: {
    providerId: string;
    name: string;
    enabled: boolean;
    source: 'tenant' | 'platform' | 'env' | null;
    lastTest: { ok: boolean; at: string; message: string } | null;
  }[];
  signIn: { ssoEnabled: boolean; passwordLogin: boolean };
  /** Sign-in failures and security events, newest first. */
  events: AuditEntry[];
}

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Lowercase letters, numbers and dashes');

/** POST /v1/platform/orgs — the owner signs in with the temporary password and changes it. */
export const CreatePlatformOrgSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug,
  ownerName: z.string().trim().min(1).max(120),
  ownerEmail: z.string().trim().toLowerCase().email().max(254),
  temporaryPassword: z.string().min(12).max(200),
  planId: z.string().min(1).max(64).nullable().default(null),
});
export type CreatePlatformOrgRequest = z.input<typeof CreatePlatformOrgSchema>;

/** PATCH /v1/platform/orgs/:tenantId */
export const UpdatePlatformOrgSchema = z.object({ name: z.string().trim().min(2).max(120) });

/** POST /v1/platform/orgs/:tenantId/suspend */
export const SuspendOrgSchema = z.object({
  clientActionId: z.string().min(8).max(64),
  reason: z.string().trim().min(3).max(500),
});

/** POST /v1/platform/orgs/:tenantId/deletion — type the organization's address to confirm. */
export const ScheduleDeletionSchema = z.object({
  clientActionId: z.string().min(8).max(64),
  confirmSlug: z.string().trim().toLowerCase().min(1).max(40),
});

/** Days between a deletion request and the erase. Cancel any time before. */
export const ORG_DELETION_GRACE_DAYS = 30;

/** PUT /v1/platform/orgs/:tenantId/plan */
export const PlatformAssignPlanSchema = AssignPlanRequestSchema;

// ─── platform admins ────────────────────────────────────────────────────────

export interface PlatformAdmin {
  adminId: string;
  role: PlatformRole;
  tenantId: string;
  orgName: string;
  orgSlug: string;
  userId: string;
  name: string;
  email: string;
  twoStep: boolean;
  addedAt: string;
  addedByName: string | null;
  bootstrap: boolean;
  you: boolean;
}

/** GET /v1/platform/accounts?q= — work accounts in any organization, to make one a platform admin. */
export interface PlatformAccount {
  tenantId: string;
  orgName: string;
  orgSlug: string;
  userId: string;
  name: string;
  email: string;
  /** Already a platform admin. */
  role: PlatformRole | null;
}

export const AddPlatformAdminSchema = z.object({
  tenantId: z.string().min(1).max(64),
  userId: z.string().min(1).max(64),
  role: z.enum(PLATFORM_ROLES),
});
export type AddPlatformAdminRequest = z.infer<typeof AddPlatformAdminSchema>;

export const UpdatePlatformAdminSchema = z.object({ role: z.enum(PLATFORM_ROLES) });

// ─── audit ──────────────────────────────────────────────────────────────────

export const PLATFORM_AUDIT_AREAS = [
  'organizations',
  'billing',
  'moderation',
  'admins',
  'integrations',
  'support',
  'permissions',
  'activity',
] as const;
export type PlatformAuditArea = (typeof PLATFORM_AUDIT_AREAS)[number];

export const PlatformAuditQuerySchema = z.object({
  area: z.enum(PLATFORM_AUDIT_AREAS).optional(),
  tenantId: z.string().max(64).optional(),
  q: z.string().trim().max(100).optional(),
  before: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type PlatformAuditQuery = z.input<typeof PlatformAuditQuerySchema>;

export interface PlatformAuditEntry {
  id: string;
  at: string;
  action: string;
  label: string;
  area: PlatformAuditArea;
  actor: { name: string; email: string; orgName: string } | null;
  /** The organization it affected, if any. */
  org: { tenantId: string; name: string } | null;
  target: { type: string; id: string; label: string } | null;
  ip: string | null;
  metadata: Record<string, unknown>;
}

export interface PlatformAuditPage {
  items: PlatformAuditEntry[];
  nextCursor: string | null;
}

const PLATFORM_LABELS: Record<string, string> = {
  'platform.org_created': 'Created an organization',
  'platform.org_renamed': 'Renamed an organization',
  'platform.org_suspended': 'Suspended an organization',
  'platform.org_reactivated': 'Reactivated an organization',
  'platform.org_deletion_scheduled': 'Scheduled an organization for deletion',
  'platform.org_deletion_cancelled': 'Cancelled an organization’s deletion',
  'platform.org_purged': 'Erased an organization',
  'platform.plan_assigned': 'Changed an organization’s plan',
  'platform.plan_created': 'Added a plan',
  'platform.plan_updated': 'Edited a plan',
  'platform.support_viewed': 'Opened the support view',
  'platform.admin_added': 'Added a platform admin',
  'platform.admin_role_changed': 'Changed a platform admin’s role',
  'platform.admin_removed': 'Removed a platform admin',
  'platform.admin_bootstrapped': 'First super admin set up from server settings',
  'platform.integration_saved': 'Saved a platform integration',
  'platform.moderation_action': 'Acted on a SampConnect Network report',
  'platform.moderation_restore': 'Restored a suspended Network account or community',
  'platform.permissions_default_changed': 'Changed what people may do in every organization',
  'platform.permissions_org_changed': 'Changed what people may do in an organization',
  'platform.org_password_reset_forced': 'Forced a password reset',
  'platform.activity_retention_changed': 'Changed how long activity is kept',
  'platform.activity_exported': 'Exported activity',
};

export function platformAuditLabel(action: string): string {
  return PLATFORM_LABELS[action] ?? action.replace(/^platform\./, '').replace(/_/g, ' ');
}

export function platformAuditArea(action: string): PlatformAuditArea {
  if (/^platform\.permissions_/.test(action)) return 'permissions';
  if (/^platform\.activity_/.test(action)) return 'activity';
  if (/^platform\.(org_|support)/.test(action))
    return action.includes('support') ? 'support' : 'organizations';
  if (/^platform\.plan_/.test(action)) return 'billing';
  if (/^platform\.admin_/.test(action)) return 'admins';
  if (/^platform\.integration/.test(action)) return 'integrations';
  return 'moderation';
}

export const PLATFORM_AUDIT_AREA_PATTERNS: Record<PlatformAuditArea, RegExp> = {
  organizations: /^platform\.org_/,
  support: /^platform\.support/,
  billing: /^platform\.plan_/,
  admins: /^platform\.admin_/,
  integrations: /^platform\.integration/,
  moderation: /^platform\.moderation/,
  permissions: /^platform\.permissions_/,
  activity: /^platform\.activity_/,
};

/** Realtime, to every platform admin: refetch that area of the console. */
export interface PlatformChangedEvent {
  area: 'orgs' | 'admins' | 'billing' | 'audit' | 'me' | 'permissions' | 'activity';
  tenantId?: string;
}

export type PlatformAssignPlanRequest = z.input<typeof PlatformAssignPlanSchema>;

// ─── permissions (what each organization's people may do) ───────────────────

/** GET /v1/platform/permissions — the default for every organization. */
export interface PlatformPermissionDefaults {
  /** SampConnect's built-in rules. */
  builtIn: TenantPermissionPolicy;
  /** What organizations without their own rules use. */
  policy: TenantPermissionPolicy;
  /** The default differs from the built-in rules. */
  customized: boolean;
  /** Organizations with their own rules. */
  customOrganizations: number;
}

/** GET /v1/platform/orgs/:tenantId/permissions */
export interface PlatformOrgPermissions {
  tenantId: string;
  /** What applies in this organization now. */
  policy: TenantPermissionPolicy;
  /** True when the organization follows the platform default. */
  inherits: boolean;
  platformDefault: TenantPermissionPolicy;
}

/** PUT either: a full policy, or null to go back to the default (built-in for the platform). */
export const SetPermissionPolicySchema = z.object({
  policy: TenantPermissionPolicySchema.nullable(),
});
export type SetPermissionPolicyRequest = z.input<typeof SetPermissionPolicySchema>;

// ─── activity (every organization's audit log, in one place) ────────────────

export const PlatformActivityQuerySchema = AuditQuerySchema.extend({
  tenantId: z.string().max(64).optional(),
});
export type PlatformActivityQuery = z.input<typeof PlatformActivityQuerySchema>;

export type PlatformActivityEntry = AuditEntry & {
  org: { tenantId: string; name: string; slug: string };
};

export interface PlatformActivityPage {
  items: PlatformActivityEntry[];
  nextCursor: string | null;
}

/** GET/PUT /v1/platform/activity/retention — null keeps everything. */
export const ActivityRetentionSchema = z.object({
  days: z.number().int().min(30).max(3650).nullable(),
});
export interface ActivityRetention {
  days: number | null;
  /** Oldest entry still kept. */
  oldestAt: string | null;
}

/** POST /v1/platform/orgs/:tenantId/people/:userId/password-reset */
export interface ForcedPasswordReset {
  userId: string;
  signedOutDevices: number;
}
