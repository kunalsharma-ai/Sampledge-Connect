'use client';
import * as React from 'react';
import {
  DEFAULT_THEME,
  THEME_IDS,
  getTheme,
  themeToCssVars,
  type BrandThemeInput,
  type Theme,
  type ThemeId,
} from '@sampledge/design-tokens';

export const THEME_STORAGE_KEY = 'sampledge.theme';
export const BRAND_STORAGE_KEY = 'sampledge.brand';

interface ThemeContextValue {
  themeId: ThemeId;
  theme: Theme;
  setTheme: (id: ThemeId) => void;
  /** Organization brand (white-label). Set by the tenant's branding settings. */
  brand: BrandThemeInput | null;
  setBrand: (brand: BrandThemeInput | null) => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}

function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && (THEME_IDS as readonly string[]).includes(v);
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode); preference lasts for this session only */
  }
}

/**
 * Inline this in <head> (before paint) so the persisted theme applies without a flash.
 * Kept tiny and dependency-free on purpose.
 */
export const themeInitScript = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');var ok=${JSON.stringify(THEME_IDS)};if(ok.indexOf(t)<0)t='${DEFAULT_THEME}';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

function applyToDocument(theme: Theme) {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme.id);
  root.style.colorScheme = theme.mode;
  const vars = themeToCssVars(theme);
  // Built-in themes come from the stylesheet; only brand themes need inline vars.
  for (const k of Object.keys(vars)) root.style.removeProperty(k);
  if (theme.id === 'custom-brand')
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}

export function ThemeProvider({
  children,
  defaultTheme = DEFAULT_THEME,
}: {
  children: React.ReactNode;
  defaultTheme?: ThemeId;
}) {
  const [themeId, setThemeId] = React.useState<ThemeId>(defaultTheme);
  const [brand, setBrandState] = React.useState<BrandThemeInput | null>(null);
  const first = React.useRef(true);

  React.useEffect(() => {
    const stored = safeGet(THEME_STORAGE_KEY);
    if (isThemeId(stored)) setThemeId(stored);
    const b = safeGet(BRAND_STORAGE_KEY);
    if (b) {
      try {
        setBrandState(JSON.parse(b) as BrandThemeInput);
      } catch {
        safeSet(BRAND_STORAGE_KEY, null);
      }
    }
  }, []);

  const theme = React.useMemo(() => getTheme(themeId, brand ?? undefined), [themeId, brand]);

  React.useEffect(() => {
    const root = document.documentElement;
    if (!first.current) {
      // Smooth color crossfade on theme change (disabled under reduced motion via CSS).
      root.classList.add('sc-theme-transition');
      const t = setTimeout(() => root.classList.remove('sc-theme-transition'), 300);
      applyToDocument(theme);
      return () => clearTimeout(t);
    }
    first.current = false;
    applyToDocument(theme);
  }, [theme]);

  const setTheme = React.useCallback((id: ThemeId) => {
    setThemeId(id);
    safeSet(THEME_STORAGE_KEY, id);
  }, []);
  const setBrand = React.useCallback((b: BrandThemeInput | null) => {
    setBrandState(b);
    safeSet(BRAND_STORAGE_KEY, b ? JSON.stringify(b) : null);
  }, []);

  const value = React.useMemo(
    () => ({ themeId, theme, setTheme, brand, setBrand }),
    [themeId, theme, setTheme, brand, setBrand],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
