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
      'message.edit.own',
      'message.delete.own',
    ],
  };

export function tenantCan(role: TenantRole, permission: TenantPermission): boolean {
  return TENANT_ROLE_GRANTS[role].includes(permission);
}

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
