import type { TenantRole } from '@sampledge/contracts';

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
}
