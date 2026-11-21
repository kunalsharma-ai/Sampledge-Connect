import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  uuidv7,
  type Conversation,
  type Message,
  type MyPollVote,
  type ScheduledMessage,
  type Session,
} from '@sampledge/contracts';
import { ScheduledMessagesService } from '../src/scheduled/scheduled-messages.service.js';
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
let mia: Session;
let group: Conversation;

const poll = (s: Session, body: Record<string, unknown>, c = group) =>
  api<Message>(h, 'POST', `/v1/conversations/${c.conversationId}/polls`, {
    token: s.accessToken,
    body: { clientMessageId: uuidv7(), ...body },
  });
const vote = (s: Session, id: string, optionIds: string[]) =>
  api<Message>(h, 'PUT', `/v1/messages/${id}/poll/vote`, {
    token: s.accessToken,
    body: { optionIds },
  });
const schedule = (s: Session, text: string, inMs: number, c = group) =>
  api<ScheduledMessage>(h, 'POST', `/v1/conversations/${c.conversationId}/scheduled-messages`, {
    token: s.accessToken,
    body: {
      clientMessageId: uuidv7(),
      content: { text, mentions: [] },
      sendAt: new Date(Date.now() + inMs).toISOString(),
    },
  });
const history = async (s: Session, c = group) =>
  (
    await api<Message[]>(h, 'GET', `/v1/conversations/${c.conversationId}/messages`, {
      token: s.accessToken,
    })
  ).body;
const sweeper = () => h.app.get(ScheduledMessagesService);

beforeAll(async () => {
  h = await startHarness();
  const t = await registerTenant(h);
  owner = t.session;
  ravi = await inviteAndLogin(h, owner, t.slug, 'Ravi Kumar');
  mia = await inviteAndLogin(h, owner, t.slug, 'Mia Chen');
  group = (
    await api<Conversation>(h, 'POST', '/v1/conversations', {
      token: owner.accessToken,
      body: { kind: 'group', name: 'Bid team', memberIds: [ravi.user.userId, mia.user.userId] },
    })
  ).body;
});
afterAll(() => h.close());

describe('polls', () => {
  it('creates a poll message that older clients can read as text', async () => {
    const r = await poll(owner, { question: 'Kick-off day?', options: ['Tuesday', 'Thursday'] });
    expect(r.status).toBe(200);
    expect(r.body.content.text).toBe('📊 Kick-off day?');
    expect(r.body.poll).toMatchObject({
      question: 'Kick-off day?',
      multiple: false,
      anonymous: false,
      totalVoters: 0,
      closedAt: null,
    });
    expect(r.body.poll!.options.map((o) => o.optionId)).toEqual(['o1', 'o2']);
    expect((await poll(owner, { question: 'x', options: ['a'] })).status).toBe(400);
    expect((await poll(owner, { question: 'x', options: ['a', 'A'] })).status).toBe(400);
  });

  it('counts votes, replaces a vote, withdraws, and broadcasts', async () => {
    const p = (await poll(owner, { question: 'Venue?', options: ['Pune', 'Mumbai', 'Remote'] }))
      .body;
    const sock = await connect(h, mia.accessToken);
    const upd = nextEvent(sock, 'message:updated', (m) => m.messageId === p.messageId);
    await vote(ravi, p.messageId, ['o1']);
    expect((await upd).poll!.options[0]!.count).toBe(1);
    await vote(mia, p.messageId, ['o1']);
    let r = await vote(ravi, p.messageId, ['o2']);
    expect(r.body.poll!.options.map((o) => o.count)).toEqual([1, 1, 0]);
    expect(r.body.poll!.options[1]!.voterIds).toEqual([ravi.user.userId]);
    expect(r.body.poll!.totalVoters).toBe(2);
    expect((await vote(ravi, p.messageId, ['o1', 'o2'])).status).toBe(400);
    expect((await vote(ravi, p.messageId, ['o9'])).status).toBe(400);
    r = await vote(ravi, p.messageId, []);
    expect(r.body.poll!.totalVoters).toBe(1);
    expect(r.body.changeSequence).toBeGreaterThan(p.changeSequence);
    sock.disconnect();
  });

  it('keeps anonymous votes anonymous but tells you your own', async () => {
    const p = (
      await poll(owner, {
        question: 'Rate the brief',
        options: ['Clear', 'Unclear'],
        anonymous: true,
        multiple: true,
      })
    ).body;
    const r = await vote(ravi, p.messageId, ['o1', 'o2']);
    expect(r.body.poll!.options.map((o) => o.count)).toEqual([1, 1]);
    expect(r.body.poll!.options.every((o) => o.voterIds.length === 0)).toBe(true);
    const mine = await api<MyPollVote>(h, 'GET', `/v1/messages/${p.messageId}/poll/vote`, {
      token: ravi.accessToken,
    });
    expect(mine.body.optionIds).toEqual(['o1', 'o2']);
    const theirs = await api<MyPollVote>(h, 'GET', `/v1/messages/${p.messageId}/poll/vote`, {
      token: mia.accessToken,
    });
    expect(theirs.body.optionIds).toEqual([]);
  });

  it('closes by the author or a moderator, then refuses votes; polls cannot be edited', async () => {
    const p = (await poll(ravi, { question: 'Lunch?', options: ['Yes', 'No'] })).body;
    expect(
      (await api(h, 'POST', `/v1/messages/${p.messageId}/poll/close`, { token: mia.accessToken }))
        .status,
    ).toBe(403);
    const closed = await api<Message>(h, 'POST', `/v1/messages/${p.messageId}/poll/close`, {
      token: ravi.accessToken,
    });
    expect(closed.body.poll).toMatchObject({ closedBy: ravi.user.userId });
    expect((await vote(mia, p.messageId, ['o1'])).status).toBe(409);
    const edit = await api(h, 'PATCH', `/v1/messages/${p.messageId}`, {
      token: ravi.accessToken,
      body: { content: { text: 'changed', mentions: [] } },
    });
    expect(edit.status).toBe(409);
  });

  it('rejects a closing time in the past', async () => {
    const r = await poll(owner, {
      question: 'Too late',
      options: ['a', 'b'],
      closesAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(r.status).toBe(400);
  });
});

describe('scheduled messages', () => {
  it('schedules privately and sends as the author when due, exactly once', async () => {
    const s = await schedule(ravi, 'Reminder: quotas lock at 5pm', 120_000);
    expect(s.status).toBe(200);
    expect(s.body.status).toBe('scheduled');
    const mineList = await api<ScheduledMessage[]>(h, 'GET', '/v1/scheduled-messages', {
      token: ravi.accessToken,
    });
    expect(mineList.body.map((x) => x.scheduledId)).toContain(s.body.scheduledId);
    const others = await api<ScheduledMessage[]>(h, 'GET', '/v1/scheduled-messages', {
      token: owner.accessToken,
    });
    expect(others.body).toEqual([]);
    expect((await history(owner)).some((m) => m.content.text.includes('quotas lock'))).toBe(false);

    expect(await sweeper().sendDue(new Date())).toBe(0);
    const sock = await connect(h, ravi.accessToken);
    const done = nextEvent(sock, 'scheduled:updated', (x) => x.scheduledId === s.body.scheduledId);
    expect(await sweeper().sendDue(new Date(Date.now() + 121_000))).toBe(1);
    const final = await done;
    expect(final.status).toBe('sent');
    const sent = (await history(owner)).filter((m) => m.content.text.includes('quotas lock'));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.senderId).toBe(ravi.user.userId);
    expect(sent[0]!.clientMessageId).toBe(s.body.clientMessageId);
    expect(await sweeper().sendDue(new Date(Date.now() + 200_000))).toBe(0);
    sock.disconnect();
  });

  it('edits, reschedules, sends now and cancels', async () => {
    const s = (await schedule(ravi, 'draft', 3_600_000)).body;
    const e = await api<ScheduledMessage>(h, 'PATCH', `/v1/scheduled-messages/${s.scheduledId}`, {
      token: ravi.accessToken,
      body: { content: { text: 'final text', mentions: [] } },
    });
    expect(e.body.content.text).toBe('final text');
    expect(
      (
        await api(h, 'PATCH', `/v1/scheduled-messages/${s.scheduledId}`, {
          token: mia.accessToken,
          body: { content: { text: 'hijack', mentions: [] } },
        })
      ).status,
    ).toBe(404);
    const now = await api<ScheduledMessage>(
      h,
      'POST',
      `/v1/scheduled-messages/${s.scheduledId}/send-now`,
      { token: ravi.accessToken },
    );
    expect(now.body).toMatchObject({ status: 'sent' });
    expect((await history(owner)).some((m) => m.messageId === now.body.messageId)).toBe(true);

    const c = (await schedule(ravi, 'never mind', 3_600_000)).body;
    const cancelled = await api<ScheduledMessage>(
      h,
      'DELETE',
      `/v1/scheduled-messages/${c.scheduledId}`,
      { token: ravi.accessToken },
    );
    expect(cancelled.body.status).toBe('cancelled');
    expect(await sweeper().sendDue(new Date(Date.now() + 7_200_000))).toBe(0);
  });

  it('validates the time and fails cleanly when the author lost access', async () => {
    expect((await schedule(ravi, 'too soon', 1_000)).status).toBe(400);
    const s = (await schedule(mia, 'after I leave', 120_000)).body;
    await api(h, 'DELETE', `/v1/conversations/${group.conversationId}/members/${mia.user.userId}`, {
      token: owner.accessToken,
    });
    await sweeper().sendDue(new Date(Date.now() + 121_000));
    const list = await api<ScheduledMessage[]>(h, 'GET', '/v1/scheduled-messages', {
      token: mia.accessToken,
    });
    expect(list.body.find((x) => x.scheduledId === s.scheduledId)).toMatchObject({
      status: 'failed',
      error: 'You can no longer post in this conversation',
    });
  });
});

describe('announcement channels', () => {
  it('lets only moderators post once enabled', async () => {
    const ch = (
      await api<Conversation>(h, 'POST', '/v1/conversations', {
        token: owner.accessToken,
        body: { kind: 'channel_public', name: 'announcements', memberIds: [ravi.user.userId] },
      })
    ).body;
    const send = (s: Session) =>
      api(h, 'POST', `/v1/conversations/${ch.conversationId}/messages`, {
        token: s.accessToken,
        body: { clientMessageId: uuidv7(), content: { text: 'hi', mentions: [] } },
      });
    expect((await send(ravi)).status).toBe(200);
    const set = (s: Session, policy: string) =>
      api<Conversation>(h, 'PUT', `/v1/conversations/${ch.conversationId}/posting-policy`, {
        token: s.accessToken,
        body: { policy },
      });
    expect((await set(ravi, 'moderators')).status).toBe(403);
    const r = await set(owner, 'moderators');
    expect(r.body.postingPolicy).toBe('moderators');
    expect((await send(ravi)).status).toBe(403);
    expect((await poll(ravi, { question: 'q', options: ['a', 'b'] }, ch)).status).toBe(403);
    expect((await send(owner)).status).toBe(200);
    expect(
      (
        await api(h, 'PUT', `/v1/conversations/${group.conversationId}/posting-policy`, {
          token: owner.accessToken,
          body: { policy: 'moderators' },
        })
      ).status,
    ).toBe(400);
    await set(owner, 'everyone');
    expect((await send(ravi)).status).toBe(200);
  });
});
