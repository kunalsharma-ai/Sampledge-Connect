import { forwardedOf, type ForwardedSnapshot } from '@sampledge/contracts';
import type { LocalConversation, LocalMessage } from '../db/store';

/**
 * What a forward of this message carries, as the server will store it. Forwarding a forward
 * keeps the first original.
 */
export function forwardSnapshot(m: LocalMessage, from: string | null): ForwardedSnapshot {
  return (
    forwardedOf(m) ?? {
      messageId: m.messageId!,
      conversationId: m.conversationId,
      senderId: m.senderId,
      text: m.text,
      createdAt: m.createdAt,
      from,
    }
  );
}

/** Forward shows on sent, readable messages that are not polls or call events. */
export function canForwardMessage(m: LocalMessage): boolean {
  return !!m.messageId && !m.deletedAt && !m.poll && m.messageType !== 'system';
}

/**
 * Where this message may go. When forwarding is turned off in its conversation it can only be
 * re-shared inside that same conversation.
 */
export function forwardTargets(
  source: Pick<LocalConversation, 'conversationId' | 'allowForwarding'>,
  all: readonly LocalConversation[],
): LocalConversation[] {
  return all.filter(
    (c) =>
      !c.archivedAt &&
      c.myRole !== null &&
      (source.allowForwarding || c.conversationId === source.conversationId),
  );
}

/** Private channels and groups can turn forwarding off; public channels and DMs always allow it. */
export function canTurnOffForwarding(c: Pick<LocalConversation, 'kind'>): boolean {
  return c.kind === 'channel_private' || c.kind === 'group';
}

/** Where a forward came from, written the way the server writes it ("#ops", a group's name, or the other person in a DM). */
export function forwardFrom(
  c: Pick<LocalConversation, 'kind' | 'name' | 'memberIds'>,
  nameOf: (id: string) => string,
  selfId: string,
): string | null {
  if (c.kind === 'dm') {
    const other = c.memberIds.find((id) => id !== selfId);
    return other ? nameOf(other) : null;
  }
  if (c.kind === 'group') return c.name ?? null;
  return c.name ? `#${c.name}` : null;
}
