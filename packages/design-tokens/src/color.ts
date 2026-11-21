/** Small, dependency-free color helpers used to derive themes and check WCAG contrast. */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function parseHex(hex: string): Rgb {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Invalid hex color: ${hex}`);
  let h = m[1]!;
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function toHex({ r, g, b }: Rgb): string {
  const c = (n: number) =>
    Math.round(Math.min(255, Math.max(0, n)))
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

/** Linear blend: amount 0 returns a, 1 returns b. */
export function mix(a: string, b: string, amount: number): string {
  const x = parseHex(a);
  const y = parseHex(b);
  return toHex({
    r: x.r + (y.r - x.r) * amount,
    g: x.g + (y.g - x.g) * amount,
    b: x.b + (y.b - x.b) * amount,
  });
}

export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = parseHex(hex);
  return `rgb(${r} ${g} ${b} / ${Math.round(alpha * 1000) / 10}%)`;
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.x contrast ratio, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Pick whichever candidate has the higher contrast against `bg`. */
export function pickForeground(bg: string, light: string, dark: string): string {
  return contrastRatio(bg, light) >= contrastRatio(bg, dark) ? light : dark;
}

/**
 * Move `color` toward `toward` in small steps until it reaches `min` contrast
 * against `against`. Used to make organization brand colors accessible.
 */
export function ensureContrast(
  color: string,
  against: string,
  min: number,
  toward: string,
): string {
  let c = color;
  for (let i = 0; i <= 20 && contrastRatio(c, against) < min; i++) {
    c = mix(color, toward, i / 20);
  }
  return c;
}
