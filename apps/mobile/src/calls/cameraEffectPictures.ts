import type { CallBackgroundChoice, CallBackgroundState } from '@sampledge/contracts';
import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';
import { isLocalUpload, localUploadUri, uploadUrl } from '../lib/callBackground';
import { PRESET_IMAGES } from '../lib/callBackgroundImages';
import { logoSource, pictureCacheName, type EffectPictures } from './cameraEffects';

/**
 * Local files for the pictures a background needs, so the camera can read them: bundled presets,
 * uploads (downloaded once and kept), and the organization logo. Kept in the app's own storage so
 * a call with no connection still has them.
 */
const folder = () => new Directory(Paths.document, 'call-backgrounds');

function cached(name: string): File {
  const dir = folder();
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return new File(dir, name);
}

async function download(url: string): Promise<string | null> {
  if (url.startsWith('file://') || url.startsWith('/')) return url;
  const file = cached(`${pictureCacheName(url)}.img`);
  if (file.exists && file.size > 0) return file.uri;
  try {
    const got = await File.downloadFileAsync(url, file, { idempotent: true });
    return got.uri;
  } catch {
    return null;
  }
}

async function imageFor(
  choice: CallBackgroundChoice,
  state: Pick<CallBackgroundState, 'uploads' | 'customImageUrl'>,
): Promise<string | null> {
  if (choice.kind === 'preset') {
    try {
      const asset = await Asset.fromModule(PRESET_IMAGES[choice.presetId]).downloadAsync();
      return asset.localUri ?? asset.uri ?? null;
    } catch {
      return null;
    }
  }
  if (choice.kind === 'upload' && isLocalUpload(choice.imageId))
    return localUploadUri(choice.imageId);
  const url = uploadUrl(state, choice);
  return url ? download(url) : null;
}

async function logoFor(
  brand: CallBackgroundState['brand'],
  svgPng: string | null,
): Promise<string | null> {
  const src = logoSource(brand.logo);
  if (src.kind === 'url') return download(src.url);
  if (src.kind === 'data') {
    const file = cached(`logo-${pictureCacheName(src.base64)}.${src.ext}`);
    if (!file.exists) {
      try {
        file.create({ intermediates: true, overwrite: true });
        file.write(src.base64, { encoding: 'base64' });
      } catch {
        return null;
      }
    }
    return file.uri;
  }
  // A vector logo, drawn to a PNG on screen by SvgLogoSnapshot.
  return svgPng;
}

/** Everything the camera needs to show this background, as local files. */
export async function effectPictures(
  state: Pick<CallBackgroundState, 'effective' | 'uploads' | 'customImageUrl' | 'brand'>,
  svgLogoPng: string | null,
): Promise<EffectPictures> {
  const c = state.effective;
  if (c.kind === 'logo') return { image: null, logo: await logoFor(state.brand, svgLogoPng) };
  if (c.kind === 'preset' || c.kind === 'upload' || c.kind === 'custom')
    return { image: await imageFor(c, state), logo: null };
  return { image: null, logo: null };
}

/** Saves a vector logo drawn to PNG (base64) and returns its file. */
export function saveLogoPng(key: string, base64: string): string | null {
  try {
    const file = cached(`logo-svg-${pictureCacheName(key)}.png`);
    if (!file.exists) {
      file.create({ intermediates: true, overwrite: true });
      file.write(base64, { encoding: 'base64' });
    }
    return file.uri;
  } catch {
    return null;
  }
}
