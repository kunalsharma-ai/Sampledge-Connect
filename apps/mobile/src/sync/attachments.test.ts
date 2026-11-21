import { describe, expect, it } from 'vitest';
import type { Attachment, SendMessageAck, SendMessageRequest } from '@sampledge/contracts';
import { migrate } from '../db/migrations';
import { LocalStore, type PendingFile } from '../db/store';
import { openNodeDriver } from '../test/nodeDriver';
import { conversation, SELF, serverMessage } from '../test/fixtures';
import { OutboxProcessor } from './outbox';
import { TransportError } from './transport';

const now = () => 1_000_000;
const file = (name: string, mimeType = 'application/pdf') => ({
  localUri: `file:///docs/${name}`,
  fileName: name,
  mimeType,
  sizeBytes: 1234,
});

async function setup() {
  const db = openNodeDriver();
  await migrate(db);
  const store = new LocalStore(db, SELF, undefined, now);
  await store.upsertConversations([conversation('c1')]);
  const uploads: string[] = [];
  const sent: SendMessageRequest[] = [];
  let failOn: string | null = null;
  const attachments = new Map<string, Attachment>();
  const upload = async (f: PendingFile, conversationId: string) => {
    if (failOn === f.fileName) throw new TransportError('connection lost', 'network');
    uploads.push(f.fileName);
    const id = `att-${uploads.length}`;
    attachments.set(id, {
      attachmentId: id,
      conversationId,
      uploaderId: SELF,
      fileName: f.fileName,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
      width: null,
      height: null,
      status: 'ready',
      createdAt: new Date(0).toISOString(),
    });
    return id;
  };
  const send = async (req: SendMessageRequest): Promise<SendMessageAck> => {
    sent.push(req);
    const message = serverMessage({
      conversationId: req.conversationId,
      clientMessageId: req.clientMessageId,
      senderId: SELF,
      serverSequence: sent.length,
      content: { text: req.content.text, mentions: [] },
      attachmentIds: req.attachmentIds ?? [],
      attachments: (req.attachmentIds ?? []).map((id) => attachments.get(id)!),
    });
    return { clientMessageId: req.clientMessageId, message, duplicate: false };
  };
  const outbox = new OutboxProcessor({
    store,
    send,
    upload,
    canSend: () => true,
    onAuthError: () => undefined,
    schedule: () => () => undefined,
    now,
    random: () => 0.5,
  });
  return { store, outbox, uploads, sent, setFailOn: (n: string | null) => (failOn = n) };
}

describe('attachments', () => {
  it('queues files with the message and shows them before upload', async () => {
    const { store } = await setup();
    const m = await store.enqueueSend({
      conversationId: 'c1',
      text: '',
      files: [file('brief.pdf')],
    });
    expect(m.attachments).toEqual([
      expect.objectContaining({
        fileName: 'brief.pdf',
        attachmentId: null,
        localUri: 'file:///docs/brief.pdf',
      }),
    ]);
    expect((await store.getConversation('c1'))!.lastPreview).toBe('📎 brief.pdf');
  });

  it('uploads each file once, resuming after a failure, then sends the ids in order', async () => {
    const { store, outbox, uploads, sent, setFailOn } = await setup();
    const m = await store.enqueueSend({
      conversationId: 'c1',
      text: 'Both files',
      files: [file('a.pdf'), file('b.png', 'image/png')],
    });
    setFailOn('b.png');
    await outbox.kick();
    expect(uploads).toEqual(['a.pdf']);
    expect(sent).toHaveLength(0);
    expect((await store.getMessage(m.clientId))!.status).toBe('queued');

    setFailOn(null);
    await store.retry(m.clientId);
    await outbox.kick();
    expect(uploads).toEqual(['a.pdf', 'b.png']);
    expect(sent[0]!.attachmentIds).toEqual(['att-1', 'att-2']);

    const local = (await store.getMessage(m.clientId))!;
    expect(local.status).toBe('sent');
    // Server snapshot, with this device's copy kept for instant display.
    expect(local.attachments.map((a) => [a.attachmentId, a.localUri])).toEqual([
      ['att-1', 'file:///docs/a.pdf'],
      ['att-2', 'file:///docs/b.png'],
    ]);
  });

  it('shows files from other people from the server snapshot', async () => {
    const { store } = await setup();
    await store.applyServerMessages([
      serverMessage({
        conversationId: 'c1',
        serverSequence: 1,
        content: { text: '', mentions: [] },
        attachments: [
          {
            attachmentId: 'x1',
            conversationId: 'c1',
            uploaderId: 'someone',
            fileName: 'quota.xlsx',
            mimeType: 'application/vnd.ms-excel',
            sizeBytes: 99,
            width: null,
            height: null,
            status: 'ready',
            createdAt: new Date(0).toISOString(),
          },
        ],
      }),
    ]);
    const [m] = await store.listMessages('c1');
    expect(m!.attachments[0]).toMatchObject({ attachmentId: 'x1', localUri: null });
    expect((await store.getConversation('c1'))!.lastPreview).toBe('📎 quota.xlsx');
  });
});
