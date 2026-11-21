import {
  conversationCan,
  tenantCan,
  type ConversationPermission,
  type TenantPermission,
  type TenantRole,
} from '@sampledge/contracts';
import type { LocalConversation } from '../db/store';

/**
 * The same permission rules the server enforces, so the app only offers what will be allowed.
 * The server still decides; this only hides buttons that would be refused.
 */
export function canInConversation(
  c: LocalConversation,
  tenantRole: TenantRole,
  permission: ConversationPermission,
): boolean {
  return conversationCan(
    {
      conversationRole: c.myRole,
      tenantRole,
      archived: !!c.archivedAt,
      isPublicChannel: c.kind === 'channel_public',
    },
    permission,
  );
}

export function canInWorkspace(tenantRole: TenantRole, permission: TenantPermission): boolean {
  return tenantCan(tenantRole, permission);
}

/** A public channel you can read but have not joined. */
export function isUnjoinedChannel(c: LocalConversation): boolean {
  return c.kind === 'channel_public' && c.myRole === null;
}

/** Channel names the server accepts: letters, numbers, spaces, - _ . (first char a letter or digit). */
export function channelNameError(name: string): string | null {
  const n = name.trim();
  if (!n) return 'Give the channel a name.';
  if (n.length > 80) return 'Use 80 characters or fewer.';
  if (!/^[\p{L}\p{N}][\p{L}\p{N} _.-]*$/u.test(n))
    return 'Use letters, numbers, spaces, and - _ . only, starting with a letter or number.';
  return null;
}
