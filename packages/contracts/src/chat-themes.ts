import { z } from 'zod';

/**
 * Chat themes: how conversations look (background and your message bubbles), chosen per person
 * and synced to all of their devices. They sit on top of the app theme (Midnight Executive,
 * Arctic Professional, …) and adapt to its light or dark mode. Owners and admins can set the
 * organization default and limit the choice.
 *
 * The visuals for each id live in @sampledge/design-tokens (`CHAT_THEME_VISUALS`).
 */
export const CHAT_THEME_CATEGORIES = ['classic', 'office', 'pattern', 'color'] as const;
export type ChatThemeCategory = (typeof CHAT_THEME_CATEGORIES)[number];

export const CHAT_THEMES = [
  { id: 'default', name: 'App theme', category: 'classic', description: 'Follows your app theme' },
  {
    id: 'executive-navy',
    name: 'Executive Navy',
    category: 'classic',
    description: 'Deep navy, crisp blue bubbles',
  },
  {
    id: 'graphite',
    name: 'Graphite',
    category: 'classic',
    description: 'Neutral charcoal and steel',
  },
  {
    id: 'slate-teal',
    name: 'Slate Teal',
    category: 'classic',
    description: 'Calm slate with teal',
  },
  {
    id: 'monochrome',
    name: 'Monochrome',
    category: 'classic',
    description: 'Black, white and grey only',
  },
  {
    id: 'skyline-office',
    name: 'Skyline Office',
    category: 'office',
    description: 'City skyline through the window',
  },
  {
    id: 'boardroom',
    name: 'Boardroom',
    category: 'office',
    description: 'Long table and tall windows',
  },
  { id: 'library', name: 'Library', category: 'office', description: 'Quiet shelves of books' },
  {
    id: 'open-studio',
    name: 'Open Studio',
    category: 'office',
    description: 'Desks, lamps and plants',
  },
  {
    id: 'glass-atrium',
    name: 'Glass Atrium',
    category: 'office',
    description: 'Steel-framed glass panes',
  },
  {
    id: 'corner-office',
    name: 'Corner Office',
    category: 'office',
    description: 'Skyline at dusk',
  },
  { id: 'blueprint', name: 'Blueprint', category: 'pattern', description: 'Fine engineering grid' },
  { id: 'linen', name: 'Linen', category: 'pattern', description: 'Soft woven texture' },
  { id: 'ledger', name: 'Ledger', category: 'pattern', description: 'Ruled notebook lines' },
  { id: 'hexagon', name: 'Hexagon', category: 'pattern', description: 'Light honeycomb' },
  { id: 'dot-matrix', name: 'Dot Matrix', category: 'pattern', description: 'Even dot grid' },
  { id: 'aurora', name: 'Aurora', category: 'color', description: 'Soft blue-violet glow' },
  { id: 'sandstone', name: 'Sandstone', category: 'color', description: 'Warm stone and bronze' },
  { id: 'evergreen', name: 'Evergreen', category: 'color', description: 'Forest green and sage' },
  { id: 'burgundy-club', name: 'Burgundy Club', category: 'color', description: 'Wine and brass' },
] as const satisfies readonly {
  id: string;
  name: string;
  category: ChatThemeCategory;
  description: string;
}[];

export const CHAT_THEME_IDS = CHAT_THEMES.map((t) => t.id) as unknown as readonly [
  (typeof CHAT_THEMES)[number]['id'],
  ...(typeof CHAT_THEMES)[number]['id'][],
];
export type ChatThemeId = (typeof CHAT_THEMES)[number]['id'];
export const ChatThemeIdSchema = z.enum(CHAT_THEME_IDS);
export const DEFAULT_CHAT_THEME: ChatThemeId = 'default';

/** Organization rules for chat themes (owners and admins). */
export const ChatThemePolicySchema = z.object({
  /** What people see until they choose. */
  defaultThemeId: ChatThemeIdSchema.default('default'),
  /** Themes people may choose; null means all. Always includes the default. */
  allowed: z.array(ChatThemeIdSchema).min(1).max(CHAT_THEMES.length).nullable().default(null),
  /** People may use their own picture as a chat background (kept on their device). */
  allowCustomImages: z.boolean().default(true),
});
export type ChatThemePolicy = z.infer<typeof ChatThemePolicySchema>;
export const DEFAULT_CHAT_THEME_POLICY: ChatThemePolicy = {
  defaultThemeId: 'default',
  allowed: null,
  allowCustomImages: true,
};

export const CHAT_BACKGROUND_FILTERS = [
  'none',
  'mono',
  'sepia',
  'vivid',
  'fade',
  'noir',
  'cool',
] as const;
export type ChatBackgroundFilter = (typeof CHAT_BACKGROUND_FILTERS)[number];

/**
 * A personal chat background picture. It never leaves the device: each app keeps the picture
 * and these settings in local storage, for all chats or for one conversation.
 */
export const ChatBackgroundAdjustSchema = z.object({
  /** Crop center, 0 (left/top) to 1 (right/bottom). */
  focusX: z.number().min(0).max(1).default(0.5),
  focusY: z.number().min(0).max(1).default(0.5),
  zoom: z.number().min(1).max(3).default(1),
  /** Gaussian blur in CSS pixels. */
  blur: z.number().min(0).max(24).default(0),
  /** Wash in the app background color, 0 to 0.8, so messages stay readable. */
  dim: z.number().min(0).max(0.8).default(0.25),
  /** The picture's own opacity over the chat background color. */
  opacity: z.number().min(0.2).max(1).default(1),
  brightness: z.number().min(-1).max(1).default(0),
  contrast: z.number().min(-1).max(1).default(0),
  saturation: z.number().min(-1).max(1).default(0),
  /** Negative is cooler, positive is warmer. */
  warmth: z.number().min(-1).max(1).default(0),
  filter: z.enum(CHAT_BACKGROUND_FILTERS).default('none'),
});
export type ChatBackgroundAdjust = z.infer<typeof ChatBackgroundAdjustSchema>;
export const DEFAULT_CHAT_BACKGROUND_ADJUST: ChatBackgroundAdjust =
  ChatBackgroundAdjustSchema.parse({});
/** Longest edge of a prepared background picture, in pixels. */
export const CHAT_BACKGROUND_MAX_EDGE = 2560;

/** GET /v1/me/chat-theme */
export const ChatThemeStateSchema = z.object({
  /** Your choice; null means the organization default. */
  themeId: ChatThemeIdSchema.nullable(),
  policy: ChatThemePolicySchema,
  /** The theme in effect for you (your choice when still allowed, else the default). */
  effective: ChatThemeIdSchema,
});
export type ChatThemeState = z.infer<typeof ChatThemeStateSchema>;

/** PUT /v1/me/chat-theme */
export const SetChatThemeRequestSchema = z.object({ themeId: ChatThemeIdSchema.nullable() });

/** The theme someone sees: their choice if the organization still allows it, else the default. */
export function effectiveChatTheme(
  choice: ChatThemeId | null | undefined,
  policy: ChatThemePolicy,
): ChatThemeId {
  if (choice && (!policy.allowed || policy.allowed.includes(choice))) return choice;
  return policy.defaultThemeId;
}

type M5 = number[][];
const ID5 = (): M5 => [0, 1, 2, 3, 4].map((r) => [0, 1, 2, 3, 4].map((c) => (r === c ? 1 : 0)));
/** a after b: apply b first, then a. */
function mul(a: M5, b: M5): M5 {
  return a.map((row) => [0, 1, 2, 3, 4].map((c) => row.reduce((s, v, k) => s + v * b[k]![c]!, 0)));
}
function rgb(rows: [number[], number[], number[]], offsets: [number, number, number] = [0, 0, 0]) {
  const m = ID5();
  rows.forEach((r, i) => {
    m[i] = [r[0]!, r[1]!, r[2]!, 0, offsets[i]!];
  });
  return m;
}
const LR = 0.2126;
const LG = 0.7152;
const LB = 0.0722;
function saturate(s: number): M5 {
  return rgb([
    [LR + (1 - LR) * s, LG - LG * s, LB - LB * s],
    [LR - LR * s, LG + (1 - LG) * s, LB - LB * s],
    [LR - LR * s, LG - LG * s, LB + (1 - LB) * s],
  ]);
}
function contrast(k: number): M5 {
  const o = 0.5 * (1 - k);
  return rgb(
    [
      [k, 0, 0],
      [0, k, 0],
      [0, 0, k],
    ],
    [o, o, o],
  );
}
function scale(r: number, g: number, b: number, o: [number, number, number] = [0, 0, 0]): M5 {
  return rgb(
    [
      [r, 0, 0],
      [0, g, 0],
      [0, 0, b],
    ],
    o,
  );
}
const SEPIA = rgb([
  [0.393, 0.769, 0.189],
  [0.349, 0.686, 0.168],
  [0.272, 0.534, 0.131],
]);
const PRESET: Record<ChatBackgroundFilter, () => M5> = {
  none: ID5,
  mono: () => saturate(0),
  sepia: () => SEPIA,
  vivid: () => mul(contrast(1.1), saturate(1.5)),
  fade: () => mul(scale(0.88, 0.88, 0.88, [0.08, 0.08, 0.08]), saturate(0.8)),
  noir: () => mul(contrast(1.4), saturate(0)),
  cool: () => mul(scale(0.92, 1, 1.08, [0, 0, 0.03]), saturate(0.95)),
};

/**
 * The colour edits of a chat background picture as one SVG feColorMatrix (4x5, row major, 20
 * numbers, channels 0 to 1). Web and mobile both use it, so the picture looks the same
 * everywhere. Order: brightness, contrast, saturation, warmth, then the filter preset.
 * Opacity, blur and dim are applied separately.
 */
export function chatBackgroundColorMatrix(
  a: Pick<ChatBackgroundAdjust, 'brightness' | 'contrast' | 'saturation' | 'warmth' | 'filter'>,
): number[] {
  const b = a.brightness * 0.35;
  let m = scale(1, 1, 1, [b, b, b]);
  m = mul(contrast(1 + a.contrast * 0.8), m);
  m = mul(saturate(1 + a.saturation), m);
  const w = a.warmth;
  m = mul(scale(1 + w * 0.1, 1, 1 - w * 0.1, [w * 0.06, w * 0.01, -w * 0.06]), m);
  m = mul(PRESET[a.filter](), m);
  return m.slice(0, 4).flatMap((row) => row.map((v) => Math.round(v * 10000) / 10000));
}

/** True when the colour edits change nothing (so apps can skip the filter). */
export function isNeutralChatBackground(
  a: Pick<ChatBackgroundAdjust, 'brightness' | 'contrast' | 'saturation' | 'warmth' | 'filter'>,
): boolean {
  return !a.brightness && !a.contrast && !a.saturation && !a.warmth && a.filter === 'none';
}
