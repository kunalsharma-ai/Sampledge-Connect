import { matchesAll, snippetAround, type MessageHit } from '@sampledge/contracts';
import type { ConnectDb, LocalMessage } from './db.js';

export interface LocalSearchOptions {
  conversationIds?: Set<string>;
  from?: string | null;
  hasFile?: boolean;
  after?: number | null;
  before?: number | null;
  limit?: number;
}

/** A search hit from this device's cache. Unsent messages have no messageId yet. */
export type LocalMessageHit = Omit<MessageHit, 'messageId' | 'serverSequence'> & {
  messageId: string | null;
  clientMessageId: string;
  serverSequence: number | null;
  status: LocalMessage['status'];
};

/**
 * Searches messages cached on this device (works with no connection). Same matching as the
 * server: every term must occur, case-insensitive, in the text, a file name or a poll question.
 * Newest first. The cache only holds conversations this person can read, so no scope check is needed.
 */
export async function searchLocalMessages(
  db: ConnectDb,
  terms: string[],
  opts: LocalSearchOptions = {},
): Promise<LocalMessageHit[]> {
  const limit = opts.limit ?? 50;
  const rows = await db.messages
    .filter((m) => {
      if (m.deletedAt || m.messageType !== 'text') return false;
      if (opts.conversationIds && !opts.conversationIds.has(m.conversationId)) return false;
      if (opts.from && m.senderId !== opts.from) return false;
      const files = m.attachments ?? [];
      if (opts.hasFile && files.length === 0) return false;
      const at = Date.parse(m.createdAt) || m.localCreatedAt;
      if (opts.after && at < opts.after) return false;
      if (opts.before && at >= opts.before) return false;
      if (!terms.length) return true;
      const hay = [m.content.text, m.poll?.question ?? '', ...files.map((f) => f.fileName)].join(
        '\n',
      );
      return matchesAll(hay, terms);
    })
    .toArray();
  rows.sort(
    (a, b) =>
      (Date.parse(b.createdAt) || b.localCreatedAt) - (Date.parse(a.createdAt) || a.localCreatedAt),
  );
  return rows.slice(0, limit).map((m) => {
    const text = m.content.text || m.poll?.question || '';
    const { snippet, matches } = snippetAround(text, terms);
    return {
      messageId: m.messageId,
      clientMessageId: m.clientMessageId,
      conversationId: m.conversationId,
      senderId: m.senderId,
      snippet,
      matches,
      createdAt: m.createdAt,
      serverSequence: m.serverSequence,
      replyToMessageId: m.replyToMessageId ?? null,
      fileNames: (m.attachments ?? []).map((f) => f.fileName),
      status: m.status,
    };
  });
}
