import {
  CHAT_BACKGROUND_FILTERS,
  CHAT_BACKGROUND_MAX_EDGE,
  DEFAULT_CHAT_BACKGROUND_ADJUST,
  chatBackgroundColorMatrix,
  isNeutralChatBackground,
  type ChatBackgroundFilter,
} from '@sampledge/contracts';

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

export type ChatImageFilter = ChatBackgroundFilter;
const FILTER_LABEL: Record<ChatImageFilter, string> = {
  none: 'Original',
  vivid: 'Vivid',
  fade: 'Fade',
  mono: 'Mono',
  noir: 'Noir',
  sepia: 'Sepia',
  cool: 'Cool',
};
export const CHAT_IMAGE_FILTERS = CHAT_BACKGROUND_FILTERS.map((key) => ({
  key,
  label: FILTER_LABEL[key],
}));
const FILTER_KEYS = CHAT_BACKGROUND_FILTERS as readonly string[];

/** Edits that can be reset in one go (the picture and its crop stay). */
export const NO_EDITS = {
  blur: DEFAULT_CHAT_BACKGROUND_ADJUST.blur,
  dim: DEFAULT_CHAT_BACKGROUND_ADJUST.dim,
  opacity: DEFAULT_CHAT_BACKGROUND_ADJUST.opacity,
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
export const CHAT_IMAGE_MAX_SIDE = CHAT_BACKGROUND_MAX_EDGE;
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

/**
 * The color edits as one SVG feColorMatrix (20 numbers), from the shared contracts so the web
 * and the phone render the same picture; null when nothing changes the colors.
 */
export function colorMatrix(
  img: Pick<ChatImage, 'brightness' | 'contrast' | 'saturation' | 'warmth' | 'filter'>,
): number[] | null {
  return isNeutralChatBackground(img) ? null : chatBackgroundColorMatrix(img);
}

/** Applies a color matrix to one RGB color (0 to 1), as the renderer would; for tests. */
export function applyMatrix(m: number[], [r, g, b]: [number, number, number]): number[] {
  return [0, 1, 2].map((i) => {
    const v = m[i * 5]! * r + m[i * 5 + 1]! * g + m[i * 5 + 2]! * b + m[i * 5 + 4]!;
    return Math.min(1, Math.max(0, v));
  });
}
