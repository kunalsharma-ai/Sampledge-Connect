import { z } from 'zod';
import { ServerIdSchema } from './ids.js';

/**
 * Recurring meetings. A series has one rule; each occurrence is its own meeting (its own
 * RSVPs, reminders and call), all in the same meeting chat. Occurrences keep the same local
 * time in the organizer's time zone across daylight-saving changes.
 *
 * Series that never end are created this far ahead and extended automatically.
 */
export const SERIES_HORIZON_DAYS = 180;
export const MAX_SERIES_OCCURRENCES = 200;
/** A series with an end date may run at most this long. */
export const MAX_SERIES_YEARS = 2;

export const RECURRENCE_FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;

const YMD = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'use YYYY-MM-DD');

/**
 * daily: every `interval` days. weekly: every `interval` weeks on `weekdays` (0 = Sunday;
 * defaults to the first meeting's weekday). monthly: every `interval` months on the first
 * meeting's day of the month (months without that day are skipped).
 * Ends after `endsAfter` meetings, on `endsOn` (a local date, inclusive), or never.
 */
export const RecurrenceSchema = z
  .object({
    frequency: z.enum(RECURRENCE_FREQUENCIES),
    interval: z.number().int().min(1).max(30).default(1),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
    endsAfter: z.number().int().min(2).max(MAX_SERIES_OCCURRENCES).optional(),
    endsOn: YMD.optional(),
  })
  .refine((r) => !(r.endsAfter && r.endsOn), {
    message: 'Choose an end date or a number of meetings, not both',
    path: ['endsOn'],
  });
export type Recurrence = z.infer<typeof RecurrenceSchema>;
export type RecurrenceInput = z.input<typeof RecurrenceSchema>;

/** `Meeting.series`: present on every occurrence of a recurring meeting. */
export const MeetingSeriesInfoSchema = z.object({
  seriesId: ServerIdSchema,
  recurrence: RecurrenceSchema,
  /** "Weekly on Tuesday", in the organizer's time zone. */
  summary: z.string(),
  /** This occurrence was changed on its own (time, title or agenda). */
  detached: z.boolean(),
});
export type MeetingSeriesInfo = z.infer<typeof MeetingSeriesInfoSchema>;

/** Which meetings a change, cancellation or RSVP applies to. */
export const SeriesScopeSchema = z.enum(['occurrence', 'series']).default('occurrence');
export type SeriesScope = z.infer<typeof SeriesScopeSchema>;

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ordinal = (n: number) => {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
};

/** Local weekday and day of month of an instant in `timeZone`. */
function localDay(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
  }).formatToParts(new Date(iso));
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
  return {
    weekday: Math.max(0, SHORT.indexOf(wd)),
    day: Number(parts.find((p) => p.type === 'day')?.value ?? 1),
  };
}

/** Monday-first order, as people read a week. */
const weekOrder = (d: number) => (d + 6) % 7;

/**
 * Plain-English summary of a rule: "Every weekday", "Weekly on Tuesday", "Every 2 weeks on
 * Mon, Thu", "Monthly on the 24th, until 31 Mar 2027", "Daily, 10 times".
 */
export function describeRecurrence(r: RecurrenceInput, firstStartsAt: string, timeZone: string) {
  const interval = r.interval ?? 1;
  const first = localDay(firstStartsAt, timeZone);
  let text: string;
  if (r.frequency === 'daily') {
    text = interval === 1 ? 'Daily' : `Every ${interval} days`;
  } else if (r.frequency === 'weekly') {
    const days = [...new Set(r.weekdays?.length ? r.weekdays : [first.weekday])].sort(
      (a, b) => weekOrder(a) - weekOrder(b),
    );
    const weekdays = days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d));
    const list =
      days.length === 1
        ? DAY_NAMES[days[0]!]!
        : days.length === 7
          ? 'every day'
          : days.map((d) => SHORT[d]).join(', ');
    if (interval === 1 && weekdays) text = 'Every weekday';
    else if (interval === 1) text = days.length === 7 ? 'Daily' : `Weekly on ${list}`;
    else text = `Every ${interval} weeks on ${weekdays ? 'weekdays' : list}`;
  } else {
    const on = `on the ${ordinal(first.day)}`;
    text = interval === 1 ? `Monthly ${on}` : `Every ${interval} months ${on}`;
  }
  if (r.endsAfter) text += `, ${r.endsAfter} times`;
  else if (r.endsOn) {
    const [y, m, d] = r.endsOn.split('-').map(Number) as [number, number, number];
    const until = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(Date.UTC(y, m - 1, d)));
    text += `, until ${until}`;
  }
  return text;
}
