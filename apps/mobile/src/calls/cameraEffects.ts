import {
  lookParams,
  type CallAppearance,
  type CallBackgroundChoice,
  type CallBackgroundState,
  type LookParams,
} from '@sampledge/contracts';

/** What the native camera processor draws behind you. Pictures are local files. */
export type NativeBackground =
  | { mode: 'off' }
  | { mode: 'blur' }
  | { mode: 'image'; uri: string }
  | { mode: 'brand'; primary: string; secondary: string; name: string; logoUri: string | null };

/** The JSON the native module reads (EffectsOptions.kt / EffectsOptions.swift). */
export interface NativeEffectsOptions {
  background: NativeBackground;
  /** Null when the look changes nothing. */
  look: LookParams | null;
  /** Face shaping strengths, 0..1. */
  face: { slim: number; eyes: number; nose: number };
}

export const NO_NATIVE_EFFECTS: NativeEffectsOptions = {
  background: { mode: 'off' },
  look: null,
  face: { slim: 0, eyes: 0, nose: 0 },
};

/** True when the look (not counting face shaping) leaves the picture as it is. */
export function isNeutralLook(a: CallAppearance): boolean {
  return (
    a.filter === 'natural' &&
    !a.brightness &&
    !a.contrast &&
    !a.saturation &&
    !a.warmth &&
    !a.lowLight &&
    !a.sharpness &&
    !a.smoothing
  );
}

/** Local copies of the pictures a background needs (see cameraEffectPictures.ts). */
export interface EffectPictures {
  /** The background picture, for a preset or an uploaded image. */
  image: string | null;
  /** The organization logo as a PNG or JPEG file, for the company background. */
  logo: string | null;
}

/**
 * The camera options for what applies in calls now (the organization's rule, my pick or the
 * default) and how I look. The look numbers come from lookParams in contracts, the same as web.
 * A picture that could not be fetched (offline, never downloaded) becomes blur, so the room
 * behind you stays private.
 */
export function nativeEffectsOptions(
  state: Pick<CallBackgroundState, 'effective' | 'appearance' | 'brand'>,
  pictures: EffectPictures,
): NativeEffectsOptions {
  const a = state.appearance;
  return {
    background: nativeBackground(state.effective, state.brand, pictures),
    look: isNeutralLook(a) ? null : lookParams(a),
    face: { slim: a.faceSlim / 100, eyes: a.eyes / 100, nose: a.nose / 100 },
  };
}

function nativeBackground(
  c: CallBackgroundChoice,
  brand: CallBackgroundState['brand'],
  pictures: EffectPictures,
): NativeBackground {
  switch (c.kind) {
    case 'none':
      return { mode: 'off' };
    case 'blur':
      return { mode: 'blur' };
    case 'logo':
      return {
        mode: 'brand',
        primary: brand.primary,
        secondary: brand.secondary,
        name: brand.name,
        logoUri: pictures.logo,
      };
    case 'preset':
    case 'upload':
    case 'custom':
      return pictures.image ? { mode: 'image', uri: pictures.image } : { mode: 'blur' };
  }
}

/** True when the camera has nothing to do (the processor is then switched off). */
export const nativeEffectsOff = (o: NativeEffectsOptions) =>
  o.background.mode === 'off' && !o.look && !o.face.slim && !o.face.eyes && !o.face.nose;

/** A stable file name for a downloaded picture (an upload's id, or a hash of its address). */
export function pictureCacheName(url: string): string {
  let h = 2166136261;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `bg-${(h >>> 0).toString(16).padStart(8, '0')}-${url.length.toString(36)}`;
}

/** What a logo is: an image file the camera can read, a vector (SVG), or a link to fetch. */
export function logoSource(
  logo: string | null,
):
  | { kind: 'none' }
  | { kind: 'data'; ext: 'png' | 'jpg' | 'webp'; base64: string }
  | { kind: 'url'; url: string } {
  if (!logo) return { kind: 'none' };
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(logo);
  if (m) {
    const t = m[1]!.toLowerCase();
    return {
      kind: 'data',
      ext: t === 'png' ? 'png' : t === 'webp' ? 'webp' : 'jpg',
      base64: m[2]!,
    };
  }
  if (/^https?:\/\//i.test(logo) && !/\.svg(\?|$)/i.test(logo)) return { kind: 'url', url: logo };
  // An SVG logo can't be read by the camera; the company background then shows the name only.
  return { kind: 'none' };
}
