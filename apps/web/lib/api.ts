import type { ApiError } from '@sampledge/contracts';
import { API_URL } from './config';

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly error: ApiError,
  ) {
    super(error.message);
  }
}

/** JSON request. A network failure surfaces as UNAVAILABLE so screens can show their offline state. */
export async function apiRequest<T>(
  method: string,
  path: string,
  opts: { token?: string | null; body?: unknown } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiFailure(0, {
      code: 'UNAVAILABLE',
      message: "Can't reach SampConnect. Check your connection.",
    });
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new ApiFailure(
      res.status,
      json?.error ?? { code: 'INTERNAL', message: `HTTP ${res.status}` },
    );
  }
  return json as T;
}

/** POST a caption clip (raw audio) and return the recognized text. */
export async function postCaptionClip(path: string, clip: Blob, token?: string | null) {
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method: 'POST',
      headers: {
        'content-type': clip.type || 'audio/webm',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: clip,
    });
  } catch {
    throw new Error("Can't reach SampConnect for captions.");
  }
  const json = (await res.json().catch(() => null)) as {
    text?: string;
    error?: { message?: string };
  } | null;
  if (!res.ok) throw new Error(json?.error?.message ?? `Captions failed (HTTP ${res.status})`);
  return json?.text ?? '';
}
