/** Room names always embed the tenant, so a room can never span tenants. */
export const userRoom = (tenantId: string, userId: string) => `t:${tenantId}:u:${userId}`;
export const conversationRoom = (tenantId: string, conversationId: string) =>
  `t:${tenantId}:c:${conversationId}`;
