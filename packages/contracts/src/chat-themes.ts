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
});
export type ChatThemePolicy = z.infer<typeof ChatThemePolicySchema>;
export const DEFAULT_CHAT_THEME_POLICY: ChatThemePolicy = {
  defaultThemeId: 'default',
  allowed: null,
};

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
