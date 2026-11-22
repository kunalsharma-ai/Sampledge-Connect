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
