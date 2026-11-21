/**
 * AI drafts and dismissed suggestions follow the person across their devices, and stay private
 * to them. Device A and B are the owner signed in twice; Ravi is another member.
 * See docs/sync-coverage.md.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  aiSuggestionId,
  type AiDismissedSuggestions,
  type AiProposal,
  type Conversation,
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
  type ClientSocket,
  type Harness,
} from './harness.js';

let h: Harness;
let owner: Session;
let ravi: Session;
let group: Conversation;
let a: ClientSocket;
let b: ClientSocket;
let r: ClientSocket;

const ai = <T>(s: Session, method: string, path: string, body?: unknown) =>
  api<T>(h, method, `/v1/ai${path}`, { token: s.accessToken, body });

/** Resolves when no event of this name arrives within the window. */
const silent = (s: ClientSocket, event: 'ai:proposal' | 'ai:suggestion', ms = 400) =>
  new Promise<void>((resolve, reject) => {
    const fail = () => reject(new Error(`unexpected ${event}`));
    s.once(event, fail);
    setTimeout(() => {
      s.off(event, fail);
      resolve();
    }, ms);
  });

beforeAll(async () => {
  h = await startHarness();
  const t = await registerTenant(h, 'Sync AI Co');
  owner = t.session;
  ravi = await inviteAndLogin(h, owner, t.slug, 'Ravi Kumar');
  const ana = await inviteAndLogin(h, owner, t.slug, 'Ana Silva');
  const second = await api<Session>(h, 'POST', '/v1/auth/login', {
    body: {
      tenantSlug: t.slug,
      email: `priya@${t.slug}.test`,
      password: t.password,
      device: { ...device('Phone'), platform: 'ios' },
    },
  });
  expect(second.status).toBe(200);
  group = (
    await api<Conversation>(h, 'POST', '/v1/conversations', {
      token: owner.accessToken,
      body: { kind: 'group', memberIds: [ravi.user.userId, ana.user.userId], name: 'Fieldwork' },
    })
  ).body;
  [a, b, r] = await Promise.all([
    connect(h, owner.accessToken),
    connect(h, second.body.accessToken),
    connect(h, ravi.accessToken),
  ]);
});
afterAll(async () => {
  for (const s of [a, b, r]) s?.disconnect();
  await h?.close();
});

describe('AI drafts', () => {
  it('a draft created, then sent, reaches my other device only', async () => {
    const created = nextEvent(b, 'ai:proposal', (p) => p.status === 'pending');
    const quiet = silent(r, 'ai:proposal');
    const p = (
      await ai<AiProposal>(owner, 'POST', '/proposals', {
        kind: 'send_message',
        conversationId: group.conversationId,
        text: 'Summary: fieldwork starts Monday.',
      })
    ).body;
    expect((await created).proposalId).toBe(p.proposalId);
    await quiet;

    const sent = nextEvent(b, 'ai:proposal', (x) => x.proposalId === p.proposalId);
    const res = await ai(owner, 'POST', `/proposals/${p.proposalId}/confirm`, { confirm: true });
    expect(res.status).toBeLessThan(300);
    expect(await sent).toMatchObject({ status: 'confirmed' });
    // A queued retry from the other device is harmless: no second message, no error.
    const again = await ai<{ proposal: AiProposal }>(
      owner,
      'POST',
      `/proposals/${p.proposalId}/confirm`,
      { confirm: true },
    );
    expect(again.status).toBeLessThan(300);
    expect(again.body.proposal.messageId).toBe((await sent).messageId);
    // Dismissing a sent draft (a stale queued dismiss) changes nothing.
    const late = await ai<AiProposal>(owner, 'POST', `/proposals/${p.proposalId}/dismiss`);
    expect(late.body.status).toBe('confirmed');
  });

  it('a dismissed draft closes on my other device', async () => {
    const p = (
      await ai<AiProposal>(owner, 'POST', '/proposals', {
        kind: 'send_message',
        conversationId: group.conversationId,
        text: 'Draft we will not send.',
      })
    ).body;
    const closed = nextEvent(b, 'ai:proposal', (x) => x.proposalId === p.proposalId);
    await ai(owner, 'POST', `/proposals/${p.proposalId}/dismiss`);
    expect(await closed).toMatchObject({ status: 'dismissed' });
    // Dismissing twice (offline retry) is a no-op and sends no second event.
    const quiet = silent(b, 'ai:proposal');
    expect(
      (await ai<AiProposal>(owner, 'POST', `/proposals/${p.proposalId}/dismiss`)).body,
    ).toMatchObject({ status: 'dismissed' });
    await quiet;
  });
});

describe('dismissed suggestions', () => {
  const id = aiSuggestionId('conv-1', 'msg-1', 'Send the revised quota grid');

  it('the id is the same wherever it is computed', () => {
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(aiSuggestionId('conv-1', 'msg-1', ' Send the revised quota grid ')).toBe(id);
    expect(aiSuggestionId('conv-1', 'msg-2', 'Send the revised quota grid')).not.toBe(id);
  });

  it('dismiss and undo reach my other device, idempotently, and stay private', async () => {
    const onB = nextEvent(b, 'ai:suggestion', (e) => e.suggestionId === id);
    const quiet = silent(r, 'ai:suggestion');
    expect((await ai(owner, 'PUT', `/suggestions/${id}/dismissed`)).status).toBe(200);
    expect(await onB).toEqual({ suggestionId: id, dismissed: true });
    await quiet;
    // A retried PUT stores it once.
    await ai(owner, 'PUT', `/suggestions/${id}/dismissed`);
    const mine = (await ai<AiDismissedSuggestions>(owner, 'GET', '/suggestions/dismissed')).body;
    expect(mine.suggestionIds.filter((x) => x === id)).toHaveLength(1);
    const theirs = (await ai<AiDismissedSuggestions>(ravi, 'GET', '/suggestions/dismissed')).body;
    expect(theirs.suggestionIds).not.toContain(id);

    const undo = nextEvent(b, 'ai:suggestion', (e) => e.suggestionId === id && !e.dismissed);
    expect((await ai(owner, 'DELETE', `/suggestions/${id}/dismissed`)).status).toBe(200);
    await undo;
    expect(
      (await ai<AiDismissedSuggestions>(owner, 'GET', '/suggestions/dismissed')).body.suggestionIds,
    ).not.toContain(id);
  });

  it('rejects ids that are not suggestion ids', async () => {
    expect((await ai(owner, 'PUT', '/suggestions/not-an-id/dismissed')).status).toBe(400);
  });
});
