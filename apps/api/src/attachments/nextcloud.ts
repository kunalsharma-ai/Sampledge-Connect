import { randomBytes } from 'node:crypto';
import { PassThrough, Readable, Transform } from 'node:stream';
import type { IntegrationProviderDef, IntegrationValues } from '@sampledge/contracts';

/**
 * Nextcloud over WebDAV. Files land under
 * `<baseUrl>/remote.php/dav/files/<username>/<folder>/<tenantId>/<attachmentId>`.
 * Settings come from the database (Integrations → Files & storage), never env.
 */
export const NEXTCLOUD_PROVIDER: IntegrationProviderDef = {
  id: 'storage.nextcloud',
  label: 'Nextcloud',
  description:
    'Keep chat files in your own Nextcloud. Start in test mode: files are copied there while Connect keeps serving its own copy, so nothing breaks if Nextcloud is unreachable.',
  category: 'storage',
  scopes: ['tenant', 'platform'],
  testable: true,
  fields: [
    {
      key: 'baseUrl',
      label: 'Nextcloud address',
      type: 'url',
      required: true,
      placeholder: 'https://cloud.example.com',
    },
    { key: 'username', label: 'User name', type: 'string', required: true },
    {
      key: 'appPassword',
      label: 'App password',
      type: 'secret',
      required: true,
      help: 'Create one in Nextcloud under Settings → Security → Devices & sessions.',
    },
    {
      key: 'folder',
      label: 'Folder',
      type: 'string',
      default: 'Sampledge Connect',
      help: 'Created if it does not exist. Each organization gets its own subfolder.',
    },
    {
      key: 'mode',
      label: 'Mode',
      type: 'select',
      default: 'test',
      options: [
        { value: 'test', label: 'Test mode: copy new files, keep serving from Connect' },
        { value: 'live', label: 'Live: store new files in Nextcloud' },
      ],
      help: 'In live mode a file that cannot reach Nextcloud stays in Connect storage, so uploads never fail because of it.',
    },
  ],
};

export interface NextcloudConfig {
  baseUrl: string;
  username: string;
  appPassword: string;
  folder: string;
  mode: 'test' | 'live';
}

export function nextcloudConfig(v: IntegrationValues): NextcloudConfig | null {
  if (!v.baseUrl || !v.username || !v.appPassword) return null;
  return {
    baseUrl: String(v.baseUrl).replace(/\/+$/, ''),
    username: String(v.username),
    appPassword: String(v.appPassword),
    folder: String(v.folder || 'Sampledge Connect').replace(/^\/+|\/+$/g, ''),
    mode: v.mode === 'live' ? 'live' : 'test',
  };
}

export class NextcloudError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

const SMALL_TIMEOUT = 15_000;
const TRANSFER_TIMEOUT = 10 * 60_000;

export class NextcloudClient {
  private readonly auth: string;
  constructor(private readonly cfg: NextcloudConfig) {
    this.auth = 'Basic ' + Buffer.from(`${cfg.username}:${cfg.appPassword}`).toString('base64');
  }

  private root() {
    return `${this.cfg.baseUrl}/remote.php/dav/files/${encodeURIComponent(this.cfg.username)}`;
  }

  /** Path segments under the configured folder, each URL-encoded. */
  url(...parts: string[]) {
    const segs = [...this.cfg.folder.split('/').filter(Boolean), ...parts];
    return `${this.root()}/${segs.map(encodeURIComponent).join('/')}`;
  }

  private async req(method: string, url: string, init: RequestInit = {}, timeout = SMALL_TIMEOUT) {
    const res = await fetch(url, {
      ...init,
      method,
      headers: { authorization: this.auth, ...(init.headers as Record<string, string>) },
      signal: AbortSignal.timeout(timeout),
      redirect: 'manual',
    });
    if (res.status === 401 || res.status === 403) {
      await res.body?.cancel();
      throw new NextcloudError('Nextcloud rejected the user name or app password', res.status);
    }
    return res;
  }

  /** Creates the folder chain; existing folders (405) are fine. */
  async ensureFolder(...parts: string[]) {
    const segs = [...this.cfg.folder.split('/').filter(Boolean), ...parts];
    for (let i = 1; i <= segs.length; i++) {
      const url = `${this.root()}/${segs.slice(0, i).map(encodeURIComponent).join('/')}`;
      const res = await this.req('MKCOL', url);
      await res.body?.cancel();
      if (res.status === 404)
        throw new NextcloudError(
          'This Nextcloud address has no WebDAV files endpoint for that user',
          404,
        );
      if (![201, 405].includes(res.status))
        throw new NextcloudError(`Could not create the folder (HTTP ${res.status})`, res.status);
    }
  }

  async put(tenantId: string, name: string, body: Readable, size: number) {
    await this.ensureFolder(tenantId);
    const res = await this.req(
      'PUT',
      this.url(tenantId, name),
      {
        body: Readable.toWeb(body) as ReadableStream,
        headers: { 'content-length': String(size), 'content-type': 'application/octet-stream' },
        // Node's fetch needs this for streamed request bodies.
        ...({ duplex: 'half' } as object),
      },
      TRANSFER_TIMEOUT,
    );
    await res.body?.cancel();
    if (![200, 201, 204].includes(res.status))
      throw new NextcloudError(`Upload failed (HTTP ${res.status})`, res.status);
  }

  /** Streams a file; `range` is inclusive. Errors arrive on the stream, like GridFS. */
  get(tenantId: string, name: string, range?: { start: number; end: number }): Readable {
    const out = new PassThrough();
    this.req(
      'GET',
      this.url(tenantId, name),
      range ? { headers: { range: `bytes=${range.start}-${range.end}` } } : {},
      TRANSFER_TIMEOUT,
    )
      .then(async (res) => {
        if (res.status === 404) throw new NextcloudError('File not found in Nextcloud', 404);
        if (res.status !== 200 && res.status !== 206)
          throw new NextcloudError(`Download failed (HTTP ${res.status})`, res.status);
        if (!res.body) return out.end();
        let src = Readable.fromWeb(res.body as never);
        // A server that ignores Range sends the whole file: trim it ourselves.
        if (range && res.status === 200) src = src.pipe(slice(range.start, range.end));
        src.on('error', (e) => out.destroy(e));
        src.pipe(out);
      })
      .catch((e: Error) => out.destroy(e));
    return out;
  }

  async delete(tenantId: string, name: string) {
    const res = await this.req('DELETE', this.url(tenantId, name));
    await res.body?.cancel();
    if (![200, 204, 404].includes(res.status))
      throw new NextcloudError(`Delete failed (HTTP ${res.status})`, res.status);
  }

  /** Write, read back and delete a small file. Proves address, credentials and permissions. */
  async roundTrip(): Promise<string> {
    const name = `.connect-test-${randomBytes(6).toString('hex')}.txt`;
    const payload = `Sampledge Connect connection test ${new Date().toISOString()}`;
    await this.ensureFolder();
    const put = await this.req('PUT', this.url(name), {
      body: payload,
      headers: { 'content-type': 'text/plain' },
    });
    await put.body?.cancel();
    if (![200, 201, 204].includes(put.status))
      throw new NextcloudError(`Could not write a test file (HTTP ${put.status})`, put.status);
    try {
      const get = await this.req('GET', this.url(name));
      const text = await get.text();
      if (get.status !== 200 || text !== payload)
        throw new NextcloudError('The test file did not read back the same', get.status);
    } finally {
      await this.req('DELETE', this.url(name))
        .then((r) => r.body?.cancel())
        .catch(() => undefined);
    }
    return `/${this.cfg.folder}`;
  }
}

function slice(start: number, end: number) {
  let pos = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      const from = Math.max(start - pos, 0);
      const to = Math.min(end + 1 - pos, chunk.length);
      pos += chunk.length;
      cb(null, from < to ? chunk.subarray(from, to) : undefined);
    },
  });
}
