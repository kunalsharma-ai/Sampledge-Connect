import type { BrandingView, PublicBranding } from '@sampledge/contracts';

/** What the phone keeps of the organization's branding (kept across restarts, works offline). */
export interface OrgBranding {
  displayName: string;
  organizationName: string;
  logo: string | null;
  primary: string;
  secondary: string;
  dark: boolean;
  /** Members start on the organization theme until they pick another. */
  useBrandTheme: boolean;
  /** Members always see the organization theme. */
  enforceTheme: boolean;
}

export function orgBrandingFrom(v: BrandingView | PublicBranding): OrgBranding {
  return {
    displayName: v.displayName,
    organizationName: v.organizationName,
    logo: v.logo,
    primary: v.primary,
    secondary: v.secondary,
    dark: v.mode === 'dark',
    useBrandTheme: 'useBrandTheme' in v ? v.useBrandTheme : false,
    enforceTheme: 'enforceTheme' in v ? v.enforceTheme : false,
  };
}

export type ThemeSource = 'org' | 'own';

/**
 * Whose theme to show. Enforced branding always wins; "start on the organization theme" applies
 * until the person picks a theme themselves; choosing "Organization" picks it explicitly.
 */
export function themeSource(
  org: OrgBranding | null,
  preference: string,
  chosenByPerson: boolean,
): ThemeSource {
  if (!org) return 'own';
  if (org.enforceTheme || preference === 'org') return 'org';
  if (org.useBrandTheme && !chosenByPerson) return 'org';
  return 'own';
}
