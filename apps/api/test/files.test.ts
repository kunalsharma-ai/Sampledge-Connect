import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  uuidv7,
  type Attachment,
  type Conversation,
  type FileList,
  type Session,
  type UploadTicket,
} from '@sampledge/contracts';
import { api, inviteAndLogin, registerTenant, startHarness, type Harness } from './harness.js';

let h: Harness;
let owner: Session;
let ravi: Session;
let olga: Session;
let group: Conversation;
let channel: Conversation;

async function share(s: Session, c: Conversation, fileName: string, mimeType: string) {
  const bytes = Buffer.from(`${fileName} bytes`);
  const t = await api<UploadTicket>(h, 'POST', '/v1/uploads', {
    token: s.accessToken,
    body: {
      conversationId: c.conversationId,
      fileName,
      mimeType,
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
  });
  await fetch(h.url + t.body.uploadUrl, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${s.accessToken}`,
      'content-type': 'application/octet-stream',
    },
    body: bytes,
  });
  const a = await api<Attachment>(h, 'POST', `/v1/uploads/${t.body.uploadId}/complete`, {
    token: s.accessToken,
  });
  await api(h, 'POST', `/v1/conversations/${c.conversationId}/messages`, {
    token: s.accessToken,
    body: {
      clientMessageId: uuidv7(),
      content: { text: '', mentions: [] },
      attachmentIds: [a.body.attachmentId],
    },
  });
  return a.body;
}
const list = async (s: Session, q: Record<string, string> = {}) =>
  (await api<FileList>(h, 'GET', `/v1/files?${new URLSearchParams(q)}`, { token: s.accessToken }))
    .body;

beforeAll(async () => {
  h = await startHarness();
  const t = await registerTenant(h);
  owner = t.session;
  ravi = await inviteAndLogin(h, owner, t.slug, 'Ravi Kumar');
  olga = await inviteAndLogin(h, owner, t.slug, 'Olga Novak');
  const mia = await inviteAndLogin(h, owner, t.slug, 'Mia Chen');
  group = (
    await api<Conversation>(h, 'POST', '/v1/conversations', {
      token: owner.accessToken,
      body: { kind: 'group', name: 'Bid team', memberIds: [ravi.user.userId, mia.user.userId] },
    })
  ).body;
  channel = (
    await api<Conversation>(h, 'POST', '/v1/conversations', {
      token: owner.accessToken,
      body: { kind: 'channel_public', name: 'general-files' },
    })
  ).body;
  await share(
    owner,
    group,
    'pricing.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  await share(ravi, group, 'site-photo.png', 'image/png');
  await share(owner, channel, 'brief.pdf', 'application/pdf');
  await share(owner, channel, 'export.zip', 'application/zip');
  // Uploaded but never sent: not listed.
  const bytes = Buffer.from('draft');
  await api(h, 'POST', '/v1/uploads', {
    token: owner.accessToken,
    body: {
      conversationId: channel.conversationId,
      fileName: 'draft.txt',
      mimeType: 'text/plain',
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
  });
});
afterAll(() => h.close());

describe('files', () => {
  it('lists shared files newest first with kind and storage', async () => {
    const r = await list(owner);
    expect(r.items.map((f) => f.fileName)).toEqual([
      'export.zip',
      'brief.pdf',
      'site-photo.png',
      'pricing.xlsx',
    ]);
    expect(r.items.map((f) => f.kind)).toEqual(['other', 'documents', 'images', 'documents']);
    expect(r.items.every((f) => f.storage === 'connect' && f.messageId)).toBe(true);
  });

  it('only shows files from conversations the caller can open', async () => {
    expect((await list(olga)).items.map((f) => f.fileName)).toEqual(['export.zip', 'brief.pdf']);
    expect((await list(olga, { in: group.conversationId })).items).toEqual([]);
  });

  it('filters by kind, person, conversation and name, and pages with a cursor', async () => {
    expect((await list(owner, { kind: 'documents' })).items.map((f) => f.fileName)).toEqual([
      'brief.pdf',
      'pricing.xlsx',
    ]);
    expect((await list(owner, { kind: 'images' })).items.map((f) => f.fileName)).toEqual([
      'site-photo.png',
    ]);
    expect((await list(owner, { kind: 'other' })).items.map((f) => f.fileName)).toEqual([
      'export.zip',
    ]);
    expect((await list(owner, { from: ravi.user.userId })).items).toHaveLength(1);
    expect((await list(owner, { in: group.conversationId })).items).toHaveLength(2);
    expect((await list(owner, { q: 'PRIC' })).items.map((f) => f.fileName)).toEqual([
      'pricing.xlsx',
    ]);
    const p1 = await list(owner, { limit: '3' });
    expect(p1.items).toHaveLength(3);
    expect(p1.nextBefore).not.toBeNull();
    const p2 = await list(owner, { limit: '3', before: p1.nextBefore! });
    expect(p2.items.map((f) => f.fileName)).toEqual(['pricing.xlsx']);
    expect(p2.nextBefore).toBeNull();
  });
});
