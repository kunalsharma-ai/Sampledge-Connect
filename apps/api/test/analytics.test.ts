import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  uuidv7,
  type AnalyticsResponse,
  type Conversation,
  type SendMessageAck,
  type Session,
} from '@sampledge/contracts';
import { api, inviteAndLogin, registerTenant, startHarness, type Harness } from './harness.js';

let h: Harness;
let owner: Session;
let ravi: Session;
let channel: Conversation;
let dm: Conversation;

const send = (s: Session, c: Conversation, text: string) =>
  api<SendMessageAck>(h, 'POST', `/v1/conversations/${c.conversationId}/messages`, {
    token: s.accessToken,
    body: { clientMessageId: uuidv7(), content: { text, mentions: [] } },
  });
const analytics = (s: Session, query: string) =>
  api<AnalyticsResponse>(h, 'GET', `/v1/analytics?${query}`, { token: s.accessToken });

beforeAll(async () => {
  h = await startHarness();
  const t = await registerTenant(h);
  owner = t.session;
  ravi = await inviteAndLogin(h, owner, t.slug, 'Ravi Kumar');
  channel = (
    await api<Conversation>(h, 'POST', '/v1/conversations', {
      token: owner.accessToken,
      body: { kind: 'channel_public', name: 'fieldwork', memberIds: [ravi.user.userId] },
    })
  ).body;
  dm = (
    await api<Conversation>(h, 'POST', '/v1/conversations', {
      token: owner.accessToken,
      body: { kind: 'dm', memberIds: [ravi.user.userId] },
    })
  ).body;
  await send(owner, channel, 'Wave 3 starts Monday');
  await send(ravi, channel, 'Quota sheet attached');
  await send(ravi, channel, 'Panel looks healthy');
  await send(ravi, dm, 'Can we talk pricing?');
});
afterAll(() => h.close());

describe('analytics', () => {
  it('gives owners organization totals, days, heatmap and top conversations', async () => {
    const r = await analytics(owner, 'scope=org&range=7d&tz=Asia/Kolkata');
    expect(r.status).toBe(200);
    const a = r.body;
    expect(a.totals.messages).toBe(4);
    expect(a.totals.activePeople).toBe(2);
    expect(a.totals.activeConversations).toBe(2);
    expect(a.previous.messages).toBe(0);
    expect(a.daily.length).toBeGreaterThanOrEqual(7);
    expect(a.daily.reduce((s, d) => s + d.messages, 0)).toBe(4);
    expect(a.heatmap.flat().reduce((s, n) => s + n, 0)).toBe(4);
    expect(a.byKind).toEqual({ dm: 1, group: 0, channel: 3 });
    // DMs are never named, only counted together.
    expect(a.topConversations[0]).toMatchObject({ name: 'fieldwork', messages: 3, people: 2 });
    expect(a.topConversations.find((c) => c.kind === 'dm')).toMatchObject({
      conversationId: null,
      name: 'Direct messages',
      messages: 1,
    });
    expect(a.topPeople[0]).toEqual({ userId: ravi.user.userId, messages: 3 });
  });

  it('gives everyone their own activity, and keeps the organization view for admins', async () => {
    const mine = await analytics(ravi, 'scope=me&range=30d');
    expect(mine.status).toBe(200);
    expect(mine.body.totals.messages).toBe(3);
    expect(mine.body.totals.activeConversations).toBe(2);
    expect(mine.body.topPeople).toEqual([]);

    const org = await analytics(ravi, 'scope=org');
    expect(org.status).toBe(403);
  });

  it('validates the range and time zone', async () => {
    expect((await analytics(owner, 'range=1y')).status).toBe(400);
    expect((await analytics(owner, 'tz=Mars/Base')).status).toBe(400);
  });
});
