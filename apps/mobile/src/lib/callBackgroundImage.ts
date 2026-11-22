import { CALL_BACKGROUND_MAX_BYTES } from '@sampledge/contracts';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { fitCallBackground } from './callBackground';
import { keepPickedFile, localFileSize } from './localFiles';

/**
 * Turns a picked picture into what the server takes for a call background: a JPEG within
 * 1920x1080 and under 2 MB, kept in app storage so an upload queued offline survives a restart.
 */
export async function prepareCallBackground(
  uri: string,
  width: number,
  height: number,
): Promise<string> {
  const ctx = ImageManipulator.manipulate(uri);
  const size = fitCallBackground(width, height);
  if (size.width !== width || size.height !== height) ctx.resize(size);
  const image = await ctx.renderAsync();
  for (const compress of [0.85, 0.7, 0.55, 0.4]) {
    const r = await image.saveAsync({ compress, format: SaveFormat.JPEG });
    if ((await localFileSize(r.uri)) <= CALL_BACKGROUND_MAX_BYTES)
      return keepPickedFile(r.uri, 'call-background.jpg');
  }
  throw new Error('That picture is too detailed to use as a background. Try another one.');
}
