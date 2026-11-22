/** Room names always embed the tenant, so a room can never span tenants. */
export const userRoom = (tenantId: string, userId: string) => `t:${tenantId}:u:${userId}`;
export const conversationRoom = (tenantId: string, conversationId: string) =>
  `t:${tenantId}:c:${conversationId}`;
export const tenantRoom = (tenantId: string) => `t:${tenantId}:all`;
/** Platform operators (PLATFORM_ADMIN_EMAILS), across tenants: the moderation queue. */
export const moderatorsRoom = () => 'platform:moderators';
