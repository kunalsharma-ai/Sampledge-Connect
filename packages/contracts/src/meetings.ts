import { z } from 'zod';
import { GuestInputSchema, MAX_MEETING_GUESTS, MeetingGuestSchema } from './guests.js';
import { ServerIdSchema } from './ids.js';

/**
 * Scheduled meetings. Every meeting lives in a conversation (its "meeting chat"): either one
 * the organizer picked, or a new group/DM created for it. Joining the meeting joins that
 * conversation's call, so in-meeting chat, files and history are the conversation itself.
 * All times are ISO-8601 UTC; `timeZone` is the organizer's IANA zone, for display.
 */
export const RSVP_RESPONSES = ['pending', 'accepted', 'tentative', 'declined'] as const;
export const RsvpResponseSchema = z.enum(RSVP_RESPONSES);
export type RsvpResponse = z.infer<typeof RsvpResponseSchema>;

export const MeetingAttendeeSchema = z.object({
  userId: ServerIdSchema,
  response: RsvpResponseSchema,
  /** Required attendees count for "find a time"; optional ones are shown but not blocking. */
  optional: z.boolean(),
});
export type MeetingAttendee = z.infer<typeof MeetingAttendeeSchema>;

export const MEETING_STATUSES = ['scheduled', 'cancelled'] as const;

export const MeetingSchema = z.object({
  meetingId: ServerIdSchema,
  conversationId: ServerIdSchema,
  title: z.string(),
  agenda: z.string(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  timeZone: z.string(),
  organizerId: ServerIdSchema,
  attendees: z.array(MeetingAttendeeSchema),
  media: z.enum(['audio', 'video']),
  /** Minutes before start at which attendees get a reminder. */
  remindMinutes: z.array(z.number().int()),
  status: z.enum(MEETING_STATUSES),
  /** External guests invited by email (see guests.ts). */
  guests: z.array(MeetingGuestSchema).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Meeting = z.infer<typeof MeetingSchema>;

export const MAX_MEETING_ATTENDEES = 300;
export const MAX_MEETING_MINUTES = 12 * 60;

const IanaZone = z
  .string()
  .min(1)
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'unknown time zone');

const MeetingFields = {
  title: z.string().trim().min(1).max(120),
  agenda: z.string().trim().max(4000).default(''),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  timeZone: IanaZone.default('UTC'),
  media: z.enum(['audio', 'video']).default('video'),
  remindMinutes: z.array(z.number().int().min(0).max(1440)).max(3).default([10]),
};

const validRange = (r: { startsAt?: string; endsAt?: string }) =>
  !r.startsAt ||
  !r.endsAt ||
  (Date.parse(r.endsAt) > Date.parse(r.startsAt) &&
    Date.parse(r.endsAt) - Date.parse(r.startsAt) <= MAX_MEETING_MINUTES * 60_000);

/** POST /v1/meetings */
export const CreateMeetingRequestSchema = z
  .object({
    ...MeetingFields,
    /** Other people to invite (the organizer is always an attendee). */
    attendeeIds: z.array(ServerIdSchema).max(MAX_MEETING_ATTENDEES).default([]),
    optionalAttendeeIds: z.array(ServerIdSchema).max(MAX_MEETING_ATTENDEES).default([]),
    /** Hold the meeting in an existing conversation (its members are invited). Otherwise a meeting chat is created. */
    conversationId: ServerIdSchema.optional(),
    /** People outside the organization, invited by email with a calendar invite and a join link. */
    guests: z.array(GuestInputSchema).max(MAX_MEETING_GUESTS).default([]),
  })
  .refine(validRange, {
    message: 'endsAt must be after startsAt (max 12 hours)',
    path: ['endsAt'],
  });
export type CreateMeetingRequest = z.input<typeof CreateMeetingRequestSchema>;

/** PATCH /v1/meetings/:id (organizer). Changing the time resets everyone's RSVP to pending. */
export const UpdateMeetingRequestSchema = z
  .object({
    title: MeetingFields.title.optional(),
    agenda: z.string().trim().max(4000).optional(),
    startsAt: MeetingFields.startsAt.optional(),
    endsAt: MeetingFields.endsAt.optional(),
    timeZone: IanaZone.optional(),
    media: z.enum(['audio', 'video']).optional(),
    remindMinutes: MeetingFields.remindMinutes.optional(),
    addAttendeeIds: z.array(ServerIdSchema).max(MAX_MEETING_ATTENDEES).default([]),
    addGuests: z.array(GuestInputSchema).max(MAX_MEETING_GUESTS).default([]),
    /** Removed guests get a cancellation and their link stops working. */
    removeGuestIds: z.array(ServerIdSchema).max(MAX_MEETING_GUESTS).default([]),
  })
  .refine(validRange, {
    message: 'endsAt must be after startsAt (max 12 hours)',
    path: ['endsAt'],
  });
export type UpdateMeetingRequest = z.input<typeof UpdateMeetingRequestSchema>;

export const RsvpRequestSchema = z.object({
  response: z.enum(['accepted', 'tentative', 'declined']),
});

/** GET /v1/meetings?from=&to= (my meetings overlapping the range; max 62 days). */
export const ListMeetingsQuerySchema = z
  .object({
    from: z.string().datetime(),
    to: z.string().datetime(),
    includeCancelled: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  })
  .refine(
    (q) =>
      Date.parse(q.to) > Date.parse(q.from) &&
      Date.parse(q.to) - Date.parse(q.from) <= 62 * 86_400_000,
    { message: 'range must be positive and at most 62 days', path: ['to'] },
  );

// ---------- availability ("booking slots") ----------

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use HH:MM');

/** Weekly working hours. day: 0 = Sunday ... 6 = Saturday, times in `timeZone`. */
export const WorkingHoursSchema = z.object({
  timeZone: IanaZone,
  days: z
    .array(z.object({ day: z.number().int().min(0).max(6), start: HHMM, end: HHMM }))
    .max(14)
    .refine((d) => d.every((x) => x.end > x.start), 'each end must be after its start'),
});
export type WorkingHours = z.infer<typeof WorkingHoursSchema>;

export const DEFAULT_WORKING_HOURS: WorkingHours = {
  timeZone: 'UTC',
  days: [1, 2, 3, 4, 5].map((day) => ({ day, start: '09:00', end: '17:30' })),
};

/** POST /v1/meetings/find-times */
export const FindTimesRequestSchema = z
  .object({
    attendeeIds: z.array(ServerIdSchema).min(0).max(50),
    durationMinutes: z.number().int().min(5).max(MAX_MEETING_MINUTES),
    from: z.string().datetime(),
    to: z.string().datetime(),
    /** Slots start on these boundaries (minutes). */
    stepMinutes: z.number().int().min(5).max(120).default(30),
    limit: z.number().int().min(1).max(50).default(12),
    /** A meeting being rescheduled doesn't block itself. */
    ignoreMeetingId: ServerIdSchema.optional(),
  })
  .refine(
    (r) =>
      Date.parse(r.to) > Date.parse(r.from) &&
      Date.parse(r.to) - Date.parse(r.from) <= 31 * 86_400_000,
    { message: 'range must be positive and at most 31 days', path: ['to'] },
  );
export type FindTimesRequest = z.input<typeof FindTimesRequestSchema>;

export const FindTimesResponseSchema = z.object({
  /** Slots where every attendee is inside working hours and free. */
  slots: z.array(z.object({ startsAt: z.string().datetime(), endsAt: z.string().datetime() })),
  /** Busy blocks per attendee in the range (meeting times only, no titles), for a free/busy grid. */
  busy: z.record(
    z.string(),
    z.array(z.object({ startsAt: z.string().datetime(), endsAt: z.string().datetime() })),
  ),
});
export type FindTimesResponse = z.infer<typeof FindTimesResponseSchema>;

/** Payload of the `meeting:reminder` socket event. */
export interface MeetingReminderEvent {
  meeting: Meeting;
  minutesBefore: number;
}

/** Push data for a meeting reminder or invite. */
export interface MeetingPushData {
  type: 'meeting';
  event: 'invite' | 'reminder' | 'updated' | 'cancelled';
  meetingId: string;
  conversationId: string;
  startsAt: string;
}

/** `metadata.meeting` on the system message a meeting posts in its chat. */
export const MeetingSystemMetadataSchema = z.object({
  meetingId: ServerIdSchema,
  title: z.string(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  organizerId: ServerIdSchema,
  status: z.enum(['scheduled', 'updated', 'cancelled']),
});
export type MeetingSystemMetadata = z.infer<typeof MeetingSystemMetadataSchema>;
