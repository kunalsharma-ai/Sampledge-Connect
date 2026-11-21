import Storage from 'expo-sqlite/kv-store';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { customTheme, motion, THEMES, type CustomBrand, type Theme, type ThemeId } from './themes';

/** 'system' follows the OS: Midnight Executive in dark mode, Arctic Professional in light mode. */
export type ThemePreference = ThemeId | 'system';

interface ThemeContextValue {
  theme: Theme;
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
  brand: CustomBrand;
  setBrand: (b: CustomBrand) => void;
  /** Durations to use for animations; all 0 when reduced motion is on. */
  motion: { fast: number; base: number; slow: number };
  reducedMotion: boolean;
}

const PREF_KEY = 'theme.preference';
const BRAND_KEY = 'theme.brand';
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

  const setPreference = useCallback((p: ThemePreference) => {
    setPref(p);
    Storage.setItemSync(PREF_KEY, JSON.stringify(p));
  }, []);
  const setBrand = useCallback((b: CustomBrand) => {
    setBrandState(b);
    Storage.setItemSync(BRAND_KEY, JSON.stringify(b));
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const theme =
      preference === 'custom'
        ? customTheme(brand)
        : preference === 'system'
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
      reducedMotion,
      motion: reducedMotion ? { fast: 0, base: 0, slow: 0 } : motion,
    };
  }, [preference, brand, scheme, reducedMotion, setPreference, setBrand]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
