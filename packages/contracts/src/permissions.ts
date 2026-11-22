import { z } from 'zod';

/**
 * Permission model (see docs/permission-model.md).
 *
 * Two layers are evaluated for every action:
 *  1. Tenant role: what the user may do inside their organization.
 *  2. Conversation role: what the user may do inside one conversation.
 * Tenant isolation is not a permission: it is enforced before any check runs,
 * by deriving tenantId from the authenticated session, never from input.
 */

export const TENANT_ROLES = ['owner', 'admin', 'member', 'guest'] as const;
export const TenantRoleSchema = z.enum(TENANT_ROLES);
export type TenantRole = z.infer<typeof TenantRoleSchema>;

export const CONVERSATION_ROLES = ['owner', 'moderator', 'member'] as const;
export const ConversationRoleSchema = z.enum(CONVERSATION_ROLES);
export type ConversationRole = z.infer<typeof ConversationRoleSchema>;

export const TENANT_PERMISSIONS = [
  'tenant.manage', // branding, plan, retention, delete tenant
  'members.invite',
  'members.manage', // change roles, deactivate users
  'devices.revoke.any',
  'audit.read',
  'integrations.manage',
  'recordings.manage', // retention settings, delete any recording, bulk export
  'inbox.access', // work client conversations in the Client Inbox
  'inbox.supervise', // all inbox teams, SLA and escalation settings, supervisor dashboard
  'connectors.manage', // connect external messaging channels and manage their credentials
  'ai.manage', // turn the private AI assistant on or off for the organization
  'analytics.org', // organization-wide analytics
  'themes.manage', // chat theme rules for everyone
  'work.manage', // see and manage everyone's tasks and approvals
  'directory.read',
  'conversation.dm.create',
  'conversation.group.create',
  'channel.public.create',
  'channel.private.create',
  'channel.public.join',
] as const;
export type TenantPermission = (typeof TENANT_PERMISSIONS)[number];

export const CONVERSATION_PERMISSIONS = [
  'conversation.read',
  'message.send',
  'message.react',
  'message.pin',
  'message.edit.own',
  'message.delete.own',
  'message.delete.any', // moderation
  'members.add',
  'members.remove',
  'conversation.rename',
  'conversation.archive',
] as const;
export type ConversationPermission = (typeof CONVERSATION_PERMISSIONS)[number];

const ALL_TENANT = [...TENANT_PERMISSIONS];

export const TENANT_ROLE_GRANTS: Record<TenantRole, readonly TenantPermission[]> = {
  owner: ALL_TENANT,
  admin: ALL_TENANT.filter((p) => p !== 'tenant.manage'),
  member: [
    'directory.read',
    'inbox.access',
    'conversation.dm.create',
    'conversation.group.create',
    'channel.public.create',
    'channel.private.create',
    'channel.public.join',
  ],
  // Guests (e.g. external suppliers) can talk in conversations they were added to,
  // and start DMs, but cannot browse the directory or create channels.
  guest: ['conversation.dm.create'],
};

export const CONVERSATION_ROLE_GRANTS: Record<ConversationRole, readonly ConversationPermission[]> =
  {
    owner: [...CONVERSATION_PERMISSIONS],
    moderator: [
      'conversation.read',
      'message.send',
      'message.react',
      'message.pin',
      'message.edit.own',
      'message.delete.own',
      'message.delete.any',
      'members.add',
      'members.remove',
      'conversation.rename',
    ],
    member: [
      'conversation.read',
      'message.send',
      'message.react',
      'message.pin',
      'message.edit.own',
      'message.delete.own',
    ],
  };

/**
 * What each role may do in one organization. SampConnect's super admins set it, per
 * organization or as the default for all of them (docs/super-admin.md); organization owners
 * can't change it. Missing roles fall back to TENANT_ROLE_GRANTS.
 */
export type TenantPermissionPolicy = Record<TenantRole, TenantPermission[]>;

const PermissionList = z.array(z.enum(TENANT_PERMISSIONS)).max(TENANT_PERMISSIONS.length);
export const TenantPermissionPolicySchema = z.object({
  owner: PermissionList,
  admin: PermissionList,
  member: PermissionList,
  guest: PermissionList,
});

/** The built-in policy, used until a super admin changes it. */
export const DEFAULT_TENANT_POLICY: TenantPermissionPolicy = Object.fromEntries(
  TENANT_ROLES.map((r) => [r, [...TENANT_ROLE_GRANTS[r]]]),
) as TenantPermissionPolicy;

/** A role alone (built-in rules) or a signed-in person with the grants their organization allows. */
export type TenantSubject = TenantRole | { role: TenantRole; grants?: readonly TenantPermission[] };

export function tenantCan(subject: TenantSubject, permission: TenantPermission): boolean {
  if (typeof subject === 'string') return TENANT_ROLE_GRANTS[subject].includes(permission);
  return (subject.grants ?? TENANT_ROLE_GRANTS[subject.role]).includes(permission);
}

/** Plain-language names for the permission matrix in the super admin console. */
export const TENANT_PERMISSION_INFO: Record<TenantPermission, { label: string; group: string }> = {
  'tenant.manage': {
    label: 'Manage the organization (branding, plan, retention)',
    group: 'Organization',
  },
  'members.invite': { label: 'Add members', group: 'People' },
  'members.manage': { label: 'Change roles, deactivate people, reset passwords', group: 'People' },
  'devices.revoke.any': { label: 'Sign anyone’s devices out', group: 'People' },
  'audit.read': { label: 'Read the organization’s audit log', group: 'Organization' },
  'integrations.manage': { label: 'Set up integrations', group: 'Organization' },
  'recordings.manage': { label: 'Manage all recordings and minutes', group: 'Meetings' },
  'inbox.access': { label: 'Use the Client Inbox', group: 'Client Inbox' },
  'inbox.supervise': { label: 'Supervise the Client Inbox (teams, SLAs)', group: 'Client Inbox' },
  'connectors.manage': { label: 'Connect messaging channels', group: 'Client Inbox' },
  'ai.manage': { label: 'Turn the AI assistant on or off', group: 'Organization' },
  'analytics.org': { label: 'See organization-wide analytics', group: 'Organization' },
  'themes.manage': { label: 'Set chat theme rules for everyone', group: 'Organization' },
  'work.manage': { label: 'Manage everyone’s tasks and approvals', group: 'People' },
  'directory.read': { label: 'See the member directory', group: 'People' },
  'conversation.dm.create': { label: 'Start direct messages', group: 'Conversations' },
  'conversation.group.create': { label: 'Start group conversations', group: 'Conversations' },
  'channel.public.create': { label: 'Create public channels', group: 'Conversations' },
  'channel.private.create': { label: 'Create private channels', group: 'Conversations' },
  'channel.public.join': { label: 'Join public channels', group: 'Conversations' },
};

export interface ConversationAccess {
  /** null when the user is not a member of the conversation. */
  conversationRole: ConversationRole | null;
  tenantRole: TenantRole;
  archived: boolean;
  /** Public channels are readable by any non-guest tenant member. */
  isPublicChannel: boolean;
}

const WRITE_PERMISSIONS: ReadonlySet<ConversationPermission> = new Set([
  'message.send',
  'message.react',
  'message.pin',
  'message.edit.own',
  'members.add',
  'conversation.rename',
]);

/**
 * Conversation-level authorization. Tenant admins may moderate any conversation
 * in their tenant, but only see private conversations they belong to.
 */
export function conversationCan(
  access: ConversationAccess,
  permission: ConversationPermission,
): boolean {
  if (access.archived && WRITE_PERMISSIONS.has(permission)) return false;
  if (access.conversationRole) {
    if (CONVERSATION_ROLE_GRANTS[access.conversationRole].includes(permission)) return true;
  }
  const isTenantAdmin = access.tenantRole === 'owner' || access.tenantRole === 'admin';
  if (
    permission === 'conversation.read' &&
    access.isPublicChannel &&
    access.tenantRole !== 'guest'
  ) {
    return true;
  }
  if (
    isTenantAdmin &&
    access.conversationRole &&
    (permission === 'message.delete.any' || permission === 'conversation.archive')
  ) {
    return true;
  }
  return false;
}
