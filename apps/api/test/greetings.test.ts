import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  greetingOf,
  uuidv7,
  type Conversation,
  type GreetingPolicyState,
  type NotificationPage,
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
let dm: Conversation;

const card = {
  occasionId: 'diwali',
  styleId: 'radiant',
  title: 'Happy Diwali',
  to: 'Ravi',
};
const sendCard = (s: Session, body: Record<string, unknown> = {}, id = uuidv7()) =>
  api<SendMessageAck>(h, 'POST', `/v1/conversations/${dm.conversationId}/messages`, {
    token: s.accessToken,
    body: {
      clientMessageId: id,
      content: { text: 'May every diya you light tonight bring warmth.', mentions: [] },
      greeting: card,
      ...body,
    },
  });
const setPolicy = (s: Session, body: unknown) =>
  api<GreetingPolicyState>(h, 'PUT', '/v1/admin/greetings', { token: s.accessToken, body });

beforeAll(async () => {
  h = await startHarness();
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
afterAll(() => h.close());

describe('greeting cards', () => {
  it('is on by default with every category offered', async () => {
    const r = await api<GreetingPolicyState>(h, 'GET', '/v1/greetings/policy', {
      token: ravi.accessToken,
    });
    expect(r.body.policy).toEqual({ enabled: true, hiddenCategories: [] });
  });

  it('sends a card live, idempotently, and previews it in notifications', async () => {
    const sock = await connect(h, ravi.accessToken);
    const live = nextEvent(sock, 'message:new', (m) => !!greetingOf(m));
    const id = uuidv7();
    const r = await sendCard(owner, {}, id);
    expect(r.status).toBe(200);
    expect(greetingOf(r.body.message)).toEqual(card);
    expect(r.body.message.content.text).toContain('diya');
    expect(greetingOf(await live)).toEqual(card);
    // A retry from the offline queue returns the same message.
    const again = await sendCard(owner, {}, id);
    expect(again.body.duplicate).toBe(true);
    expect(again.body.message.messageId).toBe(r.body.message.messageId);
    sock.disconnect();

    // A mention puts it in the in-app list (DMs alone only push), with the card's headline.
    await sendCard(owner, {
      content: {
        text: 'May every diya you light tonight bring warmth.',
        mentions: [ravi.user.userId],
      },
    });
    const n = await api<NotificationPage>(h, 'GET', '/v1/notifications', {
      token: ravi.accessToken,
    });
    expect(n.body.items.some((x) => x.preview.startsWith('🪔 Happy Diwali: May every diya'))).toBe(
      true,
    );
  });

  it('refuses unknown occasions and styles, and cards without a message', async () => {
    expect((await sendCard(owner, { greeting: { ...card, occasionId: 'nope' } })).status).toBe(400);
    expect((await sendCard(owner, { greeting: { ...card, styleId: 'neon' } })).status).toBe(400);
    expect((await sendCard(owner, { greeting: { ...card, title: '  ' } })).status).toBe(400);
    expect((await sendCard(owner, { content: { text: ' ', mentions: [] } })).status).toBe(400);
  });

  it('lets admins hide categories or turn cards off, live for everyone', async () => {
    expect((await setPolicy(ravi, { enabled: false })).status).toBe(403);

    const sock = await connect(h, ravi.accessToken);
    let live = nextEvent(sock, 'tenant:updated', (e) => e.area === 'greetings');
    const r = await setPolicy(owner, { enabled: true, hiddenCategories: ['india', 'india'] });
    expect(r.status).toBe(200);
    expect(r.body.policy).toEqual({ enabled: true, hiddenCategories: ['india'] });
    await live;
    expect((await sendCard(owner)).status).toBe(400);
    expect(
      (
        await sendCard(owner, {
          greeting: { ...card, occasionId: 'birthday', title: 'Happy Birthday' },
        })
      ).status,
    ).toBe(200);

    live = nextEvent(sock, 'tenant:updated', (e) => e.area === 'greetings');
    await setPolicy(owner, { enabled: false, hiddenCategories: [] });
    await live;
    expect(
      (await sendCard(owner, { greeting: { ...card, occasionId: 'birthday', title: 'Hi' } }))
        .status,
    ).toBe(400);
    // Plain messages are unaffected.
    expect(
      (await sendCard(owner, { greeting: undefined, content: { text: 'hello', mentions: [] } }))
        .status,
    ).toBe(200);
    await setPolicy(owner, { enabled: true, hiddenCategories: [] });
    sock.disconnect();
  });
});
