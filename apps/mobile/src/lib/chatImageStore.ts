import { FlipType, ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import Storage from 'expo-sqlite/kv-store';
import { useEffect, useState } from 'react';
import { Emitter } from './emitter';
import {
  CHAT_IMAGE_MAX_BYTES,
  NEW_IMAGE,
  fitWithin,
  parseChatImage,
  pickChatImage,
  type ChatImage,
} from './chatImage';
import { base64Bytes } from './profile';

/**
 * Device settings, kept outside the account cache like the app theme: one key for all chats and
 * one per conversation. Nothing here is sent to the server.
 */
const keyFor = (conversationId?: string | null) =>
  conversationId ? `chat.image.${conversationId}` : 'chat.image';
const events = new Emitter<{ change: { key: string } }>();

export function readChatImage(conversationId?: string | null): ChatImage | null {
  try {
    return parseChatImage(Storage.getItemSync(keyFor(conversationId)));
  } catch {
    return null;
  }
}

export function saveChatImage(conversationId: string | null, v: ChatImage | null): void {
  const key = keyFor(conversationId);
  if (v) Storage.setItemSync(key, JSON.stringify(v));
  else Storage.removeItemSync(key);
  events.emit('change', { key });
}

export function adjustChatImage(
  conversationId: string | null,
  patch: Partial<Omit<ChatImage, 'uri' | 'width' | 'height'>>,
): void {
  const cur = readChatImage(conversationId);
  if (cur) saveChatImage(conversationId, { ...cur, ...patch });
}

/** Shrinks a picked picture on the phone and saves it (for all chats, or one conversation). */
export async function chooseChatImage(
  conversationId: string | null,
  picked: { uri: string; width: number; height: number },
): Promise<void> {
  const size = fitWithin(picked.width, picked.height);
  const ctx = ImageManipulator.manipulate(picked.uri);
  ctx.resize(size);
  const image = await ctx.renderAsync();
  for (const compress of [0.8, 0.65, 0.5, 0.35]) {
    const r = await image.saveAsync({ base64: true, compress, format: SaveFormat.JPEG });
    if (r.base64 && base64Bytes(r.base64) <= CHAT_IMAGE_MAX_BYTES) {
      saveChatImage(conversationId, {
        uri: `data:image/jpeg;base64,${r.base64}`,
        width: r.width || size.width,
        height: r.height || size.height,
        ...NEW_IMAGE,
      });
      return;
    }
  }
  throw new Error('That picture is too large to use. Try another one.');
}

/** Rotates or flips the saved picture itself (baked into the JPEG, as on the web). */
export async function transformChatImage(
  conversationId: string | null,
  t: { rotate: 90 | -90 } | { flip: 'horizontal' | 'vertical' },
): Promise<void> {
  const cur = readChatImage(conversationId);
  if (!cur) return;
  const ctx = ImageManipulator.manipulate(cur.uri);
  if ('rotate' in t) ctx.rotate(t.rotate);
  else ctx.flip(t.flip === 'horizontal' ? FlipType.Horizontal : FlipType.Vertical);
  const image = await ctx.renderAsync();
  const r = await image.saveAsync({ base64: true, compress: 0.8, format: SaveFormat.JPEG });
  if (!r.base64) throw new Error('Could not edit that picture.');
  const turned = 'rotate' in t;
  saveChatImage(conversationId, {
    ...cur,
    uri: `data:image/jpeg;base64,${r.base64}`,
    width: r.width || (turned ? cur.height : cur.width),
    height: r.height || (turned ? cur.width : cur.height),
    // Keep the same part of the picture in view.
    focusX: turned
      ? t.rotate === 90
        ? 1 - cur.focusY
        : cur.focusY
      : t.flip === 'horizontal'
        ? 1 - cur.focusX
        : cur.focusX,
    focusY: turned
      ? t.rotate === 90
        ? cur.focusX
        : 1 - cur.focusX
      : t.flip === 'vertical'
        ? 1 - cur.focusY
        : cur.focusY,
  });
}

/** One slot's picture, kept current. */
export function useChatImageSlot(conversationId: string | null): ChatImage | null {
  const key = keyFor(conversationId);
  const [v, setV] = useState<ChatImage | null>(() => readChatImage(conversationId));
  useEffect(() => {
    setV(readChatImage(conversationId));
    return events.on('change', (e) => {
      if (e.key === key) setV(readChatImage(conversationId));
    });
  }, [key, conversationId]);
  return v;
}

/** The picture to show in a conversation: its own, else the one for all chats. */
export function useChatImage(conversationId: string): ChatImage | null {
  return pickChatImage(useChatImageSlot(null), useChatImageSlot(conversationId));
}
