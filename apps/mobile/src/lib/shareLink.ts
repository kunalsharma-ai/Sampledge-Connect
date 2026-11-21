import { Platform, Share } from 'react-native';

/**
 * Hands a link to the system share sheet (Messages, Mail, Copy and so on) on phones. In the
 * web preview it is copied to the clipboard. Returns what happened, for a short confirmation.
 */
export async function shareLink(url: string, title: string): Promise<'shared' | 'copied'> {
  if (Platform.OS === 'web') {
    await globalThis.navigator?.clipboard?.writeText(url);
    return 'copied';
  }
  await Share.share({ message: url, url, title });
  return 'shared';
}
