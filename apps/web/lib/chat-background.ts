'use client';
import * as React from 'react';
import {
  CHAT_BACKGROUND_MAX_EDGE,
  ChatBackgroundAdjustSchema,
  DEFAULT_CHAT_BACKGROUND_ADJUST,
  customImagesAllowed,
  type ChatBackgroundAdjust,
} from '@sampledge/contracts';
import { useEngine } from './engine';
import { useChatTheme } from './chat-theme';

/**
 * Personal chat background pictures. They never leave this device: the picture and its edits
 * are kept in this browser's offline database, one for all chats and optionally one per
 * conversation (which wins). Nothing is uploaded, so there is nothing to set up.
 */
export type ChatBackgroundSlot = 'all' | { conversationId: string };

export interface StoredChatBackground {
  image: Blob;
  adjust: ChatBackgroundAdjust;
  updatedAt: number;
}

export interface LoadedChatBackground extends StoredChatBackground {
  /** An object URL for the picture, valid while the page is open. */
  url: string;
}

const keyOf = (slot: ChatBackgroundSlot) =>
  slot === 'all' ? 'chatBackground:all' : `chatBackground:c:${slot.conversationId}`;

/** One cache per page, so the timeline, Settings and the details panel agree. */
const cache = new Map<string, LoadedChatBackground | null>();
const loading = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function put(key: string, v: StoredChatBackground | null) {
  const old = cache.get(key);
  if (old) URL.revokeObjectURL(old.url);
  cache.set(key, v ? { ...v, url: URL.createObjectURL(v.image) } : null);
  notify();
}

function parseStored(value: unknown): StoredChatBackground | null {
  const v = value as Partial<StoredChatBackground> | undefined;
  if (!v || !(v.image instanceof Blob)) return null;
  const adjust = ChatBackgroundAdjustSchema.safeParse(v.adjust ?? {});
  return {
    image: v.image,
    adjust: adjust.success ? adjust.data : DEFAULT_CHAT_BACKGROUND_ADJUST,
    updatedAt: v.updatedAt ?? 0,
  };
}

function useSubscribe() {
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    listeners.add(force);
    return () => void listeners.delete(force);
  }, []);
}

/** Read and change one slot (all chats, or one conversation). */
export function useChatBackgroundSlot(slot: ChatBackgroundSlot | null) {
  const { db } = useEngine();
  useSubscribe();
  const key = slot ? keyOf(slot) : null;

  React.useEffect(() => {
    if (!key || cache.has(key) || loading.has(key)) return;
    const p = db.meta
      .get(key)
      .then((row) => put(key, parseStored(row?.value)))
      .catch(() => put(key, null))
      .finally(() => loading.delete(key));
    loading.set(key, p);
  }, [db, key]);

  const save = React.useCallback(
    async (image: Blob, adjust: ChatBackgroundAdjust) => {
      if (!key) return;
      const v: StoredChatBackground = { image, adjust, updatedAt: Date.now() };
      await db.meta.put({ key, value: v });
      put(key, v);
    },
    [db, key],
  );
  const remove = React.useCallback(async () => {
    if (!key) return;
    await db.meta.delete(key);
    put(key, null);
  }, [db, key]);

  return {
    background: key ? (cache.get(key) ?? null) : null,
    loaded: key ? cache.has(key) : true,
    save,
    remove,
  };
}

/**
 * The picture to show behind a conversation: its own, else the one for all chats. None when
 * the organization has switched personal pictures off (the pictures stay on the device).
 */
export function useChatBackground(conversationId: string | null) {
  const { policy } = useChatTheme();
  const all = useChatBackgroundSlot('all');
  const own = useChatBackgroundSlot(conversationId ? { conversationId } : null);
  if (!customImagesAllowed(policy)) return null;
  return own.background ?? all.background;
}

/**
 * Turns a picked file into a background picture: decoded on the device, shrunk to at most
 * 2560 px on the long edge, optionally rotated or flipped, and saved as JPEG (which also drops
 * location and camera metadata).
 */
export async function prepareChatBackground(
  file: Blob,
  opts: { rotate?: 0 | 90 | 180 | 270; flipX?: boolean } = {},
): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('This picture can’t be opened here. Try a JPEG, PNG or WebP picture.');
  }
  const rotate = opts.rotate ?? 0;
  const s = Math.min(1, CHAT_BACKGROUND_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * s);
  const h = Math.round(bitmap.height * s);
  const sideways = rotate === 90 || rotate === 270;
  const canvas = document.createElement('canvas');
  canvas.width = sideways ? h : w;
  canvas.height = sideways ? w : h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser can’t prepare pictures.');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  if (opts.flipX) ctx.scale(-1, 1);
  ctx.drawImage(bitmap, -w / 2, -h / 2, w, h);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Couldn’t prepare the picture.'))),
      'image/jpeg',
      0.88,
    ),
  );
}
