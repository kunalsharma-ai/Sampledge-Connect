import { z } from 'zod';
import { ServerIdSchema } from './ids.js';

/**
 * Booking pages: a public link (`/book/<slug>`) where people outside the organization pick a
 * free time with one person or a team. The free times come from the hosts' working hours and
 * meetings, like "find a time". A booking becomes an ordinary meeting with the booker as an
 * external guest (calendar invite by email, join link, lobby).
 *
 * `all`: every host attends, so a slot needs all of them free.
 * `any`: one host attends: whoever is free, preferring the one with the fewest bookings that day.
 */
export const BOOKING_MODES = ['all', 'any'] as const;
export const MAX_BOOKING_HOSTS = 20;

export const BookingSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(60)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'use lowercase letters, numbers and dashes');

export const BookingPageSchema = z.object({
  bookingPageId: ServerIdSchema,
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  durationMinutes: z.number().int(),
  hostIds: z.array(ServerIdSchema),
  mode: z.enum(BOOKING_MODES),
  /** Free time kept before and after each meeting. */
  bufferMinutes: z.number().int(),
  /** Earliest a booking can start, from now. */
  minNoticeMinutes: z.number().int(),
  /** How many days ahead people can book. */
  horizonDays: z.number().int(),
  media: z.enum(['audio', 'video']),
  enabled: z.boolean(),
  createdBy: ServerIdSchema,
  /** Public link. */
  url: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type BookingPage = z.infer<typeof BookingPageSchema>;

const Fields = {
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).default(''),
  durationMinutes: z.number().int().min(10).max(240).default(30),
  hostIds: z.array(ServerIdSchema).max(MAX_BOOKING_HOSTS).default([]),
  mode: z.enum(BOOKING_MODES).default('any'),
  bufferMinutes: z.number().int().min(0).max(120).default(0),
  minNoticeMinutes: z
    .number()
    .int()
    .min(0)
    .max(14 * 24 * 60)
    .default(4 * 60),
  horizonDays: z.number().int().min(1).max(90).default(30),
  media: z.enum(['audio', 'video']).default('video'),
  enabled: z.boolean().default(true),
};

/** POST /v1/booking-pages. The creator is always a host. */
export const CreateBookingPageSchema = z.object({ ...Fields, slug: BookingSlugSchema });
export type CreateBookingPageRequest = z.input<typeof CreateBookingPageSchema>;

/** PATCH /v1/booking-pages/:id (any host). */
export const UpdateBookingPageSchema = z
  .object({
    title: Fields.title,
    description: z.string().trim().max(2000),
    durationMinutes: z.number().int().min(10).max(240),
    hostIds: z.array(ServerIdSchema).min(1).max(MAX_BOOKING_HOSTS),
    mode: z.enum(BOOKING_MODES),
    bufferMinutes: z.number().int().min(0).max(120),
    minNoticeMinutes: z
      .number()
      .int()
      .min(0)
      .max(14 * 24 * 60),
    horizonDays: z.number().int().min(1).max(90),
    media: z.enum(['audio', 'video']),
    enabled: z.boolean(),
    slug: BookingSlugSchema,
  })
  .partial();
export type UpdateBookingPageRequest = z.input<typeof UpdateBookingPageSchema>;

// ---------- public ----------

/** GET /v1/book/:slug: what the public page shows. Host names only, never emails. */
export const PublicBookingPageSchema = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  durationMinutes: z.number().int(),
  mode: z.enum(BOOKING_MODES),
  hosts: z.array(z.object({ name: z.string(), title: z.string().nullable() })),
  organizationName: z.string(),
  media: z.enum(['audio', 'video']),
  /** First and last moment a booking may start. */
  opensAt: z.string().datetime(),
  closesAt: z.string().datetime(),
});
export type PublicBookingPage = z.infer<typeof PublicBookingPageSchema>;

/** GET /v1/book/:slug/slots?from=&to= (at most 14 days per request). */
export const BookingSlotsQuerySchema = z
  .object({ from: z.string().datetime(), to: z.string().datetime() })
  .refine(
    (q) =>
      Date.parse(q.to) > Date.parse(q.from) &&
      Date.parse(q.to) - Date.parse(q.from) <= 14 * 86_400_000,
    { message: 'range must be positive and at most 14 days', path: ['to'] },
  );
export const BookingSlotsResponseSchema = z.object({
  slots: z.array(z.object({ startsAt: z.string().datetime(), endsAt: z.string().datetime() })),
});
export type BookingSlotsResponse = z.infer<typeof BookingSlotsResponseSchema>;

/** POST /v1/book/:slug */
export const CreateBookingSchema = z.object({
  startsAt: z.string().datetime(),
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(254),
  notes: z.string().trim().max(1000).default(''),
  /** The booker's IANA time zone, for their confirmation email. */
  timeZone: z.string().max(64).optional(),
});
export type CreateBookingRequest = z.input<typeof CreateBookingSchema>;

export const BookingConfirmationSchema = z.object({
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  title: z.string(),
  hostNames: z.array(z.string()),
  /** The booker's join link (also emailed with the calendar invite when email is set up). */
  joinUrl: z.string(),
  emailed: z.boolean(),
});
export type BookingConfirmation = z.infer<typeof BookingConfirmationSchema>;
