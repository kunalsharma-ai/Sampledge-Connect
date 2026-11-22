import type { TenantPermission, TenantRole } from '@sampledge/contracts';

/**
 * The authenticated principal. Constructed only from a verified access token
 * plus a server-side membership lookup. Never from request bodies.
 */
export interface TenantContext {
  tenantId: string;
  userId: string;
  sessionId: string;
  deviceId: string;
  role: TenantRole;
  workspaceId: string;
  /**
   * What this person's role may do in their organization, as set by SampConnect's super
   * admins (docs/super-admin.md). Absent only for internal contexts, which use the built-in rules.
   */
  grants?: readonly TenantPermission[];
}
