/**
 * Your own picture behind conversations, chosen from the phone's photos and kept on this phone
 * only (nothing is uploaded). Same shape as the web app: one picture for all chats plus an
 * optional one per conversation (that one wins). Chat themes still set the bubble colors; the
 * picture replaces only the theme's background.
 */
export interface ChatImage {
  /** The picture as a JPEG data URL, already shrunk. */
  uri: string;
  width: number;
  height: number;
  /** The point kept in view when the picture is cropped to the screen (0 to 1). */
  focusX: number;
  focusY: number;
  /** 1 to 3. */
  zoom: number;
  /** Blur in px, 0 to 24. */
  blur: number;
  /** A wash of the app's background color over the picture, 0 to 0.8. */
  dim: number;
  /** The picture's own opacity over the background color, 0.2 to 1. */
  opacity: number;
  /** -1 to 1 each, 0 = unchanged. */
  brightness: number;
  contrast: number;
  saturation: number;
  /** Negative is cooler, positive warmer. */
  warmth: number;
  filter: ChatImageFilter;
}

export const CHAT_IMAGE_FILTERS = [
  { key: 'none', label: 'Original' },
  { key: 'vivid', label: 'Vivid' },
  { key: 'fade', label: 'Fade' },
  { key: 'mono', label: 'Mono' },
  { key: 'noir', label: 'Noir' },
  { key: 'sepia', label: 'Sepia' },
  { key: 'cool', label: 'Cool' },
] as const;
export type ChatImageFilter = (typeof CHAT_IMAGE_FILTERS)[number]['key'];
const FILTER_KEYS = CHAT_IMAGE_FILTERS.map((f) => f.key) as readonly string[];

/** Edits that can be reset in one go (the picture and its crop stay). */
export const NO_EDITS = {
  blur: 0,
  dim: 0.25,
  opacity: 1,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  warmth: 0,
  filter: 'none' as ChatImageFilter,
};

export const DIM_STEPS = [
  { value: 0, label: 'None' },
  { value: 0.3, label: 'Light' },
  { value: 0.5, label: 'Medium' },
  { value: 0.7, label: 'Strong' },
];
export const BLUR_STEPS = [
  { value: 0, label: 'Off' },
  { value: 8, label: 'Soft' },
  { value: 16, label: 'Strong' },
];
export const ZOOM_STEPS = [
  { value: 1, label: 'Fit' },
  { value: 1.5, label: '1.5×' },
  { value: 2, label: '2×' },
  { value: 3, label: '3×' },
];

/** Longest side kept on the phone (as on the web). */
export const CHAT_IMAGE_MAX_SIDE = 2560;
/** Largest saved picture (base64 bytes); compression steps down until it fits. */
export const CHAT_IMAGE_MAX_BYTES = 1536 * 1024;

const clamp = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

/** Defaults for a newly picked picture. */
export const NEW_IMAGE = { focusX: 0.5, focusY: 0.5, zoom: 1, ...NO_EDITS };

/** Size to resize to so the longest side is at most `max` (never enlarges). */
export function fitWithin(
  width: number,
  height: number,
  max = CHAT_IMAGE_MAX_SIDE,
): { width: number; height: number } {
  if (!width || !height) return { width: max, height: max };
  const s = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * s), height: Math.round(height * s) };
}

/** Reads a saved value, ignoring anything malformed and clamping the adjustments. */
export function parseChatImage(raw: string | null | undefined): ChatImage | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ChatImage>;
    if (typeof v.uri !== 'string' || !v.uri.startsWith('data:image/')) return null;
    return {
      uri: v.uri,
      width: clamp(v.width, 0, 100_000, 0),
      height: clamp(v.height, 0, 100_000, 0),
      focusX: clamp(v.focusX, 0, 1, 0.5),
      focusY: clamp(v.focusY, 0, 1, 0.5),
      zoom: clamp(v.zoom, 1, 3, 1),
      blur: clamp(v.blur, 0, 24, 0),
      dim: clamp(v.dim, 0, 0.8, 0.25),
      opacity: clamp(v.opacity, 0.2, 1, 1),
      brightness: clamp(v.brightness, -1, 1, 0),
      contrast: clamp(v.contrast, -1, 1, 0),
      saturation: clamp(v.saturation, -1, 1, 0),
      warmth: clamp(v.warmth, -1, 1, 0),
      filter: FILTER_KEYS.includes(v.filter as string) ? (v.filter as ChatImageFilter) : 'none',
    };
  } catch {
    return null;
  }
}

/** The conversation's own picture wins over the one for all chats. */
export function pickChatImage(
  all: ChatImage | null,
  conversation: ChatImage | null,
): ChatImage | null {
  return conversation ?? all;
}

/**
 * Where to draw the picture so it covers a box of `boxW` x `boxH`, zoomed, with the focus point
 * as close to the middle as the edges allow.
 */
export function coverRect(
  img: { width: number; height: number; focusX: number; focusY: number; zoom: number },
  boxW: number,
  boxH: number,
): { left: number; top: number; width: number; height: number } {
  const iw = img.width || boxW;
  const ih = img.height || boxH;
  const s = Math.max(boxW / iw, boxH / ih) * img.zoom;
  const width = iw * s;
  const height = ih * s;
  const left = Math.min(0, Math.max(boxW - width, boxW / 2 - img.focusX * width));
  const top = Math.min(0, Math.max(boxH - height, boxH / 2 - img.focusY * height));
  return { left, top, width, height };
}

/** 4x5 color matrix rows (SVG feColorMatrix order), as a 5x5 for composing. */
type M5 = number[][];
const I5 = (): M5 => [0, 1, 2, 3, 4].map((r) => [0, 1, 2, 3, 4].map((c) => (r === c ? 1 : 0)));
const mul = (a: M5, b: M5): M5 =>
  a.map((row) => [0, 1, 2, 3, 4].map((c) => row.reduce((s, v, k) => s + v * b[k]![c]!, 0)));

const LR = 0.2126;
const LG = 0.7152;
const LB = 0.0722;
function saturate(s: number): M5 {
  const m = I5();
  m[0] = [LR + (1 - LR) * s, LG - LG * s, LB - LB * s, 0, 0];
  m[1] = [LR - LR * s, LG + (1 - LG) * s, LB - LB * s, 0, 0];
  m[2] = [LR - LR * s, LG - LG * s, LB + (1 - LB) * s, 0, 0];
  return m;
}
function contrastM(f: number): M5 {
  const m = I5();
  for (let i = 0; i < 3; i++) {
    m[i]![i] = f;
    m[i]![4] = (1 - f) / 2;
  }
  return m;
}
function offset(r: number, g: number, b: number): M5 {
  const m = I5();
  m[0]![4] = r;
  m[1]![4] = g;
  m[2]![4] = b;
  return m;
}
const SEPIA: M5 = [
  [0.393, 0.769, 0.189, 0, 0],
  [0.349, 0.686, 0.168, 0, 0],
  [0.272, 0.534, 0.131, 0, 0],
  [0, 0, 0, 1, 0],
  [0, 0, 0, 0, 1],
];

function filterMatrix(f: ChatImageFilter): M5 {
  switch (f) {
    case 'vivid':
      return mul(contrastM(1.12), saturate(1.45));
    case 'fade':
      return mul(offset(0.06, 0.06, 0.06), mul(contrastM(0.8), saturate(0.75)));
    case 'mono':
      return saturate(0);
    case 'noir':
      return mul(contrastM(1.35), saturate(0));
    case 'sepia':
      return SEPIA;
    case 'cool':
      return mul(offset(-0.05, 0, 0.07), saturate(0.9));
    default:
      return I5();
  }
}

/**
 * The color edits as one SVG feColorMatrix (20 numbers), or null when nothing changes the
 * colors. The filter is applied first, then brightness, contrast, saturation and warmth.
 */
export function colorMatrix(
  img: Pick<ChatImage, 'brightness' | 'contrast' | 'saturation' | 'warmth' | 'filter'>,
): number[] | null {
  if (img.filter === 'none' && !img.brightness && !img.contrast && !img.saturation && !img.warmth)
    return null;
  let m = filterMatrix(img.filter);
  const b = img.brightness * 0.35;
  m = mul(offset(b, b, b), m);
  m = mul(contrastM(1 + img.contrast * 0.6), m);
  m = mul(saturate(1 + img.saturation), m);
  const w = img.warmth * 0.08;
  m = mul(offset(w, w * 0.3, -w), m);
  return m.slice(0, 4).flatMap((row) => row.map((v) => Math.round(v * 10000) / 10000));
}

/** Applies a color matrix to one RGB color (0 to 1), as the renderer would; for tests. */
export function applyMatrix(m: number[], [r, g, b]: [number, number, number]): number[] {
  return [0, 1, 2].map((i) => {
    const v = m[i * 5]! * r + m[i * 5 + 1]! * g + m[i * 5 + 2]! * b + m[i * 5 + 4]!;
    return Math.min(1, Math.max(0, v));
  });
}
