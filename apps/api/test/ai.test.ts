import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  uuidv7,
  type AiAskResponse,
  type AiDigest,
  type AiMeetingSummary,
  type AiPrioritizedNotifications,
  type AiProposal,
  type AiSearchResponse,
  type AiStatus,
  type AiSuggestedReplies,
  type AiSummary,
  type AiTranslation,
  type Conversation,
  type Meeting,
  type Message,
  type SendMessageAck,
  type Session,
} from '@sampledge/contracts';
import {
  AI_SETTINGS_SOURCE,
  StaticSettingsSource,
  type SwappableSettingsSource,
} from '../src/ai/settings.js';
import { api, inviteAndLogin, registerTenant, startHarness, type Harness } from './harness.js';

let h: Harness;
let owner: Session;
let ravi: Session;
let mia: Session;
let outsider: Session;
let guest: Session;
let bid: Conversation; // private group: owner, ravi, mia
let general: Conversation; // public channel created by owner
let slug: string;

const send = async (s: Session, conversationId: string, text: string, mentions: string[] = []) =>
  (
    await api<SendMessageAck>(h, 'POST', `/v1/conversations/${conversationId}/messages`, {
      token: s.accessToken,
      body: { clientMessageId: uuidv7(), content: { text, mentions } },
    })
  ).body.message;
const ai = <T>(s: Session, method: string, path: string, body?: unknown) =>
  api<T>(h, method, `/v1/ai${path}`, { token: s.accessToken, body });

beforeAll(async () => {
  h = await startHarness();
  const t = await registerTenant(h, 'Northwind Research');
  slug = t.slug;
  owner = t.session;
  ravi = await inviteAndLogin(h, owner, slug, 'Ravi Kumar');
  mia = await inviteAndLogin(h, owner, slug, 'Mia Chen');
  outsider = await inviteAndLogin(h, owner, slug, 'Omar Outside');
  guest = await inviteAndLogin(h, owner, slug, 'Gina Guest', 'guest');
  bid = (
    await api<Conversation>(h, 'POST', '/v1/conversations', {
      token: owner.accessToken,
      body: { kind: 'group', name: 'Bid team', memberIds: [ravi.user.userId, mia.user.userId] },
    })
  ).body;
  general = (
    await api<Conversation>(h, 'POST', '/v1/conversations', {
      token: owner.accessToken,
      body: { kind: 'channel_public', name: 'office-news', memberIds: [] },
    })
  ).body;
  await send(
    owner,
    bid.conversationId,
    'Morning team. The client wants the Germany quote for the healthcare panel by Friday.',
  );
  await send(ravi, bid.conversationId, 'I’ll prepare the cost breakdown for the panel today.');
  await send(
    mia,
    bid.conversationId,
    'We agreed to use the 18-24 quota from wave 2. Ravi, can you double-check incidence rates?',
  );
  await send(
    owner,
    bid.conversationId,
    'Decided: we go with the premium sample tier. Mia please update the proposal deck by Thursday.',
  );
  await send(ravi, bid.conversationId, 'Should we include the Austria boost sample as an option?');
  await send(
    owner,
    general.conversationId,
    'Reminder: the office kitchen gets cleaned on Wednesday.',
  );
});
afterAll(() => h.close());

describe('AI assistant (built-in engine)', () => {
  it('reports the basic engine and feature levels', async () => {
    const r = await ai<AiStatus>(ravi, 'GET', '/status');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ enabled: true, engine: 'basic', model: null, canManage: false });
    expect(r.body.features.translation).toBe('needs_model');
    expect(r.body.features.summaries).toBe('limited');
    expect((await ai<AiStatus>(owner, 'GET', '/status')).body.canManage).toBe(true);
  });

  it('summarizes with decisions, assigned action items and open questions', async () => {
    const r = await ai<AiSummary>(ravi, 'POST', `/conversations/${bid.conversationId}/summary`, {
      range: 'recent',
    });
    expect(r.status).toBe(200);
    const s = r.body;
    expect(s.engine).toBe('basic');
    expect(s.messageCount).toBe(5);
    expect(s.summary).toMatch(/5 messages from/);
    expect(s.decisions.join(' ')).toMatch(/premium sample tier/);
    const deck = s.actionItems.find((a) => /proposal deck/.test(a.text));
    expect(deck).toMatchObject({ assigneeId: mia.user.userId, due: 'by Thursday' });
    const breakdown = s.actionItems.find((a) => /cost breakdown/.test(a.text));
    expect(breakdown?.assigneeId).toBe(ravi.user.userId);
    expect(s.openQuestions.join(' ')).toMatch(/Austria boost/);
    expect(s.participantIds).toHaveLength(3);
  });

  it('never summarizes conversations the caller cannot read', async () => {
    expect(
      (await ai(outsider, 'POST', `/conversations/${bid.conversationId}/summary`, {})).status,
    ).toBe(404);
    expect(
      (await ai(guest, 'POST', `/conversations/${general.conversationId}/summary`, {})).status,
    ).toBe(404);
    // Public channels are readable by members of the organization without joining.
    expect(
      (
        await ai<AiSummary>(
          outsider,
          'POST',
          `/conversations/${general.conversationId}/summary`,
          {},
        )
      ).body.messageCount,
    ).toBe(1);
  });

  it('summarizes only unread messages for "unread"', async () => {
    const r = await ai<AiSummary>(mia, 'POST', `/conversations/${bid.conversationId}/summary`, {
      range: 'unread',
    });
    expect(r.body.messageCount).toBe(4); // everything except Mia's own message
    await api(h, 'POST', '/v1/messages/receipts', {
      token: mia.accessToken,
      body: { conversationId: bid.conversationId, kind: 'read', upToSequence: r.body.toSequence },
    });
    const after = await ai<AiSummary>(mia, 'POST', `/conversations/${bid.conversationId}/summary`, {
      range: 'unread',
    });
    expect(after.body.messageCount).toBe(0);
    expect(after.body.summary).toMatch(/caught up/);
  });

  it('semantic search finds related wording, only in readable conversations', async () => {
    const r = await ai<AiSearchResponse>(ravi, 'POST', '/search', {
      query: 'pricing for the panel quotes',
    });
    expect(r.status).toBe(200);
    expect(r.body.hits[0]!.conversationId).toBe(bid.conversationId);
    expect(r.body.hits[0]!.text).toMatch(/quote|cost/);
    const o = await ai<AiSearchResponse>(outsider, 'POST', '/search', {
      query: 'pricing for the panel quotes',
    });
    expect(o.body.hits.every((x) => x.conversationId !== bid.conversationId)).toBe(true);
    expect(
      (
        await ai(outsider, 'POST', '/search', {
          query: 'panel',
          conversationId: bid.conversationId,
        })
      ).status,
    ).toBe(404);
  });

  it('drops deleted messages and removed members from search', async () => {
    const secret = await send(
      mia,
      bid.conversationId,
      'Confidential: the margin target on the Zephyr account is 42 percent.',
    );
    let r = await ai<AiSearchResponse>(ravi, 'POST', '/search', { query: 'Zephyr margin target' });
    expect(r.body.hits[0]?.messageId).toBe(secret.messageId);
    await api(h, 'DELETE', `/v1/messages/${secret.messageId}`, { token: mia.accessToken });
    r = await ai<AiSearchResponse>(ravi, 'POST', '/search', { query: 'Zephyr margin target' });
    expect(r.body.hits.some((x) => x.messageId === secret.messageId)).toBe(false);

    const tmp = await send(
      owner,
      bid.conversationId,
      'Nebula renewal paperwork is in the shared drive.',
    );
    expect(
      (await ai<AiSearchResponse>(mia, 'POST', '/search', { query: 'Nebula renewal paperwork' }))
        .body.hits[0]?.messageId,
    ).toBe(tmp.messageId);
    await api(h, 'DELETE', `/v1/conversations/${bid.conversationId}/members/${mia.user.userId}`, {
      token: owner.accessToken,
    });
    const gone = await ai<AiSearchResponse>(mia, 'POST', '/search', {
      query: 'Nebula renewal paperwork',
    });
    expect(gone.body.hits.some((x) => x.conversationId === bid.conversationId)).toBe(false);
    expect((await ai(mia, 'POST', `/conversations/${bid.conversationId}/summary`, {})).status).toBe(
      404,
    );
    await api(h, 'POST', `/v1/conversations/${bid.conversationId}/members`, {
      token: owner.accessToken,
      body: { userIds: [mia.user.userId] },
    });
  });

  it('answers questions from readable messages with sources', async () => {
    const r = await ai<AiAskResponse>(ravi, 'POST', '/ask', {
      question: 'Which sample tier did we pick?',
    });
    expect(r.status).toBe(200);
    expect(r.body.engine).toBe('basic');
    expect(r.body.sources[0]!.text).toMatch(/premium sample tier/);
    expect(r.body.answer).toMatch(/Bid team/);
    const o = await ai<AiAskResponse>(outsider, 'POST', '/ask', {
      question: 'Which sample tier did we pick?',
    });
    expect(o.body.sources.some((s) => s.conversationId === bid.conversationId)).toBe(false);
  });

  it('suggests replies, needs a model to translate, and checks access for both', async () => {
    const r = await ai<AiSuggestedReplies>(
      owner,
      'POST',
      `/conversations/${bid.conversationId}/replies`,
    );
    expect(r.body.suggestions).toHaveLength(3);
    expect(r.body.replyToMessageId).toBeTruthy();
    expect(
      (await ai(outsider, 'POST', `/conversations/${bid.conversationId}/replies`)).status,
    ).toBe(404);
    const msg = (
      await api<Message[]>(h, 'GET', `/v1/conversations/${bid.conversationId}/messages`, {
        token: owner.accessToken,
      })
    ).body[0]!;
    const tr = await ai<AiTranslation>(owner, 'POST', '/translate', {
      messageId: msg.messageId,
      targetLanguage: 'de',
    });
    expect(tr.body).toMatchObject({ text: null, engine: 'basic' });
    expect(
      (await ai(outsider, 'POST', '/translate', { messageId: msg.messageId, targetLanguage: 'de' }))
        .status,
    ).toBe(404);
  });

  it('builds a status digest and suggested tasks, skipping unreadable conversations', async () => {
    const r = await ai<AiDigest>(outsider, 'POST', '/digest', {
      conversationIds: [bid.conversationId, general.conversationId],
    });
    expect(r.body.items.map((i) => i.conversationId)).toEqual([general.conversationId]);
    const mine = await ai<AiDigest>(ravi, 'POST', '/digest', {});
    const item = mine.body.items.find((i) => i.conversationId === bid.conversationId)!;
    expect(item.status).toBe('needs_attention');
    expect(mine.body.suggestedTasks.length).toBeGreaterThan(0);
  });

  it('flags likely duplicates', async () => {
    const r = await ai<{ matches: { text: string }[] }>(mia, 'POST', '/duplicates', {
      text: 'Can someone double-check the incidence rates?',
    });
    expect(r.body.matches[0]?.text).toMatch(/incidence rates/);
  });

  it('ranks notifications: urgent DM mentions first', async () => {
    const dm = (
      await api<Conversation>(h, 'POST', '/v1/conversations', {
        token: owner.accessToken,
        body: { kind: 'dm', memberIds: [ravi.user.userId] },
      })
    ).body;
    await send(owner, bid.conversationId, '@Ravi Kumar nice work on the deck', [ravi.user.userId]);
    await send(owner, dm.conversationId, '@Ravi Kumar urgent: can you approve the invoice today?', [
      ravi.user.userId,
    ]);
    const r = await ai<AiPrioritizedNotifications>(ravi, 'GET', '/notifications/priority');
    expect(r.body.items).toHaveLength(2);
    expect(r.body.items[0]).toMatchObject({ priority: 'high' });
    expect(r.body.items[0]!.reasons).toEqual(
      expect.arrayContaining(['Direct message', 'Sounds urgent']),
    );
    expect(r.body.items[1]!.priority).not.toBe('high');
  });

  it('summarizes a meeting from its chat, for people who can read that chat', async () => {
    const start = new Date(Date.now() + 30 * 60_000);
    const m = (
      await api<Meeting>(h, 'POST', '/v1/meetings', {
        token: owner.accessToken,
        body: {
          title: 'Wave 3 quota review',
          agenda: 'Walk through Germany quotas and the 18-24 cell',
          startsAt: start.toISOString(),
          endsAt: new Date(start.getTime() + 30 * 60_000).toISOString(),
          timeZone: 'Europe/Berlin',
          attendeeIds: [ravi.user.userId],
        },
      })
    ).body;
    await send(
      ravi,
      m.conversationId,
      'I’ll bring the Germany quota sheet. We agreed to cap the 18-24 cell at 120.',
    );
    const r = await ai<AiMeetingSummary>(owner, 'POST', `/meetings/${m.meetingId}/summary`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      meetingId: m.meetingId,
      title: 'Wave 3 quota review',
      transcriptIncluded: false,
    });
    expect(r.body.decisions.join(' ')).toMatch(/cap the 18-24 cell/);
    expect((await ai(outsider, 'POST', `/meetings/${m.meetingId}/summary`)).status).toBe(404);
  });
});

describe('drafts need confirmation', () => {
  it('sends nothing until the author confirms; others cannot confirm', async () => {
    const before = (
      await api<Message[]>(h, 'GET', `/v1/conversations/${bid.conversationId}/messages`, {
        token: owner.accessToken,
      })
    ).body.length;
    const p = await ai<AiProposal>(owner, 'POST', '/proposals', {
      kind: 'send_message',
      conversationId: bid.conversationId,
      text: 'Summary: we use the premium tier and Mia updates the deck.',
    });
    expect(p.status).toBe(201);
    expect(p.body).toMatchObject({ status: 'pending', risk: { level: 'normal' } });
    const count = (
      await api<Message[]>(h, 'GET', `/v1/conversations/${bid.conversationId}/messages`, {
        token: owner.accessToken,
      })
    ).body.length;
    expect(count).toBe(before);
    expect(
      (await ai(ravi, 'POST', `/proposals/${p.body.proposalId}/confirm`, { confirm: true })).status,
    ).toBe(404);
    expect((await ai(owner, 'POST', `/proposals/${p.body.proposalId}/confirm`, {})).status).toBe(
      400,
    );

    const ok = await ai<{ message: Message; proposal: AiProposal }>(
      owner,
      'POST',
      `/proposals/${p.body.proposalId}/confirm`,
      { confirm: true },
    );
    expect(ok.status).toBe(200);
    expect(ok.body.proposal.status).toBe('confirmed');
    expect(ok.body.message.senderId).toBe(owner.user.userId);
    const again = await ai<{ message: Message }>(
      owner,
      'POST',
      `/proposals/${p.body.proposalId}/confirm`,
      { confirm: true },
    );
    expect(again.body.message.messageId).toBe(ok.body.message.messageId);
  });

  it('needs a second acknowledgement for financial, HR, client-facing or destructive drafts', async () => {
    const p = await ai<AiProposal>(owner, 'POST', '/proposals', {
      kind: 'send_message',
      conversationId: bid.conversationId,
      text: 'Please approve the $4,200 invoice and send it to the client.',
    });
    expect(p.body.risk).toEqual({ level: 'sensitive', categories: ['financial', 'client_facing'] });
    const blocked = await ai<{ error: { details: { reason: string } } }>(
      owner,
      'POST',
      `/proposals/${p.body.proposalId}/confirm`,
      { confirm: true },
    );
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.details.reason).toBe('RISK_ACK_REQUIRED');
    // Editing a harmless draft into a sensitive one is caught too.
    const q = await ai<AiProposal>(owner, 'POST', '/proposals', {
      kind: 'send_message',
      conversationId: bid.conversationId,
      text: 'Thanks all',
    });
    expect(
      (
        await ai(owner, 'POST', `/proposals/${q.body.proposalId}/confirm`, {
          confirm: true,
          text: 'Delete the old survey links',
        })
      ).status,
    ).toBe(400);
    const ok = await ai(owner, 'POST', `/proposals/${p.body.proposalId}/confirm`, {
      confirm: true,
      acknowledgeRisk: true,
    });
    expect(ok.status).toBe(200);
  });

  it('cannot draft where the caller cannot post, and dismissed drafts stay unsent', async () => {
    expect(
      (
        await ai(outsider, 'POST', '/proposals', {
          kind: 'send_message',
          conversationId: general.conversationId,
          text: 'hi',
        })
      ).status,
    ).toBe(403);
    const p = await ai<AiProposal>(ravi, 'POST', '/proposals', {
      kind: 'send_message',
      conversationId: bid.conversationId,
      text: 'Draft',
    });
    expect(
      (await ai<AiProposal>(ravi, 'POST', `/proposals/${p.body.proposalId}/dismiss`)).body.status,
    ).toBe('dismissed');
    expect(
      (await ai(ravi, 'POST', `/proposals/${p.body.proposalId}/confirm`, { confirm: true })).status,
    ).toBe(409);
  });
});

describe('organization switch', () => {
  it('only admins turn AI off, and then every AI call is refused but chat works', async () => {
    expect((await ai(ravi, 'PUT', '/settings', { enabled: false })).status).toBe(403);
    expect((await ai<AiStatus>(owner, 'PUT', '/settings', { enabled: false })).body.engine).toBe(
      'off',
    );
    expect((await ai(ravi, 'POST', '/search', { query: 'panel quote' })).status).toBe(403);
    expect((await send(ravi, bid.conversationId, 'Chat still works')).messageId).toBeTruthy();
    expect((await ai<AiStatus>(owner, 'PUT', '/settings', { enabled: true })).body.engine).toBe(
      'basic',
    );
    // The recordings settings row created on the way keeps its defaults.
    const rec = await api<{ callRecordingEnabled: boolean }>(
      h,
      'GET',
      '/v1/admin/recording-settings',
      { token: owner.accessToken },
    );
    if (rec.status === 200) expect(rec.body.callRecordingEnabled).toBe(true);
  });
});

describe('model server settings live in the database', () => {
  it('admins set the model server in Integrations; the assistant picks it up', async () => {
    const put = (s: Session, values: Record<string, unknown>, enabled = true) =>
      api(h, 'PUT', '/v1/admin/integrations/ai.model', {
        token: s.accessToken,
        body: { enabled, values },
      });
    expect((await put(ravi, { baseUrl: 'http://127.0.0.1:9', chatModel: 'llama3.1' })).status).toBe(
      403,
    );
    expect(
      (
        await put(owner, {
          baseUrl: 'http://127.0.0.1:9',
          chatModel: 'llama3.1',
          apiKey: 'sk-secret',
        })
      ).status,
    ).toBe(200);
    const st = await ai<AiStatus>(ravi, 'GET', '/status');
    expect(st.body).toMatchObject({ engine: 'model', model: 'llama3.1' });
    // Nothing listens on port 9: the assistant still answers, with the built-in engine.
    const r = await ai<AiSummary>(ravi, 'POST', `/conversations/${bid.conversationId}/summary`, {
      range: 'week',
    });
    expect(r.body.engine).toBe('basic');
    expect((await ai<AiStatus>(ravi, 'GET', '/status')).body.lastError).toMatch(
      /Cannot reach the model server/,
    );
    const test = await api<{ ok: boolean }>(h, 'POST', '/v1/admin/integrations/ai.model/test', {
      token: owner.accessToken,
      body: {},
    });
    expect(test.body.ok).toBe(false);
    // Cloud metadata addresses are refused.
    await put(owner, { baseUrl: 'http://169.254.169.254', chatModel: 'x' });
    expect((await ai<AiStatus>(ravi, 'GET', '/status')).body).toMatchObject({ engine: 'basic' });
    await put(owner, { baseUrl: 'http://127.0.0.1:9', chatModel: 'llama3.1' }, false);
    expect((await ai<AiStatus>(ravi, 'GET', '/status')).body.engine).toBe('basic');
  });
});

describe('model server (OpenAI-compatible)', () => {
  let server: Server;
  let prompts: string[] = [];
  let mode: 'ok' | 'down' = 'ok';
  const source = () => h.app.get<SwappableSettingsSource>(AI_SETTINGS_SOURCE);

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (mode === 'down') {
          res.writeHead(500).end('boom secret internal detail');
          return;
        }
        const j = JSON.parse(body);
        res.setHeader('content-type', 'application/json');
        if (req.url === '/v1/embeddings') {
          const data = (j.input as string[]).map((t, index) => ({
            index,
            embedding: [
              /panel|quote|cost|pric/i.test(t) ? 1 : 0,
              /quota|cell/i.test(t) ? 1 : 0,
              0.1,
            ],
          }));
          res.end(JSON.stringify({ data }));
          return;
        }
        const user = j.messages[1].content as string;
        prompts.push(user);
        let content = 'Ready';
        if (user.includes('Reply with JSON only:\n{"summary"'))
          content =
            'Sure! ```json\n{"summary":"The team settled on the premium tier.","highlights":["Premium tier chosen"],"decisions":["Premium tier"],"actionItems":[{"text":"Update the deck","assignee":"Mia Chen","due":"Thursday","messageId":"invented"}],"openQuestions":[]}\n```';
        else if (user.startsWith('Translate')) content = 'Guten Morgen, Team.';
        else if (user.includes('"replies"'))
          content = '{"replies":["Sounds good","On it","Let us talk"]}';
        else if (user.includes('<sources>')) content = 'You picked the premium tier [1].';
        res.end(JSON.stringify({ choices: [{ message: { content } }] }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    source().use(
      new StaticSettingsSource({
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: 'sk-local',
        chatModel: 'llama3.1:8b',
        embeddingModel: 'nomic-embed-text',
        timeoutMs: 5000,
      }),
    );
  });
  afterAll(async () => {
    source().use(new StaticSettingsSource(null));
    await new Promise((r) => server.close(r));
  });

  it('uses the model for summaries, maps assignees and drops invented message ids', async () => {
    const r = await ai<AiSummary>(ravi, 'POST', `/conversations/${bid.conversationId}/summary`, {
      range: 'week',
    });
    expect(r.body.engine).toBe('model');
    expect(r.body.summary).toBe('The team settled on the premium tier.');
    expect(r.body.actionItems[0]).toEqual({
      text: 'Update the deck',
      assigneeId: mia.user.userId,
      due: 'Thursday',
      messageId: null,
    });
    // Message text goes in as data inside tags, after the rules.
    expect(prompts.at(-1)).toMatch(/<messages>[\s\S]*premium sample tier[\s\S]*<\/messages>/);
    expect((await ai<AiStatus>(ravi, 'GET', '/status')).body).toMatchObject({
      engine: 'model',
      model: 'llama3.1:8b',
    });
  });

  it('translates, suggests replies, answers and searches with model embeddings', async () => {
    const msg = (
      await api<Message[]>(h, 'GET', `/v1/conversations/${bid.conversationId}/messages`, {
        token: owner.accessToken,
      })
    ).body[0]!;
    expect(
      (
        await ai<AiTranslation>(owner, 'POST', '/translate', {
          messageId: msg.messageId,
          targetLanguage: 'de',
        })
      ).body,
    ).toMatchObject({
      text: 'Guten Morgen, Team.',
      engine: 'model',
    });
    expect(
      (await ai<AiSuggestedReplies>(owner, 'POST', `/conversations/${bid.conversationId}/replies`))
        .body.suggestions,
    ).toEqual(['Sounds good', 'On it', 'Let us talk']);
    const s = await ai<AiSearchResponse>(ravi, 'POST', '/search', { query: 'panel pricing' });
    expect(s.body.engine).toBe('model');
    expect(s.body.hits[0]!.text).toMatch(/quote|cost|panel/i);
    const a = await ai<AiAskResponse>(ravi, 'POST', '/ask', { question: 'Which tier?' });
    expect(a.body.answer).toBe('You picked the premium tier [1].');
  });

  it('falls back to the built-in engine when the model server fails, and says why', async () => {
    mode = 'down';
    const r = await ai<AiSummary>(ravi, 'POST', `/conversations/${bid.conversationId}/summary`, {
      range: 'day',
    });
    expect(r.status).toBe(200);
    expect(r.body.engine).toBe('basic');
    const st = (await ai<AiStatus>(ravi, 'GET', '/status')).body;
    expect(st.lastError).toBe('Model server returned HTTP 500');
    const msg = (
      await api<Message[]>(h, 'GET', `/v1/conversations/${bid.conversationId}/messages`, {
        token: owner.accessToken,
      })
    ).body[0]!;
    expect(
      (await ai(owner, 'POST', '/translate', { messageId: msg.messageId, targetLanguage: 'de' }))
        .status,
    ).toBe(503);
    mode = 'ok';
    prompts = [];
  });
});
