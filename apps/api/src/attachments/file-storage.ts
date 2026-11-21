import { GridFSBucket, type Db } from 'mongodb';
import type { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Where attachment bytes live. Metadata and access control stay in MongoDB
 * (`attachments`), so a storage backend only ever sees opaque keys.
 * GridFS always takes the upload (so size and checksum checks run in one place);
 * `commit` then decides where the finished file lives (see RoutingStorage).
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
  /**
   * Called once a file is complete and verified. Returns the key to store from now on
   * (it may move to another backend) and, for copies made in the background, a promise
   * that settles with the copy's outcome.
   */
  commit?(key: string, meta: { tenantId: string; size: number }): Promise<StorageCommit>;
}

export interface StorageCommit {
  key: string;
  backend: StorageBackend;
  /** Test-mode mirror copy running in the background. */
  mirror?: Promise<{ ok: boolean; error: string | null }>;
  /** Live mode could not reach the target; the file stayed in Connect storage. */
  fallbackError?: string;
}

export type StorageBackend = 'gridfs' | 'nextcloud';

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
