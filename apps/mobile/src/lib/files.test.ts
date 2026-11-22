import type { FileItem } from '@sampledge/contracts';
import { describe, expect, it } from 'vitest';
import type { LocalFile } from '../db/store';
import { mergeFiles } from './files';

const server = (id: string): FileItem => ({
  attachmentId: id,
  conversationId: 'c1',
  uploaderId: 'u1',
  fileName: `${id}.pdf`,
  mimeType: 'application/pdf',
  sizeBytes: 10,
  width: null,
  height: null,
  status: 'ready',
  createdAt: '2026-11-20T10:00:00.000Z',
  messageId: `m-${id}`,
  kind: 'documents',
  storage: 'connect',
});
const phone = (attachmentId: string | null, fileName: string): LocalFile => ({
  attachmentId,
  fileName,
  mimeType: 'image/png',
  sizeBytes: 5,
  width: null,
  height: null,
  localUri: attachmentId ? null : `file:///${fileName}`,
  recording: null,
  durationMs: null,
  deletedAt: null,
  kind: 'images',
  messageId: null,
  clientId: `cl-${fileName}`,
  position: 0,
  conversationId: 'c1',
  uploaderId: 'me',
  createdAt: '2026-11-21T10:00:00.000Z',
});

describe('mergeFiles', () => {
  it('shows the phone copy until the server answers', () => {
    const rows = mergeFiles(null, [phone('a1', 'one.png'), phone(null, 'two.png')]);
    expect(rows.map((r) => [r.fileName, r.storage, r.waiting])).toEqual([
      ['one.png', 'phone', false],
      ['two.png', 'phone', true],
    ]);
  });

  it('online: files still uploading first, then the server list, no duplicates', () => {
    const rows = mergeFiles(
      [server('a1'), server('a2')],
      [phone('a1', 'a1.pdf'), phone(null, 'up.png')],
    );
    expect(rows.map((r) => r.key)).toEqual(['cl-up.png:0', 'a1', 'a2']);
    expect(rows[0]!.waiting).toBe(true);
  });
});
