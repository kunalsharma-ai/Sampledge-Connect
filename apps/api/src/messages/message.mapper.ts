import { REACTION_USER_IDS_LIMIT, type Message, type Receipt } from '@sampledge/contracts';
import type { MessageDoc, ReceiptDoc } from '../database/documents.js';

export function toMessage(m: MessageDoc): Message {
  return {
    messageId: m._id,
    clientMessageId: m.clientMessageId,
    tenantId: m.tenantId,
    conversationId: m.conversationId,
    senderId: m.senderId,
    messageType: m.messageType,
    content: m.content,
    attachmentIds: m.attachmentIds,
    replyToMessageId: m.replyToMessageId,
    serverSequence: m.serverSequence,
    changeSequence: m.changeSequence,
    createdAt: m.createdAt.toISOString(),
    editedAt: m.editedAt?.toISOString() ?? null,
    deletedAt: m.deletedAt?.toISOString() ?? null,
    metadata: m.metadata,
    reactions: (m.reactions ?? [])
      .filter((r) => r.userIds.length > 0)
      .map((r) => ({
        emoji: r.emoji,
        userIds: r.userIds.slice(0, REACTION_USER_IDS_LIMIT),
        count: r.userIds.length,
      })),
  };
}

export function toReceipt(r: ReceiptDoc): Receipt {
  return {
    conversationId: r.conversationId,
    userId: r.userId,
    deliveredUpTo: r.deliveredUpTo,
    readUpTo: r.readUpTo,
    updatedAt: r.updatedAt.toISOString(),
  };
}
