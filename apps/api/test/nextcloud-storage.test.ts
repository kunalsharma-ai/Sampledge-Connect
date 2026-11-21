import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  Attachment,
  AttachmentUrl,
  Conversation,
  IntegrationTestResult,
  IntegrationView,
  Session,
  UploadTicket,
} from '@sampledge/contracts';
import { api, inviteAndLogin, registerTenant, startHarness, type Harness } from './harness.js';

/**
 * A small in-memory WebDAV server shaped like Nextcloud: Basic auth, MKCOL, PUT,
 * GET with Range, DELETE under /remote.php/dav/files/<user>/.
 */
const files = new Map<string, Buffer>();
const folders = new Set<string>();
const seen: string[] = [];
let down = false;
let ignoreRange = false;
let dav: Server;
let davUrl: string;
const AUTH = 'Basic ' + Buffer.from('connect:app-pass').toString('base64');

let h: Harness;
let mongo: MongoClient;
let owner: Session;
let ravi: Session;
let dm: Conversation;

const save = (body: unknown) =>
  api<IntegrationView>(h, 'PUT', '/v1/admin/integrations/storage.nextcloud', {
    token: owner.accessToken,
    body,
  });
const runTest = (body?: unknown) =>
  api<IntegrationTestResult>(h, 'POST', '/v1/admin/integrations/storage.nextcloud/test', {
    token: owner.accessToken,
    body: body ?? {},
  });
const settings = (mode: 'test' | 'live', password = 'app-pass') => ({
  enabled: true,
  values: {
    baseUrl: davUrl,
    username: 'connect',
    appPassword: password,
    folder: 'Connect Files',
    mode,
  },
});

async function upload(bytes: Buffer, fileName = 'brief.pdf') {
  const t = await api<UploadTicket>(h, 'POST', '/v1/uploads', {
    token: owner.accessToken,
    body: {
      conversationId: dm.conversationId,
      fileName,
      mimeType: 'application/pdf',
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
  });
  const put = await fetch(h.url + t.body.uploadUrl, {
    method: 'PUT',
    headers: { authorization: `Bearer ${owner.accessToken}`, 'content-type': 'application/pdf' },
    body: bytes,
  });
  expect(put.status).toBe(200);
  const done = await api<Attachment>(h, 'POST', `/v1/uploads/${t.body.uploadId}/complete`, {
    token: owner.accessToken,
  });
  expect(done.body.status).toBe('ready');
  return done.body;
}

async function download(id: string, range?: string) {
  const u = await api<AttachmentUrl>(h, 'GET', `/v1/attachments/${id}/url`, {
    token: ravi.accessToken,
  });
  const res = await fetch(h.url + u.body.url, range ? { headers: { range } } : {});
  return { status: res.status, body: Buffer.from(await res.arrayBuffer()) };
}

const row = (id: string) =>
  mongo
    .db(h.dbName)
    .collection<{ _id: string; storageKey: string; storage?: Record<string, unknown> }>(
      'attachments',
    )
    .findOne({ _id: id });
const gridfsHas = async (key: string) =>
  (await mongo
    .db(h.dbName)
    .collection('attachment_files.files')
    .countDocuments({ filename: key })) > 0;
const davPath = (tenantId: string, id: string) =>
  `/remote.php/dav/files/connect/Connect%20Files/${tenantId}/${id}`;

async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeAll(async () => {
  dav = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const path = (req.url ?? '').split('?')[0]!;
      seen.push(`${req.method} ${path}`);
      if (down) return res.writeHead(503).end();
      if (req.headers.authorization !== AUTH) return res.writeHead(401).end();
      if (!path.startsWith('/remote.php/dav/files/connect')) return res.writeHead(404).end();
      const parent = path.slice(0, path.lastIndexOf('/'));
      switch (req.method) {
        case 'MKCOL':
          if (folders.has(path)) return res.writeHead(405).end();
          folders.add(path);
          return res.writeHead(201).end();
        case 'PUT':
          if (parent !== '/remote.php/dav/files/connect' && !folders.has(parent))
            return res.writeHead(409).end();
          files.set(path, Buffer.concat(chunks));
          return res.writeHead(201).end();
        case 'GET': {
          const f = files.get(path);
          if (!f) return res.writeHead(404).end();
          const m = /^bytes=(\d+)-(\d+)$/.exec(String(req.headers.range ?? ''));
          if (m && !ignoreRange) {
            const [s, e] = [Number(m[1]), Number(m[2])];
            return res.writeHead(206).end(f.subarray(s, e + 1));
          }
          return res.writeHead(200).end(f);
        }
        case 'DELETE':
          return res.writeHead(files.delete(path) ? 204 : 404).end();
        default:
          return res.writeHead(405).end();
      }
    });
  });
  await new Promise<void>((r) => dav.listen(0, '127.0.0.1', r));
  davUrl = `http://127.0.0.1:${(dav.address() as { port: number }).port}`;
  h = await startHarness({ SETTINGS_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64') });
  mongo = await MongoClient.connect(process.env.MONGO_URL ?? 'mongodb://localhost:27017');
  const t = await registerTenant(h);
  owner = t.session;
  ravi = await inviteAndLogin(h, owner, t.slug, 'Ravi Kumar');
  dm = (
    await api<Conversation>(h, 'POST', '/v1/conversations', {
      token: owner.accessToken,
      body: { kind: 'dm', memberIds: [ravi.user.userId] },
    })
  ).body;
});

afterAll(async () => {
  await mongo?.close();
  await h?.close();
  await new Promise((r) => dav?.close(r));
});

describe('Nextcloud storage', () => {
  it('is listed under Files & storage and tests the connection with a round trip', async () => {
    const list = await api<IntegrationView[]>(h, 'GET', '/v1/admin/integrations', {
      token: owner.accessToken,
    });
    const nc = list.body.find((v) => v.provider.id === 'storage.nextcloud');
    expect(nc?.provider.category).toBe('storage');
    expect(nc?.enabled).toBe(false);

    const bad = await runTest({ values: settings('test', 'wrong').values });
    expect(bad.body.ok).toBe(false);
    expect(bad.body.message).toMatch(/user name or app password/);

    const good = await runTest({ values: settings('test').values });
    expect(good.body.ok).toBe(true);
    expect(good.body.message).toMatch(/Wrote, read back and deleted a test file/);
    // The test file was cleaned up.
    expect([...files.keys()].some((k) => k.includes('.connect-test-'))).toBe(false);
  });

  it('with the integration off, files stay in Connect storage and Nextcloud is never called', async () => {
    seen.length = 0;
    const a = await upload(Buffer.from('off mode'));
    expect((await row(a.attachmentId))?.storage?.backend).toBe('gridfs');
    expect(seen).toEqual([]);
  });

  it('test mode copies new files to Nextcloud but keeps serving the Connect copy', async () => {
    expect((await save(settings('test'))).status).toBe(200);
    const bytes = Buffer.from('test mode file '.repeat(200));
    const a = await upload(bytes);
    const r = await until(
      () => row(a.attachmentId),
      (d) => (d?.storage?.mirror as { status?: string })?.status === 'copied',
    );
    expect((r?.storage?.mirror as { status: string }).status).toBe('copied');
    expect(r?.storageKey).toBe(`${owner.tenant.tenantId}/${a.attachmentId}`);
    expect(files.get(davPath(owner.tenant.tenantId, a.attachmentId))?.equals(bytes)).toBe(true);

    // Reads never touch Nextcloud in test mode, so an outage changes nothing.
    down = true;
    seen.length = 0;
    const d = await download(a.attachmentId);
    down = false;
    expect(d.status).toBe(200);
    expect(d.body.equals(bytes)).toBe(true);
    expect(seen.filter((s) => s.startsWith('GET'))).toEqual([]);

    const t = await runTest();
    expect(t.body.message).toMatch(/Test mode: \d+ files? copied, 0 failed/);
  });

  it('a failed test-mode copy is recorded and the upload still succeeds', async () => {
    down = true;
    const a = await upload(Buffer.from('nextcloud is down'));
    const r = await until(
      () => row(a.attachmentId),
      (d) => (d?.storage?.mirror as { status?: string })?.status === 'failed',
    );
    down = false;
    expect((r?.storage?.mirror as { status: string }).status).toBe('failed');
    expect((await download(a.attachmentId)).status).toBe(200);
  });

  it('live mode stores new files in Nextcloud and serves them from there, with ranges', async () => {
    expect((await save(settings('live'))).status).toBe(200);
    const bytes = Buffer.from('0123456789'.repeat(50));
    const a = await upload(bytes);
    const r = await row(a.attachmentId);
    const key = `${owner.tenant.tenantId}/${a.attachmentId}`;
    expect(r?.storageKey).toBe(`nc:${key}`);
    expect(r?.storage?.backend).toBe('nextcloud');
    expect(await gridfsHas(key)).toBe(false);
    expect(files.get(davPath(owner.tenant.tenantId, a.attachmentId))?.equals(bytes)).toBe(true);

    const full = await download(a.attachmentId);
    expect(full.status).toBe(200);
    expect(full.body.equals(bytes)).toBe(true);
    const part = await download(a.attachmentId, 'bytes=10-19');
    expect(part.status).toBe(206);
    expect(part.body.toString()).toBe('0123456789');
    // A server that ignores Range still yields only the requested bytes.
    ignoreRange = true;
    const trimmed = await download(a.attachmentId, 'bytes=5-14');
    ignoreRange = false;
    expect(trimmed.status).toBe(206);
    expect(trimmed.body.toString()).toBe('5678901234');
  });

  it('live mode keeps a file in Connect storage when Nextcloud is unreachable', async () => {
    down = true;
    const bytes = Buffer.from('kept safe');
    const a = await upload(bytes);
    down = false;
    const r = await row(a.attachmentId);
    expect(r?.storage?.backend).toBe('gridfs');
    expect((r?.storage?.mirror as { status: string }).status).toBe('failed');
    expect((await download(a.attachmentId)).body.equals(bytes)).toBe(true);
  });

  it('files keep working after switching back to test mode', async () => {
    const bytes = Buffer.from('written while live');
    const a = await upload(bytes);
    expect((await row(a.attachmentId))?.storage?.backend).toBe('nextcloud');
    expect((await save(settings('test'))).status).toBe(200);
    expect((await download(a.attachmentId)).body.equals(bytes)).toBe(true);
  });
});
