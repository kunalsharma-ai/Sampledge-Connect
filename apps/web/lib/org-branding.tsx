'use client';
import * as React from 'react';
import { DEFAULT_APP_NAME, type BrandingView } from '@sampledge/contracts';
import { useTheme } from '@sampledge/ui';
import { apiRequest } from './api';
import { isNetworkSession, useAuth } from './auth';

interface OrgBrandingValue {
  branding: BrandingView | null;
  displayName: string;
  /** Members can't change the theme (the organization enforces its own). */
  themeLocked: boolean;
  refresh(): Promise<void>;
  /** After a save, use the saved settings at once. */
  replace(b: BrandingView): void;
}

const Ctx = React.createContext<OrgBrandingValue>({
  branding: null,
  displayName: DEFAULT_APP_NAME,
  themeLocked: false,
  refresh: async () => {},
  replace: () => {},
});
export const useOrgBranding = () => React.useContext(Ctx);

const cacheKey = (tenantId: string) => `sampledge.orgBranding.${tenantId}`;
const appliedKey = (tenantId: string) => `sampledge.orgBrandingApplied.${tenantId}`;
function read<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage blocked */
  }
}

/**
 * White-label for the signed-in organization: name, logo and theme. Cached on the device so
 * the brand shows offline and before the network answers.
 */
export function OrgBrandingProvider({ children }: { children: React.ReactNode }) {
  const { session, getAccessToken } = useAuth();
  const { setBrand, setTheme, themeId } = useTheme();
  const tenantId = session?.tenant.tenantId ?? '';
  const [branding, setBranding] = React.useState<BrandingView | null>(() =>
    tenantId ? read<BrandingView>(cacheKey(tenantId)) : null,
  );

  const replace = React.useCallback(
    (b: BrandingView) => {
      setBranding(b);
      if (tenantId) write(cacheKey(tenantId), b);
    },
    [tenantId],
  );
  const refresh = React.useCallback(async () => {
    // SampConnect Network is not an organization: it has no branding of its own.
    if (isNetworkSession(session)) return;
    try {
      replace(
        await apiRequest<BrandingView>('GET', '/v1/branding', { token: await getAccessToken() }),
      );
    } catch {
      /* offline: keep the cached brand */
    }
  }, [getAccessToken, replace, session]);
  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  // Apply the organization theme: always when enforced; once per change when offered.
  React.useEffect(() => {
    if (!branding || !tenantId) return;
    const brand = { primary: branding.primary, secondary: branding.secondary, mode: branding.mode };
    if (branding.enforceTheme) {
      setBrand(brand);
      if (themeId !== 'custom-brand') setTheme('custom-brand');
      return;
    }
    if (!branding.useBrandTheme) return;
    const stamp = `${branding.updatedAt}`;
    if (read<string>(appliedKey(tenantId)) === stamp) return;
    write(appliedKey(tenantId), stamp);
    setBrand(brand);
    setTheme('custom-brand');
  }, [branding, tenantId, themeId, setBrand, setTheme]);

  const displayName = branding?.displayName ?? DEFAULT_APP_NAME;
  React.useEffect(() => {
    document.title = displayName;
  }, [displayName]);

  const value = React.useMemo(
    () => ({ branding, displayName, themeLocked: !!branding?.enforceTheme, refresh, replace }),
    [branding, displayName, refresh, replace],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The organization's logo, or the product mark. Rendered as an image: SVG scripts never run. */
export function OrgLogo({
  className,
  fallback,
}: {
  className?: string;
  fallback: React.ReactNode;
}) {
  const { branding } = useOrgBranding();
  if (!branding?.logo) return <>{fallback}</>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={branding.logo} alt="" className={className} />;
}
