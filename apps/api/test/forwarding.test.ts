import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiUrl,
  forwardedOf,
  uuidv7,
  type Attachment,
  type AttachmentUrl,
  type Conversation,
  type Message,
  type SendMessageAck,
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

const send = (s: Session, c: Conversation, body: Record<string, unknown>, id = uuidv7()) =>
  api<SendMessageAck>(h, 'POST', `/v1/conversations/${c.conversationId}/messages`, {
    token: s.accessToken,
    body: { clientMessageId: id, content: { text: '', mentions: [] }, ...body },
  });

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
      body: {
        kind: 'channel_public',
        name: 'announcements-all',
        memberIds: [ravi.user.userId, olga.user.userId],
      },
    })
  ).body;
});
afterAll(() => h.close());

describe('forwarding', () => {
  it('forwards a message with a comment and a snapshot of the original, idempotently', async () => {
    const src = (
      await send(ravi, group, { content: { text: 'Budget ceiling is EUR 84k', mentions: [] } })
    ).body.message;
    const id = uuidv7();
    const r = await send(
      owner,
      channel,
      { forwardOf: src.messageId, content: { text: 'FYI everyone', mentions: [] } },
      id,
    );
    expect(r.status).toBe(200);
    const fwd = forwardedOf(r.body.message)!;
    expect(fwd).toMatchObject({
      messageId: src.messageId,
      senderId: ravi.user.userId,
      text: 'Budget ceiling is EUR 84k',
      from: 'Bid team',
    });
    expect(r.body.message.content.text).toBe('FYI everyone');
    const again = await send(
      owner,
      channel,
      { forwardOf: src.messageId, content: { text: 'FYI everyone', mentions: [] } },
      id,
    );
    expect(again.body.duplicate).toBe(true);

    // Forwarding a forward keeps the first original.
    const second = await send(olga, channel, { forwardOf: r.body.message.messageId }, uuidv7());
    expect(forwardedOf(second.body.message)!.messageId).toBe(src.messageId);
  });

  it('refuses messages the sender cannot read', async () => {
    const src = (await send(ravi, group, { content: { text: 'Private note', mentions: [] } })).body
      .message;
    const r = await send(olga, channel, { forwardOf: src.messageId });
    expect(r.status).toBe(404);
  });

  it('honours a group that turned forwarding off, except inside itself', async () => {
    const src = (await send(ravi, group, { content: { text: 'Do not share', mentions: [] } })).body
      .message;
    const off = await api<Conversation>(
      h,
      'PUT',
      `/v1/conversations/${group.conversationId}/forwarding`,
      {
        token: owner.accessToken,
        body: { allowed: false },
      },
    );
    expect(off.status).toBe(200);
    expect(off.body.allowForwarding).toBe(false);
    expect((await send(ravi, channel, { forwardOf: src.messageId })).status).toBe(403);
    expect((await send(ravi, group, { forwardOf: src.messageId })).status).toBe(200);
    // Public channels have no switch.
    const pub = await api(h, 'PUT', `/v1/conversations/${channel.conversationId}/forwarding`, {
      token: owner.accessToken,
      body: { allowed: false },
    });
    expect(pub.status).toBe(400);
    await api(h, 'PUT', `/v1/conversations/${group.conversationId}/forwarding`, {
      token: owner.accessToken,
      body: { allowed: true },
    });
  });

  it('forwards files as copies the new audience can open', async () => {
    const bytes = Buffer.from('pricing sheet');
    const t = await api<UploadTicket>(h, 'POST', '/v1/uploads', {
      token: ravi.accessToken,
      body: {
        conversationId: group.conversationId,
        fileName: 'pricing.csv',
        mimeType: 'text/csv',
        sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    });
    await fetch(h.url + t.body.uploadUrl, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${ravi.accessToken}`,
        'content-type': 'application/octet-stream',
      },
      body: bytes,
    });
    const a = (
      await api<Attachment>(h, 'POST', `/v1/uploads/${t.body.uploadId}/complete`, {
        token: ravi.accessToken,
      })
    ).body;
    const src = (await send(ravi, group, { attachmentIds: [a.attachmentId] })).body.message;
    // Olga can't open the original…
    expect(
      (await api(h, 'GET', `/v1/attachments/${a.attachmentId}/url`, { token: olga.accessToken }))
        .status,
    ).toBe(404);
    const fr = await send(owner, channel, { forwardOf: src.messageId });
    if (!fr.body.message) throw new Error(JSON.stringify(fr.body));
    const fwd = fr.body.message as Message;
    expect(fwd.attachments).toHaveLength(1);
    const copy = fwd.attachments[0]!;
    expect(copy.attachmentId).not.toBe(a.attachmentId);
    expect(copy.fileName).toBe('pricing.csv');
    // …but she can open the forwarded copy.
    const u = await api<AttachmentUrl>(h, 'GET', `/v1/attachments/${copy.attachmentId}/url`, {
      token: olga.accessToken,
    });
    expect(u.status).toBe(200);
    const res = await fetch(apiUrl(h.url, u.body.url));
    expect(await res.text()).toBe('pricing sheet');
  });
});
