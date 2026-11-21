import { describe, expect, it } from 'vitest';
import { migrate } from '../db/migrations';
import { LocalStore } from '../db/store';
import { conversation, SELF, serverMessage } from '../test/fixtures';
import { openNodeDriver } from '../test/nodeDriver';

describe('system messages', () => {
  it('keeps type and metadata and previews the event', async () => {
    const db = openNodeDriver();
    await migrate(db);
    const store = new LocalStore(db, SELF);
    await store.upsertConversations([conversation('c1')]);
    await store.applyServerMessages([
      {
        ...serverMessage({ conversationId: 'c1', serverSequence: 1 }),
        messageType: 'system',
        content: { text: '', mentions: [] },
        metadata: { call: { media: 'video', status: 'ended', durationSec: 120 } },
      },
    ]);
    const [m] = await store.listMessages('c1');
    expect(m).toMatchObject({
      messageType: 'system',
      metadata: { call: { media: 'video', status: 'ended', durationSec: 120 } },
    });
    expect((await store.getConversation('c1'))?.lastPreview).toBe('Video call ended · 2 min');
  });
});
