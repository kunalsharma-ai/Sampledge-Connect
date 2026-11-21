import type {
  ApiError,
  Message,
  Receipt,
  SendMessageAck,
  SendMessageRequest,
  SyncRequest,
  SyncResponse,
  Conversation,
} from '@sampledge/contracts';
import { NetworkError, ServerError, type Transport } from './transport.js';

/**
 * In-memory stand-in for the API used by unit tests. It implements the same
 * contract semantics (idempotency, per-conversation sequences, cursor sync).
 * The real end-to-end path is covered by apps/api/test/offline-e2e.test.ts.
 */
export class FakeServer {
  online = true;
  messages: Message[] = [];
  seq = new Map<string, number>();
  conversations = new Map<string, Conversation>();
  sendCalls = 0;
  reactCalls = 0;
  private failures: (ApiError | 'network' | 'drop-ack')[] = [];

  addConversation(id: string, memberIds: string[]) {
    this.conversations.set(id, {
      conversationId: id,
      tenantId: 't1',
      workspaceId: 'w1',
      kind: 'group',
      name: id,
      topic: null,
      memberIds,
      createdBy: memberIds[0]!,
      createdAt: new Date().toISOString(),
      archivedAt: null,
      lastChangeSequence: 0,
      lastMessageAt: null,
      myRole: 'member',
      myNotifyLevel: 'all',
    });
  }
  failNext(...f: (ApiError | 'network' | 'drop-ack')[]) {
    this.failures.push(...f);
  }
  /** Simulates another user's message arriving at the server. */
  injectFrom(senderId: string, conversationId: string, text: string): Message {
    return this.store(senderId, {
      conversationId,
      clientMessageId: crypto.randomUUID(),
      content: { text, mentions: [] },
    }).message;
  }

  private store(senderId: string, req: SendMessageRequest): SendMessageAck {
    const dup = this.messages.find((m) => m.clientMessageId === req.clientMessageId);
    if (dup) return { clientMessageId: req.clientMessageId, message: dup, duplicate: true };
    const n = (this.seq.get(req.conversationId) ?? 0) + 1;
    this.seq.set(req.conversationId, n);
    const m: Message = {
      messageId: `m${this.messages.length + 1}`,
      clientMessageId: req.clientMessageId,
      tenantId: 't1',
      conversationId: req.conversationId,
      senderId,
      messageType: 'text',
      content: { text: req.content.text, mentions: req.content.mentions ?? [] },
      attachmentIds: [],
      attachments: [],
      replyToMessageId: req.replyToMessageId ?? null,
      serverSequence: n,
      changeSequence: n,
      createdAt: new Date().toISOString(),
      editedAt: null,
      deletedAt: null,
      metadata: {},
      reactions: [],
      pinned: null,
    };
    this.messages.push(m);
    const c = this.conversations.get(req.conversationId);
    if (c) c.lastChangeSequence = n;
    return { clientMessageId: req.clientMessageId, message: m, duplicate: false };
  }

  transportFor(userId: string): Transport {
    return {
      send: async (req) => {
        this.sendCalls++;
        if (!this.online) throw new NetworkError('offline');
        const f = this.failures.shift();
        if (f === 'network') throw new NetworkError('flaky');
        if (f && f !== 'drop-ack') throw new ServerError(f);
        if (!this.conversations.get(req.conversationId)?.memberIds.includes(userId)) {
          throw new ServerError({ code: 'NOT_FOUND', message: 'Conversation not found' });
        }
        const ack = this.store(userId, req);
        if (f === 'drop-ack') throw new NetworkError('connection reset after commit');
        return ack;
      },
      sync: async (req: SyncRequest): Promise<SyncResponse> => {
        if (!this.online) throw new NetworkError('offline');
        const readable = [...this.conversations.values()].filter((c) =>
          c.memberIds.includes(userId),
        );
        const cur = new Map(
          (req.cursors ?? []).map((c) => [c.conversationId, c.afterChangeSequence]),
        );
        const limit = req.limitPerConversation ?? 200;
        return {
          conversations: readable,
          results: readable.map((c) => {
            const after = cur.get(c.conversationId) ?? 0;
            const all = this.messages
              .filter((m) => m.conversationId === c.conversationId && m.changeSequence > after)
              .sort((a, b) => a.changeSequence - b.changeSequence);
            const page = all.slice(0, limit);
            return {
              conversationId: c.conversationId,
              changes: page,
              nextCursor: page.at(-1)?.changeSequence ?? after,
              hasMore: all.length > limit,
              receipts: [],
            };
          }),
          revokedConversationIds: [...cur.keys()].filter(
            (id) => !readable.some((c) => c.conversationId === id),
          ),
          serverTime: new Date().toISOString(),
        };
      },
      react: async (req): Promise<Message> => {
        this.reactCalls++;
        if (!this.online) throw new NetworkError('offline');
        const i = this.messages.findIndex((m) => m.messageId === req.messageId);
        const m = this.messages[i];
        if (!m) throw new ServerError({ code: 'NOT_FOUND', message: 'Message not found' });
        const reactions = m.reactions.map((r) => ({ ...r, userIds: [...r.userIds] }));
        let r = reactions.find((x) => x.emoji === req.emoji);
        const has = r?.userIds.includes(userId) ?? false;
        if (req.op === 'add' ? has : !has) return m;
        if (req.op === 'add') {
          if (!r) reactions.push((r = { emoji: req.emoji, userIds: [], count: 0 }));
          r.userIds.push(userId);
        } else r!.userIds = r!.userIds.filter((u) => u !== userId);
        for (const x of reactions) x.count = x.userIds.length;
        const n = (this.seq.get(m.conversationId) ?? 0) + 1;
        this.seq.set(m.conversationId, n);
        const updated = {
          ...m,
          reactions: reactions.filter((x) => x.count > 0),
          changeSequence: n,
        };
        this.messages[i] = updated;
        return updated;
      },
      ackReceipt: async (r): Promise<Receipt> => ({
        conversationId: r.conversationId,
        userId,
        deliveredUpTo: r.upToSequence,
        readUpTo: r.kind === 'read' ? r.upToSequence : 0,
        updatedAt: new Date().toISOString(),
      }),
    };
  }
}
