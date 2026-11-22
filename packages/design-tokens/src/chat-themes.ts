import { contrastRatio, ensureContrast, mix, pickForeground, withAlpha } from './color.js';
import type { ThemeColors } from './themes.js';

/**
 * Visuals for the chat themes listed in @sampledge/contracts (`CHAT_THEMES`). Each one tints the
 * conversation background, recolors your own bubbles and may add line art: a repeating pattern
 * or an office scene along the bottom. All art is drawn in the app theme's text color at low
 * opacity, so it works in light and dark themes and never competes with messages.
 */
export interface ChatThemeVisual {
  /** Own-bubble color in light and dark app themes. null = the app theme's accent. */
  bubble: { light: string; dark: string } | null;
  /** Background tint mixed into the app background. null = untinted. */
  tint: string | null;
  /** Second tint for a soft glow (color themes). */
  glow?: string;
  art?:
    | { kind: 'tile'; size: [number, number]; svg: (c: string) => string }
    | { kind: 'scene'; svg: (c: string) => string };
}

const svg = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

/** Deterministic pseudo-random numbers, so scenes look the same everywhere. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function skyline(c: string, seed: number, h = 420) {
  const r = rng(seed);
  let x = 0;
  let out = '';
  while (x < 1440) {
    const w = 50 + Math.round(r() * 90);
    const bh = 120 + Math.round(r() * 260);
    out += `<rect x="${x}" y="${h - bh}" width="${w - 6}" height="${bh}" fill="${c}"/>`;
    for (let wy = h - bh + 14; wy < h - 16; wy += 22)
      for (let wx = x + 8; wx < x + w - 16; wx += 16)
        if (r() > 0.45)
          out += `<rect x="${wx}" y="${wy}" width="6" height="9" fill="${c}" opacity="0.9"/>`;
    x += w;
  }
  return out;
}

const SCENES = {
  skyline: (c: string) => svg(1440, 420, `<g opacity="0.9">${skyline(c, 7)}</g>`),
  corner: (c: string) =>
    svg(
      1440,
      480,
      `<g>${skyline(c, 31, 480)}</g>` +
        // Window mullions over the skyline.
        [0, 360, 720, 1080, 1440]
          .map((x) => `<rect x="${x - 6}" y="0" width="12" height="480" fill="${c}"/>`)
          .join('') +
        `<rect x="0" y="0" width="1440" height="10" fill="${c}"/>`,
    ),
  boardroom: (c: string) =>
    svg(
      1440,
      460,
      // Tall windows.
      [80, 300, 520, 740, 960, 1180]
        .map(
          (x) =>
            `<rect x="${x}" y="20" width="180" height="300" fill="none" stroke="${c}" stroke-width="6"/>` +
            `<line x1="${x + 90}" y1="20" x2="${x + 90}" y2="320" stroke="${c}" stroke-width="4"/>`,
        )
        .join('') +
        // Table and chairs.
        `<path d="M260 400 L1180 400 L1100 350 L340 350 Z" fill="${c}"/>` +
        [380, 500, 620, 740, 860, 980]
          .map(
            (x) =>
              `<rect x="${x}" y="300" width="56" height="48" rx="10" fill="${c}"/>` +
              `<rect x="${x + 6}" y="410" width="44" height="40" rx="8" fill="${c}"/>`,
          )
          .join(''),
    ),
  library: (c: string) => {
    const r = rng(11);
    let body = '';
    for (let shelf = 0; shelf < 4; shelf++) {
      const y = 40 + shelf * 110;
      body += `<rect x="0" y="${y + 96}" width="1440" height="8" fill="${c}"/>`;
      let x = 10;
      while (x < 1430) {
        const w = 14 + Math.round(r() * 18);
        const h = 60 + Math.round(r() * 34);
        if (r() > 0.08)
          body += `<rect x="${x}" y="${y + 96 - h}" width="${w}" height="${h}" rx="2" fill="${c}" opacity="${(0.55 + r() * 0.45).toFixed(2)}"/>`;
        x += w + 3;
      }
    }
    return svg(1440, 480, body);
  },
  studio: (c: string) =>
    svg(
      1440,
      360,
      [60, 420, 780, 1140]
        .map(
          (x) =>
            // Desk, monitor, lamp, plant.
            `<rect x="${x}" y="250" width="260" height="12" fill="${c}"/>` +
            `<rect x="${x + 16}" y="262" width="8" height="90" fill="${c}"/>` +
            `<rect x="${x + 236}" y="262" width="8" height="90" fill="${c}"/>` +
            `<rect x="${x + 70}" y="160" width="120" height="78" rx="6" fill="none" stroke="${c}" stroke-width="6"/>` +
            `<rect x="${x + 124}" y="238" width="12" height="12" fill="${c}"/>` +
            `<path d="M${x + 222} 250 L${x + 222} 170 L${x + 200} 150" stroke="${c}" stroke-width="5" fill="none"/>` +
            `<path d="M${x + 186} 140 h34 l-8 16 h-18 z" fill="${c}"/>` +
            `<circle cx="${x + 30}" cy="226" r="14" fill="${c}"/><circle cx="${x + 42}" cy="212" r="11" fill="${c}"/><rect x="${x + 24}" y="236" width="22" height="14" fill="${c}"/>`,
        )
        .join(''),
    ),
};

const TILES = {
  blueprint: (c: string) =>
    svg(
      48,
      48,
      `<path d="M48 0H0V48" fill="none" stroke="${c}" stroke-width="1.5"/>` +
        `<path d="M24 0V48M0 24H48" fill="none" stroke="${c}" stroke-width="0.75" opacity="0.6"/>`,
    ),
  linen: (c: string) =>
    svg(
      10,
      10,
      `<path d="M0 10L10 0M-2.5 2.5L2.5-2.5M7.5 12.5L12.5 7.5" stroke="${c}" stroke-width="0.8"/>` +
        `<path d="M0 0L10 10" stroke="${c}" stroke-width="0.5" opacity="0.6"/>`,
    ),
  ledger: (c: string) =>
    svg(120, 32, `<line x1="0" y1="31.5" x2="120" y2="31.5" stroke="${c}" stroke-width="1"/>`),
  hexagon: (c: string) =>
    svg(
      56,
      97,
      `<path d="M28 0L56 16V48L28 64L0 48V16Z M28 64V97 M0 97L0 80 M56 97V80" fill="none" stroke="${c}" stroke-width="1.2"/>`,
    ),
  dots: (c: string) => svg(22, 22, `<circle cx="11" cy="11" r="1.6" fill="${c}"/>`),
  atrium: (c: string) =>
    svg(
      160,
      200,
      `<rect x="2" y="2" width="156" height="196" fill="none" stroke="${c}" stroke-width="4"/>` +
        `<line x1="80" y1="2" x2="80" y2="198" stroke="${c}" stroke-width="2"/>` +
        `<line x1="2" y1="100" x2="158" y2="100" stroke="${c}" stroke-width="2"/>` +
        `<path d="M20 30L60 70" stroke="${c}" stroke-width="1.5" opacity="0.6"/>`,
    ),
};

export const CHAT_THEME_VISUALS: Record<string, ChatThemeVisual> = {
  default: { bubble: null, tint: null },
  'executive-navy': { bubble: { light: '#1E3A8A', dark: '#3B6FE0' }, tint: '#1E3A8A' },
  graphite: { bubble: { light: '#374151', dark: '#6B7280' }, tint: '#4B5563' },
  'slate-teal': { bubble: { light: '#0F766E', dark: '#14B8A6' }, tint: '#0F766E' },
  monochrome: { bubble: { light: '#111827', dark: '#E5E7EB' }, tint: '#6B7280' },
  'skyline-office': {
    bubble: { light: '#1D4ED8', dark: '#4F7BFF' },
    tint: '#1D4ED8',
    art: { kind: 'scene', svg: SCENES.skyline },
  },
  boardroom: {
    bubble: { light: '#7C2D12', dark: '#C2703D' },
    tint: '#92400E',
    art: { kind: 'scene', svg: SCENES.boardroom },
  },
  library: {
    bubble: { light: '#14532D', dark: '#3F9A64' },
    tint: '#78350F',
    art: { kind: 'scene', svg: SCENES.library },
  },
  'open-studio': {
    bubble: { light: '#0E7490', dark: '#22A6C3' },
    tint: '#0E7490',
    art: { kind: 'scene', svg: SCENES.studio },
  },
  'glass-atrium': {
    bubble: { light: '#0369A1', dark: '#38A1DB' },
    tint: '#0369A1',
    art: { kind: 'tile', size: [160, 200], svg: TILES.atrium },
  },
  'corner-office': {
    bubble: { light: '#9A3412', dark: '#E07B45' },
    tint: '#C2410C',
    glow: '#7C3AED',
    art: { kind: 'scene', svg: SCENES.corner },
  },
  blueprint: {
    bubble: { light: '#1E40AF', dark: '#5B8CFF' },
    tint: '#1E40AF',
    art: { kind: 'tile', size: [48, 48], svg: TILES.blueprint },
  },
  linen: {
    bubble: { light: '#57534E', dark: '#A8A29E' },
    tint: '#A8A29E',
    art: { kind: 'tile', size: [10, 10], svg: TILES.linen },
  },
  ledger: {
    bubble: { light: '#065F46', dark: '#34A77F' },
    tint: '#065F46',
    art: { kind: 'tile', size: [120, 32], svg: TILES.ledger },
  },
  hexagon: {
    bubble: { light: '#5B21B6', dark: '#9B7BF2' },
    tint: '#5B21B6',
    art: { kind: 'tile', size: [56, 97], svg: TILES.hexagon },
  },
  'dot-matrix': {
    bubble: { light: '#334155', dark: '#7C8BA1' },
    tint: '#334155',
    art: { kind: 'tile', size: [22, 22], svg: TILES.dots },
  },
  aurora: { bubble: { light: '#4338CA', dark: '#7C83F7' }, tint: '#4338CA', glow: '#0891B2' },
  sandstone: { bubble: { light: '#92400E', dark: '#D08B4C' }, tint: '#B45309', glow: '#A16207' },
  evergreen: { bubble: { light: '#166534', dark: '#3FA46A' }, tint: '#166534', glow: '#4D7C0F' },
  'burgundy-club': {
    bubble: { light: '#881337', dark: '#D0567A' },
    tint: '#881337',
    glow: '#A16207',
  },
};

export interface ChatThemeStyle {
  /** The flat color under the art: what text in the timeline is read against. */
  base: string;
  /** CSS `background` value for the conversation area. */
  background: string;
  bubbleOwn: string;
  bubbleOwnFg: string;
  bubbleOther: string;
}

const dataUri = (s: string) => `url("data:image/svg+xml,${encodeURIComponent(s)}")`;

/**
 * Resolve a chat theme against the app theme in use. Text, meta and bubbles keep at least
 * WCAG AA contrast: tints are light, own bubbles are adjusted until their text reaches 4.5:1.
 */
export function chatThemeStyle(
  id: string,
  app: ThemeColors,
  mode: 'light' | 'dark',
): ChatThemeStyle {
  const v = CHAT_THEME_VISUALS[id] ?? CHAT_THEME_VISUALS.default!;
  const dark = mode === 'dark';
  let base = v.tint ? mix(app.bg, v.tint, dark ? 0.14 : 0.06) : app.bg;
  // Keep the timeline's muted text readable on the tinted base.
  for (let i = 0; i < 10 && contrastRatio(app.textSubtle, base) < 4.6; i++)
    base = mix(base, app.bg, 0.5);

  let bubbleOwn = v.bubble ? (dark ? v.bubble.dark : v.bubble.light) : app.bubbleOwn;
  let bubbleOwnFg = pickForeground(bubbleOwn, '#FFFFFF', '#0B1220');
  if (contrastRatio(bubbleOwnFg, bubbleOwn) < 4.5)
    bubbleOwn = ensureContrast(
      bubbleOwn,
      bubbleOwnFg,
      4.5,
      bubbleOwnFg === '#FFFFFF' ? '#000000' : '#FFFFFF',
    );
  bubbleOwnFg = pickForeground(bubbleOwn, '#FFFFFF', '#0B1220');
  const bubbleOther = v.tint ? mix(app.bubbleOther, v.tint, dark ? 0.08 : 0.04) : app.bubbleOther;

  const ink = withAlpha(app.text, dark ? 0.07 : 0.075);
  const layers: string[] = [];
  if (v.art?.kind === 'scene')
    layers.push(`${dataUri(v.art.svg(ink))} center bottom / min(100%, 1440px) auto no-repeat`);
  if (v.art?.kind === 'tile') {
    const [w, h] = v.art.size;
    layers.push(`${dataUri(v.art.svg(ink))} 0 0 / ${w}px ${h}px repeat`);
  }
  if (v.glow)
    layers.push(
      `radial-gradient(ellipse at 85% 0%, ${withAlpha(v.glow, dark ? 0.16 : 0.08)}, transparent 60%)`,
      `radial-gradient(ellipse at 10% 100%, ${withAlpha(v.tint ?? v.glow, dark ? 0.14 : 0.07)}, transparent 55%)`,
    );
  layers.push(base);
  return { base, background: layers.join(', '), bubbleOwn, bubbleOwnFg, bubbleOther };
}
