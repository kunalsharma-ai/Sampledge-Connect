import { describe, expect, it } from 'vitest';
import { openNodeDriver } from '../test/nodeDriver';
import { migrate } from './migrations';
import { WorkStore } from './work';

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
    await work.enqueue({ kind: 'callbg.imageRemove' });
    expect(await work.claim(picked!.id)).toBeUndefined();
  });
});
