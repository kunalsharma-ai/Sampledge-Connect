import { DEFAULT_GREETING_ART, GREETING_MOTIFS, GREETING_OCCASION_ART } from './greeting-art.js';
import type { GreetingPalette } from './greeting-art.js';
import { contrastRatio, mix } from './color.js';

/** On light paper, a pale highlight (moon, cream) would vanish: deepen it toward the main colour. */
const onLight = (p: GreetingPalette, paper: string): GreetingPalette =>
  contrastRatio(p.c, paper) < 1.5 ? { ...p, c: mix(p.c, p.a, 0.55) } : p;

export type { GreetingPalette } from './greeting-art.js';

/**
 * How a greeting card looks: an SVG banner (original art, 640×300) and the colours of the
 * text panel under it. Web shows the banner as an <img> data URL and mobile with SvgXml, so a
 * card looks the same everywhere and works offline. The banner's bottom edge fades into the
 * panel colour, so banner and text read as one card.
 */
export interface GreetingCardLook {
  svg: string;
  aspect: number;
  panel: {
    bg: string;
    fg: string;
    muted: string;
    accent: string;
    border: string;
  };
  /** Headline font: a serif for elegant cards, the display face otherwise. */
  titleFont: 'serif' | 'display';
}

export const GREETING_BANNER = { width: 640, height: 300 } as const;

function rng(seed: number) {
  let s = seed % 2147483647 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
const hash = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

const svgDoc = (body: string, defs: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${GREETING_BANNER.width}" height="${GREETING_BANNER.height}" viewBox="0 0 ${GREETING_BANNER.width} ${GREETING_BANNER.height}"><defs>${defs}</defs>${body}</svg>`;

const star4 = (x: number, y: number, r: number, fill: string, o = 1) =>
  `<path d="M${x} ${y - r}Q${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y}Q${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r}Q${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y}Q${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r}Z" fill="${fill}" opacity="${o}"/>`;

function confetti(seed: number, colours: string[], n: number) {
  const r = rng(seed);
  let out = '';
  for (let i = 0; i < n; i++) {
    const x = r() * 640;
    const y = r() * 250;
    // Keep the centre (the motif) clear.
    if (Math.abs(x - 320) < 130 && y > 30 && y < 270) continue;
    const c = colours[i % colours.length];
    const rot = Math.round(r() * 180);
    out +=
      r() > 0.5
        ? `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="10" height="5" rx="1.5" fill="${c}" transform="rotate(${rot} ${x.toFixed(1)} ${y.toFixed(1)})"/>`
        : `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(2 + r() * 3).toFixed(1)}" fill="${c}"/>`;
  }
  return out;
}

function stars(seed: number, n: number, fill: string) {
  const r = rng(seed);
  let out = '';
  for (let i = 0; i < n; i++) {
    const x = r() * 640;
    const y = r() * 230;
    out +=
      i % 7 === 0
        ? star4(x, y, 4 + r() * 4, fill, 0.9)
        : `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(0.6 + r() * 1.4).toFixed(1)}" fill="${fill}" opacity="${(0.4 + r() * 0.6).toFixed(2)}"/>`;
  }
  return out;
}

function bokeh(seed: number, fill: string, n: number) {
  const r = rng(seed);
  let out = '';
  for (let i = 0; i < n; i++)
    out += `<circle cx="${(r() * 640).toFixed(1)}" cy="${(r() * 300).toFixed(1)}" r="${(10 + r() * 36).toFixed(1)}" fill="${fill}" opacity="${(0.06 + r() * 0.12).toFixed(2)}"/>`;
  return out;
}

function mandala(cx: number, cy: number, colour: string) {
  let out = '';
  for (let ring = 0; ring < 4; ring++) {
    const R = 110 + ring * 34;
    out += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${colour}" stroke-width="${ring % 2 ? 2 : 6}" stroke-dasharray="${ring % 2 ? '2 10' : '1 14'}" stroke-linecap="round" opacity="0.35"/>`;
    const n = 16 + ring * 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      out += `<circle cx="${(cx + Math.cos(a) * (R + 17)).toFixed(1)}" cy="${(cy + Math.sin(a) * (R + 17)).toFixed(1)}" r="${ring % 2 ? 2.5 : 4}" fill="${colour}" opacity="0.28"/>`;
    }
  }
  return out;
}

function bunting(colours: string[]) {
  let out = `<path d="M-10 6Q320 64 650 6" stroke="#fff" stroke-width="1.5" fill="none" opacity="0.8"/>`;
  for (let i = 0; i < 15; i++) {
    const x = 10 + i * 44;
    const t = x / 640;
    const y = 6 + 58 * 4 * t * (1 - t) * 0.5;
    out += `<path d="M${x - 14} ${y.toFixed(1)}L${x + 14} ${y.toFixed(1)}L${x} ${(y + 26).toFixed(1)}Z" fill="${colours[i % colours.length]}"/>`;
  }
  return out;
}

function corner(x: number, y: number, sx: number, sy: number, c: string) {
  return (
    `<g transform="translate(${x} ${y}) scale(${sx} ${sy})" fill="none" stroke="${c}" stroke-width="1.6">` +
    `<path d="M0 34Q0 0 34 0"/><path d="M8 40Q8 8 40 8"/><circle cx="20" cy="20" r="3" fill="${c}"/>` +
    `<path d="M40 8Q52 4 58 12M8 40Q4 52 12 58"/></g>`
  );
}

function sprig(x: number, y: number, flip: number, c: string) {
  let out = `<g transform="translate(${x} ${y}) scale(${flip} 1)"><path d="M0 0Q30 -10 60 -40" stroke="${c}" stroke-width="2" fill="none"/>`;
  for (let i = 1; i < 6; i++) {
    const px = i * 11;
    const py = -i * i * 1.2 - i * 1.5;
    out += `<ellipse cx="${px}" cy="${py - 6}" rx="3.5" ry="8" fill="${c}" transform="rotate(-30 ${px} ${py - 6})"/>`;
    out += `<ellipse cx="${px + 4}" cy="${py + 4}" rx="3.5" ry="8" fill="${c}" transform="rotate(60 ${px + 4} ${py + 4})"/>`;
  }
  return `${out}</g>`;
}

const motifAt = (svg: string, x: number, y: number, s: number) =>
  `<g transform="translate(${x} ${y}) scale(${s})">${svg}</g>`;

/** Fade from transparent to the panel colour along the bottom of the banner. */
const fadeTo = (bg: string) =>
  `<rect x="0" y="230" width="640" height="70" fill="url(#fade)"/>` +
  // A last solid strip hides any sub-pixel seam with the panel.
  `<rect x="0" y="298" width="640" height="2" fill="${bg}"/>`;
const fadeDef = (bg: string) =>
  `<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg}" stop-opacity="0"/><stop offset="1" stop-color="${bg}"/></linearGradient>`;

export function greetingArt(occasionId: string) {
  return GREETING_OCCASION_ART[occasionId] ?? DEFAULT_GREETING_ART;
}

/**
 * The look of a card. `quiet` (condolences) mutes colour and drops confetti and bunting in
 * every style, so a sympathy card never looks like a party.
 */
export function greetingCardLook(
  occasionId: string,
  styleId: string,
  opts: { quiet?: boolean } = {},
): GreetingCardLook {
  const { motif, palette: p } = greetingArt(occasionId);
  const draw = GREETING_MOTIFS[motif] ?? GREETING_MOTIFS.popper!;
  const quiet = !!opts.quiet;
  const seed = hash(`${occasionId}:${styleId}`);
  const party = [p.a, p.b, p.c, '#ffffff'];

  switch (styleId) {
    case 'elegant': {
      const bg = '#FBF6EC';
      const gold = '#B8892E';
      const pal: GreetingPalette = { ...onLight(p, bg), d: bg };
      const defs =
        fadeDef(bg) +
        `<radialGradient id="glow" cx="0.5" cy="0.45" r="0.5"><stop offset="0" stop-color="${p.c}" stop-opacity="0.28"/><stop offset="1" stop-color="${p.c}" stop-opacity="0"/></radialGradient>`;
      const body =
        `<rect width="640" height="300" fill="${bg}"/>` +
        `<rect width="640" height="300" fill="url(#glow)"/>` +
        `<rect x="16" y="16" width="608" height="300" fill="none" stroke="${gold}" stroke-width="1.5"/>` +
        `<rect x="24" y="24" width="592" height="300" fill="none" stroke="${gold}" stroke-width="0.8" opacity="0.7"/>` +
        corner(16, 16, 1, 1, gold) +
        corner(624, 16, -1, 1, gold) +
        sprig(210, 230, -1, gold) +
        sprig(430, 230, 1, gold) +
        motifAt(draw(pal), 320, 150, 1.0) +
        fadeTo(bg);
      return {
        svg: svgDoc(body, defs),
        aspect: 640 / 300,
        panel: { bg, fg: '#3A2E1F', muted: '#6B5B45', accent: gold, border: '#E6D7B8' },
        titleFont: 'serif',
      };
    }
    case 'festive': {
      const bg = quiet ? '#334155' : p.a;
      const panelBg = quiet ? '#1E293B' : p.d;
      const defs =
        fadeDef(panelBg) +
        `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${panelBg}"/></linearGradient>`;
      const body =
        `<rect width="640" height="300" fill="url(#bg)"/>` +
        mandala(320, 160, quiet ? '#CBD5E1' : p.c) +
        (quiet ? '' : bunting([p.c, '#ffffff', p.b, p.c]) + confetti(seed, party, 60)) +
        motifAt(draw(p), 320, 160, 1.1) +
        fadeTo(panelBg);
      return {
        svg: svgDoc(body, defs),
        aspect: 640 / 300,
        panel: {
          bg: panelBg,
          fg: '#FFFFFF',
          muted: 'rgba(255,255,255,0.78)',
          accent: quiet ? '#CBD5E1' : p.c,
          border: 'rgba(255,255,255,0.14)',
        },
        titleFont: 'display',
      };
    }
    case 'minimal': {
      const bg = '#FFFFFF';
      const defs = fadeDef(bg);
      const body =
        `<rect width="640" height="300" fill="${bg}"/>` +
        `<circle cx="320" cy="150" r="118" fill="${p.a}" opacity="0.08"/>` +
        `<circle cx="320" cy="150" r="96" fill="${p.a}" opacity="0.08"/>` +
        `<path d="M120 150L190 150M450 150L520 150" stroke="${p.a}" stroke-width="1.5" opacity="0.35" stroke-linecap="round"/>` +
        star4(206, 150, 4, p.a, 0.5) +
        star4(434, 150, 4, p.a, 0.5) +
        motifAt(draw({ ...onLight(p, bg), d: bg }), 320, 150, 0.82) +
        fadeTo(bg);
      return {
        svg: svgDoc(body, defs),
        aspect: 640 / 300,
        panel: { bg, fg: '#1F2430', muted: '#5B6472', accent: p.a, border: '#E5E7EB' },
        titleFont: 'display',
      };
    }
    case 'midnight': {
      const top = '#0B1028';
      const bottom = '#141B3D';
      const gold = '#E8C26A';
      const defs =
        fadeDef(bottom) +
        `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>` +
        `<radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${gold}" stop-opacity="0.38"/><stop offset="1" stop-color="${gold}" stop-opacity="0"/></radialGradient>`;
      const body =
        `<rect width="640" height="300" fill="url(#bg)"/>` +
        stars(seed, quiet ? 40 : 90, '#FFF6DA') +
        `<ellipse cx="320" cy="150" rx="200" ry="150" fill="url(#glow)"/>` +
        `<path d="M40 270Q320 200 600 270" stroke="${gold}" stroke-width="1" fill="none" opacity="0.5"/>` +
        motifAt(draw({ ...p, d: top }), 320, 148, 1.05) +
        fadeTo(bottom);
      return {
        svg: svgDoc(body, defs),
        aspect: 640 / 300,
        panel: {
          bg: bottom,
          fg: '#F8F1DE',
          muted: 'rgba(248,241,222,0.74)',
          accent: gold,
          border: 'rgba(232,194,106,0.25)',
        },
        titleFont: 'serif',
      };
    }
    case 'radiant':
    default: {
      const panelBg = quiet ? '#1E293B' : p.d;
      const defs =
        fadeDef(panelBg) +
        `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${quiet ? '#475569' : p.b}"/><stop offset="0.55" stop-color="${quiet ? '#334155' : p.a}"/><stop offset="1" stop-color="${panelBg}"/></linearGradient>` +
        `<radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${p.c}" stop-opacity="${quiet ? 0.25 : 0.55}"/><stop offset="1" stop-color="${p.c}" stop-opacity="0"/></radialGradient>`;
      const body =
        `<rect width="640" height="300" fill="url(#bg)"/>` +
        bokeh(seed, '#ffffff', quiet ? 6 : 14) +
        `<ellipse cx="320" cy="150" rx="210" ry="150" fill="url(#glow)"/>` +
        (quiet
          ? ''
          : [
              [90, 60, 10],
              [560, 80, 12],
              [140, 200, 7],
              [520, 210, 8],
              [470, 40, 6],
              [180, 40, 6],
            ]
              .map(([x, y, r]) => star4(x!, y!, r!, p.c, 0.95))
              .join('')) +
        motifAt(draw(p), 320, 150, 1.1) +
        fadeTo(panelBg);
      return {
        svg: svgDoc(body, defs),
        aspect: 640 / 300,
        panel: {
          bg: panelBg,
          fg: '#FFFFFF',
          muted: 'rgba(255,255,255,0.8)',
          accent: quiet ? '#CBD5E1' : p.c,
          border: 'rgba(255,255,255,0.14)',
        },
        titleFont: 'display',
      };
    }
  }
}

/** The banner as a data URL for <img src>. */
export function greetingBannerDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
