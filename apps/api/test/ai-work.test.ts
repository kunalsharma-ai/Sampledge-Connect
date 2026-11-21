import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  resolveDueHint,
  uuidv7,
  type AiDigest,
  type AiSummary,
  type Message,
  type ModuleCredentials,
  type ModuleEventInput,
  type SendMessageAck,
  type Session,
  type Task,
} from '@sampledge/contracts';
import { signPayload } from '../src/integrations/signing.js';
import { api, inviteAndLogin, registerTenant, startHarness, type Harness } from './harness.js';

let h: Harness;
let owner: Session;
let ravi: Session;
let outsider: Session;
let slug: string;
let samptrek: ModuleCredentials;
let projectConv: string;

const email = (name: string) => `${name.toLowerCase().replace(/\s+/g, '.')}@${slug}.test`;
const send = async (s: Session, conversationId: string, text: string) =>
  (
    await api<SendMessageAck>(h, 'POST', `/v1/conversations/${conversationId}/messages`, {
      token: s.accessToken,
      body: { clientMessageId: uuidv7(), content: { text } },
    })
  ).body.message;

async function sendEvent(event: ModuleEventInput) {
  const body = JSON.stringify(event);
  const res = await fetch(`${h.url}/v1/integration/events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${samptrek.connectApiKey}`,
      'sampledge-signature': signPayload(samptrek.signingSecret!, body),
    },
    body,
  });
  return (await res.json()) as { conversationId?: string };
}

beforeAll(async () => {
  h = await startHarness();
  const t = await registerTenant(h);
  owner = t.session;
  slug = t.slug;
  ravi = await inviteAndLogin(h, owner, slug, 'Ravi Kumar');
  outsider = await inviteAndLogin(h, owner, slug, 'Gina Guest', 'guest');
  await api(h, 'PUT', '/v1/admin/integrations/sampledge.samptrek', {
    token: owner.accessToken,
    body: { enabled: true, values: { mode: 'test' } },
  });
  samptrek = (
    await api<ModuleCredentials>(h, 'POST', '/v1/integrations/modules/samptrek/keys', {
      token: owner.accessToken,
      body: { generateSigningSecret: true },
    })
  ).body;
  const r = await sendEvent({
    eventId: 'p-1',
    type: 'project.created',
    record: { type: 'project', id: 'PRJ-77', title: 'Germany oncology tracker' },
    people: [{ email: email('Ravi Kumar') }],
    data: { status: 'active', dueAt: '2027-02-19T17:00:00.000Z' },
  });
  projectConv = r.conversationId!;
  // One milestone already late, one coming up.
  await sendEvent({
    eventId: 'm-1',
    type: 'milestone.due',
    record: { type: 'milestone', id: 'MS-1', title: 'Screener sign-off' },
    parent: { type: 'project', id: 'PRJ-77', title: 'Germany oncology tracker' },
    data: { dueAt: new Date(Date.now() - 2 * 86_400_000).toISOString() },
  });
  await sendEvent({
    eventId: 'm-2',
    type: 'milestone.due',
    record: { type: 'milestone', id: 'MS-2', title: 'Fieldwork start' },
    parent: { type: 'project', id: 'PRJ-77', title: 'Germany oncology tracker' },
    data: { dueAt: new Date(Date.now() + 9 * 86_400_000).toISOString() },
  });
});
afterAll(() => h?.close());

describe('project status in the AI digest', () => {
  it('shows the linked Samptrek project with plain concerns, only to people who can read it', async () => {
    await send(ravi, projectConv, 'I’ll send the revised quota grid by Thursday.');
    await send(ravi, projectConv, 'Will do. The client is happy with the screener so far.');
    const d = (
      await api<AiDigest>(h, 'POST', '/v1/ai/digest', {
        token: ravi.accessToken,
        body: { sinceHours: 24 },
      })
    ).body;
    const item = d.items.find((i) => i.conversationId === projectConv)!;
    expect(item.project).toMatchObject({
      name: 'Germany oncology tracker',
      source: 'samptrek',
      status: 'active',
      missedMilestones: 1,
      nextMilestone: { title: 'Fieldwork start' },
    });
    expect(item.project!.concerns).toContain('1 milestone missed');
    expect(item.status).toBe('needs_attention');
    // A guest outside the project channel sees neither the item nor the project.
    const theirs = (
      await api<AiDigest>(h, 'POST', '/v1/ai/digest', {
        token: outsider.accessToken,
        body: { conversationIds: [projectConv] },
      })
    ).body;
    expect(theirs.items).toHaveLength(0);
  });

  it('includes a project that needs attention even when its channel is quiet', async () => {
    const quiet = (
      await sendEvent({
        eventId: 'p-2',
        type: 'project.created',
        record: { type: 'project', id: 'PRJ-78', title: 'Austria boost' },
        people: [{ email: email('Ravi Kumar') }],
        data: { status: 'at_risk' },
      })
    ).conversationId!;
    const d = (
      await api<AiDigest>(h, 'POST', '/v1/ai/digest', {
        token: ravi.accessToken,
        body: { sinceHours: 1 },
      })
    ).body;
    const item = d.items.find((i) => i.conversationId === quiet);
    expect(item?.project?.concerns).toContain('Marked at risk');
    expect(item?.status).toBe('needs_attention');
  });
});

describe('creating a task from a suggestion', () => {
  it('turns a suggested action item into a task only through the Tasks API the person confirms', async () => {
    const s = (
      await api<AiSummary>(h, 'POST', `/v1/ai/conversations/${projectConv}/summary`, {
        token: ravi.accessToken,
        body: { range: 'recent' },
      })
    ).body;
    const item = s.actionItems.find((a) => /quota grid/.test(a.text))!;
    expect(item).toMatchObject({ assigneeId: ravi.user.userId, due: 'by Thursday' });
    // Asking for a summary created nothing.
    const before = (
      await api<Task[]>(h, 'GET', `/v1/tasks?scope=conversation&conversationId=${projectConv}`, {
        token: ravi.accessToken,
      })
    ).body;
    expect(before.filter((t) => /quota grid/.test(t.title))).toHaveLength(0);

    // What the web form sends after the person presses Create.
    const due = resolveDueHint(item.due)!;
    const body = {
      title: item.text,
      description: 'Suggested by the AI assistant from this conversation.',
      assigneeIds: [item.assigneeId!],
      dueAt: new Date(`${due}T17:00:00`).toISOString(),
      conversationId: projectConv,
      sourceMessageId: item.messageId,
      clientRequestId: crypto.randomUUID(),
    };
    const r = await api<Task>(h, 'POST', '/v1/tasks', { token: ravi.accessToken, body });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({
      assigneeIds: [ravi.user.userId],
      sourceMessageId: item.messageId,
    });
    // A retry (double press) makes one task.
    const again = await api<Task>(h, 'POST', '/v1/tasks', { token: ravi.accessToken, body });
    expect(again.body.taskId).toBe(r.body.taskId);
    const msgs = (
      await api<Message[]>(h, 'GET', `/v1/conversations/${projectConv}/messages`, {
        token: ravi.accessToken,
      })
    ).body;
    expect(
      msgs.some(
        (m) => m.messageType === 'system' && JSON.stringify(m.metadata).includes(r.body.taskId),
      ),
    ).toBe(true);
  });
});
