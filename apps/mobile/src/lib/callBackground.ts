import {
  CALL_BACKGROUND_PRESETS,
  type CallBackgroundChoice,
  type CallBackgroundPolicy,
  type CallBackgroundPresetId,
  type CallBackgroundState,
} from '@sampledge/contracts';
import type { ActionInput } from '../db/work';

export type PendingCallBackground = Extract<ActionInput, { kind: `callbg.${string}` }>;

export const sameChoice = (a: CallBackgroundChoice | null, b: CallBackgroundChoice | null) =>
  !!a &&
  !!b &&
  a.kind === b.kind &&
  (a.kind !== 'preset' || (b.kind === 'preset' && a.presetId === b.presetId));

/** What applies in calls: the company background when required, else my pick or the default. */
export function effectiveCallBackground(
  choice: CallBackgroundChoice | null,
  policy: Pick<CallBackgroundPolicy, 'defaultChoice' | 'enforceLogo'>,
): CallBackgroundChoice {
  return policy.enforceLogo ? { kind: 'logo' } : (choice ?? policy.defaultChoice);
}

/**
 * The server's copy with changes made on this device laid over it, in the order they were made,
 * the same way the server applies them: an upload selects the image, and removing the image
 * while it is in use goes back to the default.
 */
export function withPendingCallBackground(
  state: CallBackgroundState,
  pending: readonly PendingCallBackground[],
): CallBackgroundState {
  let { choice, customImageUrl } = state;
  for (const p of pending) {
    if (p.kind === 'callbg.image') {
      customImageUrl = p.localUri;
      choice = { kind: 'custom' };
    } else if (p.kind === 'callbg.imageRemove') {
      customImageUrl = null;
      if (choice?.kind === 'custom') choice = null;
    } else if (p.choice.kind !== 'custom' || customImageUrl) choice = p.choice;
  }
  return {
    ...state,
    choice,
    customImageUrl,
    effective: effectiveCallBackground(choice, state.policy),
  };
}

/** Before the first load with no connection: nothing is known about the organization yet. */
export const UNKNOWN_CALL_BACKGROUND: CallBackgroundState = {
  choice: null,
  effective: { kind: 'none' },
  customImageUrl: null,
  policy: { defaultChoice: { kind: 'none' }, enforceLogo: false, canManage: false },
  brand: { name: '', logo: null, primary: '#1f3a5f', secondary: '#c9a227' },
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
    case 'preset':
      return PRESET_NAMES.get(c.presetId) ?? 'Background';
  }
}

export const PRESET_GROUPS: {
  group: string;
  presets: { id: CallBackgroundPresetId; name: string }[];
}[] = ['Office', 'Simple'].map((group) => ({
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
