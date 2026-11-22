import type { FileItem, FileKind } from '@sampledge/contracts';
import type { LocalFile } from '../db/store';

export const FILE_FILTERS: { key: FileKind | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'documents', label: 'Documents' },
  { key: 'images', label: 'Images' },
  { key: 'media', label: 'Audio & video' },
  { key: 'other', label: 'Other' },
];

/** One row on the Files screen, from the server or from this phone. */
export interface FileRow {
  key: string;
  attachmentId: string | null;
  localUri: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  kind: FileKind;
  conversationId: string;
  messageId: string | null;
  uploaderId: string;
  createdAt: string;
  storage: 'connect' | 'nextcloud' | 'phone';
  /** Picked on this phone and not uploaded yet. */
  waiting: boolean;
}

export function rowFromServer(f: FileItem): FileRow {
  return {
    key: f.attachmentId,
    attachmentId: f.attachmentId,
    localUri: null,
    fileName: f.fileName,
    mimeType: f.mimeType,
    sizeBytes: f.sizeBytes,
    kind: f.kind,
    conversationId: f.conversationId,
    messageId: f.messageId,
    uploaderId: f.uploaderId,
    createdAt: f.createdAt,
    storage: f.storage,
    waiting: false,
  };
}

export function rowFromPhone(f: LocalFile): FileRow {
  return {
    key: f.attachmentId ?? `${f.clientId}:${f.position}`,
    attachmentId: f.attachmentId,
    localUri: f.localUri,
    fileName: f.fileName,
    mimeType: f.mimeType,
    sizeBytes: f.sizeBytes,
    kind: f.kind,
    conversationId: f.conversationId,
    messageId: f.messageId,
    uploaderId: f.uploaderId,
    createdAt: f.createdAt,
    storage: 'phone',
    waiting: !f.attachmentId,
  };
}

/**
 * What the Files screen shows. Online: files still waiting to upload from this phone first (the
 * server does not know them yet), then the server's list. Offline, or before the server answers:
 * every file saved on this phone.
 */
export function mergeFiles(server: FileItem[] | null, phone: LocalFile[]): FileRow[] {
  const local = phone.map(rowFromPhone);
  if (!server) return local;
  return [...local.filter((r) => r.waiting), ...server.map(rowFromServer)];
}
