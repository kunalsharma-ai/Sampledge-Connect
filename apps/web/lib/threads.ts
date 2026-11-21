/** Pure helpers for reply threads (no React, no I/O). */

/** Every message whose reply chain leads back to `rootId`, oldest first. */
export function threadReplies<
  T extends { messageId?: string | null; replyToMessageId?: string | null },
>(messages: T[], rootId: string): T[] {
  const parent = new Map<string, string | null>();
  for (const m of messages) if (m.messageId) parent.set(m.messageId, m.replyToMessageId ?? null);
  const inThread = (m: T) => {
    let p = m.replyToMessageId ?? null;
    for (let hops = 0; p && hops < 100; hops++) {
      if (p === rootId) return true;
      p = parent.get(p) ?? null;
    }
    return false;
  };
  return messages.filter(inThread);
}

/** Reply counts for every message that has replies (direct or nested), keyed by root id. */
export function threadCounts<
  T extends {
    messageId?: string | null;
    replyToMessageId?: string | null;
    deletedAt?: string | null;
  },
>(messages: T[]): Map<string, number> {
  const parent = new Map<string, string | null>();
  for (const m of messages) if (m.messageId) parent.set(m.messageId, m.replyToMessageId ?? null);
  const out = new Map<string, number>();
  for (const m of messages) {
    if (m.deletedAt) continue;
    const seen = new Set<string>(m.messageId ? [m.messageId] : []);
    let p = m.replyToMessageId ?? null;
    for (let hops = 0; p && hops < 100 && !seen.has(p); hops++) {
      seen.add(p);
      out.set(p, (out.get(p) ?? 0) + 1);
      p = parent.get(p) ?? null;
    }
  }
  return out;
}
