import {
  CALL_BACKGROUND_PRESETS,
  DEFAULT_CALL_APPEARANCE,
  type CallAppearance,
  type CallBackgroundChoice,
  type CallBackgroundPolicy,
  type CallBackgroundPresetId,
  type CallBackgroundState,
} from '@sampledge/contracts';
import type { ActionInput } from '../db/work';

export type PendingCallBackground = Extract<
  ActionInput,
  { kind: 'callbg.set' | 'callbg.image' | 'callbg.imageRemove' }
>;

/** An image picked on this phone that hasn't reached the server shows under this id. */
export const LOCAL_UPLOAD_PREFIX = 'local:';
export const isLocalUpload = (imageId: string) => imageId.startsWith(LOCAL_UPLOAD_PREFIX);
export const localUploadUri = (imageId: string) => imageId.slice(LOCAL_UPLOAD_PREFIX.length);

export const sameChoice = (a: CallBackgroundChoice | null, b: CallBackgroundChoice | null) =>
  !!a &&
  !!b &&
  a.kind === b.kind &&
  (a.kind !== 'preset' || (b.kind === 'preset' && a.presetId === b.presetId)) &&
  (a.kind !== 'upload' || (b.kind === 'upload' && a.imageId === b.imageId));

/** What applies in calls: the company background when required, else my pick or the default. */
export function effectiveCallBackground(
  choice: CallBackgroundChoice | null,
  policy: Pick<CallBackgroundPolicy, 'defaultChoice' | 'enforceLogo'>,
): CallBackgroundChoice {
  return policy.enforceLogo ? { kind: 'logo' } : (choice ?? policy.defaultChoice);
}

/** The picture behind an upload choice (or the older "my image"), if it is still there. */
export function uploadUrl(
  state: Pick<CallBackgroundState, 'uploads' | 'customImageUrl'>,
  choice: CallBackgroundChoice,
): string | null {
  if (choice.kind === 'custom') return state.customImageUrl;
  if (choice.kind !== 'upload') return null;
  return state.uploads.find((u) => u.imageId === choice.imageId)?.url ?? null;
}

/**
 * The server's copy with changes made on this device laid over it, in the order they were made,
 * the same way the server applies them: an upload adds the image and selects it, and removing an
 * image while it is in use goes back to the default.
 */
export function withPendingCallBackground(
  state: CallBackgroundState,
  pending: readonly PendingCallBackground[],
  appearance?: CallAppearance | null,
  now = new Date().toISOString(),
): CallBackgroundState {
  let { choice, customImageUrl } = state;
  let uploads = [...(state.uploads ?? [])];
  const mineFirst = () => uploads.find((u) => u.owner === 'mine')?.url ?? null;
  for (const p of pending) {
    if (p.kind === 'callbg.image') {
      const imageId = `${LOCAL_UPLOAD_PREFIX}${p.localUri}`;
      const org = uploads.filter((u) => u.owner === 'organization');
      const mine = uploads.filter((u) => u.owner === 'mine');
      uploads = [
        ...org,
        {
          imageId,
          url: p.localUri,
          name: p.name ?? 'My background',
          owner: 'mine',
          createdAt: now,
        },
        ...mine,
      ];
      customImageUrl = p.localUri;
      choice = { kind: 'upload', imageId };
    } else if (p.kind === 'callbg.imageRemove') {
      if (p.imageId) {
        uploads = uploads.filter((u) => u.imageId !== p.imageId);
        if (choice?.kind === 'upload' && choice.imageId === p.imageId) choice = null;
      } else {
        const latest = uploads.find((u) => u.owner === 'mine');
        if (latest) uploads = uploads.filter((u) => u !== latest);
        if (choice?.kind === 'custom') choice = null;
      }
      customImageUrl = mineFirst();
      if (choice?.kind === 'custom' && !customImageUrl) choice = null;
    } else if (p.choice.kind === 'custom') {
      if (customImageUrl) choice = p.choice;
    } else if (p.choice.kind === 'upload') {
      const id = p.choice.imageId;
      if (uploads.some((u) => u.imageId === id)) choice = p.choice;
    } else choice = p.choice;
  }
  return {
    ...state,
    choice,
    customImageUrl,
    uploads,
    appearance: appearance ?? state.appearance ?? DEFAULT_CALL_APPEARANCE,
    effective: effectiveCallBackground(choice, state.policy),
  };
}

/** Before the first load with no connection: nothing is known about the organization yet. */
export const UNKNOWN_CALL_BACKGROUND: CallBackgroundState = {
  choice: null,
  effective: { kind: 'none' },
  customImageUrl: null,
  uploads: [],
  policy: { defaultChoice: { kind: 'none' }, enforceLogo: false, canManage: false },
  brand: { name: '', logo: null, primary: '#1f3a5f', secondary: '#c9a227' },
  appearance: DEFAULT_CALL_APPEARANCE,
};

const PRESET_NAMES = new Map<string, string>(CALL_BACKGROUND_PRESETS.map((p) => [p.id, p.name]));

export function callBackgroundLabel(c: CallBackgroundChoice): string {
  switch (c.kind) {
    case 'none':
      return 'No background';
    case 'blur':
      return 'Blur';
    case 'logo':
      return 'Company background';
    case 'custom':
      return 'Your image';
    case 'upload':
      return 'Uploaded background';
    case 'preset':
      return PRESET_NAMES.get(c.presetId) ?? 'Background';
  }
}

export const PRESET_GROUPS: {
  group: string;
  presets: { id: CallBackgroundPresetId; name: string }[];
}[] = ['Office', 'Home'].map((group) => ({
  group,
  presets: CALL_BACKGROUND_PRESETS.filter((p) => p.group === group).map((p) => ({
    id: p.id,
    name: p.name,
  })),
}));

/** Largest personal image, as on web (the server takes up to 2 MB). */
export const CALL_BACKGROUND_MAX_W = 1920;
export const CALL_BACKGROUND_MAX_H = 1080;

/** Size to shrink a picture to so it fits within 1920x1080, keeping its shape. */
export function fitCallBackground(
  width: number,
  height: number,
): { width: number; height: number } {
  if (!width || !height) return { width: CALL_BACKGROUND_MAX_W, height: CALL_BACKGROUND_MAX_H };
  const s = Math.min(1, CALL_BACKGROUND_MAX_W / width, CALL_BACKGROUND_MAX_H / height);
  return { width: Math.round(width * s), height: Math.round(height * s) };
}

/** Darkens (negative) or lightens (positive) a #rrggbb color, as the web company background does. */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) =>
    Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)
      .toString(16)
      .padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}
