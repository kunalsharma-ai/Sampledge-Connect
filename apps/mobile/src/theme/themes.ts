/**
 * Mobile theme tokens for the five Sampledge Connect themes.
 *
 * The brand values come straight from the product spec. Once the shared
 * @sampledge/design-tokens package lands, `BASE` should be read from it instead
 * so web and mobile cannot drift.
 */
export type ThemeId = 'midnight' | 'arctic' | 'graphite' | 'emerald' | 'custom';

export interface Palette {
  background: string;
  surface: string;
  surfaceRaised: string;
  surfaceSunken: string;
  border: string;
  accent: string;
  accentSecondary: string;
  onAccent: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  bubbleOwn: string;
  bubbleOwnText: string;
  bubbleOther: string;
  success: string;
  warning: string;
  danger: string;
  /** Gradient stops for hero surfaces. */
  glow: [string, string];
}

export interface Theme {
  id: ThemeId;
  name: string;
  dark: boolean;
  colors: Palette;
}

interface BaseSpec {
  name: string;
  dark: boolean;
  background: string;
  surface: string;
  accent: string;
  accentSecondary: string;
  text: string;
}

export const BASE: Record<Exclude<ThemeId, 'custom'>, BaseSpec> = {
  midnight: {
    name: 'Midnight Executive',
    dark: true,
    background: '#080F1F',
    surface: '#111C30',
    accent: '#5B8CFF',
    accentSecondary: '#8B5CF6',
    text: '#F8FAFC',
  },
  arctic: {
    name: 'Arctic Professional',
    dark: false,
    background: '#F6F8FC',
    surface: '#FFFFFF',
    accent: '#2563EB',
    accentSecondary: '#0D9488',
    text: '#0F172A',
  },
  graphite: {
    name: 'Royal Graphite',
    dark: true,
    background: '#121318',
    surface: '#1D2029',
    accent: '#9B8CFF',
    accentSecondary: '#D4B483',
    text: '#F5F5F7',
  },
  emerald: {
    name: 'Emerald Enterprise',
    dark: true,
    background: '#071C1A',
    surface: '#10302B',
    accent: '#34D399',
    accentSecondary: '#5EEAD4',
    text: '#ECFDF5',
  },
};

// ---------------------------------------------------------------- colour maths

function parse(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b]
    .map((v) =>
      Math.round(Math.min(255, Math.max(0, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`.toUpperCase();
}

/** Linear mix of two colours; t=0 gives a, t=1 gives b. */
export function mix(a: string, b: string, t: number): string {
  const x = parse(a);
  const y = parse(b);
  return toHex([0, 1, 2].map((i) => x[i]! + (y[i]! - x[i]!) * t) as [number, number, number]);
}

export function alpha(hex: string, a: number): string {
  return `${toHex(parse(hex))}${Math.round(a * 255)
    .toString(16)
    .padStart(2, '0')}`;
}

function luminance(hex: string): number {
  const [r, g, b] = parse(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Picks near-black or white, whichever reads better on `bg`. */
export function readableOn(bg: string): string {
  return contrast(bg, '#FFFFFF') >= contrast(bg, '#0B1020') ? '#FFFFFF' : '#0B1020';
}

/** Darkens/lightens `fg` toward the text colour until it reaches `min` contrast on `bg`. */
function ensureContrast(fg: string, bg: string, min: number, toward: string): string {
  let c = fg;
  for (let i = 1; i <= 10 && contrast(c, bg) < min; i++) c = mix(fg, toward, i / 10);
  return c;
}

export function buildTheme(id: ThemeId, spec: BaseSpec): Theme {
  const { background: bg, surface, text, accent, accentSecondary, dark } = spec;
  const ownBubble = accent;
  return {
    id,
    name: spec.name,
    dark,
    colors: {
      background: bg,
      surface,
      surfaceRaised: dark ? mix(surface, '#FFFFFF', 0.06) : '#FFFFFF',
      surfaceSunken: dark ? mix(bg, surface, 0.5) : mix(bg, '#0F172A', 0.03),
      border: dark ? alpha('#FFFFFF', 0.08) : alpha('#0F172A', 0.08),
      accent,
      accentSecondary,
      onAccent: readableOn(accent),
      text,
      textMuted: ensureContrast(mix(text, bg, 0.35), bg, 4.5, text),
      textSubtle: ensureContrast(mix(text, bg, 0.55), bg, 3, text),
      bubbleOwn: ownBubble,
      bubbleOwnText: readableOn(ownBubble),
      bubbleOther: dark ? mix(surface, '#FFFFFF', 0.05) : '#FFFFFF',
      success: dark ? '#4ADE80' : '#15803D',
      warning: dark ? '#FBBF24' : '#B45309',
      danger: dark ? '#F87171' : '#B91C1C',
      glow: [alpha(accent, dark ? 0.28 : 0.16), alpha(accentSecondary, dark ? 0.18 : 0.1)],
    },
  };
}

export interface CustomBrand {
  primary: string;
  secondary: string;
  dark: boolean;
  workspaceName?: string;
}

/** Theme 5: organisation-controlled colours with light and dark variants derived from them. */
export function customTheme(brand: CustomBrand): Theme {
  const valid = (c: string) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c);
  const primary = valid(brand.primary) ? brand.primary : BASE.midnight.accent;
  const secondary = valid(brand.secondary) ? brand.secondary : BASE.midnight.accentSecondary;
  const background = brand.dark ? mix('#070A12', primary, 0.06) : mix('#F7F8FB', primary, 0.03);
  const surface = brand.dark ? mix('#111522', primary, 0.08) : '#FFFFFF';
  const text = brand.dark ? '#F8FAFC' : '#0F172A';
  return buildTheme('custom', {
    name: brand.workspaceName ? `${brand.workspaceName} brand` : 'Custom brand',
    dark: brand.dark,
    background,
    surface,
    accent: ensureContrast(primary, surface, 3, text),
    accentSecondary: secondary,
    text,
  });
}

export const THEMES: Record<Exclude<ThemeId, 'custom'>, Theme> = {
  midnight: buildTheme('midnight', BASE.midnight),
  arctic: buildTheme('arctic', BASE.arctic),
  graphite: buildTheme('graphite', BASE.graphite),
  emerald: buildTheme('emerald', BASE.emerald),
};

// ---------------------------------------------------------------- scale

export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const radius = { sm: 8, md: 12, lg: 18, xl: 24, pill: 999 } as const;

export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

/** Typography scale: headings, labels, message body and metadata are visually distinct. */
export const type = {
  display: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 36, letterSpacing: -0.6 },
  title: { fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28, letterSpacing: -0.3 },
  heading: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22, letterSpacing: -0.2 },
  body: { fontFamily: fonts.regular, fontSize: 15.5, lineHeight: 22 },
  bodyStrong: { fontFamily: fonts.medium, fontSize: 15.5, lineHeight: 22 },
  label: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, letterSpacing: 0.1 },
  meta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  overline: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const,
  },
} as const;

/** Motion timings (ms). Everything collapses to 0 when the OS asks for reduced motion. */
export const motion = { fast: 150, base: 200, slow: 250 } as const;
