import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoClient } from 'mongodb';
import {
  CONNECTOR_PROVIDERS,
  uuidv7,
  type Connector,
  type ConnectorDescriptor,
  type InboxAnalytics,
  type InboxConversationDetail,
  type InboxList,
  type InboxMessage,
  type SendMessageAck,
  type Session,
  type TestConnectorResult,
  type Conversation,
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
import { ConnectorHttp } from '../src/connectors/transport.js';
import { InboxService } from '../src/client-inbox/inbox.service.js';
import { OutboundWorker } from '../src/client-inbox/outbound.worker.js';
import { hmacBase64 } from '../src/connectors/adapters/util.js';
import type { HttpRequest, HttpResponse } from '../src/connectors/adapters/types.js';

let h: Harness;
let owner: Session;
let agent: Session;
let other: Session;
let guest: Session;
let slug: string;
let mongo: MongoClient;

const tok = (s: Session) => ({ token: s.accessToken });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 6000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > end) return v;
    await wait(100);
  }
}

const createConnector = async (s: Session, body: Record<string, unknown>) =>
  api<Connector>(h, 'POST', '/v1/connectors', { ...tok(s), body });
const detail = async (s: Session, id: string) =>
  (await api<InboxConversationDetail>(h, 'GET', `/v1/inbox/conversations/${id}`, tok(s))).body;
const simulate = async (connectorId: string, body: Record<string, unknown>) =>
  (
    await api<{ accepted: boolean; conversationIds: string[] }>(
      h,
      'POST',
      `/v1/connectors/${connectorId}/simulate-inbound`,
      {
        ...tok(owner),
        body,
      },
    )
  ).body;
const reply = (s: Session, id: string, text: string, clientMessageId = uuidv7()) =>
  api<InboxMessage>(h, 'POST', `/v1/inbox/conversations/${id}/replies`, {
    ...tok(s),
    body: { clientMessageId, text },
  });

beforeAll(async () => {
  h = await startHarness();
  const t = await registerTenant(h, 'Northwind Research');
  owner = t.session;
  slug = t.slug;
  agent = await inviteAndLogin(h, owner, slug, 'Ravi Agent');
  other = await inviteAndLogin(h, owner, slug, 'Mia Other');
  guest = await inviteAndLogin(h, owner, slug, 'Gus Guest', 'guest');
  mongo = await MongoClient.connect(process.env.MONGO_URL ?? 'mongodb://localhost:27017');
});
afterAll(async () => {
  await mongo.close();
  await h.close();
});

describe('connector catalog and permissions', () => {
  it('describes all twelve providers with honest modes', async () => {
    const r = await api<ConnectorDescriptor[]>(h, 'GET', '/v1/connectors/catalog', tok(agent));
    expect(r.body.map((d) => d.provider).sort()).toEqual([...CONNECTOR_PROVIDERS].sort());
    const mode = Object.fromEntries(r.body.map((d) => [d.provider, d.mode]));
    expect(mode.signal).toBe('handoff');
    expect(mode.imessage).toBe('handoff');
    expect(mode.wechat).toBe('limited');
    expect(mode.telegram).toBe('two_way');
    for (const d of r.body) {
      expect(d.webhookValidation).toBeTruthy();
      expect(d.credentialRotation).toBeTruthy();
      expect(d.docsUrl).toMatch(/^https:\/\//);
    }
  });

  it('only admins manage connectors; guests have no inbox', async () => {
    expect((await createConnector(agent, { provider: 'telegram', name: 'x' })).status).toBe(403);
    expect((await api(h, 'GET', '/v1/inbox/conversations', tok(guest))).status).toBe(403);
    expect((await api(h, 'GET', '/v1/inbox/conversations', tok(agent))).status).toBe(200);
  });
});

describe('Telegram in test mode, end to end', () => {
  let connector: Connector;
  let conversationId: string;

  it('creates a test connector with generated, masked credentials', async () => {
    const r = await createConnector(owner, {
      provider: 'telegram',
      name: 'Support bot',
      environment: 'test',
    });
    expect(r.status).toBe(201);
    connector = r.body;
    expect(connector.environment).toBe('test');
    expect(connector.missingCredentials).toEqual([]);
    expect(connector.credentialHints.botToken).toMatch(/^••••/);
    expect(connector.credentialHints.webhookSecret).toMatch(/^••••/);
    expect(connector.webhookPath).toMatch(/^\/v1\/connectors\/webhooks\/[\w-]{32,}$/);
    // Stored sealed, never in plain text.
    const raw = await mongo
      .db(h.dbName)
      .collection('connectors')
      .findOne({ _id: connector.connectorId as never });
    expect(raw!.credentials).toMatch(/^v1\./);
    expect(JSON.stringify(raw)).not.toMatch(/TEST-/);
  });

  it('rejects a webhook with the wrong secret and counts it', async () => {
    const res = await fetch(h.url + connector.webhookPath!, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'nope' },
      body: JSON.stringify({
        update_id: 1,
        message: {
          message_id: 1,
          date: 1,
          chat: { id: 5, type: 'private' },
          from: { id: 5 },
          text: 'hi',
        },
      }),
    });
    expect(res.status).toBe(401);
    const c = (
      await api<Connector>(h, 'GET', `/v1/connectors/${connector.connectorId}`, tok(owner))
    ).body;
    expect(c.health.rejectedWebhooks).toBe(1);
    expect(
      (await fetch(h.url + '/v1/connectors/webhooks/not-a-real-key', { method: 'POST' })).status,
    ).toBe(404);
  });

  it('a signed inbound message creates a client, a conversation and starts the SLA', async () => {
    const sock = await connect(h, agent.accessToken);
    const changed = nextEvent(sock, 'inbox:changed');
    const r = await simulate(connector.connectorId, {
      fromName: 'Elena Garcia',
      fromHandle: '@elena',
      text: 'Hi, can we get the Q3 tracker results?',
    });
    expect(r.accepted).toBe(true);
    conversationId = r.conversationIds[0]!;
    expect((await changed).conversationId).toBe(conversationId);
    sock.disconnect();

    const d = await detail(agent, conversationId);
    expect(d.conversation.provider).toBe('telegram');
    expect(d.conversation.testMode).toBe(true);
    expect(d.conversation.status).toBe('open');
    expect(d.conversation.sla.state).toBe('on_track');
    expect(d.conversation.awaitingReply).toBe(1);
    expect(d.client.name).toBe('Elena Garcia');
    expect(d.client.identities[0]).toMatchObject({ provider: 'telegram', handle: '@elena' });
    expect(d.timeline.filter((x) => x.type === 'message')).toHaveLength(1);
  });

  it('replies go through the queue to the sandbox, with secrets redacted', async () => {
    const r = await reply(agent, conversationId, 'Hi Elena, sending them today.');
    expect(r.status).toBe(201);
    expect(r.body.deliveryState).toBe('queued');
    const d = await until(
      () => detail(agent, conversationId),
      (x) =>
        x.timeline.some(
          (i) =>
            i.type === 'message' &&
            i.message.direction === 'outbound' &&
            i.message.deliveryState === 'test',
        ),
    );
    const out = d.timeline.find((i) => i.type === 'message' && i.message.direction === 'outbound');
    expect(out?.type === 'message' && out.message.deliveryState).toBe('test');
    const req = out?.type === 'message' ? out.message.sandboxRequest : null;
    expect(req?.url).toMatch(/^https:\/\/api\.telegram\.org\/bot••••\/sendMessage$/);
    expect(req?.body).toMatchObject({ text: 'Hi Elena, sending them today.' });
    // The first reply stopped the clock and met the SLA; the replier was assigned.
    expect(d.conversation.sla.state).toBe('met');
    expect(d.conversation.assigneeId).toBe(agent.user.userId);
    expect(d.conversation.awaitingReply).toBe(0);
  });

  it('replies are idempotent on clientMessageId', async () => {
    const id = uuidv7();
    const a = await reply(agent, conversationId, 'Once', id);
    const b = await reply(agent, conversationId, 'Once', id);
    expect(b.body.messageId).toBe(a.body.messageId);
  });

  it('internal notes stay internal: separate collection, never queued or sent', async () => {
    const before = await mongo
      .db(h.dbName)
      .collection('external_messages')
      .countDocuments({ conversationId });
    const n = await api(h, 'POST', `/v1/inbox/conversations/${conversationId}/notes`, {
      ...tok(agent),
      body: {
        clientNoteId: uuidv7(),
        text: 'Client is price-sensitive, loop in Mia',
        mentions: [other.user.userId],
      },
    });
    expect(n.status).toBe(201);
    await wait(1500);
    const after = await mongo
      .db(h.dbName)
      .collection('external_messages')
      .countDocuments({ conversationId });
    expect(after).toBe(before);
    const all = await mongo
      .db(h.dbName)
      .collection('external_messages')
      .find({ conversationId })
      .toArray();
    expect(JSON.stringify(all)).not.toContain('price-sensitive');
    const d = await detail(agent, conversationId);
    expect(
      d.timeline.some((i) => i.type === 'note' && i.note.text.includes('price-sensitive')),
    ).toBe(true);
  });

  it('assignment, tags, priority and escalation are tracked as activity', async () => {
    let r = await api<InboxConversationDetail>(
      h,
      'PATCH',
      `/v1/inbox/conversations/${conversationId}`,
      {
        ...tok(agent),
        body: { assigneeId: other.user.userId, tags: ['Q3', 'tracker'], priority: 'high' },
      },
    );
    expect(r.status).toBe(200);
    expect(r.body.conversation).toMatchObject({
      assigneeId: other.user.userId,
      tags: ['q3', 'tracker'],
      priority: 'high',
    });
    r = await api<InboxConversationDetail>(
      h,
      'POST',
      `/v1/inbox/conversations/${conversationId}/escalate`,
      {
        ...tok(agent),
        body: { reason: 'Client threatened to cancel', toUserId: owner.user.userId },
      },
    );
    expect(r.body.conversation.escalation?.level).toBe(1);
    expect(r.body.conversation.priority).toBe('urgent');
    expect(r.body.conversation.assigneeId).toBe(owner.user.userId);
    const kinds = r.body.timeline
      .filter((i) => i.type === 'activity')
      .map((i) => (i.type === 'activity' ? i.activity.kind : ''));
    expect(kinds).toEqual(
      expect.arrayContaining([
        'created',
        'assigned',
        'tags_changed',
        'priority_changed',
        'escalated',
      ]),
    );
  });

  it('links SampForce and Samptrek records (unverified until the module is connected)', async () => {
    const r = await api<InboxConversationDetail>(
      h,
      'POST',
      `/v1/inbox/conversations/${conversationId}/links`,
      {
        ...tok(agent),
        body: {
          module: 'sampforce',
          recordType: 'opportunity',
          externalId: 'OPP-1042',
          label: 'Q3 brand tracker renewal',
        },
      },
    );
    expect(r.body.conversation.links[0]).toMatchObject({
      module: 'sampforce',
      externalId: 'OPP-1042',
      verified: false,
    });
    expect(r.body.client.links).toHaveLength(1);
  });

  it('verifies links against records the module has sent; restricted records stay hidden', async () => {
    const now = new Date();
    const base = {
      tenantId: owner.tenant.tenantId,
      conversationId: null,
      parent: null,
      fields: {},
      lastEventType: null,
      channelKey: null,
      createdAt: now,
      updatedAt: now,
    };
    await mongo
      .db(h.dbName)
      .collection('linked_records')
      .insertMany([
        {
          ...base,
          _id: 'rec-proj-77' as never,
          module: 'samptrek',
          recordType: 'project',
          externalId: 'PRJ-77',
          title: 'Q3 Brand Tracker Wave 3',
          url: 'https://samptrek.example/projects/77',
          sensitivity: 'standard',
        },
        {
          ...base,
          _id: 'rec-opp-9' as never,
          module: 'sampforce',
          recordType: 'opportunity',
          externalId: 'OPP-9',
          title: 'Confidential: acquisition study',
          url: 'https://sampforce.example/opp/9',
          sensitivity: 'restricted',
        },
      ]);
    const link = (body: Record<string, unknown>) =>
      api<InboxConversationDetail>(h, 'POST', `/v1/inbox/conversations/${conversationId}/links`, {
        ...tok(agent),
        body,
      });
    const verified = await link({
      module: 'samptrek',
      recordType: 'project',
      externalId: 'PRJ-77',
      label: 'typed label',
    });
    expect(verified.body.conversation.links.find((l) => l.externalId === 'PRJ-77')).toMatchObject({
      verified: true,
      label: 'Q3 Brand Tracker Wave 3',
      url: 'https://samptrek.example/projects/77',
    });
    const restricted = await link({
      module: 'sampforce',
      recordType: 'opportunity',
      externalId: 'OPP-9',
      label: 'Opportunity 9',
    });
    const r = restricted.body.conversation.links.find((l) => l.externalId === 'OPP-9');
    expect(r).toMatchObject({ verified: false, label: 'Opportunity 9' });
    expect(JSON.stringify(restricted.body)).not.toMatch(/acquisition|sampforce\.example/);
  });

  it('later messages from the same client join the same conversation', async () => {
    const res = await api<{ conversationIds: string[] }>(
      h,
      'POST',
      `/v1/connectors/${connector.connectorId}/simulate-inbound`,
      {
        ...tok(owner),
        body: { fromName: 'Elena Garcia', fromHandle: '@elena', text: 'Second message' },
      },
    );
    expect(res.body.conversationIds).toEqual([conversationId]);
    const count = await mongo
      .db(h.dbName)
      .collection('external_messages')
      .countDocuments({ conversationId, direction: 'inbound' });
    expect(count).toBe(2);
  });

  it('search and filters', async () => {
    const byName = await api<InboxList>(h, 'GET', '/v1/inbox/conversations?q=elena', tok(agent));
    expect(byName.body.items.map((c) => c.conversationId)).toContain(conversationId);
    const byTag = await api<InboxList>(h, 'GET', '/v1/inbox/conversations?tag=q3', tok(agent));
    expect(byTag.body.items).toHaveLength(1);
    const none = await api<InboxList>(
      h,
      'GET',
      '/v1/inbox/conversations?provider=slack',
      tok(agent),
    );
    expect(none.body.items).toHaveLength(0);
  });
});

describe('every webhook adapter round-trips in test mode', () => {
  const webhookProviders = CONNECTOR_PROVIDERS.filter((p) => p !== 'signal' && p !== 'imessage');
  for (const provider of webhookProviders) {
    it(provider, async () => {
      const c = (await createConnector(owner, { provider, name: `${provider} test` })).body;
      const r = await simulate(c.connectorId, {
        fromName: `Client ${provider}`,
        fromHandle: `@c_${provider}`,
        text: `hello from ${provider}`,
        email: 'c@example.com',
      });
      expect(r.accepted).toBe(true);
      const id = r.conversationIds[0]!;
      expect((await reply(owner, id, `reply via ${provider}`)).status).toBe(201);
      const d = await until(
        () => detail(owner, id),
        (x) =>
          x.timeline.some(
            (i) =>
              i.type === 'message' &&
              i.message.direction === 'outbound' &&
              i.message.deliveryState !== 'queued' &&
              i.message.deliveryState !== 'sending',
          ),
      );
      const out = d.timeline.find(
        (i) => i.type === 'message' && i.message.direction === 'outbound',
      );
      expect(out?.type === 'message' && [out.message.deliveryState, out.message.error]).toEqual([
        'test',
        null,
      ]);
      expect(JSON.stringify(out)).not.toMatch(/BEGIN PRIVATE KEY/);
      const test = (
        await api<TestConnectorResult>(
          h,
          'POST',
          `/v1/connectors/${c.connectorId}/test`,
          tok(owner),
        )
      ).body;
      expect(test).toMatchObject({ ok: true, sandbox: true });
    });
  }
});

describe('handoff channels', () => {
  it('Signal: agent starts the conversation; replies become an open-in-Signal link', async () => {
    const c = (await createConnector(owner, { provider: 'signal', name: 'Signal desk' })).body;
    expect(c.webhookPath).toBeNull();
    const d = (
      await api<InboxConversationDetail>(h, 'POST', '/v1/inbox/conversations', {
        ...tok(agent),
        body: {
          connectorId: c.connectorId,
          clientName: 'Tom Becker',
          handle: '+49 151 2345678',
          subject: 'Panel invoice',
          firstMessage: 'Sent you the invoice on Signal',
        },
      })
    ).body;
    const id = d.conversation.conversationId;
    expect(d.conversation.channelMode).toBe('handoff');
    const r = await reply(agent, id, 'Thanks Tom, checking now');
    expect(r.body.deliveryState).toBe('handoff');
    expect(r.body.handoffUrl).toBe('https://signal.me/#p/%2B491512345678');
    const logged = await api<InboxConversationDetail>(
      h,
      'POST',
      `/v1/inbox/conversations/${id}/log-inbound`,
      { ...tok(agent), body: { text: 'Paid, thanks!' } },
    );
    expect(logged.body.conversation.awaitingReply).toBe(1);
  });
});

describe('live providers failing never block internal chat', () => {
  let calls: HttpRequest[] = [];
  let answer: (req: HttpRequest) => HttpResponse;
  let restore: () => void;

  beforeAll(() => {
    const http = h.app.get(ConnectorHttp);
    const original = http.live;
    http.live = () => ({ sandbox: false, request: async (req) => (calls.push(req), answer(req)) });
    restore = () => (http.live = original);
  });
  afterAll(() => restore());

  it('flags missing live credentials', async () => {
    const c = (
      await createConnector(owner, {
        provider: 'slack',
        name: 'Slack live',
        environment: 'live',
        credentials: { botToken: 'xoxb-real-looking-token' },
      })
    ).body;
    expect(c.missingCredentials).toEqual(['signingSecret']);
    const t = (
      await api<TestConnectorResult>(h, 'POST', `/v1/connectors/${c.connectorId}/test`, tok(owner))
    ).body;
    expect(t).toMatchObject({ ok: false, message: 'Missing: signingSecret' });
    expect(
      (
        await createConnector(owner, {
          provider: 'slack',
          name: 'bad',
          environment: 'live',
          credentials: { testSigningKey: 'x' },
        })
      ).status,
    ).toBe(400);
  });

  it('retries 5xx with backoff, then sends; an auth error fails the reply and flags the connector', async () => {
    const secret = 'line-channel-secret-123';
    const c = (
      await createConnector(owner, {
        provider: 'line',
        name: 'LINE live',
        environment: 'live',
        credentials: { channelSecret: secret, channelAccessToken: 'line-token-abcdef' },
      })
    ).body;
    const body = JSON.stringify({
      events: [
        {
          type: 'message',
          webhookEventId: 'evt-live-1',
          timestamp: Date.now(),
          source: { type: 'user', userId: 'Ulive1' },
          message: { id: '1', type: 'text', text: 'Live hello' },
        },
      ],
    });
    const wh = await fetch(h.url + c.webhookPath!, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-line-signature': hmacBase64(secret, body) },
      body,
    });
    expect(wh.status).toBe(200);
    const list = (
      await api<InboxList>(h, 'GET', '/v1/inbox/conversations?provider=line', tok(owner))
    ).body;
    const id = list.items.find((x) => x.connectorId === c.connectorId)!.conversationId;

    let n = 0;
    calls = [];
    answer = () =>
      ++n === 1
        ? { status: 503, headers: {}, json: { message: 'busy' } }
        : { status: 200, headers: {}, json: { sentMessages: [{ id: 'line-msg-9' }] } };
    const started = Date.now();
    await reply(owner, id, 'Live reply');
    // Internal chat is unaffected while the provider misbehaves.
    const dmRes = await api<Conversation>(h, 'POST', '/v1/conversations', {
      ...tok(owner),
      body: { kind: 'dm', memberIds: [agent.user.userId] },
    });
    expect([200, 201]).toContain(dmRes.status);
    const dm = dmRes.body;
    const sent = await api<SendMessageAck>(
      h,
      'POST',
      `/v1/conversations/${dm.conversationId}/messages`,
      {
        ...tok(owner),
        body: {
          clientMessageId: uuidv7(),
          content: { text: 'internal still works', mentions: [] },
          replyToMessageId: null,
        },
      },
    );
    expect(sent.status).toBe(200);
    // A provider redelivery of the same event is acknowledged but not stored twice.
    expect(
      (
        await fetch(h.url + c.webhookPath!, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-line-signature': hmacBase64(secret, body),
          },
          body,
        })
      ).status,
    ).toBe(200);
    expect(
      await mongo
        .db(h.dbName)
        .collection('external_messages')
        .countDocuments({ conversationId: id, direction: 'inbound' }),
    ).toBe(1);
    expect(Date.now() - started).toBeLessThan(3000);

    const d = await until(
      () => detail(owner, id),
      (x) => x.timeline.some((i) => i.type === 'message' && i.message.deliveryState === 'sent'),
      10_000,
    );
    const out = d.timeline.find((i) => i.type === 'message' && i.message.direction === 'outbound');
    expect(out?.type === 'message' && out.message).toMatchObject({
      deliveryState: 'sent',
      externalMessageId: 'line-msg-9',
      attempts: 2,
    });
    expect(calls[0]!.url).toBe('https://api.line.me/v2/bot/message/push');
    expect(calls[0]!.headers.authorization).toBe('Bearer line-token-abcdef');

    answer = () => ({ status: 401, headers: {}, json: { message: 'Authentication failed' } });
    await reply(owner, id, 'This one will fail');
    const failed = await until(
      () => detail(owner, id),
      (x) => x.timeline.some((i) => i.type === 'message' && i.message.deliveryState === 'failed'),
    );
    const f = failed.timeline.find(
      (i) => i.type === 'message' && i.message.deliveryState === 'failed',
    );
    expect(f?.type === 'message' && f.message.error).toMatch(/Authentication failed/);
    const conn = (await api<Connector>(h, 'GET', `/v1/connectors/${c.connectorId}`, tok(owner)))
      .body;
    expect(conn.status).toBe('error');

    // Rotating credentials clears the error; the old secret keeps verifying webhooks in the grace window.
    const rotated = (
      await api<Connector>(h, 'PUT', `/v1/connectors/${c.connectorId}/credentials`, {
        ...tok(owner),
        body: {
          credentials: { channelSecret: 'new-secret-456', channelAccessToken: 'new-token' },
          graceHours: 24,
        },
      })
    ).body;
    expect(rotated.status).toBe('active');
    expect(rotated.previousCredentialsValidUntil).not.toBeNull();
    const old = JSON.stringify({
      events: [
        {
          type: 'message',
          webhookEventId: 'evt-live-2',
          timestamp: Date.now(),
          source: { type: 'user', userId: 'Ulive1' },
          message: { id: '2', type: 'text', text: 'Signed with old secret' },
        },
      ],
    });
    expect(
      (
        await fetch(h.url + c.webhookPath!, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-line-signature': hmacBase64(secret, old),
          },
          body: old,
        })
      ).status,
    ).toBe(200);
    await api(h, 'PUT', `/v1/connectors/${c.connectorId}/credentials`, {
      ...tok(owner),
      body: { credentials: { channelSecret: 'newest-789' }, graceHours: 0 },
    });
    expect(
      (
        await fetch(h.url + c.webhookPath!, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-line-signature': hmacBase64(secret, old),
          },
          body: old,
        })
      ).status,
    ).toBe(401);

    // The audit trail names fields, never values.
    const audit = await mongo
      .db(h.dbName)
      .collection('audit_logs')
      .find({ action: 'connector.credentials_rotated' })
      .toArray();
    expect(audit.length).toBe(2);
    expect(JSON.stringify(audit)).not.toContain('new-secret-456');
    void h.app.get(OutboundWorker);
  });
});

describe('teams, SLA, analytics and isolation', () => {
  it('team-owned conversations are hidden from agents outside the team', async () => {
    const settings = await api(h, 'PUT', '/v1/inbox/settings', {
      ...tok(owner),
      body: {
        sla: { low: 1440, normal: 240, high: 60, urgent: 15 },
        dueSoonRatio: 0.75,
        autoEscalateOnBreach: true,
        escalationContactIds: [owner.user.userId],
        autoAssign: true,
        teams: [{ teamId: '', name: 'Key accounts', memberIds: [agent.user.userId] }],
      },
    });
    expect(settings.status).toBe(200);
    expect((await api(h, 'PUT', '/v1/inbox/settings', { ...tok(agent), body: {} })).status).toBe(
      403,
    );
    const teamId = (settings.body as { teams: { teamId: string }[] }).teams[0]!.teamId;
    const c = (
      await createConnector(owner, { provider: 'mattermost', name: 'Key accounts MM', teamId })
    ).body;
    const r = await simulate(c.connectorId, {
      fromName: 'Hiro Tanaka',
      fromHandle: 'hiro',
      text: 'Need a quote',
    });
    const id = r.conversationIds[0]!;
    const asAgent = await detail(agent, id);
    expect(asAgent.conversation.teamId).toBe(teamId);
    expect(asAgent.conversation.assigneeId).toBe(agent.user.userId); // auto-assigned within the team
    expect((await api(h, 'GET', `/v1/inbox/conversations/${id}`, tok(other))).status).toBe(404);
    const list = await api<InboxList>(h, 'GET', '/v1/inbox/conversations', tok(other));
    expect(list.body.items.some((x) => x.conversationId === id)).toBe(false);

    // SLA breach -> auto-escalation to the escalation contact.
    await h.app.get(InboxService).sweep(new Date(Date.now() + 5 * 3600_000));
    const after = await detail(owner, id);
    expect(after.conversation.sla.breachedAt).not.toBeNull();
    expect(after.conversation.escalation).toMatchObject({ level: 1, reason: 'SLA breached' });
    expect(after.conversation.assigneeId).toBe(owner.user.userId);
  });

  it('supervisor dashboard numbers', async () => {
    expect((await api(h, 'GET', '/v1/inbox/analytics', tok(agent))).status).toBe(403);
    const a = (await api<InboxAnalytics>(h, 'GET', '/v1/inbox/analytics?days=7', tok(owner))).body;
    expect(a.totals.conversations).toBeGreaterThanOrEqual(12);
    expect(a.totals.inbound).toBeGreaterThanOrEqual(12);
    expect(a.byProvider.length).toBeGreaterThanOrEqual(10);
    expect(a.daily.length).toBeGreaterThanOrEqual(7);
    expect(a.slaMetRate).not.toBeNull();
    expect(a.agents.some((x) => x.userId === agent.user.userId)).toBe(true);
  });

  it('templates with shortcuts', async () => {
    const t = await api(h, 'POST', '/v1/inbox/templates', {
      ...tok(agent),
      body: {
        name: 'Thanks',
        shortcut: 'thanks',
        body: 'Thanks {{client.firstName}}, {{agent.name}} here.',
      },
    });
    expect(t.status).toBe(201);
    expect(
      (
        await api(h, 'POST', '/v1/inbox/templates', {
          ...tok(other),
          body: { name: 'Dup', shortcut: 'thanks', body: 'x' },
        })
      ).status,
    ).toBe(409);
    const id = (t.body as { templateId: string }).templateId;
    expect((await api(h, 'DELETE', `/v1/inbox/templates/${id}`, tok(other))).status).toBe(403);
    expect((await api(h, 'DELETE', `/v1/inbox/templates/${id}`, tok(owner))).status).toBe(200);
  });

  it('another tenant sees nothing', async () => {
    const t2 = await registerTenant(h, 'Other Org');
    const list = await api<InboxList>(
      h,
      'GET',
      '/v1/inbox/conversations?status=open',
      tok(t2.session),
    );
    expect(list.body.items).toHaveLength(0);
    const mine = (await api<InboxList>(h, 'GET', '/v1/inbox/conversations', tok(owner))).body
      .items[0]!;
    expect(
      (await api(h, 'GET', `/v1/inbox/conversations/${mine.conversationId}`, tok(t2.session)))
        .status,
    ).toBe(404);
    expect((await api(h, 'GET', '/v1/connectors', tok(t2.session))).body).toEqual([]);
  });
});
