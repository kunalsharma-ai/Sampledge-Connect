import { toApiUrl } from '@/lib/config';
import { guestSenderName } from '@sampledge/contracts';
import type { Conversation } from '@sampledge/contracts';
import type { DirectoryEntry } from '@/lib/engine';

export function conversationTitle(
  c: Conversation,
  me: string,
  dir: Map<string, DirectoryEntry>,
): string {
  if (c.kind === 'dm') {
    const other = c.memberIds.find((id) => id !== me);
    return (other && dir.get(other)?.displayName) || 'Direct message';
  }
  if (c.name) return c.name;
  const names = c.memberIds
    .filter((id) => id !== me)
    .map((id) => dir.get(id)?.displayName?.split(' ')[0] ?? 'Someone');
  return names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : '');
}

/** Absolute URL of a profile photo path from the API (`/v1/avatars/...`), or null. */
export function avatarUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  try {
    return toApiUrl(path);
  } catch {
    return null;
  }
}

/** A member's profile photo, or null for initials. */
export function avatarOf(id: string | null | undefined, dir: Map<string, DirectoryEntry>) {
  return id ? avatarUrl(dir.get(id)?.avatarUrl) : null;
}

export function nameOf(id: string, dir: Map<string, DirectoryEntry>): string {
  return dir.get(id)?.displayName ?? 'Unknown member';
}

/** A message's sender: a member's name, or "Name (guest)" for an external meeting guest. */
export function senderNameOf(
  m: { senderId: string; metadata?: Record<string, unknown> },
  dir: Map<string, DirectoryEntry>,
): string {
  const guest = guestSenderName(m);
  return guest ? `${guest} (guest)` : nameOf(m.senderId, dir);
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'short',
  day: 'numeric',
});

export const formatTime = (iso: string) => timeFmt.format(new Date(iso));

export function formatDay(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return dayFmt.format(d);
}

export function relativeShort(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - Date.parse(iso);
  if (diff < 60_000) return 'now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}
