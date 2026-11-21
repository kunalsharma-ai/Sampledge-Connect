import {
  REACTION_USER_IDS_LIMIT,
  type Message,
  type Poll,
  type Receipt,
} from '@sampledge/contracts';
import type { MessageDoc, PollDoc, ReceiptDoc } from '../database/documents.js';

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
    attachments: (m.attachments ?? []).map((a) => ({
      attachmentId: a.attachmentId,
      conversationId: m.conversationId,
      uploaderId: m.senderId,
      fileName: a.fileName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      width: a.width,
      height: a.height,
      status: 'ready' as const,
      createdAt: a.createdAt.toISOString(),
      recording: a.recording ?? null,
      durationMs: a.durationMs ?? null,
      deletedAt: a.deletedAt?.toISOString() ?? null,
    })),
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
    pinned: m.pinned
      ? { pinnedBy: m.pinned.pinnedBy, pinnedAt: m.pinned.pinnedAt.toISOString() }
      : null,
    ...(m.poll && !m.deletedAt ? { poll: toPoll(m.poll) } : {}),
  };
}

/** A poll past its closesAt counts as closed even before anyone touches it. */
export function pollClosedAt(p: PollDoc, now = new Date()): Date | null {
  if (p.closedAt) return p.closedAt;
  return p.closesAt && p.closesAt <= now ? p.closesAt : null;
}

export function toPoll(p: PollDoc): Poll {
  const closedAt = pollClosedAt(p);
  return {
    question: p.question,
    options: p.options.map((o) => {
      const voters = p.votes.filter((v) => v.optionIds.includes(o.optionId)).map((v) => v.userId);
      return {
        optionId: o.optionId,
        text: o.text,
        count: voters.length,
        voterIds: p.anonymous ? [] : voters,
      };
    }),
    multiple: p.multiple,
    anonymous: p.anonymous,
    totalVoters: p.votes.length,
    closesAt: p.closesAt?.toISOString() ?? null,
    closedAt: closedAt?.toISOString() ?? null,
    closedBy: p.closedAt ? p.closedBy : null,
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
