import type { Conversation, Message } from '@sampledge/contracts';

export const SELF = 'user-self';
export const PEER = 'user-peer';

export function conversation(id: string, over: Partial<Conversation> = {}): Conversation {
  return {
    conversationId: id,
    tenantId: 't1',
    workspaceId: 'w1',
    kind: 'dm',
    name: null,
    topic: null,
    memberIds: [SELF, PEER],
    createdBy: SELF,
    createdAt: '2026-11-01T00:00:00.000Z',
    archivedAt: null,
    lastChangeSequence: 0,
    lastMessageAt: null,
    myRole: 'member',
    ...over,
  } as Conversation;
}

let n = 0;
export function serverMessage(
  over: Partial<Message> & { conversationId: string; serverSequence: number },
): Message {
  n++;
  return {
    messageId: `m-${over.conversationId}-${over.serverSequence}`,
    clientMessageId:
      over.clientMessageId ?? `0190a000-0000-7000-8000-${String(n).padStart(12, '0')}`,
    tenantId: 't1',
    senderId: PEER,
    messageType: 'text',
    content: { text: `hello ${over.serverSequence}`, mentions: [] },
    attachmentIds: [],
    replyToMessageId: null,
    changeSequence: over.changeSequence ?? over.serverSequence,
    createdAt: new Date(Date.UTC(2026, 10, 1, 0, 0, over.serverSequence)).toISOString(),
    editedAt: null,
    deletedAt: null,
    metadata: {},
    ...over,
  };
}
