import { describe, expect, it } from 'vitest';
import type { Attachment, SendMessageAck, SendMessageRequest } from '@sampledge/contracts';
import { migrate } from '../db/migrations';
import { LocalStore, type PendingFile } from '../db/store';
import { openNodeDriver } from '../test/nodeDriver';
import { conversation, SELF, serverMessage } from '../test/fixtures';
import { OutboxProcessor } from './outbox';
import { TransportError } from './transport';

const now = () => 1_000_000;
const voice = {
  localUri: 'file:///docs/voice.m4a',
  fileName: 'Voice message.m4a',
  mimeType: 'audio/mp4',
  sizeBytes: 48_000,
  recording: 'voice' as const,
  durationMs: 7_400,
};
const serverAttachment = (over: Partial<Attachment> = {}): Attachment => ({
  attachmentId: 'r1',
  conversationId: 'c1',
  uploaderId: 'someone',
  fileName: 'Call recording.mp4',
  mimeType: 'video/mp4',
  sizeBytes: 9_000_000,
  width: null,
  height: null,
  status: 'ready',
  createdAt: new Date(0).toISOString(),
  recording: 'call',
  durationMs: 754_000,
  ...over,
});

async function setup() {
  const db = openNodeDriver();
  await migrate(db);
  const store = new LocalStore(db, SELF, undefined, now);
  await store.upsertConversations([conversation('c1')]);
  const uploaded: PendingFile[] = [];
  let down = false;
  const upload = async (f: PendingFile) => {
    if (down) throw new TransportError('connection lost', 'network');
    uploaded.push(f);
    return `att-${uploaded.length}`;
  };
  const send = async (req: SendMessageRequest): Promise<SendMessageAck> => ({
    clientMessageId: req.clientMessageId,
    message: serverMessage({
      conversationId: req.conversationId,
      clientMessageId: req.clientMessageId,
      senderId: SELF,
      serverSequence: 1,
      content: { text: req.content.text, mentions: [] },
      attachmentIds: req.attachmentIds ?? [],
      attachments: (req.attachmentIds ?? []).map((id) =>
        serverAttachment({
          attachmentId: id,
          uploaderId: SELF,
          fileName: voice.fileName,
          mimeType: voice.mimeType,
          recording: 'voice',
          durationMs: voice.durationMs,
        }),
      ),
    }),
    duplicate: false,
  });
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
  return { db, store, outbox, uploaded, setDown: (d: boolean) => (down = d) };
}

describe('voice messages', () => {
  it('queue offline with their kind and length, and upload them as voice', async () => {
    const t = await setup();
    t.setDown(true);
    const m = await t.store.enqueueSend({ conversationId: 'c1', text: '', files: [voice] });
    expect(m.attachments[0]).toMatchObject({ recording: 'voice', durationMs: 7_400 });
    expect((await t.store.getConversation('c1'))!.lastPreview).toBe('🎤 Voice message');
    await t.outbox.kick();
    expect(t.uploaded).toHaveLength(0);

    // The app restarts: the queued clip is read back from the database with its kind.
    const again = new LocalStore(t.db, SELF, undefined, now);
    const pending = await again.getMessage(m.clientId);
    expect(pending!.attachments[0]).toMatchObject({ recording: 'voice', durationMs: 7_400 });

    t.setDown(false);
    await t.store.retry(m.clientId);
    await t.outbox.kick();
    expect(t.uploaded[0]).toMatchObject({ recording: 'voice', durationMs: 7_400 });
    const sent = (await t.store.getMessage(m.clientId))!;
    expect(sent.status).toBe('sent');
    expect(sent.attachments[0]).toMatchObject({
      attachmentId: 'att-1',
      recording: 'voice',
      localUri: voice.localUri,
    });
  });
});

describe('recordings from the server', () => {
  it('show call recordings and then their deletion', async () => {
    const t = await setup();
    const msg = serverMessage({
      conversationId: 'c1',
      serverSequence: 1,
      messageType: 'system',
      content: { text: '', mentions: [] },
      metadata: { recording: { callId: 'k1', attachmentId: 'r1', durationMs: 754_000 } },
      attachments: [serverAttachment()],
    });
    await t.store.applyServerMessages([msg]);
    let [m] = await t.store.listMessages('c1');
    expect(m!.attachments[0]).toMatchObject({ recording: 'call', deletedAt: null });

    await t.store.applyServerMessages([
      {
        ...msg,
        changeSequence: (msg.changeSequence ?? 1) + 1,
        attachments: [serverAttachment({ deletedAt: '2026-11-21T12:00:00.000Z' })],
      },
    ]);
    [m] = await t.store.listMessages('c1');
    expect(m!.attachments[0]!.deletedAt).toBe('2026-11-21T12:00:00.000Z');
  });
});
