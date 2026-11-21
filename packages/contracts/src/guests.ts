import { z } from 'zod';
import { ServerIdSchema } from './ids.js';

/**
 * External guests: people outside the organization invited to a meeting by email.
 *
 * A guest has no account. Each one gets a personal join link (`/join/<token>`, a signed,
 * unguessable token) by email together with a calendar invite (.ics), and can RSVP, add
 * the meeting to their calendar and join the call from it. Guests always wait in the lobby
 * until someone in the call admits them.
 *
 * Email goes through the organization's own SMTP server (self-hosted, no third-party
 * service). Without SMTP configured, invites are not emailed and the organizer copies
 * the link instead (`invite.status = 'not_configured'`).
 */
export const MAX_MEETING_GUESTS = 100;

export const GuestEmailSchema = z.string().trim().toLowerCase().email().max(254);

export const GuestInputSchema = z.object({
  email: GuestEmailSchema,
  /** Shown to everyone in the meeting. Defaults to the part of the email before the @. */
  name: z.string().trim().max(80).optional(),
});
export type GuestInput = z.input<typeof GuestInputSchema>;

export const GUEST_RESPONSES = ['pending', 'accepted', 'tentative', 'declined'] as const;

/**
 * sending: queued. sent: the SMTP server accepted it. failed: it didn't (see `error`).
 * not_configured: this server has no SMTP settings, so nothing was sent.
 */
export const INVITE_EMAIL_STATUSES = ['sending', 'sent', 'failed', 'not_configured'] as const;
export const InviteEmailStatusSchema = z.enum(INVITE_EMAIL_STATUSES);
export type InviteEmailStatus = z.infer<typeof InviteEmailStatusSchema>;

export const MeetingGuestSchema = z.object({
  guestId: ServerIdSchema,
  email: z.string(),
  name: z.string(),
  response: z.enum(GUEST_RESPONSES),
  invite: z.object({
    status: InviteEmailStatusSchema,
    /** When the last email (invite, update or cancellation) was attempted. */
    at: z.string().datetime().nullable(),
    error: z.string().nullable(),
  }),
});
export type MeetingGuest = z.infer<typeof MeetingGuestSchema>;

/** GET /v1/meetings/:id/guests/:guestId/link (organizer): the guest's personal join link. */
export const GuestLinkResponseSchema = z.object({ url: z.string().url() });
export type GuestLinkResponse = z.infer<typeof GuestLinkResponseSchema>;

// ---------- lobby (on the call record) ----------

/** Someone waiting in the lobby of a live call. Everyone in the call sees the list. */
export const CallLobbyEntrySchema = z.object({
  guestId: ServerIdSchema,
  meetingId: ServerIdSchema,
  name: z.string(),
  email: z.string(),
  requestedAt: z.string().datetime(),
});
export type CallLobbyEntry = z.infer<typeof CallLobbyEntrySchema>;

/** A guest who was let into (or turned away from) a call. */
export const CallGuestSchema = z.object({
  guestId: ServerIdSchema,
  meetingId: ServerIdSchema,
  name: z.string(),
  email: z.string(),
  /** admitted: may connect. joined: in the room. left: was in. denied: turned away. */
  state: z.enum(['admitted', 'joined', 'left', 'denied']),
  decidedBy: ServerIdSchema,
  joinedAt: z.string().datetime().nullable(),
});
export type CallGuest = z.infer<typeof CallGuestSchema>;

/** LiveKit identities of guests start with this, so they can't collide with user ids. */
export const GUEST_IDENTITY_PREFIX = 'guest:';
export const guestIdentity = (guestId: string) => `${GUEST_IDENTITY_PREFIX}${guestId}`;
export const isGuestIdentity = (identity: string) => identity.startsWith(GUEST_IDENTITY_PREFIX);

// ---------- public guest endpoints (authenticated by the link token) ----------

/** Guests may wait in the lobby from this long before the start ... */
export const GUEST_EARLY_JOIN_MINUTES = 30;
/** ... until this long after the scheduled end. */
export const GUEST_LATE_JOIN_MINUTES = 120;

/** GET /v1/guest/:token: what the join page shows. No member ids or emails other than the guest's. */
export const GuestMeetingViewSchema = z.object({
  meetingId: ServerIdSchema,
  title: z.string(),
  agenda: z.string(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  timeZone: z.string(),
  media: z.enum(['audio', 'video']),
  status: z.enum(['scheduled', 'cancelled']),
  organizerName: z.string(),
  organizationName: z.string(),
  guest: z.object({
    guestId: ServerIdSchema,
    name: z.string(),
    email: z.string(),
    response: z.enum(GUEST_RESPONSES),
  }),
  /** Earliest and latest time the guest may join. */
  joinOpensAt: z.string().datetime(),
  joinClosesAt: z.string().datetime(),
});
export type GuestMeetingView = z.infer<typeof GuestMeetingViewSchema>;

export const GuestRsvpRequestSchema = z.object({
  response: z.enum(['accepted', 'tentative', 'declined']),
});

/** POST /v1/guest/:token/lobby: ask to join (the name others will see). */
export const GuestLobbyRequestSchema = z.object({ name: z.string().trim().min(1).max(80) });

/**
 * GET or POST /v1/guest/:token/lobby. The guest page polls this every few seconds.
 * too_early / ended / cancelled: can't join now. not_started: nobody has started the call yet
 * (a guest who already pressed Join keeps polling with their name and enters the lobby as soon
 * as it starts). ready: the call is live; press Join to ask to be let in. waiting: in the lobby. admitted: `join` holds a short-lived SFU token. denied: turned away.
 */
export const GUEST_JOIN_STATES = [
  'too_early',
  'not_started',
  'ready',
  'waiting',
  'admitted',
  'denied',
  'ended',
  'cancelled',
] as const;
export const GuestJoinStateSchema = z.object({
  state: z.enum(GUEST_JOIN_STATES),
  callId: ServerIdSchema.nullable(),
  /** The call is being recorded (shown to the guest before and during the call). */
  recording: z.boolean(),
  /** Same shape as CallJoin (kept local: calls.ts imports this file). */
  join: z
    .object({ url: z.string(), token: z.string(), expiresAt: z.string().datetime() })
    .nullable(),
});
export type GuestJoinState = z.infer<typeof GuestJoinStateSchema>;

// ---------- meeting chat for guests ----------

/**
 * `metadata.guest` on a message an external guest wrote in the meeting chat. Its `senderId`
 * is the guest's identity (`guest:<guestId>`), which is never a user id.
 */
export const MessageGuestMetadataSchema = z.object({
  guestId: ServerIdSchema,
  name: z.string(),
});
export type MessageGuestMetadata = z.infer<typeof MessageGuestMetadataSchema>;

/** Display name for a message's sender when it came from a guest, else null. */
export function guestSenderName(message: { metadata?: Record<string, unknown> }): string | null {
  const g = message.metadata?.guest as Partial<MessageGuestMetadata> | undefined;
  return g && typeof g.name === 'string' ? g.name : null;
}

/**
 * What a guest sees of the meeting chat: only messages from while the current call has been
 * live (never the conversation's earlier history), and only while they're admitted to it.
 * Attachments show by name; guests can't open members' files.
 */
export const GuestChatMessageSchema = z.object({
  messageId: ServerIdSchema,
  senderName: z.string(),
  fromGuest: z.boolean(),
  mine: z.boolean(),
  text: z.string(),
  attachmentNames: z.array(z.string()),
  createdAt: z.string().datetime(),
  editedAt: z.string().datetime().nullable(),
});
export type GuestChatMessage = z.infer<typeof GuestChatMessageSchema>;

export const GuestChatResponseSchema = z.object({ messages: z.array(GuestChatMessageSchema) });
export type GuestChatResponse = z.infer<typeof GuestChatResponseSchema>;

export const GuestChatSendSchema = z.object({ text: z.string().trim().min(1).max(4000) });
