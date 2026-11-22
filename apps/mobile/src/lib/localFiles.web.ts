/**
 * Web preview: picked files are blob: URLs that live as long as the tab. The preview is
 * for screenshots only, so queued files do not survive a reload there.
 */
export async function keepPickedFile(uri: string): Promise<string> {
  return uri;
}

export function deleteLocalFile(uri: string): void {
  if (uri.startsWith('blob:')) URL.revokeObjectURL(uri);
}

export function pruneLocalFiles(): number {
  return 0;
}

export async function putFileBytes(
  url: string,
  localUri: string,
  headers: Record<string, string>,
  method: 'PUT' | 'POST' = 'PUT',
): Promise<{ status: number; body: string }> {
  const blob = await (await fetch(localUri)).blob();
  const r = await fetch(url, { method, headers, body: blob });
  return { status: r.status, body: await r.text() };
}

export async function localFileSize(uri: string): Promise<number> {
  try {
    return (await (await fetch(uri)).blob()).size;
  } catch {
    return 0;
  }
}

/** Web preview: the document comes back as a blob URL. */
export async function downloadDocument(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
  fileName: string,
): Promise<string> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let msg = `Download failed (HTTP ${res.status})`;
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      if (j.error?.message) msg = j.error.message;
    } catch {
      // not JSON
    }
    throw Object.assign(new Error(msg), { status: res.status });
  }
  const blobUrl = URL.createObjectURL(await res.blob());
  lastNames.set(blobUrl, fileName);
  return blobUrl;
}

const lastNames = new Map<string, string>();

/** Web preview: saves the file through the browser. */
export async function shareDocument(uri: string): Promise<void> {
  const a = document.createElement('a');
  a.href = uri;
  a.download = lastNames.get(uri) ?? 'document';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
