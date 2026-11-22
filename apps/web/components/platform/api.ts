'use client';
import * as React from 'react';
import {
  uuidv7,
  type PlatformAssignPlanRequest,
  type BillingPlan,
  type CreatePlatformOrgRequest,
  type PlatformAccount,
  type PlatformAdmin,
  type PlatformAuditPage,
  type PlatformAuditQuery,
  type PlatformChangedEvent,
  type PlatformMe,
  type PlatformOrg,
  type PlatformOrgDetail,
  type PlatformOrgPage,
  type PlatformOrgQuery,
  type PlatformOverview,
  type PlatformRole,
  type PlatformSupportView,
  type Subscription,
  type ActivityRetention,
  type ForcedPasswordReset,
  type PlatformActivityPage,
  type PlatformActivityQuery,
  type PlatformOrgPermissions,
  type PlatformPermissionDefaults,
  type TenantPermissionPolicy,
} from '@sampledge/contracts';
import { ApiFailure, apiRequest } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { useAuth } from '@/lib/auth';
import { useEngineChange } from '@/lib/engine';

export const errorText = (e: unknown) =>
  e instanceof ApiFailure ? e.error.message : (e as Error).message;

const qs = (q: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q))
    if (v !== undefined && v !== '' && v !== null) p.set(k, String(v));
  return p.toString();
};

/** The super admin console API (docs/super-admin.md). */
export function usePlatformApi() {
  const { getAccessToken } = useAuth();
  return React.useMemo(() => {
    const req = async <T>(method: string, path: string, body?: unknown) =>
      apiRequest<T>(method, path, { token: await getAccessToken(), body });
    const o = (id: string) => `/v1/platform/orgs/${encodeURIComponent(id)}`;
    return {
      me: () => req<PlatformMe>('GET', '/v1/platform/me'),
      overview: () => req<PlatformOverview>('GET', '/v1/platform/overview'),
      orgs: (q: PlatformOrgQuery) => req<PlatformOrgPage>('GET', `/v1/platform/orgs?${qs(q)}`),
      org: (id: string) => req<PlatformOrgDetail>('GET', o(id)),
      support: (id: string) => req<PlatformSupportView>('GET', `${o(id)}/support`),
      create: (body: CreatePlatformOrgRequest) =>
        req<PlatformOrg>('POST', '/v1/platform/orgs', body),
      rename: (id: string, name: string) => req<PlatformOrg>('PATCH', o(id), { name }),
      suspend: (id: string, reason: string) =>
        req<PlatformOrg>('POST', `${o(id)}/suspend`, { clientActionId: uuidv7(), reason }),
      reactivate: (id: string) => req<PlatformOrg>('POST', `${o(id)}/reactivate`),
      scheduleDeletion: (id: string, confirmSlug: string) =>
        req<PlatformOrg>('POST', `${o(id)}/deletion`, { clientActionId: uuidv7(), confirmSlug }),
      cancelDeletion: (id: string) => req<PlatformOrg>('DELETE', `${o(id)}/deletion`),
      assignPlan: (id: string, body: PlatformAssignPlanRequest) =>
        req<Subscription>('PUT', `${o(id)}/plan`, body),
      plans: () => req<BillingPlan[]>('GET', '/v1/platform/billing/plans'),
      admins: () => req<PlatformAdmin[]>('GET', '/v1/platform/admins'),
      accounts: (q: string) =>
        req<PlatformAccount[]>('GET', `/v1/platform/accounts?q=${encodeURIComponent(q)}`),
      addAdmin: (a: { tenantId: string; userId: string; role: PlatformRole }) =>
        req<PlatformAdmin>('POST', '/v1/platform/admins', a),
      setRole: (adminId: string, role: PlatformRole) =>
        req<PlatformAdmin>('PATCH', `/v1/platform/admins/${adminId}`, { role }),
      removeAdmin: (adminId: string) => req('DELETE', `/v1/platform/admins/${adminId}`),
      audit: (q: PlatformAuditQuery) =>
        req<PlatformAuditPage>('GET', `/v1/platform/audit?${qs(q)}`),
      permissions: () => req<PlatformPermissionDefaults>('GET', '/v1/platform/permissions'),
      setPermissions: (policy: TenantPermissionPolicy | null) =>
        req<PlatformPermissionDefaults>('PUT', '/v1/platform/permissions', { policy }),
      orgPermissions: (id: string) => req<PlatformOrgPermissions>('GET', `${o(id)}/permissions`),
      setOrgPermissions: (id: string, policy: TenantPermissionPolicy | null) =>
        req<PlatformOrgPermissions>('PUT', `${o(id)}/permissions`, { policy }),
      forcePasswordReset: (id: string, userId: string) =>
        req<ForcedPasswordReset>(
          'POST',
          `${o(id)}/people/${encodeURIComponent(userId)}/password-reset`,
        ),
      activity: (q: PlatformActivityQuery) =>
        req<PlatformActivityPage>('GET', `/v1/platform/activity?${qs(q)}`),
      retention: () => req<ActivityRetention>('GET', '/v1/platform/activity/retention'),
      setRetention: (days: number | null) =>
        req<ActivityRetention>('PUT', '/v1/platform/activity/retention', { days }),
      exportActivity: async (q: PlatformActivityQuery) => {
        const res = await fetch(`${API_URL}/v1/platform/activity/export?${qs(q)}`, {
          headers: { authorization: `Bearer ${await getAccessToken()}` },
        });
        if (!res.ok) throw new Error(`Export failed (HTTP ${res.status})`);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(await res.blob());
        a.download =
          /filename="?([^";]+)/.exec(res.headers.get('content-disposition') ?? '')?.[1] ??
          'sampconnect-activity.csv';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      },
    };
  }, [getAccessToken]);
}
export type PlatformApi = ReturnType<typeof usePlatformApi>;

/**
 * Refetch when another platform admin (or you, on another device) changes this area of the
 * console, and after a reconnect.
 */
export function usePlatformChange(
  areas: PlatformChangedEvent['area'][],
  fn: (tenantId?: string) => void,
) {
  useEngineChange(['platform'], (e) => {
    if (e.type === 'reconnected') fn();
    else if (e.type === 'platform' && areas.includes(e.area)) fn(e.tenantId);
  });
}

/** Your platform role, or null. Kept live: being added or removed shows or hides the console. */
export function usePlatformRole(enabled: boolean): PlatformMe | null {
  const api = usePlatformApi();
  const [me, setMe] = React.useState<PlatformMe | null>(null);
  const load = React.useCallback(() => {
    if (!enabled) return setMe(null);
    api
      .me()
      .then(setMe)
      .catch((e: unknown) => {
        if (e instanceof ApiFailure && (e.status === 403 || e.status === 401)) setMe(null);
      });
  }, [api, enabled]);
  React.useEffect(load, [load]);
  usePlatformChange(['me'], load);
  return me;
}
