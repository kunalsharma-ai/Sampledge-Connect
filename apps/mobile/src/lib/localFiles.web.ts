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
): Promise<{ status: number; body: string }> {
  const blob = await (await fetch(localUri)).blob();
  const r = await fetch(url, { method: 'PUT', headers, body: blob });
  return { status: r.status, body: await r.text() };
}

export async function localFileSize(uri: string): Promise<number> {
  try {
    return (await (await fetch(uri)).blob()).size;
  } catch {
    return 0;
  }
}
