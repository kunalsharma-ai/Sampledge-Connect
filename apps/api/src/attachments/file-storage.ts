import { GridFSBucket, type Db } from 'mongodb';
import type { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Where attachment bytes live. Metadata and access control stay in MongoDB
 * (`attachments`), so a storage backend only ever sees opaque keys.
 * GridFS is built; a Nextcloud (WebDAV) adapter is planned behind the same interface.
 */
export interface FileStorage {
  /** Streams `body` through `transforms` (e.g. size/hash meters) into storage. */
  put(
    key: string,
    body: Readable,
    meta: { tenantId: string; contentType: string },
    transforms?: Transform[],
  ): Promise<void>;
  /** Streams the bytes; `range` is inclusive [start, end] for HTTP Range requests (media seeking). */
  get(key: string, range?: { start: number; end: number }): Readable;
  delete(key: string): Promise<void>;
}

export const FILE_STORAGE = Symbol('FILE_STORAGE');

export class GridFsStorage implements FileStorage {
  private readonly bucket: GridFSBucket;
  constructor(db: Db) {
    this.bucket = new GridFSBucket(db, {
      bucketName: 'attachment_files',
      chunkSizeBytes: 255 * 1024,
    });
  }
  async put(
    key: string,
    body: Readable,
    meta: { tenantId: string; contentType: string },
    transforms: Transform[] = [],
  ) {
    body.pause();
    await this.delete(key);
    const up = this.bucket.openUploadStream(key, { metadata: meta });
    try {
      await pipeline([body, ...transforms, up]);
    } catch (e) {
      await this.bucket.delete(up.id).catch(() => undefined);
      throw e;
    }
  }
  get(key: string, range?: { start: number; end: number }): Readable {
    return this.bucket.openDownloadStreamByName(
      key,
      range ? { start: range.start, end: range.end + 1 } : undefined,
    );
  }
  async delete(key: string) {
    for await (const f of this.bucket.find({ filename: key }, { projection: { _id: 1 } })) {
      await this.bucket.delete(f._id).catch(() => undefined);
    }
  }
}
