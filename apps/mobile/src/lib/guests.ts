import {
  GuestEmailSchema,
  MAX_MEETING_GUESTS,
  type InviteEmailStatus,
  type MeetingGuest,
} from '@sampledge/contracts';

/**
 * Checks an email typed in the "Guests from outside" field. People in the organization are
 * refused here as on the server: they are invited as attendees, so they see the meeting chat.
 */
export function checkGuestEmail(
  raw: string,
  opts: { taken: readonly string[]; directory: readonly { email: string; displayName: string }[] },
): { email: string } | { error: string } {
  const parsed = GuestEmailSchema.safeParse(raw);
  if (!parsed.success) return { error: 'Enter a full email address, like name@client.com.' };
  const email = parsed.data;
  const member = opts.directory.find((p) => p.email.toLowerCase() === email);
  if (member)
    return { error: `${member.displayName} is in your organization. Add them under People.` };
  if (opts.taken.includes(email)) return { error: `${email} is already invited.` };
  if (opts.taken.length >= MAX_MEETING_GUESTS)
    return { error: `Up to ${MAX_MEETING_GUESTS} guests per meeting.` };
  return { email };
}

export const INVITE_LABEL: Record<InviteEmailStatus, string> = {
  sending: 'Sending invite…',
  sent: 'Invite emailed',
  failed: 'Invite failed',
  not_configured: "Not emailed (email isn't set up)",
};

export const GUEST_RESPONSE_LABEL: Record<MeetingGuest['response'], string> = {
  pending: 'No answer yet',
  accepted: 'Going',
  tentative: 'Maybe',
  declined: 'Not going',
};

/** "Ana Ruiz (guest)": how guests are named in calls, so nobody mistakes them for members. */
export const guestLabel = (name: string) => `${name} (guest)`;

/**
 * Messages a guest posts in a meeting chat have senderId `guest:<id>` (not in the directory)
 * and `metadata.guest = { guestId, name }`. Returns "Name (guest)", or null for members.
 */
export function guestSenderLabel(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  const g = metadata?.guest;
  if (!g || typeof g !== 'object') return null;
  const name = (g as { name?: unknown }).name;
  return guestLabel(typeof name === 'string' && name.trim() ? name : 'Guest');
}
