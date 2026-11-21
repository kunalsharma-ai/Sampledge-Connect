import { describe, expect, it } from 'vitest';
import { openConnectDb } from './db.js';
import { searchLocalMessages } from './search.js';
import type { LocalMessage } from './db.js';

const msg = (i: number, over: Partial<LocalMessage>): LocalMessage =>
  ({
    clientMessageId: `c${i}`,
    messageId: `m${i}`,
    tenantId: 't',
    conversationId: 'conv-a',
    senderId: 'ravi',
    senderDeviceId: 'd',
    messageType: 'text',
    content: { text: '', mentions: [] },
    attachments: [],
    replyToMessageId: null,
    serverSequence: i,
    changeSequence: i,
    createdAt: new Date(Date.UTC(2026, 10, i)).toISOString(),
    editedAt: null,
    deletedAt: null,
    metadata: {},
    status: 'sent',
    localCreatedAt: i,
    error: null,
    ...over,
  }) as LocalMessage;

describe('searchLocalMessages', () => {
  it('matches every term across text and file names, newest first, honouring filters', async () => {
    const { db } = await openConnectDb('search-test');
    await db.messages.bulkPut([
      msg(1, { content: { text: 'Germany quota budget', mentions: [] } }),
      msg(2, {
        content: { text: 'see sheet', mentions: [] },
        attachments: [{ fileName: 'Germany-budget.xlsx' } as never],
      }),
      msg(3, { content: { text: 'Germany only', mentions: [] }, senderId: 'mia' }),
      msg(4, {
        content: { text: 'budget germany', mentions: [] },
        deletedAt: '2026-11-05T00:00:00Z',
      }),
      msg(5, {
        content: { text: 'queued germany budget', mentions: [] },
        messageId: null,
        serverSequence: null,
        status: 'queued',
        conversationId: 'conv-b',
      }),
    ]);
    const all = await searchLocalMessages(db, ['germ', 'budget']);
    expect(all.map((h) => h.clientMessageId)).toEqual(['c5', 'c2', 'c1']);
    expect(all[2]!.matches).toEqual([
      [0, 4],
      [14, 20],
    ]);
    const files = await searchLocalMessages(db, ['budget'], { hasFile: true });
    expect(files.map((h) => h.clientMessageId)).toEqual(['c2']);
    const inA = await searchLocalMessages(db, ['germany'], {
      conversationIds: new Set(['conv-a']),
      from: 'mia',
    });
    expect(inA.map((h) => h.clientMessageId)).toEqual(['c3']);
  });
});
