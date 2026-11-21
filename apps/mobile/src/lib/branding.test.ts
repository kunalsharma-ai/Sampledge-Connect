import { describe, expect, it } from 'vitest';
import { orgBrandingFrom, themeSource, type OrgBranding } from './branding';

const org = (over: Partial<OrgBranding> = {}): OrgBranding => ({
  displayName: 'Northwind Connect',
  organizationName: 'Northwind',
  logo: null,
  primary: '#0EA5E9',
  secondary: '#F59E0B',
  dark: true,
  useBrandTheme: false,
  enforceTheme: false,
  ...over,
});

describe('organization branding', () => {
  it('picks whose theme to show', () => {
    expect(themeSource(null, 'org', true)).toBe('own');
    expect(themeSource(org(), 'system', false)).toBe('own');
    expect(themeSource(org(), 'org', true)).toBe('org');
    expect(themeSource(org({ useBrandTheme: true }), 'system', false)).toBe('org');
    expect(themeSource(org({ useBrandTheme: true }), 'arctic', true)).toBe('own');
    expect(themeSource(org({ enforceTheme: true }), 'arctic', true)).toBe('org');
  });

  it('reads the sign-in branding without theme rules', () => {
    const b = orgBrandingFrom({
      organizationName: 'Northwind',
      displayName: 'Northwind Connect',
      logo: null,
      primary: '#0EA5E9',
      secondary: '#F59E0B',
      mode: 'light',
      loginMessage: null,
      hidePoweredBy: false,
    });
    expect(b.dark).toBe(false);
    expect(b.enforceTheme).toBe(false);
  });
});
