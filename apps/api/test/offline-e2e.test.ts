import 'fake-indexeddb/auto';
import { generateKeyPairSync } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  HttpSocketTransport,
  SyncEngine,
  listConversationMessages,
  openConnectDb,
} from '@sampledge/offline';
import type { Conversation, Session } from '@sampledge/contracts';
import { api, inviteAndLogin, registerTenant, startHarness, type Harness } from './harness.js';

const waitFor = async (fn: () => Promise<boolean> | boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('waitFor timed out');
};

let last: Harness | null = null;
afterAll(async () => {
  await last?.close().catch(() => undefined);
});

async function engineFor(baseUrl: string, s: Session, name: string) {
  const { db } = await openConnectDb(name);
  const transport = new HttpSocketTransport({
    baseUrl,
    getAccessToken: async () => s.accessToken,
    timeoutMs: 1500,
  });
  const engine = new SyncEngine({
    db,
    transport,
    tenantId: s.tenant.tenantId,
    userId: s.user.userId,
    backoff: { baseMs: 20, capMs: 250, floorMs: 10 },
    maxAttempts: 200,
    syncDebounceMs: 20,
  });
  await engine.start();
  return { db, engine };
}

describe('offline engine against the real API', () => {
  it('survives a server restart: queued messages send once, in order, and B recovers them', async () => {
    const port = 40_000 + Math.floor(Math.random() * 10_000);
    // Same signing keys across the restart, as in a real deployment.
    const kp = generateKeyPairSync('ed25519');
    const keys = {
      JWT_PRIVATE_KEY: kp.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      JWT_PUBLIC_KEY: kp.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    };
    const h1 = await startHarness(keys, { port });
    last = h1;
    const t = await registerTenant(h1);
    const b = await inviteAndLogin(h1, t.session, t.slug, 'Employee B');
    const dm = (
      await api<Conversation>(h1, 'POST', '/v1/conversations', {
        token: t.session.accessToken,
        body: { kind: 'dm', memberIds: [b.user.userId] },
      })
    ).body;

    const A = await engineFor(h1.url, t.session, `e2e-a-${Date.now()}`);
    A.engine.setNetworkAvailable(true);
    await waitFor(() => A.engine.getState().connectivity === 'online');

    // Server stops (restart / outage). The database survives.
    await h1.close(false);
    await waitFor(() => A.engine.getState().connectivity !== 'online');
    await A.engine.compose(dm.conversationId, 'first, during outage');
    await A.engine.compose(dm.conversationId, 'second, during outage');
    await new Promise((r) => setTimeout(r, 300));
    const pending = await listConversationMessages(A.db, dm.conversationId);
    expect(pending.map((m) => m.serverSequence)).toEqual([null, null]);
    expect(pending.every((m) => m.status === 'queued' || m.status === 'sending')).toBe(true);
    expect(A.engine.getState().queued).toBe(2);

    // Server comes back on the same address; the engine reconnects by itself.
    const h2 = await startHarness(keys, { port, dbName: h1.dbName });
    last = h2;
    await waitFor(async () => (await A.db.outbox.count()) === 0);
    await waitFor(() => A.engine.getState().connectivity === 'online');
    const sent = await listConversationMessages(A.db, dm.conversationId);
    expect(sent.map((m) => [m.content.text, m.status])).toEqual([
      ['first, during outage', 'sent'],
      ['second, during outage', 'sent'],
    ]);
    expect(sent[0]!.serverSequence! < sent[1]!.serverSequence!).toBe(true);

    // Employee B syncs and sees exactly those messages once.
    const B = await engineFor(h2.url, b, `e2e-b-${Date.now()}`);
    B.engine.setNetworkAvailable(true);
    await B.engine.syncNow();
    expect(
      (await listConversationMessages(B.db, dm.conversationId)).map((m) => m.content.text),
    ).toEqual(['first, during outage', 'second, during outage']);

    // B is online: a live message from B reaches A in real time.
    await B.engine.compose(dm.conversationId, 'got them, thanks');
    await waitFor(
      async () => (await listConversationMessages(A.db, dm.conversationId)).length === 3,
    );

    const history = await api<unknown[]>(
      h2,
      'GET',
      `/v1/conversations/${dm.conversationId}/messages`,
      { token: t.session.accessToken },
    );
    expect(history.body).toHaveLength(3);
    A.engine.stop();
    B.engine.stop();
  });
});
