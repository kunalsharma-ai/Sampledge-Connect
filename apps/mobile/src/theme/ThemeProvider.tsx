import Storage from 'expo-sqlite/kv-store';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { themeSource, type OrgBranding } from '../lib/branding';
import { customTheme, motion, THEMES, type CustomBrand, type Theme, type ThemeId } from './themes';

/**
 * 'system' follows the OS: Midnight Executive in dark mode, Arctic Professional in light mode.
 * 'org' is the organization's branded theme (from the server).
 */
export type ThemePreference = ThemeId | 'system' | 'org';

interface ThemeContextValue {
  theme: Theme;
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
  brand: CustomBrand;
  setBrand: (b: CustomBrand) => void;
  /** The organization's branding from the server, or null when it has none (or signed out). */
  org: OrgBranding | null;
  setOrg: (b: OrgBranding | null) => void;
  /** True when the organization's theme is showing because of its settings or your choice. */
  orgThemeActive: boolean;
  /** Durations to use for animations; all 0 when reduced motion is on. */
  motion: { fast: number; base: number; slow: number };
  reducedMotion: boolean;
}

const PREF_KEY = 'theme.preference';
const BRAND_KEY = 'theme.brand';
const ORG_KEY = 'theme.org';
const DEFAULT_BRAND: CustomBrand = { primary: '#5B8CFF', secondary: '#8B5CF6', dark: true };

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = Storage.getItemSync(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Theme choice is a device preference kept outside the account cache, so it survives sign-out. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  const reducedMotion = useReducedMotion();
  const [preference, setPref] = useState<ThemePreference>(() =>
    readJson<ThemePreference>(PREF_KEY, 'system'),
  );
  const [brand, setBrandState] = useState<CustomBrand>(() => readJson(BRAND_KEY, DEFAULT_BRAND));
  const [org, setOrgState] = useState<OrgBranding | null>(() =>
    readJson<OrgBranding | null>(ORG_KEY, null),
  );
  const [chosen, setChosen] = useState(() => {
    try {
      return Storage.getItemSync(PREF_KEY) !== null;
    } catch {
      return false;
    }
  });

  const setPreference = useCallback((p: ThemePreference) => {
    setPref(p);
    setChosen(true);
    Storage.setItemSync(PREF_KEY, JSON.stringify(p));
  }, []);
  const setOrg = useCallback((b: OrgBranding | null) => {
    setOrgState(b);
    if (b) Storage.setItemSync(ORG_KEY, JSON.stringify(b));
    else Storage.removeItemSync(ORG_KEY);
  }, []);
  const setBrand = useCallback((b: CustomBrand) => {
    setBrandState(b);
    Storage.setItemSync(BRAND_KEY, JSON.stringify(b));
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const source = themeSource(org, preference, chosen);
    const theme =
      source === 'org' && org
        ? customTheme({
            primary: org.primary,
            secondary: org.secondary,
            dark: org.dark,
            workspaceName: org.organizationName,
          })
        : preference === 'custom'
          ? customTheme(brand)
          : preference === 'system'
            ? scheme === 'light'
              ? THEMES.arctic
              : THEMES.midnight
            : preference === 'org'
              ? scheme === 'light'
                ? THEMES.arctic
                : THEMES.midnight
              : THEMES[preference];
    return {
      theme,
      preference,
      setPreference,
      brand,
      setBrand,
      org,
      setOrg,
      orgThemeActive: source === 'org',
      reducedMotion,
      motion: reducedMotion ? { fast: 0, base: 0, slow: 0 } : motion,
    };
  }, [preference, brand, org, chosen, scheme, reducedMotion, setPreference, setBrand, setOrg]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
