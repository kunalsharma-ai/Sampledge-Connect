import { z } from 'zod';
import type { TenantRole } from './permissions.js';

/** GET /v1/admin/overview: the Administration home for owners and admins. */
export interface AdminOverview {
  organization: { name: string; slug: string; createdAt: string };
  members: {
    total: number;
    active: number;
    deactivated: number;
    byRole: Record<TenantRole, number>;
    /** Active people with two-step verification on. */
    twoStepOn: number;
  };
  devices: { active: number; seenLast7Days: number };
  activity: { messagesLast7Days: number; conversations: number };
  storageBytes: number;
  plan: { name: string | null; status: string };
  signIn: { ssoEnabled: boolean; passwordLogin: boolean };
  integrations: { connected: number; failing: number };
  /** Recent failed sign-ins and other security events. */
  security: AuditEntry[];
}

export interface AuditEntry {
  id: string;
  at: string;
  action: string;
  /** Plain-language label for known actions. */
  label: string;
  category: AuditCategory;
  actor: { userId: string; name: string } | null;
  target: { type: string; id: string; name?: string } | null;
  ip: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown>;
}

export const AUDIT_CATEGORIES = [
  'sign-in',
  'members',
  'security',
  'conversations',
  'integrations',
  'billing',
  'organization',
  'other',
] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export const AuditQuerySchema = z.object({
  category: z.enum(AUDIT_CATEGORIES).optional(),
  actorId: z.string().max(64).optional(),
  /** Free text over action names and metadata values. */
  q: z.string().trim().max(100).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  /** Cursor from the previous page. */
  before: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type AuditQuery = z.input<typeof AuditQuerySchema>;

export interface AuditPage {
  items: AuditEntry[];
  nextCursor: string | null;
}

/** Category of an audit action, from its prefix. */
export function auditCategory(action: string): AuditCategory {
  const p = action.split('.')[0];
  if (action.startsWith('auth.mfa') || action.startsWith('device')) return 'security';
  switch (p) {
    case 'auth':
      return 'sign-in';
    case 'member':
      return 'members';
    case 'conversation':
    case 'message':
    case 'poll':
    case 'call':
      return 'conversations';
    case 'integration':
    case 'module':
    case 'webhook':
      return 'integrations';
    case 'billing':
      return 'billing';
    case 'tenant':
    case 'recording':
    case 'recordings':
    case 'ai':
      return 'organization';
    default:
      return 'other';
  }
}

/** Action prefixes per category, for filtering in the database. */
export const AUDIT_CATEGORY_PREFIXES: Record<Exclude<AuditCategory, 'other'>, RegExp> = {
  'sign-in': /^auth\.(?!mfa)/,
  members: /^member\./,
  security: /^(auth\.mfa|device)/,
  conversations: /^(conversation|message|poll|call)\./,
  integrations: /^(integration|module|webhook)/,
  billing: /^billing\./,
  organization: /^(tenant|recordings?|ai)\./,
};

const LABELS: Record<string, string> = {
  'auth.login': 'Signed in',
  'auth.login_failed': 'Failed sign-in',
  'auth.logout': 'Signed out',
  'auth.sso_failed': 'Single sign-on failed',
  'auth.mfa_enabled': 'Turned on two-step verification',
  'auth.mfa_disabled': 'Turned off two-step verification',
  'auth.mfa_challenge': 'Asked for a two-step code',
  'auth.mfa_failed': 'Wrong two-step code',
  'auth.mfa_recovery_code_used': 'Used a recovery code',
  'auth.mfa_recovery_codes_regenerated': 'Made new recovery codes',
  'auth.mfa_reset_by_admin': 'Reset someone’s two-step verification',
  'tenant.created': 'Created the organization',
  'tenant.branding_updated': 'Changed branding',
  'tenant.chat_themes_updated': 'Changed chat theme rules',
  'member.invited': 'Added a member',
  'member.updated': 'Changed a member',
  'member.created_by_sso': 'Joined through single sign-on',
  'device.revoked': 'Signed a device out',
  'billing.plan_changed': 'Changed the plan',
  'billing.checkout_started': 'Started checkout',
  'billing.subscription_updated': 'Subscription updated',
  'billing.invoice_paid': 'Invoice paid',
  'billing.invoice_open': 'Invoice issued',
  'billing.plan_assigned_by_operator': 'Plan assigned by the provider',
  'billing.plan_created': 'Created a plan',
  'billing.plan_updated': 'Edited a plan',
  'integration.updated': 'Changed an integration',
  'integration.tested': 'Tested an integration',
  'integration.reset': 'Removed integration settings',
  'audit.exported': 'Exported the audit log',
  'device.revoked_all': 'Signed all devices out',
  'recording.delete': 'Deleted a recording',
  'recordings.export': 'Exported recordings',
  'recordings.settings.update': 'Changed recording settings',
  'calls.backgrounds.update': 'Changed call background settings',
  'conversation.created': 'Created a conversation',
  'conversation.posting_policy': 'Changed who can post',
  'integration.key_issued': 'Issued a module key',
  'integration.key_revoked': 'Revoked a module key',
  'webhook.created': 'Added a webhook',
  'webhook.deleted': 'Removed a webhook',
};

export function auditLabel(action: string): string {
  if (LABELS[action]) return LABELS[action]!;
  const words = action.split('.').slice(1).join(' ').replace(/_/g, ' ');
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : action;
}
