import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  uuidv7,
  type Conversation,
  type Message,
  type SendMessageAck,
  type SearchResponse,
  type Session,
} from '@sampledge/contracts';
import {
  api,
  connect,
  device,
  inviteAndLogin,
  nextEvent,
  registerTenant,
  startHarness,
  type Harness,
} from './harness.js';

let h: Harness;
let slug: string;
let owner: Session;
let ravi: Session;
let olga: Session;
let other: Session;
let privateGroup: Conversation;
let publicChannel: Conversation;

const send = async (s: Session, c: Conversation, text: string) => {
  const r = await api<SendMessageAck>(h, 'POST', `/v1/conversations/${c.conversationId}/messages`, {
    token: s.accessToken,
    body: { clientMessageId: uuidv7(), content: { text, mentions: [] } },
  });
  if (r.status !== 201 && r.status !== 200) throw new Error(`send ${r.status}`);
  return r.body.message as Message;
};
const search = async (s: Session, params: Record<string, string>) => {
  const r = await api<SearchResponse>(h, 'GET', `/v1/search?${new URLSearchParams(params)}`, {
    token: s.accessToken,
  });
  return r;
};

beforeAll(async () => {
  h = await startHarness();
  const t = await registerTenant(h);
  slug = t.slug;
  owner = t.session;
  ravi = await inviteAndLogin(h, owner, slug, 'Ravi Kumar');
  olga = await inviteAndLogin(h, owner, slug, 'Olga Novak');
  const mia = await inviteAndLogin(h, owner, slug, 'Mia Chen');
  other = (await registerTenant(h, 'Other Research')).session;
  privateGroup = (
    await api<Conversation>(h, 'POST', '/v1/conversations', {
      token: owner.accessToken,
      body: { kind: 'group', name: 'Bid team', memberIds: [ravi.user.userId, mia.user.userId] },
    })
  ).body;
  publicChannel = (
    await api<Conversation>(h, 'POST', '/v1/conversations', {
      token: owner.accessToken,
      body: { kind: 'channel_public', name: 'fieldwork-germany' },
    })
  ).body;
  await send(owner, privateGroup, 'The Q4 quota budget for Germany is approved');
  await send(ravi, privateGroup, 'Budget sheet v3 is attached in the drive');
  await send(owner, publicChannel, 'Germany fieldwork starts Monday, quota 400 completes');
  await send(owner, publicChannel, 'Unrelated lunch plans');
});
afterAll(() => h.close());

describe('universal search', () => {
  it('finds messages by partial words, requires every term, newest first, with highlights', async () => {
    const r = await search(owner, { q: 'budg germ' });
    expect(r.status).toBe(200);
    const texts = r.body.messages.items.map((m) => m.snippet);
    expect(texts).toEqual(['The Q4 quota budget for Germany is approved']);
    const hit = r.body.messages.items[0]!;
    expect(hit.snippet.slice(hit.matches[0]![0], hit.matches[0]![1]).toLowerCase()).toBe('budg');
    expect(r.body.terms).toEqual(['budg', 'germ']);

    const quota = await search(owner, { q: 'quota' });
    expect(quota.body.messages.items).toHaveLength(2);
    // Newest first.
    expect(quota.body.messages.items[0]!.conversationId).toBe(publicChannel.conversationId);
  });

  it('never shows a private conversation to someone outside it, but public channels are searchable', async () => {
    const r = await search(olga, { q: 'quota' });
    expect(r.body.messages.items.map((m) => m.conversationId)).toEqual([
      publicChannel.conversationId,
    ]);
    const outsider = await search(other, { q: 'quota' });
    expect(outsider.body.messages.items).toHaveLength(0);
    expect(outsider.body.people.items).toHaveLength(0);
  });

  it('filters by person, conversation and date', async () => {
    const fromRavi = await search(owner, { q: 'budget', from: ravi.user.userId });
    expect(fromRavi.body.messages.items.map((m) => m.senderId)).toEqual([ravi.user.userId]);
    // Person-only search (no text) lists everything they said.
    const all = await search(owner, { from: ravi.user.userId });
    expect(all.status).toBe(200);
    expect(all.body.messages.items).toHaveLength(1);
    expect(all.body.people.items).toHaveLength(0);

    const inChannel = await search(owner, { q: 'quota', in: publicChannel.conversationId });
    expect(inChannel.body.messages.items).toHaveLength(1);
    const future = await search(owner, { q: 'quota', after: '2999-01-01T00:00:00.000Z' });
    expect(future.body.messages.items).toHaveLength(0);
    // A conversation you cannot read returns nothing rather than an error that leaks it.
    const peek = await search(olga, { q: 'budget', in: privateGroup.conversationId });
    expect(peek.body.messages.items).toHaveLength(0);
  });

  it('finds people, conversations and DMs by name', async () => {
    const people = await search(owner, { q: 'novak' });
    expect(people.body.people.items.map((p) => p.displayName)).toEqual(['Olga Novak']);
    const convs = await search(olga, { q: 'fieldwork' });
    expect(convs.body.conversations.items).toEqual([
      expect.objectContaining({ conversationId: publicChannel.conversationId, isMember: false }),
    ]);
    expect((await search(olga, { q: 'bid team' })).body.conversations.items).toHaveLength(0);

    await api(h, 'POST', '/v1/conversations', {
      token: owner.accessToken,
      body: { kind: 'dm', memberIds: [ravi.user.userId] },
    });
    const dm = await search(owner, { q: 'ravi', types: 'conversations' });
    expect(dm.body.conversations.items.map((c) => c.kind)).toEqual(['dm']);
    expect(dm.body.people.items).toHaveLength(0); // types narrows the search
  });

  it('finds tasks and meetings the caller can see', async () => {
    await api(h, 'POST', '/v1/tasks', {
      token: owner.accessToken,
      body: {
        title: 'Translate the Germany screener',
        conversationId: privateGroup.conversationId,
      },
    });
    const start = new Date(Date.now() + 86400_000);
    await api(h, 'POST', '/v1/meetings', {
      token: owner.accessToken,
      body: {
        title: 'Germany kickoff',
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + 1800_000).toISOString(),
        attendeeIds: [ravi.user.userId],
      },
    });
    const r = await search(ravi, { q: 'germany' });
    expect(r.body.tasks.items.map((t) => t.title)).toEqual(['Translate the Germany screener']);
    expect(r.body.meetings.items.map((m) => m.title)).toEqual(['Germany kickoff']);
    const o = await search(olga, { q: 'germany' });
    expect(o.body.tasks.items).toHaveLength(0);
    expect(o.body.meetings.items).toHaveLength(0);
  });

  it('pages with offset and more', async () => {
    for (let i = 0; i < 5; i++) await send(owner, publicChannel, `Pager note ${i}`);
    const p1 = await search(owner, { q: 'pager', types: 'messages', limit: '3' });
    expect(p1.body.messages.items).toHaveLength(3);
    expect(p1.body.messages.more).toBe(true);
    const p2 = await search(owner, { q: 'pager', types: 'messages', limit: '3', offset: '3' });
    expect(p2.body.messages.items).toHaveLength(2);
    expect(p2.body.messages.more).toBe(false);
  });

  it('rejects an empty search and treats regex characters literally', async () => {
    expect((await search(owner, { q: '' })).status).toBe(400);
    const r = await search(owner, { q: '.*' });
    expect(r.status).toBe(200);
    expect(r.body.messages.items).toHaveLength(0);
  });

  it('syncs recent searches to every device of the person, and only theirs', async () => {
    const second = (
      await api<Session>(h, 'POST', '/v1/auth/login', {
        body: {
          tenantSlug: slug,
          email: ravi.user.email,
          password: 'temporary password 123',
          device: device('Second laptop'),
        },
      })
    ).body;
    const sock = await connect(h, second.accessToken);
    const event = nextEvent(sock, 'search:recent', () => true);
    const put = await api<{ recent: string[] }>(h, 'PUT', '/v1/search/recent', {
      token: ravi.accessToken,
      body: { recent: ['budget', 'Budget', ' germany ', ''] },
    });
    expect(put.body.recent).toEqual(['budget', 'germany']);
    expect((await event).recent).toEqual(['budget', 'germany']);
    const mine = await api<{ recent: string[] }>(h, 'GET', '/v1/search/recent', {
      token: second.accessToken,
    });
    expect(mine.body.recent).toEqual(['budget', 'germany']);
    const theirs = await api<{ recent: string[] }>(h, 'GET', '/v1/search/recent', {
      token: olga.accessToken,
    });
    expect(theirs.body.recent).toEqual([]);
    sock.disconnect();
  });
});
