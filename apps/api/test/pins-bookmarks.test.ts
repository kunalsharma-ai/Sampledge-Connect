import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  uuidv7,
  type Bookmark,
  type Conversation,
  type Message,
  type SendMessageAck,
  type Session,
} from '@sampledge/contracts';
import {
  api,
  connect,
  inviteAndLogin,
  nextEvent,
  registerTenant,
  startHarness,
  type Harness,
} from './harness.js';

let h: Harness;
let owner: Session;
let ravi: Session;
let outsider: Session;
let group: Conversation;

const send = async (s: Session, text: string, replyTo: string | null = null) => {
  const r = await api<SendMessageAck>(
    h,
    'POST',
    `/v1/conversations/${group.conversationId}/messages`,
    {
      token: s.accessToken,
      body: {
        clientMessageId: uuidv7(),
        content: { text, mentions: [] },
        replyToMessageId: replyTo,
      },
    },
  );
  if (r.status !== 201 && r.status !== 200)
    throw new Error(`send ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.message;
};
const pin = (s: Session, id: string, on = true) =>
  api<Message>(h, on ? 'PUT' : 'DELETE', `/v1/messages/${id}/pin`, { token: s.accessToken });
const save = (s: Session, id: string, on = true) =>
  api(h, on ? 'PUT' : 'DELETE', `/v1/messages/${id}/bookmark`, { token: s.accessToken });
const saved = async (s: Session) =>
  (await api<{ items: Bookmark[] }>(h, 'GET', '/v1/bookmarks', { token: s.accessToken })).body
    .items;

beforeAll(async () => {
  h = await startHarness();
  const t = await registerTenant(h);
  owner = t.session;
  ravi = await inviteAndLogin(h, owner, t.slug, 'Ravi Kumar');
  outsider = await inviteAndLogin(h, owner, t.slug, 'Olga Out');
  const mia = await inviteAndLogin(h, owner, t.slug, 'Mia Chen');
  group = (
    await api<Conversation>(h, 'POST', '/v1/conversations', {
      token: owner.accessToken,
      body: { kind: 'group', name: 'Bid team', memberIds: [ravi.user.userId, mia.user.userId] },
    })
  ).body;
});
afterAll(() => h.close());

describe('pins', () => {
  it('pins for everyone, broadcasts the update, and is idempotent', async () => {
    const m = await send(owner, 'Final quota sheet is v3');
    const sock = await connect(h, ravi.accessToken);
    const update = nextEvent(sock, 'message:updated', (x) => x.messageId === m.messageId);
    const r = await pin(ravi, m.messageId);
    expect(r.status).toBe(200);
    expect(r.body.pinned).toMatchObject({ pinnedBy: ravi.user.userId });
    expect((await update).pinned).not.toBeNull();
    expect(r.body.changeSequence).toBeGreaterThan(m.changeSequence);
    const again = await pin(owner, m.messageId);
    expect(again.body.pinned!.pinnedBy).toBe(ravi.user.userId);

    const off = await pin(owner, m.messageId, false);
    expect(off.body.pinned).toBeNull();
    sock.disconnect();
  });

  it('rejects non-members, and clears the pin when a message is deleted', async () => {
    const m = await send(owner, 'Kick-off moved to Thursday');
    expect((await pin(outsider, m.messageId)).status).toBeGreaterThanOrEqual(403);
    await pin(owner, m.messageId);
    await api(h, 'DELETE', `/v1/messages/${m.messageId}`, { token: owner.accessToken });
    const hist = await api<Message[]>(
      h,
      'GET',
      `/v1/conversations/${group.conversationId}/messages`,
      { token: owner.accessToken },
    );
    expect(hist.body.find((x) => x.messageId === m.messageId)!.pinned).toBeNull();
    expect((await pin(owner, m.messageId)).status).toBe(409);
  });
});

describe('bookmarks', () => {
  it('are private, newest first, idempotent, and show edits', async () => {
    const a = await send(ravi, 'Brazil incidence is 4%');
    const b = await send(ravi, 'Mexico incidence is 6%');
    expect((await save(owner, a.messageId)).status).toBe(200);
    expect((await save(owner, a.messageId)).status).toBe(200);
    await save(owner, b.messageId);
    let items = await saved(owner);
    expect(items.map((i) => i.messageId)).toEqual([b.messageId, a.messageId]);
    expect(await saved(ravi)).toEqual([]);

    await api(h, 'PATCH', `/v1/messages/${a.messageId}`, {
      token: ravi.accessToken,
      body: { content: { text: 'Brazil incidence is 5%', mentions: [] } },
    });
    items = await saved(owner);
    expect(items.find((i) => i.messageId === a.messageId)!.message.content.text).toBe(
      'Brazil incidence is 5%',
    );

    expect((await save(owner, b.messageId, false)).status).toBe(204);
    expect((await saved(owner)).map((i) => i.messageId)).toEqual([a.messageId]);
  });

  it('tell all of your devices, and only yours, when you save or unsave', async () => {
    const m = await send(ravi, 'Save me for later');
    const mine = await connect(h, owner.accessToken);
    const theirs = await connect(h, ravi.accessToken);
    let leaked = false;
    theirs.on('bookmark:updated', () => (leaked = true));
    const on = nextEvent(mine, 'bookmark:updated', (e) => e.messageId === m.messageId);
    await save(owner, m.messageId);
    expect(await on).toEqual({
      messageId: m.messageId,
      conversationId: group.conversationId,
      saved: true,
    });
    const off = nextEvent(mine, 'bookmark:updated', (e) => e.messageId === m.messageId);
    await save(owner, m.messageId, false);
    expect((await off).saved).toBe(false);
    await new Promise((r) => setTimeout(r, 100));
    expect(leaked).toBe(false);
    mine.disconnect();
    theirs.disconnect();
  });

  it('cannot save messages you cannot read, and hides ones you lost access to', async () => {
    const m = await send(owner, 'Confidential budget');
    expect((await save(outsider, m.messageId)).status).toBeGreaterThanOrEqual(403);
    await save(ravi, m.messageId);
    expect((await saved(ravi)).some((i) => i.messageId === m.messageId)).toBe(true);
    await api(
      h,
      'DELETE',
      `/v1/conversations/${group.conversationId}/members/${ravi.user.userId}`,
      {
        token: owner.accessToken,
      },
    );
    expect((await saved(ravi)).some((i) => i.messageId === m.messageId)).toBe(false);
  });
});

describe('threads', () => {
  it('keeps replies linked to their parent', async () => {
    const root = await send(owner, 'Who owns the Q3 tracker?');
    const r1 = await send(owner, 'Ravi does', root.messageId);
    expect(r1.replyToMessageId).toBe(root.messageId);
    const bad = await api(h, 'POST', `/v1/conversations/${group.conversationId}/messages`, {
      token: owner.accessToken,
      body: {
        clientMessageId: uuidv7(),
        content: { text: 'x', mentions: [] },
        replyToMessageId: uuidv7(),
      },
    });
    expect(bad.status).toBeGreaterThanOrEqual(400);
  });
});
