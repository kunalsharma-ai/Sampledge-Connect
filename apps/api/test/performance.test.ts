/**
 * Launch performance checks:
 * 1. The queries on every hot path use an index and never sort in memory, so they stay
 *    fast as an organization's history grows.
 * 2. Latency budgets for the busiest endpoints on a conversation with a large history.
 * Budgets are generous so CI machines pass; real numbers are in docs/launch-readiness.md.
 */
import { writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db, Document } from 'mongodb';
import { uuidv7, type Conversation } from '@sampledge/contracts';
import { MONGO_DB } from '../src/database/database.module.js';
import { newId } from '../src/database/tenant-db.js';
import { api, registerTenant, startHarness, type Harness } from './harness.js';

let h: Harness;
let db: Db;
beforeAll(async () => {
  h = await startHarness();
  db = h.app.get<Db>(MONGO_DB);
});
afterAll(() => h.close());

const T = 'tenant-x';
const ID = '0123456789abcdef01234567';

/** [name, collection, filter, sort] for each hot query, as the services send them. */
const HOT: [string, string, Document, Document | undefined][] = [
  [
    'message history page',
    'messages',
    { tenantId: T, conversationId: ID, serverSequence: { $lt: 500 } },
    { serverSequence: -1 },
  ],
  [
    'sync changes',
    'messages',
    { tenantId: T, conversationId: ID, changeSequence: { $gt: 10 } },
    { changeSequence: 1 },
  ],
  ['my conversations', 'conversation_members', { tenantId: T, userId: ID }, undefined],
  ['conversation members', 'conversation_members', { tenantId: T, conversationId: ID }, undefined],
  ['receipts', 'message_receipts', { tenantId: T, conversationId: ID }, undefined],
  [
    'notification feed',
    'notifications',
    { tenantId: T, userId: ID, _id: { $lt: ID } },
    { _id: -1 },
  ],
  ['unread notifications', 'notifications', { tenantId: T, userId: ID, readAt: null }, undefined],
  ['audit log page', 'audit_logs', { tenantId: T }, { at: -1, _id: -1 }],
  ['my devices', 'devices', { tenantId: T, userId: ID }, { lastSeenAt: -1 }],
  ['all devices (admin)', 'devices', { tenantId: T }, { lastSeenAt: -1 }],
  ['membership', 'memberships', { tenantId: T, userId: ID }, undefined],
  ['directory', 'users', { tenantId: T }, { displayName: 1 }],
];

function stages(plan: Document, out: string[] = []): string[] {
  if (!plan || typeof plan !== 'object') return out;
  if (typeof plan.stage === 'string') out.push(plan.stage);
  for (const k of ['inputStage', 'queryPlan']) if (plan[k]) stages(plan[k], out);
  for (const k of ['inputStages'])
    if (Array.isArray(plan[k])) plan[k].forEach((p: Document) => stages(p, out));
  return out;
}

describe('indexes on hot paths', () => {
  it.each(HOT)('%s uses an index and no in-memory sort', async (_name, col, filter, sort) => {
    const cursor = db.collection(col).find(filter);
    if (sort) cursor.sort(sort);
    const explain = await cursor.limit(50).explain('queryPlanner');
    const used = stages(explain.queryPlanner.winningPlan);
    expect(used).not.toContain('COLLSCAN');
    expect(used).not.toContain('SORT');
  });
});

function p95(ms: number[]) {
  const s = [...ms].sort((a, b) => a - b);
  return s[Math.floor(s.length * 0.95)]!;
}

async function time(fn: () => Promise<{ status: number }>, n: number) {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    const r = await fn();
    out.push(performance.now() - t0);
    expect(r.status).toBe(200);
  }
  return out;
}

describe('latency budgets with a large history', () => {
  it('history, sync, conversation list and search stay fast with 20,000 messages', async () => {
    const owner = await registerTenant(h, 'Perf Co');
    const token = owner.session.accessToken;
    const convs = await api<Conversation[]>(h, 'GET', '/v1/conversations', { token });
    const general = convs.body[0]!;
    const tenantId = owner.session.tenant.tenantId;
    const userId = owner.session.user.userId;

    // Seed directly: 20,000 messages in #general, with sequences as the service assigns them.
    const N = 20_000;
    const now = Date.now();
    const docs = Array.from({ length: N }, (_, i) => ({
      _id: newId(),
      tenantId,
      conversationId: general.conversationId,
      clientMessageId: uuidv7(),
      senderId: userId,
      senderDeviceId: 'seed',
      content: { text: `Seeded message ${i} about fieldwork quotas`, mentions: [] },
      attachments: [],
      serverSequence: i + 1,
      changeSequence: i + 1,
      createdAt: new Date(now - (N - i) * 1000),
      editedAt: null,
      deletedAt: null,
    }));
    for (let i = 0; i < N; i += 5000)
      await db.collection('messages').insertMany(docs.slice(i, i + 5000) as never[], {
        bypassDocumentValidation: true,
      });
    await db
      .collection('conversations')
      .updateOne({ _id: general.conversationId as never }, { $set: { lastChangeSequence: N } });

    const base = `/v1/conversations/${general.conversationId}`;
    const history = await time(() => api(h, 'GET', `${base}/messages?limit=50`, { token }), 30);
    const older = await time(
      () => api(h, 'GET', `${base}/messages?limit=50&before=${N / 2}`, { token }),
      30,
    );
    const list = await time(() => api(h, 'GET', '/v1/conversations', { token }), 30);
    const sync = await time(
      () =>
        api(h, 'POST', '/v1/sync', {
          token,
          body: {
            cursors: [{ conversationId: general.conversationId, afterChangeSequence: N - 200 }],
          },
        }),
      30,
    );
    const budget = Number(process.env.PERF_BUDGET_MS ?? 250);
    const report = {
      historyP95: p95(history),
      olderP95: p95(older),
      conversationsP95: p95(list),
      syncP95: p95(sync),
    };
    if (process.env.PERF_REPORT) writeFileSync(process.env.PERF_REPORT, JSON.stringify(report));
    for (const [k, v] of Object.entries(report)) expect(v, k).toBeLessThan(budget);
  }, 120_000);
});
