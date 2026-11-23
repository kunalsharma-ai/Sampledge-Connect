'use client';
import * as React from 'react';
import {
  BLOCKED_EXTENSIONS,
  MAX_ATTACHMENT_BYTES,
  type Attachment,
  type AttachmentUrl,
  type UploadTicket,
} from '@sampledge/contracts';
import { ApiFailure, apiRequest } from './api';
import { API_URL, toApiUrl } from './config';

/** Client-side checks that mirror the server's, so the user hears about a bad file immediately. */
export function rejectReason(file: File): string | null {
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
  if ((BLOCKED_EXTENSIONS as readonly string[]).includes(ext))
    return 'This file type is not allowed';
  if (file.size === 0) return 'This file is empty';
  if (file.size > MAX_ATTACHMENT_BYTES) return 'Files can be up to 100 MB';
  return null;
}

async function imageSize(file: File): Promise<{ width?: number; height?: number }> {
  if (!/^image\/(png|jpe?g|gif|webp|avif)$/.test(file.type)) return {};
  try {
    const bmp = await createImageBitmap(file);
    const size = { width: bmp.width, height: bmp.height };
    bmp.close();
    return size;
  } catch {
    return {};
  }
}

function putBytes(
  url: string,
  file: File,
  token: string,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', API_URL + url);
    xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let err = { code: 'INTERNAL', message: `Upload failed (HTTP ${xhr.status})` };
      try {
        err = JSON.parse(xhr.responseText).error ?? err;
      } catch {
        /* keep the generic error */
      }
      reject(new ApiFailure(xhr.status, err as ApiFailure['error']));
    };
    xhr.onerror = () =>
      reject(new ApiFailure(0, { code: 'UNAVAILABLE', message: 'Upload interrupted' }));
    xhr.onabort = () => reject(new DOMException('aborted', 'AbortError'));
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

/** Ticket, then raw bytes, then complete. Returns the ready attachment. */
export async function uploadFile(
  file: File,
  conversationId: string,
  getToken: () => Promise<string | null>,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
  extra: { recording?: 'voice' | 'video' | 'screen'; durationMs?: number } = {},
): Promise<Attachment> {
  const token = await getToken();
  if (!token) throw new ApiFailure(401, { code: 'UNAUTHENTICATED', message: 'Sign in again' });
  const ticket = await apiRequest<UploadTicket>('POST', '/v1/uploads', {
    token,
    body: {
      conversationId,
      fileName: file.name,
      mimeType: (file.type || 'application/octet-stream').split(';')[0]!.trim(),
      sizeBytes: file.size,
      ...(await imageSize(file)),
      ...(extra.recording ? { recording: extra.recording } : {}),
      ...(extra.durationMs ? { durationMs: Math.round(extra.durationMs) } : {}),
    },
  });
  await putBytes(ticket.uploadUrl, file, token, onProgress, signal);
  return apiRequest<Attachment>('POST', `/v1/uploads/${ticket.uploadId}/complete`, {
    token: (await getToken()) ?? token,
  });
}

const urlCache = new Map<string, { url: string; expires: number }>();
const inflight = new Map<string, Promise<string>>();

/** Signed download URL for an attachment, cached until shortly before it expires. */
export async function attachmentUrl(
  attachmentId: string,
  getToken: () => Promise<string | null>,
): Promise<string> {
  const hit = urlCache.get(attachmentId);
  if (hit && hit.expires - Date.now() > 60_000) return hit.url;
  let p = inflight.get(attachmentId);
  if (!p) {
    p = (async () => {
      const r = await apiRequest<AttachmentUrl>('GET', `/v1/attachments/${attachmentId}/url`, {
        token: await getToken(),
      });
      // Absolute when the API has PUBLIC_API_URL configured, otherwise a path on the API.
      const url = toApiUrl(r.url);
      urlCache.set(attachmentId, { url, expires: Date.parse(r.expiresAt) });
      return url;
    })().finally(() => inflight.delete(attachmentId));
    inflight.set(attachmentId, p);
  }
  return p;
}

export function useAttachmentUrl(
  attachmentId: string | null,
  getToken: () => Promise<string | null>,
): { url: string | null; error: boolean } {
  const [state, setState] = React.useState<{ url: string | null; error: boolean }>({
    url: null,
    error: false,
  });
  React.useEffect(() => {
    if (!attachmentId) return;
    let live = true;
    attachmentUrl(attachmentId, getToken).then(
      (url) => live && setState({ url, error: false }),
      () => live && setState({ url: null, error: true }),
    );
    return () => {
      live = false;
    };
  }, [attachmentId, getToken]);
  return state;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
