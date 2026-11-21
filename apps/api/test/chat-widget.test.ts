import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WidgetClient, type WidgetState } from '@sampledge/chat-widget/client';
import type { Message, ModuleCredentials, Session, WidgetSession } from '@sampledge/contracts';
import { api, inviteAndLogin, registerTenant, startHarness, type Harness } from './harness.js';

/** The reusable chat widget's engine against the real API: sign-on, live updates, outbox. */
let h: Harness;
let owner: Session;
let omar: Session;
let session: WidgetSession;

class MemoryStorage {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

const until = async (c: WidgetClient, pred: (s: WidgetState) => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!pred(c.getState())) {
    if (Date.now() > end)
      throw new Error(`timeout; state ${JSON.stringify({ ...c.getState(), people: undefined })}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  return c.getState();
};

beforeAll(async () => {
  h = await startHarness();
  const t = await registerTenant(h);
  owner = t.session;
  omar = await inviteAndLogin(h, owner, t.slug, 'Omar Haddad');
  await api(h, 'PUT', '/v1/admin/integrations/sampledge.sampforce', {
    token: owner.accessToken,
    body: { enabled: true, values: { mode: 'test' } },
  });
  const creds = (
    await api<ModuleCredentials>(h, 'POST', '/v1/integrations/modules/sampforce/keys', {
      token: owner.accessToken,
      body: {},
    })
  ).body;
  session = (
    await api<WidgetSession>(h, 'POST', '/v1/integration/widget-sessions', {
      token: creds.connectApiKey,
      body: {
        user: { email: `omar.haddad@${t.slug}.test` },
        record: { type: 'opportunity', id: 'OP-218', title: 'Fabrikam brand health 2027' },
      },
    })
  ).body;
});
afterAll(() => h?.close());

describe('chat widget engine', () => {
  it('loads the record conversation, sends, and receives live messages', async () => {
    const c = new WidgetClient({ apiUrl: h.url, session, storage: new MemoryStorage() });
    await c.start();
    await until(c, (s) => s.status === 'online' && !!s.conversation);
    expect(c.getState().conversation!.name).toBe('Fabrikam brand health 2027');

    c.send('Hello from SampForce');
    const s = await until(c, (x) =>
      x.messages.some((m) => m.content.text === 'Hello from SampForce'),
    );
    expect(s.pending).toHaveLength(0);

    // Someone in the full Connect app answers; the widget sees it live.
    await api(h, 'POST', `/v1/conversations/${session.conversationId}/join`, {
      token: owner.accessToken,
    });
    await api(h, 'POST', `/v1/conversations/${session.conversationId}/messages`, {
      token: owner.accessToken,
      body: {
        conversationId: session.conversationId,
        clientMessageId: crypto.randomUUID(),
        content: { text: 'Thanks Omar, on it', mentions: [] },
      },
    });
    await until(c, (x) => x.messages.some((m) => m.content.text === 'Thanks Omar, on it'));
    c.dispose();
  });

  it('keeps a message queued while the network is down and sends it once, after', async () => {
    let down = true;
    const storage = new MemoryStorage();
    const flaky: typeof fetch = (input, init) =>
      down && String(input).includes('/messages') && init?.method === 'POST'
        ? Promise.reject(new TypeError('Failed to fetch'))
        : fetch(input, init);
    const c = new WidgetClient({ apiUrl: h.url, session, storage, fetch: flaky });
    await c.start();
    await until(c, (s) => s.status === 'online');
    c.send('Written while offline');
    await until(c, (s) => s.pending[0]?.state === 'queued' && s.pending[0].attempts >= 1);
    // Persisted before any network attempt, so a page reload would not lose it.
    expect([...storage.m.values()][0]).toContain('Written while offline');
    c.dispose();

    // "Reload": a new engine picks the queued message up from storage and sends it.
    down = false;
    const c2 = new WidgetClient({ apiUrl: h.url, session, storage, fetch: flaky });
    await c2.start();
    await until(
      c2,
      (s) =>
        s.pending.length === 0 &&
        s.messages.some((m) => m.content.text === 'Written while offline'),
    );
    const all = (
      await api<Message[]>(h, 'GET', `/v1/conversations/${session.conversationId}/messages`, {
        token: omar.accessToken,
      })
    ).body;
    expect(all.filter((m) => m.content.text === 'Written while offline')).toHaveLength(1);
    expect(storage.m.size).toBe(0);
    c2.dispose();
  });
});
