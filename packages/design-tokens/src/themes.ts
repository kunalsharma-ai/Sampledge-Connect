import { ensureContrast, mix, pickForeground, withAlpha } from './color.js';

export const THEME_IDS = [
  'midnight-executive',
  'arctic-professional',
  'royal-graphite',
  'emerald-enterprise',
  'custom-brand',
] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export type BuiltInThemeId = Exclude<ThemeId, 'custom-brand'>;
export const DEFAULT_THEME: BuiltInThemeId = 'midnight-executive';
export const DEFAULT_LIGHT_THEME: BuiltInThemeId = 'arctic-professional';

/**
 * Semantic color roles. Components only use these names, never raw hex,
 * so every theme (including organization brand themes) restyles the whole app.
 */
export interface ThemeColors {
  bg: string;
  /** Subtle vignette used behind the workspace. */
  bgGradientFrom: string;
  bgGradientTo: string;
  surface: string;
  surfaceRaised: string;
  surfaceSunken: string;
  /** Translucent surface for glass panels (used with backdrop-filter). */
  surfaceGlass: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  accent: string;
  accentHover: string;
  accentFg: string;
  accentSoft: string;
  accent2: string;
  accent2Soft: string;
  ring: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  /** Own-message bubble. */
  bubbleOwn: string;
  bubbleOwnFg: string;
  bubbleOther: string;
  shadowColor: string;
}

export interface Theme {
  id: ThemeId;
  name: string;
  description: string;
  mode: 'dark' | 'light';
  colors: ThemeColors;
}

export interface ThemeSeed {
  bg: string;
  surface: string;
  accent: string;
  accent2: string;
  text: string;
}

function buildColors(seed: ThemeSeed, mode: 'dark' | 'light'): ThemeColors {
  const dark = mode === 'dark';
  const { bg, surface, accent, accent2, text } = seed;
  const accentFg = pickForeground(accent, '#FFFFFF', dark ? bg : text);
  const ownFg = accentFg;
  return {
    bg,
    bgGradientFrom: dark ? mix(bg, accent, 0.1) : mix(bg, accent, 0.05),
    bgGradientTo: dark ? mix(bg, accent2, 0.08) : mix(bg, accent2, 0.04),
    surface,
    surfaceRaised: dark ? mix(surface, text, 0.05) : '#FFFFFF',
    surfaceSunken: dark ? mix(surface, bg, 0.55) : mix(bg, text, 0.025),
    surfaceGlass: withAlpha(surface, dark ? 0.72 : 0.78),
    border: dark ? mix(surface, text, 0.1) : mix(bg, text, 0.09),
    borderStrong: dark ? mix(surface, text, 0.2) : mix(bg, text, 0.18),
    text,
    textMuted: mix(text, surface, dark ? 0.3 : 0.28),
    textSubtle: mix(text, surface, dark ? 0.45 : 0.42),
    accent,
    accentHover: dark ? mix(accent, '#FFFFFF', 0.12) : mix(accent, '#000000', 0.12),
    accentFg,
    accentSoft: withAlpha(accent, dark ? 0.16 : 0.1),
    accent2,
    accent2Soft: withAlpha(accent2, dark ? 0.16 : 0.1),
    ring: withAlpha(accent, 0.55),
    success: dark ? '#34D399' : '#047857',
    warning: dark ? '#FBBF24' : '#B45309',
    danger: dark ? '#F87171' : '#B91C1C',
    info: dark ? '#60A5FA' : '#1D4ED8',
    bubbleOwn: accent,
    bubbleOwnFg: ownFg,
    bubbleOther: dark ? mix(surface, text, 0.06) : mix(bg, text, 0.04),
    shadowColor: dark ? '#000000' : mix(text, accent, 0.2),
  };
}

export const THEME_SEEDS: Record<Exclude<ThemeId, 'custom-brand'>, ThemeSeed> = {
  'midnight-executive': {
    bg: '#080F1F',
    surface: '#111C30',
    accent: '#5B8CFF',
    accent2: '#8B5CF6',
    text: '#F8FAFC',
  },
  'arctic-professional': {
    bg: '#F6F8FC',
    surface: '#FFFFFF',
    accent: '#2563EB',
    accent2: '#0D9488',
    text: '#0F172A',
  },
  'royal-graphite': {
    bg: '#121318',
    surface: '#1D2029',
    accent: '#9B8CFF',
    accent2: '#D4B483',
    text: '#F5F5F7',
  },
  'emerald-enterprise': {
    bg: '#071C1A',
    surface: '#10302B',
    accent: '#34D399',
    accent2: '#5EEAD4',
    text: '#ECFDF5',
  },
};

export const THEMES: Record<Exclude<ThemeId, 'custom-brand'>, Theme> = {
  'midnight-executive': {
    id: 'midnight-executive',
    name: 'Midnight Executive',
    description: 'Premium dark workspace. Default.',
    mode: 'dark',
    colors: buildColors(THEME_SEEDS['midnight-executive'], 'dark'),
  },
  'arctic-professional': {
    id: 'arctic-professional',
    name: 'Arctic Professional',
    description: 'Clean business workspace. Default light theme.',
    mode: 'light',
    colors: buildColors(THEME_SEEDS['arctic-professional'], 'light'),
  },
  'royal-graphite': {
    id: 'royal-graphite',
    name: 'Royal Graphite',
    description: 'Graphite surfaces with violet and champagne accents.',
    mode: 'dark',
    colors: buildColors(THEME_SEEDS['royal-graphite'], 'dark'),
  },
  'emerald-enterprise': {
    id: 'emerald-enterprise',
    name: 'Emerald Enterprise',
    description: 'Deep green workspace with emerald accents.',
    mode: 'dark',
    colors: buildColors(THEME_SEEDS['emerald-enterprise'], 'dark'),
  },
};

export interface BrandThemeInput {
  primary: string;
  secondary: string;
  mode: 'dark' | 'light';
  /** Shown in the workspace switcher. Stored per tenant (white-label). */
  logoUrl?: string;
  workspaceName?: string;
}

/**
 * Theme 5: organization-controlled brand theme. Neutral surfaces are tinted
 * slightly toward the brand primary, and brand colors are nudged until they
 * meet WCAG 1.4.11 (3:1 for UI components) against the surface.
 */
export function createBrandTheme(input: BrandThemeInput): Theme {
  const dark = input.mode === 'dark';
  const bg = dark ? mix('#0B0E14', input.primary, 0.06) : mix('#F7F8FA', input.primary, 0.025);
  const surface = dark ? mix('#151922', input.primary, 0.07) : '#FFFFFF';
  const text = dark ? '#F5F7FA' : '#0F172A';
  const toward = dark ? '#FFFFFF' : '#000000';
  const accent = ensureContrast(input.primary, surface, 3, toward);
  const accent2 = ensureContrast(input.secondary, surface, 3, toward);
  return {
    id: 'custom-brand',
    name: input.workspaceName ? `${input.workspaceName} brand` : 'Custom Brand',
    description: 'Organization brand colors.',
    mode: input.mode,
    colors: buildColors({ bg, surface, accent, accent2, text }, input.mode),
  };
}

export function getTheme(id: ThemeId, brand?: BrandThemeInput): Theme {
  if (id === 'custom-brand') {
    return createBrandTheme(brand ?? { primary: '#5B8CFF', secondary: '#8B5CF6', mode: 'dark' });
  }
  return THEMES[id];
}

const kebab = (s: string) => s.replace(/[A-Z0-9]/g, (m) => `-${m.toLowerCase()}`);

/** CSS custom properties for a theme, e.g. { '--sc-color-bg': '#080F1F', ... }. */
export function themeToCssVars(theme: Theme): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(theme.colors)) out[`--sc-color-${kebab(k)}`] = v;
  return out;
}
