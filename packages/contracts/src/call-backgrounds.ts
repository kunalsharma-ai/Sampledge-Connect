import { z } from 'zod';

/**
 * Prebuilt call backgrounds: real photos of offices and luxury homes (CC0, see
 * `apps/web/public/backgrounds/CREDITS.md`). The images are part of the web app
 * (`/backgrounds/<id>.jpg`, 1280x720, and `/backgrounds/thumbs/<id>.jpg`, 320x180).
 * Nothing is loaded from outside your servers.
 */
export const CALL_BACKGROUND_PRESETS = [
  { id: 'modern-office', name: 'Modern office', group: 'Office' },
  { id: 'executive-office', name: 'Executive office', group: 'Office' },
  { id: 'glass-meeting-room', name: 'Glass meeting room', group: 'Office' },
  { id: 'boardroom', name: 'Boardroom', group: 'Office' },
  { id: 'open-plan-office', name: 'Open plan office', group: 'Office' },
  { id: 'coworking-loft', name: 'Coworking loft', group: 'Office' },
  { id: 'library-study', name: 'Library study', group: 'Office' },
  { id: 'reception-lobby', name: 'Reception lounge', group: 'Office' },
  { id: 'office-lounge', name: 'Office lounge', group: 'Office' },
  { id: 'skyline-office', name: 'Skyline office', group: 'Office' },
  { id: 'minimal-workspace', name: 'Minimal workspace', group: 'Office' },
  { id: 'green-office', name: 'Green office', group: 'Office' },
  { id: 'luxury-living-room', name: 'Luxury living room', group: 'Home' },
  { id: 'penthouse-view', name: 'Penthouse view', group: 'Home' },
  { id: 'home-study', name: 'Home study', group: 'Home' },
  { id: 'scandinavian-living', name: 'Scandinavian living', group: 'Home' },
  { id: 'fireplace-lounge', name: 'Fireplace lounge', group: 'Home' },
  { id: 'modern-sofa-corner', name: 'Modern sofa corner', group: 'Home' },
  { id: 'reading-nook', name: 'Reading nook', group: 'Home' },
  { id: 'villa-terrace', name: 'Villa terrace', group: 'Home' },
  { id: 'contemporary-lounge', name: 'Contemporary lounge', group: 'Home' },
  { id: 'bookshelf-wall', name: 'Bookshelf wall', group: 'Home' },
  { id: 'plant-filled-room', name: 'Plant-filled room', group: 'Home' },
  { id: 'elegant-hallway-lounge', name: 'Elegant dining lounge', group: 'Home' },
] as const;

/** Older drawn backgrounds, mapped to the closest photo so saved choices keep working. */
export const LEGACY_CALL_BACKGROUND_PRESETS: Record<string, string> = {
  'dusk-skyline': 'skyline-office',
  'night-city': 'penthouse-view',
  'executive-wood': 'executive-office',
  library: 'library-study',
  reception: 'reception-lobby',
  'brick-coworking': 'coworking-loft',
  'scandi-room': 'scandinavian-living',
  lounge: 'office-lounge',
  'green-wall': 'green-office',
  'home-office': 'home-study',
  'mountain-view': 'villa-terrace',
  'seaside-view': 'villa-terrace',
  'navy-geometric': 'minimal-workspace',
  'soft-bokeh': 'minimal-workspace',
  'slate-gradient': 'minimal-workspace',
  'warm-gradient': 'contemporary-lounge',
  'teal-waves': 'modern-office',
};

export type CallBackgroundPresetId = (typeof CALL_BACKGROUND_PRESETS)[number]['id'];
const PRESET_IDS = CALL_BACKGROUND_PRESETS.map((p) => p.id) as [
  CallBackgroundPresetId,
  ...CallBackgroundPresetId[],
];

export const callBackgroundImagePath = (id: CallBackgroundPresetId) => `/backgrounds/${id}.jpg`;
export const callBackgroundThumbPath = (id: CallBackgroundPresetId) =>
  `/backgrounds/thumbs/${id}.jpg`;

/**
 * What a person shows behind them in calls:
 * - none: the real camera picture
 * - blur: their real background, blurred
 * - preset: one of the prebuilt images
 * - upload: an uploaded image, mine or one the organization added (`imageId`)
 * - custom: older form of "my uploaded image" (the most recent one)
 * - logo: the organization's logo and colors (from Branding)
 */
export const CallBackgroundChoiceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('blur') }),
  z.object({
    kind: z.literal('preset'),
    presetId: z.preprocess(
      (v) => (typeof v === 'string' ? (LEGACY_CALL_BACKGROUND_PRESETS[v] ?? v) : v),
      z.enum(PRESET_IDS),
    ),
  }),
  z.object({ kind: z.literal('upload'), imageId: z.string().regex(/^[a-f0-9]{32}$/) }),
  z.object({ kind: z.literal('custom') }),
  z.object({ kind: z.literal('logo') }),
]);
export type CallBackgroundChoice = z.infer<typeof CallBackgroundChoiceSchema>;

/** The organization default can't be someone's own image. */
export const CallBackgroundDefaultSchema = CallBackgroundChoiceSchema.refine(
  (c) => c.kind !== 'custom',
  'The default can’t be a personal image',
);

/** PUT /v1/admin/call-backgrounds (owner/admin). */
export const CallBackgroundPolicySchema = z.object({
  /** Used by everyone who hasn't picked a background themselves. */
  defaultChoice: CallBackgroundDefaultSchema.default({ kind: 'none' }),
  /** Everyone in the organization shows the company logo background in calls. */
  enforceLogo: z.boolean().default(false),
});
export type CallBackgroundPolicyInput = z.input<typeof CallBackgroundPolicySchema>;
export type CallBackgroundPolicy = z.infer<typeof CallBackgroundPolicySchema>;

/** Largest background image (after the app shrinks it to 1920x1080). */
export const CALL_BACKGROUND_MAX_BYTES = 2 * 1024 * 1024;
/** How many backgrounds a person can upload, and how many the organization library holds. */
export const CALL_BACKGROUND_MAX_PERSONAL = 12;
export const CALL_BACKGROUND_MAX_ORGANIZATION = 40;

/** An uploaded background: one of mine, or one the organization added for everyone. */
export interface CallBackgroundUpload {
  imageId: string;
  /** Public, unguessable link on the API (prefix with the API origin). */
  url: string;
  name: string;
  owner: 'mine' | 'organization';
  createdAt: string;
}

/**
 * GET /v1/me/call-background. Everything an app needs to apply the right background, on any of
 * the person's devices. Changes arrive as `meetings:changed {area: 'call_background'}` (mine)
 * and `tenant:updated {area: 'calls'}` (policy, logo).
 */
export interface CallBackgroundState {
  /** What I picked, or null if I never picked (the organization default applies). */
  choice: CallBackgroundChoice | null;
  /** What to apply now: my choice, the default, or the logo when the organization requires it. */
  effective: CallBackgroundChoice;
  /** My most recent uploaded image (older clients), if any. */
  customImageUrl: string | null;
  /** The organization's backgrounds first, then mine (newest first). */
  uploads: CallBackgroundUpload[];
  policy: CallBackgroundPolicy & { canManage: boolean };
  /** Branding used to draw the logo background. */
  brand: { name: string; logo: string | null; primary: string; secondary: string };
  /** How I look on camera (filter, light, colour, touch-up, face shaping). */
  appearance: CallAppearance;
}

// ---------- appearance ----------

/**
 * Looks: a one-tap filter applied on top of the sliders. The numbers are shared by the web and
 * mobile apps so a look is the same everywhere (all run on the device).
 * brightness/contrast/saturation/warmth are -1..1 nudges, grayscale/sepia/glow/vignette 0..1.
 */
export const CALL_LOOK_FILTERS = [
  { id: 'natural', name: 'Natural', mix: {} },
  { id: 'fresh', name: 'Fresh', mix: { brightness: 0.06, contrast: 0.08, saturation: 0.12 } },
  { id: 'warm', name: 'Warm', mix: { warmth: 0.35, saturation: 0.06, brightness: 0.03 } },
  { id: 'cool', name: 'Cool', mix: { warmth: -0.3, contrast: 0.05 } },
  { id: 'vivid', name: 'Vivid', mix: { saturation: 0.35, contrast: 0.15 } },
  { id: 'soft', name: 'Soft glow', mix: { glow: 0.45, contrast: -0.08, brightness: 0.04 } },
  { id: 'studio', name: 'Studio', mix: { contrast: 0.12, vignette: 0.35, brightness: 0.04 } },
  { id: 'mono', name: 'Black and white', mix: { grayscale: 1, contrast: 0.08 } },
  { id: 'noir', name: 'Noir', mix: { grayscale: 1, contrast: 0.35, vignette: 0.5 } },
  { id: 'vintage', name: 'Vintage', mix: { sepia: 0.6, contrast: -0.05, vignette: 0.3 } },
] as const;
export type CallLookFilterId = (typeof CALL_LOOK_FILTERS)[number]['id'];
const LOOK_IDS = CALL_LOOK_FILTERS.map((f) => f.id) as [CallLookFilterId, ...CallLookFilterId[]];

const slider = (min: number) => z.number().int().min(min).max(100).default(0);

/**
 * PUT /v1/me/call-appearance. Sliders are whole numbers; 0 is "as the camera sees it".
 * Light and colour run -100..100, touch-up and face shaping 0..100.
 */
export const CallAppearanceSchema = z.object({
  filter: z.enum(LOOK_IDS).default('natural'),
  brightness: slider(-100),
  contrast: slider(-100),
  saturation: slider(-100),
  warmth: slider(-100),
  /** Lifts dark areas, for dim rooms. */
  lowLight: slider(0),
  sharpness: slider(0),
  /** Skin smoothing. */
  smoothing: slider(0),
  /** Face shaping (needs the face model on the device). */
  faceSlim: slider(0),
  eyes: slider(0),
  nose: slider(0),
});
export type CallAppearance = z.infer<typeof CallAppearanceSchema>;
export type CallAppearanceInput = z.input<typeof CallAppearanceSchema>;
export const DEFAULT_CALL_APPEARANCE: CallAppearance = CallAppearanceSchema.parse({});

/** One tap "Enhance": the touch-up most people like. */
export const CALL_APPEARANCE_ENHANCE: Partial<CallAppearance> = {
  smoothing: 45,
  lowLight: 20,
  sharpness: 20,
  brightness: 5,
  saturation: 8,
};

/** True when nothing changes the picture (the camera can skip processing). */
export function isNeutralAppearance(a: CallAppearance): boolean {
  return (
    a.filter === 'natural' &&
    !a.brightness &&
    !a.contrast &&
    !a.saturation &&
    !a.warmth &&
    !a.lowLight &&
    !a.sharpness &&
    !a.smoothing &&
    !a.faceSlim &&
    !a.eyes &&
    !a.nose
  );
}

/** True when face shaping is on (the device then also finds the face in each frame). */
export const usesFaceShaping = (a: CallAppearance) => !!(a.faceSlim || a.eyes || a.nose);
