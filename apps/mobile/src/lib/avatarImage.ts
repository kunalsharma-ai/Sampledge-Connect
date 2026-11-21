import { MAX_AVATAR_BYTES } from '@sampledge/contracts';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { base64Bytes, squareCrop } from './profile';

export const AVATAR_SIZE = 512;

/**
 * Turns a picked or taken picture into what the server accepts: a centred 512 px square JPEG
 * under MAX_AVATAR_BYTES, as a data URL. Compression steps down until it fits.
 */
export async function prepareAvatar(uri: string, width: number, height: number): Promise<string> {
  const ctx = ImageManipulator.manipulate(uri);
  if (width && height && width !== height) ctx.crop(squareCrop(width, height));
  ctx.resize({ width: AVATAR_SIZE, height: AVATAR_SIZE });
  const image = await ctx.renderAsync();
  for (const compress of [0.8, 0.65, 0.5, 0.35]) {
    const r = await image.saveAsync({ base64: true, compress, format: SaveFormat.JPEG });
    if (r.base64 && base64Bytes(r.base64) <= MAX_AVATAR_BYTES)
      return `data:image/jpeg;base64,${r.base64}`;
  }
  throw new Error('That picture is too detailed to use as a photo. Try another one.');
}
