import { Logger } from '@nestjs/common';
import { PassThrough, type Readable, type Transform } from 'node:stream';
import type { IntegrationSettingsService } from '../integration-settings/integration-settings.service.js';
import type { FileStorage, GridFsStorage, StorageCommit } from './file-storage.js';
import {
  NEXTCLOUD_PROVIDER,
  NextcloudClient,
  nextcloudConfig,
  type NextcloudConfig,
} from './nextcloud.js';

/** Keys of files that live in Nextcloud: `nc:<tenantId>/<attachmentId>`. */
const NC = 'nc:';

function split(key: string) {
  const raw = key.startsWith(NC) ? key.slice(NC.length) : key;
  const i = raw.indexOf('/');
  return { tenantId: raw.slice(0, i), name: raw.slice(i + 1) };
}

/**
 * Uploads always land in GridFS first. On commit, per the tenant's Nextcloud setting:
 * - off: stay in GridFS.
 * - test: stay in GridFS and copy to Nextcloud in the background (reads never touch it).
 * - live: copy to Nextcloud, then drop the GridFS copy. If Nextcloud fails, the file
 *   stays in GridFS and the upload still succeeds.
 * Reads follow the key, so switching modes never strands an existing file.
 */
export class RoutingStorage implements FileStorage {
  private readonly log = new Logger('Storage');

  constructor(
    private readonly local: GridFsStorage,
    private readonly settings: IntegrationSettingsService,
  ) {}

  private async nextcloud(tenantId: string): Promise<NextcloudConfig | null> {
    const s = await this.settings.get(tenantId, NEXTCLOUD_PROVIDER.id).catch(() => null);
    if (!s?.enabled) return null;
    return nextcloudConfig(s.values);
  }

  /** Credentials for a file already in Nextcloud, even if the integration was since turned off. */
  private async nextcloudForRead(tenantId: string): Promise<NextcloudConfig | null> {
    const s = await this.settings.get(tenantId, NEXTCLOUD_PROVIDER.id).catch(() => null);
    return s ? nextcloudConfig(s.values) : null;
  }

  put(
    key: string,
    body: Readable,
    meta: { tenantId: string; contentType: string },
    transforms?: Transform[],
  ) {
    return this.local.put(key, body, meta, transforms);
  }

  get(key: string, range?: { start: number; end: number }): Readable {
    if (!key.startsWith(NC)) return this.local.get(key, range);
    const { tenantId, name } = split(key);
    // Resolve settings asynchronously but hand back a stream now, like GridFS does.
    const out = new PassThrough();
    this.nextcloudForRead(tenantId)
      .then((cfg) => {
        if (!cfg) throw new Error('Nextcloud is not configured for this organization');
        const src = new NextcloudClient(cfg).get(tenantId, name, range);
        src.on('error', (e) => out.destroy(e));
        src.pipe(out);
      })
      .catch((e: Error) => out.destroy(e));
    return out;
  }

  async delete(key: string) {
    const { tenantId, name } = split(key);
    if (key.startsWith(NC)) {
      const cfg = await this.nextcloudForRead(tenantId);
      if (cfg) await new NextcloudClient(cfg).delete(tenantId, name);
      return;
    }
    await this.local.delete(key);
    // A test-mode copy may exist too; removing it is best effort.
    const cfg = await this.nextcloud(tenantId);
    if (cfg)
      await new NextcloudClient(cfg)
        .delete(tenantId, name)
        .catch((e: Error) => this.log.warn(`Nextcloud mirror delete failed: ${e.message}`));
  }

  async commit(key: string, meta: { tenantId: string; size: number }): Promise<StorageCommit> {
    if (key.startsWith(NC)) return { key, backend: 'nextcloud' };
    const cfg = await this.nextcloud(meta.tenantId);
    if (!cfg) return { key, backend: 'gridfs' };
    const { tenantId, name } = split(key);
    const copy = () => new NextcloudClient(cfg).put(tenantId, name, this.local.get(key), meta.size);

    if (cfg.mode === 'test') {
      const mirror = copy().then(
        () => ({ ok: true, error: null }),
        (e: Error) => {
          this.log.warn(`Nextcloud test-mode copy of ${key} failed: ${e.message}`);
          return { ok: false, error: e.message };
        },
      );
      return { key, backend: 'gridfs', mirror };
    }

    try {
      await copy();
    } catch (e) {
      this.log.warn(`Nextcloud live upload of ${key} failed, kept in Connect: ${String(e)}`);
      return { key, backend: 'gridfs', fallbackError: (e as Error).message };
    }
    await this.local.delete(key).catch(() => undefined);
    return { key: NC + key, backend: 'nextcloud' };
  }
}
