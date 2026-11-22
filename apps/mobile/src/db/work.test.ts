import { describe, expect, it } from 'vitest';
import { openNodeDriver } from '../test/nodeDriver';
import { migrate } from './migrations';
import { WorkStore, type ActionInput } from './work';

describe('action queue', () => {
  it('sends a change merged in after the action was picked but before it was claimed', async () => {
    const db = openNodeDriver();
    await migrate(db);
    const work = new WorkStore(db, 'u1');
    const base = {
      kind: 'minutes.update',
      minutesId: 'm1',
      callId: 'c1',
      baseRevision: 3,
    } as const;
    await work.enqueue({ ...base, patch: { summary: 'S' } });
    const picked = await work.next();
    // Someone edits another field in between: it merges into the waiting action.
    await work.enqueue({ ...base, patch: { agenda: 'A' } });
    const sending = await work.claim(picked!.id);
    expect(sending?.input).toMatchObject({ patch: { summary: 'S', agenda: 'A' }, baseRevision: 3 });
    // Once it is being sent, later edits queue behind it instead of changing it.
    await work.enqueue({ ...base, patch: { notes: 'N' } });
    expect(await work.pendingMinutes('m1')).toEqual({ summary: 'S', agenda: 'A', notes: 'N' });
    expect(await work.claim(picked!.id)).toMatchObject({
      input: { patch: { summary: 'S', agenda: 'A' } },
    });
  });

  it('skips an action dropped between being picked and claimed', async () => {
    const db = openNodeDriver();
    await migrate(db);
    const work = new WorkStore(db, 'u1');
    await work.enqueue({ kind: 'callbg.set', choice: { kind: 'blur' } });
    const picked = await work.next();
    await work.enqueue({ kind: 'callbg.image', localUri: 'file:///x.jpg' }); // drops waiting picks
    expect(await work.claim(picked!.id)).toBeUndefined();
  });

  it('merges approval edits and shows them before they reach the server', async () => {
    const db = openNodeDriver();
    await migrate(db);
    const work = new WorkStore(db, 'u1');
    await work.upsert('approval', [
      {
        approvalId: 'a1',
        title: 'Incentive top-up',
        description: '',
        category: 'general',
        amount: { amountMinor: 50000, currency: 'GBP' },
        requesterId: 'u1',
        approverIds: ['u2'],
        policy: 'any',
        decisions: [],
        status: 'pending',
        conversationId: null,
        sourceMessageId: null,
        record: null,
        origin: 'connect',
        dueAt: null,
        createdAt: '2026-11-22T10:00:00.000Z',
        decidedAt: null,
      },
    ]);
    await work.enqueue({
      kind: 'approval.update',
      approvalId: 'a1',
      patch: { title: 'Top-up (UK)' },
    });
    await work.enqueue({
      kind: 'approval.update',
      approvalId: 'a1',
      patch: { amount: { amountMinor: 65000, currency: 'GBP' } },
    });
    expect(await work.getApproval('a1')).toMatchObject({
      title: 'Top-up (UK)',
      amount: { amountMinor: 65000 },
      pending: true,
    });
    const next = await work.next();
    expect(next?.input).toEqual({
      kind: 'approval.update',
      approvalId: 'a1',
      patch: { title: 'Top-up (UK)', amount: { amountMinor: 65000, currency: 'GBP' } },
    });
  });

  it('keeps only the latest poll edit and merges conversation renames', async () => {
    const db = openNodeDriver();
    await migrate(db);
    const work = new WorkStore(db, 'u1');
    const poll = (question: string): ActionInput => ({
      kind: 'poll.edit',
      messageId: 'm1',
      conversationId: 'c1',
      request: { question, options: ['Mon', 'Tue'] },
    });
    await work.enqueue(poll('Kick-off?'));
    await work.enqueue(poll('Kick-off day?'));
    await work.enqueue({
      kind: 'conversation.update',
      conversationId: 'c1',
      patch: { name: 'Q4' },
    });
    await work.enqueue({
      kind: 'conversation.update',
      conversationId: 'c1',
      patch: { topic: 'Quotas' },
    });
    const first = await work.next();
    expect(first?.input).toMatchObject({
      kind: 'poll.edit',
      request: { question: 'Kick-off day?' },
    });
    await work.complete(first!);
    expect((await work.next())?.input).toEqual({
      kind: 'conversation.update',
      conversationId: 'c1',
      patch: { name: 'Q4', topic: 'Quotas' },
    });
  });
});
