import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  uuidv7,
  type Attachment,
  type AttachmentUrl,
  type Conversation,
  type SendMessageAck,
  type Session,
  type UploadTicket,
} from '@sampledge/contracts';
import { api, inviteAndLogin, registerTenant, startHarness, type Harness } from './harness.js';

let h: Harness;
let owner: Session;
let ravi: Session;
let outsider: Session;
let dm: Conversation;

const putBytes = (s: Session, path: string, bytes: Buffer, type = 'application/octet-stream') =>
  fetch(h.url + path, {
    method: 'PUT',
    headers: { authorization: `Bearer ${s.accessToken}`, 'content-type': type },
    body: bytes,
  });

async function upload(s: Session, bytes: Buffer, fileName = 'quotes.csv', mimeType = 'text/csv') {
  const t = await api<UploadTicket>(h, 'POST', '/v1/uploads', {
    token: s.accessToken,
    body: {
      conversationId: dm.conversationId,
      fileName,
      mimeType,
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
  });
  expect(t.status).toBe(201);
  const put = await putBytes(s, t.body.uploadUrl, bytes);
  expect(put.status).toBe(200);
  const done = await api<Attachment>(h, 'POST', `/v1/uploads/${t.body.uploadId}/complete`, {
    token: s.accessToken,
  });
  expect(done.body.status).toBe('ready');
  return done.body;
}

beforeAll(async () => {
  h = await startHarness();
  const t = await registerTenant(h);
  owner = t.session;
  ravi = await inviteAndLogin(h, owner, t.slug, 'Ravi Kumar');
  outsider = await inviteAndLogin(h, owner, t.slug, 'Outside Person');
  dm = (
    await api<Conversation>(h, 'POST', '/v1/conversations', {
      token: owner.accessToken,
      body: { kind: 'dm', memberIds: [ravi.user.userId] },
    })
  ).body;
});
afterAll(() => h.close());

describe('attachments', () => {
  it('uploads, attaches to a message, and serves a signed download to members only', async () => {
    const bytes = Buffer.from('market,incidence\nIndia,0.12\nBrazil,0.11\n');
    const a = await upload(owner, bytes);

    const sent = await api<SendMessageAck>(
      h,
      'POST',
      `/v1/conversations/${dm.conversationId}/messages`,
      {
        token: owner.accessToken,
        body: { clientMessageId: uuidv7(), content: { text: '' }, attachmentIds: [a.attachmentId] },
      },
    );
    expect(sent.status).toBe(200);
    expect(sent.body.message.attachments).toMatchObject([
      { attachmentId: a.attachmentId, fileName: 'quotes.csv', sizeBytes: bytes.length },
    ]);

    // The recipient gets a signed URL and downloads without a bearer token.
    const u = await api<AttachmentUrl>(h, 'GET', `/v1/attachments/${a.attachmentId}/url`, {
      token: ravi.accessToken,
    });
    const res = await fetch(h.url + u.body.url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('attachment;');
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);

    // Tampering or a non-member is refused.
    expect((await fetch(h.url + u.body.url.replace(/sig=./, 'sig=x'))).status).toBe(403);
    expect(
      (
        await api(h, 'GET', `/v1/attachments/${a.attachmentId}/url`, {
          token: outsider.accessToken,
        })
      ).status,
    ).toBe(404);
  });

  it('rejects a size mismatch, a checksum mismatch, blocked types, and reuse', async () => {
    const t = await api<UploadTicket>(h, 'POST', '/v1/uploads', {
      token: owner.accessToken,
      body: {
        conversationId: dm.conversationId,
        fileName: 'a.txt',
        mimeType: 'text/plain',
        sizeBytes: 4,
      },
    });
    expect((await putBytes(owner, t.body.uploadUrl, Buffer.from('too long'))).status).toBe(400);
    const t2 = await api<UploadTicket>(h, 'POST', '/v1/uploads', {
      token: owner.accessToken,
      body: {
        conversationId: dm.conversationId,
        fileName: 'b.txt',
        mimeType: 'text/plain',
        sizeBytes: 3,
        sha256: 'a'.repeat(64),
      },
    });
    expect((await putBytes(owner, t2.body.uploadUrl, Buffer.from('abc'))).status).toBe(400);
    expect(
      (
        await api(h, 'POST', `/v1/uploads/${t2.body.uploadId}/complete`, {
          token: owner.accessToken,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await api(h, 'POST', '/v1/uploads', {
          token: owner.accessToken,
          body: {
            conversationId: dm.conversationId,
            fileName: 'run.exe',
            mimeType: 'application/x-msdownload',
            sizeBytes: 10,
          },
        })
      ).status,
    ).toBe(400);

    const a = await upload(owner, Buffer.from('once'), 'once.txt', 'text/plain');
    const send = () =>
      api(h, 'POST', `/v1/conversations/${dm.conversationId}/messages`, {
        token: owner.accessToken,
        body: {
          clientMessageId: uuidv7(),
          content: { text: 'file' },
          attachmentIds: [a.attachmentId],
        },
      });
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(400);
  });

  it("refuses someone else's upload and an empty message without files", async () => {
    const a = await upload(ravi, Buffer.from('ravi file'), 'r.txt', 'text/plain');
    const r = await api(h, 'POST', `/v1/conversations/${dm.conversationId}/messages`, {
      token: owner.accessToken,
      body: { clientMessageId: uuidv7(), content: { text: 'x' }, attachmentIds: [a.attachmentId] },
    });
    expect(r.status).toBe(400);
    const empty = await api(h, 'POST', `/v1/conversations/${dm.conversationId}/messages`, {
      token: owner.accessToken,
      body: { clientMessageId: uuidv7(), content: { text: '  ' } },
    });
    expect(empty.status).toBe(400);
  });

  it('serves images inline', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const a = await upload(owner, png, 'pixel.png', 'image/png');
    const u = await api<AttachmentUrl>(h, 'GET', `/v1/attachments/${a.attachmentId}/url`, {
      token: owner.accessToken,
    });
    const res = await fetch(h.url + u.body.url);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-disposition')).toContain('inline;');
  });
});
