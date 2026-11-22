import {
  CHAT_THEMES,
  effectiveChatTheme,
  type ChatThemeId,
  type ChatThemePolicy,
} from '@sampledge/contracts';
import {
  CHAT_THEME_VISUALS,
  chatThemeStyle,
  parseHex,
  type ThemeColors,
} from '@sampledge/design-tokens';
import type { Palette } from '../theme/themes';

/**
 * Chat themes on the phone. Colors come from the same `chatThemeStyle` as the web, so contrast
 * rules hold; the scenes and patterns are drawn with react-native-svg from the same SVG art.
 */
export interface ChatLook {
  id: ChatThemeId;
  base: string;
  bubbleOwn: string;
  bubbleOwnFg: string;
  bubbleOther: string;
  /** A whole-area SVG (pattern or glow layers), or null. */
  fillXml: string | null;
  /** An office scene along the bottom, with its aspect ratio, or null. */
  scene: { xml: string; aspect: number } | null;
}

/** The design-token color names chatThemeStyle reads, from the phone's palette. */
export function tokenColors(p: Palette): ThemeColors {
  return {
    bg: p.background,
    bgGradientFrom: p.glow[0],
    bgGradientTo: p.glow[1],
    surface: p.surface,
    surfaceRaised: p.surfaceRaised,
    surfaceSunken: p.surfaceSunken,
    surfaceGlass: p.surface,
    border: p.border,
    borderStrong: p.border,
    text: p.text,
    textMuted: p.textMuted,
    textSubtle: p.textSubtle,
    accent: p.accent,
    accentHover: p.accent,
    accentFg: p.onAccent,
    accentSoft: p.accent,
    accent2: p.accentSecondary,
    accent2Soft: p.accentSecondary,
    ring: p.accent,
    success: p.success,
    warning: p.warning,
    danger: p.danger,
    info: p.accent,
    bubbleOwn: p.bubbleOwn,
    bubbleOwnFg: p.bubbleOwnText,
    bubbleOther: p.bubbleOther,
    shadowColor: '#000000',
  };
}

/** rgba() that react-native-svg reads (the web's CSS `rgb(r g b / a%)` form is not supported). */
export function rgba(hex: string, alpha: number): string {
  const { r, g, b } = parseHex(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

const inner = (svg: string) => svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const viewBox = (svg: string): [number, number] => {
  const m = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(svg);
  return m ? [Number(m[1]), Number(m[2])] : [1440, 420];
};
const NS = 'xmlns="http://www.w3.org/2000/svg"';

/** How a conversation looks with this chat theme over the given app theme. */
export function chatLook(id: ChatThemeId, p: Palette, dark: boolean): ChatLook {
  const s = chatThemeStyle(id, tokenColors(p), dark ? 'dark' : 'light');
  const v = CHAT_THEME_VISUALS[id] ?? CHAT_THEME_VISUALS.default!;
  const ink = rgba(p.text, dark ? 0.07 : 0.075);
  // Ids are per theme: on the web build every SVG shares one document, so equal ids collide.
  const layers: string[] = [];
  const defs: string[] = [];
  if (v.glow) {
    const a = rgba(v.glow, dark ? 0.16 : 0.08);
    const b = rgba(v.tint ?? v.glow, dark ? 0.14 : 0.07);
    defs.push(
      `<radialGradient id="g1-${id}" cx="85%" cy="0%" rx="60%" ry="60%" fx="85%" fy="0%"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${a}" stop-opacity="0"/></radialGradient>`,
      `<radialGradient id="g2-${id}" cx="10%" cy="100%" rx="55%" ry="55%" fx="10%" fy="100%"><stop offset="0" stop-color="${b}"/><stop offset="1" stop-color="${b}" stop-opacity="0"/></radialGradient>`,
    );
    layers.push(
      `<rect width="100%" height="100%" fill="url(#g1-${id})"/>`,
      `<rect width="100%" height="100%" fill="url(#g2-${id})"/>`,
    );
  }
  if (v.art?.kind === 'tile') {
    const [w, h] = v.art.size;
    defs.push(
      `<pattern id="p-${id}" width="${w}" height="${h}" patternUnits="userSpaceOnUse">${inner(v.art.svg(ink))}</pattern>`,
    );
    layers.push(`<rect width="100%" height="100%" fill="url(#p-${id})"/>`);
  }
  const fillXml = layers.length
    ? `<svg ${NS} width="100%" height="100%"><defs>${defs.join('')}</defs>${layers.join('')}</svg>`
    : null;
  let scene: ChatLook['scene'] = null;
  if (v.art?.kind === 'scene') {
    const xml = v.art.svg(ink);
    const [w, h] = viewBox(xml);
    scene = { xml, aspect: w / h };
  }
  return {
    id,
    base: s.base,
    bubbleOwn: s.bubbleOwn,
    bubbleOwnFg: s.bubbleOwnFg,
    bubbleOther: s.bubbleOther,
    fillXml,
    scene,
  };
}

export type ChatThemeEntry = (typeof CHAT_THEMES)[number];

export const CATEGORY_LABEL = {
  classic: 'Classic',
  office: 'Office scenes',
  pattern: 'Patterns',
  color: 'Colors',
} as const;

/** Themes grouped for the picker, with whether the organization lets you choose each. */
export function themeGroups(policy: ChatThemePolicy) {
  return (Object.keys(CATEGORY_LABEL) as (keyof typeof CATEGORY_LABEL)[]).map((cat) => ({
    category: cat,
    label: CATEGORY_LABEL[cat],
    themes: CHAT_THEMES.filter((t) => t.category === cat).map((t) => ({
      ...t,
      allowed: !policy.allowed || policy.allowed.includes(t.id) || t.id === policy.defaultThemeId,
    })),
  }));
}

/** What a tile saves (as on the web): tapping the default while following it keeps following. */
export function choiceFor(
  id: ChatThemeId,
  policy: ChatThemePolicy,
  current: ChatThemeId | null,
): ChatThemeId | null {
  return id === policy.defaultThemeId && current === null ? null : id;
}

export { effectiveChatTheme };
