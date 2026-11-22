import {
  uuidv7,
  type BillingPlan,
  type PlatformAccount,
  type PlatformAdmin,
  type PlatformAssignPlanRequest,
  type PlatformAuditArea,
  type PlatformAuditPage,
  type PlatformMe,
  type PlatformOrg,
  type PlatformOrgDetail,
  type PlatformOrgFilter,
  type PlatformOrgPage,
  type PlatformOverview,
  type PlatformRole,
  type PlatformSupportView,
  type Subscription,
  type ActivityRetention,
  type AuditCategory,
  type ForcedPasswordReset,
  type PlatformActivityPage,
  type PlatformOrgPermissions,
  type PlatformPermissionDefaults,
  type TenantPermissionPolicy,
} from '@sampledge/contracts';

/** What the super admin console needs from the engine (Engine.platform). */
export interface PlatformCaller {
  platform<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T>;
}

const enc = encodeURIComponent;
const o = (id: string) => `/v1/platform/orgs/${enc(id)}`;

/** The super admin console API (docs/super-admin.md); the same routes as the web. */
export function platformApi(e: PlatformCaller) {
  return {
    me: () => e.platform<PlatformMe>('GET', '/v1/platform/me'),
    overview: () => e.platform<PlatformOverview>('GET', '/v1/platform/overview'),
    orgs: (q: { q?: string; status: PlatformOrgFilter; page?: number }) =>
      e.platform<PlatformOrgPage>(
        'GET',
        `/v1/platform/orgs?status=${q.status}&page=${q.page ?? 1}&limit=25${q.q ? `&q=${enc(q.q)}` : ''}`,
      ),
    org: (id: string) => e.platform<PlatformOrgDetail>('GET', o(id)),
    support: (id: string) => e.platform<PlatformSupportView>('GET', `${o(id)}/support`),
    suspend: (id: string, reason: string) =>
      e.platform<PlatformOrg>('POST', `${o(id)}/suspend`, { clientActionId: uuidv7(), reason }),
    reactivate: (id: string) => e.platform<PlatformOrg>('POST', `${o(id)}/reactivate`),
    scheduleDeletion: (id: string, confirmSlug: string) =>
      e.platform<PlatformOrg>('POST', `${o(id)}/deletion`, {
        clientActionId: uuidv7(),
        confirmSlug,
      }),
    cancelDeletion: (id: string) => e.platform<PlatformOrg>('DELETE', `${o(id)}/deletion`),
    assignPlan: (id: string, body: PlatformAssignPlanRequest) =>
      e.platform<Subscription>('PUT', `${o(id)}/plan`, body),
    plans: () => e.platform<BillingPlan[]>('GET', '/v1/platform/billing/plans'),
    admins: () => e.platform<PlatformAdmin[]>('GET', '/v1/platform/admins'),
    accounts: (q: string) =>
      e.platform<PlatformAccount[]>('GET', `/v1/platform/accounts?q=${enc(q)}`),
    addAdmin: (a: { tenantId: string; userId: string; role: PlatformRole }) =>
      e.platform<PlatformAdmin>('POST', '/v1/platform/admins', a),
    setRole: (adminId: string, role: PlatformRole) =>
      e.platform<PlatformAdmin>('PATCH', `/v1/platform/admins/${enc(adminId)}`, { role }),
    removeAdmin: (adminId: string) =>
      e.platform<{ removed: true }>('DELETE', `/v1/platform/admins/${enc(adminId)}`),
    audit: (q: { area?: PlatformAuditArea; q?: string; before?: string }) =>
      e.platform<PlatformAuditPage>(
        'GET',
        `/v1/platform/audit?limit=50${q.area ? `&area=${q.area}` : ''}${q.q ? `&q=${enc(q.q)}` : ''}${q.before ? `&before=${enc(q.before)}` : ''}`,
      ),
    permissions: () => e.platform<PlatformPermissionDefaults>('GET', '/v1/platform/permissions'),
    setPermissions: (policy: TenantPermissionPolicy | null) =>
      e.platform<PlatformPermissionDefaults>('PUT', '/v1/platform/permissions', { policy }),
    orgPermissions: (id: string) =>
      e.platform<PlatformOrgPermissions>('GET', `${o(id)}/permissions`),
    setOrgPermissions: (id: string, policy: TenantPermissionPolicy | null) =>
      e.platform<PlatformOrgPermissions>('PUT', `${o(id)}/permissions`, { policy }),
    forcePasswordReset: (id: string, userId: string) =>
      e.platform<ForcedPasswordReset>('POST', `${o(id)}/people/${enc(userId)}/password-reset`),
    activity: (q: { category?: AuditCategory; q?: string; tenantId?: string; before?: string }) =>
      e.platform<PlatformActivityPage>(
        'GET',
        `/v1/platform/activity?limit=50${q.category ? `&category=${q.category}` : ''}${q.q ? `&q=${enc(q.q)}` : ''}${q.tenantId ? `&tenantId=${enc(q.tenantId)}` : ''}${q.before ? `&before=${enc(q.before)}` : ''}`,
      ),
    retention: () => e.platform<ActivityRetention>('GET', '/v1/platform/activity/retention'),
    setRetention: (days: number | null) =>
      e.platform<ActivityRetention>('PUT', '/v1/platform/activity/retention', { days }),
  };
}

export const ORG_FILTER_TEXT: Record<PlatformOrgFilter, string> = {
  all: 'All',
  active: 'Active',
  suspended: 'Suspended',
  deleting: 'Being deleted',
};

export const AUDIT_AREA_TEXT: Record<PlatformAuditArea, string> = {
  organizations: 'Organizations',
  billing: 'Billing',
  moderation: 'Moderation',
  admins: 'Admins',
  integrations: 'Integrations',
  support: 'Support',
  permissions: 'Permissions',
  activity: 'Activity',
};

/** One short line for an organization's state, as shown on its row. */
export function orgStateText(org: Pick<PlatformOrg, 'status' | 'deletionScheduledFor'>): {
  text: string;
  tone: 'ok' | 'warn' | 'danger';
} {
  if (org.deletionScheduledFor)
    return {
      text: `Erased ${new Date(org.deletionScheduledFor).toLocaleDateString([], { day: 'numeric', month: 'short' })}`,
      tone: 'danger',
    };
  return org.status === 'active'
    ? { text: 'Active', tone: 'ok' }
    : { text: 'Suspended', tone: 'warn' };
}

export function formatBytesShort(b: number): string {
  if (b >= 1024 ** 4) return `${(b / 1024 ** 4).toFixed(1)} TB`;
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(b / 1024 ** 2)} MB`;
}

export const ACTIVITY_CATEGORY_TEXT: Record<AuditCategory, string> = {
  'sign-in': 'Sign-ins',
  members: 'People',
  security: 'Passwords & security',
  conversations: 'Conversations',
  integrations: 'Integrations',
  billing: 'Billing',
  organization: 'Organization',
  other: 'Other',
};

export const ROLE_TEXT = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  guest: 'Guest',
} as const;
