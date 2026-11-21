import { z } from 'zod';

/**
 * Availability and do-not-disturb. `availability` overrides automatic presence for everyone who
 * sees you; a custom status (emoji + text) can clear itself. While do-not-disturb is on (by hand
 * or by schedule) you get no push notifications; everything still lands in the app.
 */
export const AVAILABILITIES = ['auto', 'busy', 'away', 'dnd'] as const;
export const AvailabilitySchema = z.enum(AVAILABILITIES);
export type Availability = z.infer<typeof AvailabilitySchema>;

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use HH:MM');

export const UserStatusSchema = z.object({
  availability: AvailabilitySchema.default('auto'),
  emoji: z.string().max(16).nullable().default(null),
  text: z.string().trim().max(100).nullable().default(null),
  /** When the custom status and a manual availability clear themselves. null = until changed. */
  expiresAt: z.iso.datetime().nullable().default(null),
});
export type UserStatus = z.infer<typeof UserStatusSchema>;

/** PUT /v1/me/status */
export const SetStatusRequestSchema = UserStatusSchema;
export type SetStatusRequest = z.input<typeof SetStatusRequestSchema>;

export const DndScheduleSchema = z.object({
  enabled: z.boolean(),
  /** IANA zone the times are in. */
  timeZone: z.string().min(1).max(64),
  /** 0 = Sunday … 6 = Saturday: the days the quiet period starts on. */
  days: z.array(z.number().int().min(0).max(6)).max(7),
  /** Quiet from `start` to `end`; an end before the start runs past midnight (e.g. 19:00–08:00). */
  start: HHMM,
  end: HHMM,
});
export type DndSchedule = z.infer<typeof DndScheduleSchema>;

export const DEFAULT_DND_SCHEDULE: DndSchedule = {
  enabled: false,
  timeZone: 'UTC',
  days: [1, 2, 3, 4, 5],
  start: '19:00',
  end: '08:00',
};

/** What others (and you) see, from GET /v1/users and GET /v1/me. */
export const PresenceInfoSchema = z.object({
  status: UserStatusSchema,
  dndSchedule: DndScheduleSchema,
  /** Do-not-disturb right now (manual or scheduled). */
  dndActive: z.boolean(),
});
export type PresenceInfo = z.infer<typeof PresenceInfoSchema>;

const mins = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Local weekday (0–6) and minute of day in a time zone. */
export function localClock(at: Date, timeZone: string): { day: number; minute: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at);
  } catch {
    return localClock(at, 'UTC');
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  return {
    day: WD.indexOf(get('weekday')),
    minute: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/** True when `at` falls inside the schedule's quiet hours. */
export function inDndSchedule(s: DndSchedule, at: Date): boolean {
  if (!s.enabled || s.days.length === 0) return false;
  const { day, minute } = localClock(at, s.timeZone);
  const start = mins(s.start);
  const end = mins(s.end);
  if (start === end) return false;
  if (start < end) return s.days.includes(day) && minute >= start && minute < end;
  // Runs past midnight: the evening part today, or the morning part after yesterday's start.
  if (minute >= start) return s.days.includes(day);
  if (minute < end) return s.days.includes((day + 6) % 7);
  return false;
}

/** The status in effect at `at`: an expired custom status reads as cleared. */
export function effectiveStatus(s: UserStatus | null | undefined, at: Date): UserStatus {
  if (!s || (s.expiresAt && Date.parse(s.expiresAt) <= at.getTime()))
    return { availability: 'auto', emoji: null, text: null, expiresAt: null };
  return s;
}

export function dndActive(
  status: UserStatus | null | undefined,
  schedule: DndSchedule | null | undefined,
  at: Date,
): boolean {
  return (
    effectiveStatus(status, at).availability === 'dnd' ||
    (!!schedule && inDndSchedule(schedule, at))
  );
}
