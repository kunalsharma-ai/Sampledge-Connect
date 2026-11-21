import { Directory, File, Paths, UploadType } from 'expo-file-system';

/**
 * Files you attach are copied into the app's document folder right away, so a message
 * queued offline still has its bytes after the picker's temporary copy is gone or the
 * app restarts.
 */
const folder = () => new Directory(Paths.document, 'outgoing-files');

export async function keepPickedFile(uri: string, fileName: string): Promise<string> {
  const dir = folder();
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const safe = fileName.replace(/[^\w.\- ]+/g, '_').slice(-80) || 'file';
  const dest = new File(
    dir,
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${safe}`,
  );
  new File(uri).copy(dest);
  return dest.uri;
}

export function deleteLocalFile(uri: string): void {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // already gone
  }
}

/** Copies in the outgoing folder that no message refers to any more. */
export function pruneLocalFiles(live: ReadonlySet<string>): number {
  const dir = folder();
  if (!dir.exists) return 0;
  let removed = 0;
  for (const entry of dir.list()) {
    if (entry instanceof File && !live.has(entry.uri)) {
      deleteLocalFile(entry.uri);
      removed++;
    }
  }
  return removed;
}

/** Streams the file as the raw request body (no multipart), as the upload endpoint expects. */
export async function putFileBytes(
  url: string,
  localUri: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: string }> {
  const r = await new File(localUri).upload(url, {
    httpMethod: 'PUT',
    uploadType: UploadType.BINARY_CONTENT,
    headers,
  });
  return { status: r.status, body: r.body };
}

/** Size in bytes of a file in app storage (0 if it is gone). */
export async function localFileSize(uri: string): Promise<number> {
  try {
    const f = new File(uri);
    return f.exists ? f.size : 0;
  } catch {
    return 0;
  }
}
