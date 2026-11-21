import { MAX_SERIES_OCCURRENCES, MAX_SERIES_YEARS, type Recurrence } from '@sampledge/contracts';
import { localParts, zonedToUtc } from './time.js';

/**
 * Expands a recurrence rule into occurrence start instants. Dates step on the local calendar
 * of the series' time zone and each occurrence starts at the same local time, so a 10:00
 * weekly meeting stays at 10:00 across daylight-saving changes. The expansion matches the
 * RRULE we put in guests' calendar invites (`toRRule`), with weeks starting on Monday.
 */
export interface SeriesAnchor {
  /** The first meeting as requested (the series starts on the first matching day from it). */
  startsAt: Date;
  timeZone: string;
}

const DAY = 86_400_000;
const dayNum = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / DAY;
const fromDayNum = (n: number) => {
  const x = new Date(n * DAY);
  return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate() };
};
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const weekOrder = (d: number) => (d + 6) % 7;

/** Weekdays of a weekly rule (defaulting to the anchor's), Monday first. */
export function ruleWeekdays(r: Recurrence, anchor: SeriesAnchor): number[] {
  const first = localParts(anchor.startsAt.getTime(), anchor.timeZone).weekday;
  return [...new Set(r.weekdays?.length ? r.weekdays : [first])].sort(
    (a, b) => weekOrder(a) - weekOrder(b),
  );
}

/** Local calendar dates of the series, in order. Infinite unless the rule ends. */
function* localDates(r: Recurrence, anchor: SeriesAnchor) {
  const p = localParts(anchor.startsAt.getTime(), anchor.timeZone);
  const start = dayNum(p.year, p.month, p.day);
  const until = r.endsOn
    ? dayNum(...(r.endsOn.split('-').map(Number) as [number, number, number]))
    : Infinity;
  let count = 0;
  const emit = (n: number) => n >= start && n <= until;
  // Callers stop at a horizon; the cap only guards against a runaway loop.
  const done = () => (r.endsAfter !== undefined && count >= r.endsAfter) || count >= 100_000;

  if (r.frequency === 'daily') {
    for (let n = start; n <= until && !done(); n += r.interval) {
      count++;
      yield fromDayNum(n);
    }
  } else if (r.frequency === 'weekly') {
    const days = ruleWeekdays(r, anchor).map(weekOrder);
    const monday = start - weekOrder(p.weekday);
    for (let w = monday; w <= until && !done(); w += 7 * r.interval)
      for (const off of days) {
        const n = w + off;
        if (!emit(n)) continue;
        if (done()) return;
        count++;
        yield fromDayNum(n);
      }
  } else {
    const day = p.day;
    for (let k = 0; !done(); k += r.interval) {
      const mIdx = p.month - 1 + k;
      const y = p.year + Math.floor(mIdx / 12);
      const m = (mIdx % 12) + 1;
      const first = dayNum(y, m, 1);
      if (first > until) return;
      if (day > daysInMonth(y, m)) continue;
      const n = dayNum(y, m, day);
      if (!emit(n)) continue;
      count++;
      yield fromDayNum(n);
    }
  }
}

/**
 * Occurrence start instants after `after` (exclusive) and before `until` (exclusive), at most
 * MAX_SERIES_OCCURRENCES. `complete` says whether the rule has no meetings after these.
 */
export function expand(
  r: Recurrence,
  anchor: SeriesAnchor,
  until: Date,
  after: Date | null = null,
): { starts: Date[]; complete: boolean } {
  const p = localParts(anchor.startsAt.getTime(), anchor.timeZone);
  const starts: Date[] = [];
  for (const d of localDates(r, anchor)) {
    const at = new Date(zonedToUtc(d.y, d.m, d.d, p.minutes, anchor.timeZone));
    if (after && at.getTime() <= after.getTime()) continue;
    if (at.getTime() >= until.getTime() || starts.length >= MAX_SERIES_OCCURRENCES)
      return { starts, complete: false };
    starts.push(at);
  }
  return { starts, complete: true };
}

/** Rejects rules we won't expand: an end date too far out, or before the first meeting. */
export function validateRule(r: Recurrence, anchor: SeriesAnchor): string | null {
  if (!r.endsOn) return null;
  const p = localParts(anchor.startsAt.getTime(), anchor.timeZone);
  const [y, m, d] = r.endsOn.split('-').map(Number) as [number, number, number];
  const days = dayNum(y, m, d) - dayNum(p.year, p.month, p.day);
  if (days < 0) return 'The series would end before its first meeting';
  if (days > MAX_SERIES_YEARS * 366)
    return `A series can run at most ${MAX_SERIES_YEARS} years. Choose an earlier end date or no end.`;
  return null;
}

/** The RRULE for guests' calendars (paired with DTSTART;TZID=<zone> at the first meeting). */
export function toRRule(r: Recurrence, anchor: SeriesAnchor): string {
  const p = localParts(anchor.startsAt.getTime(), anchor.timeZone);
  const parts = [`FREQ=${r.frequency.toUpperCase()}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.frequency === 'weekly')
    parts.push(
      `BYDAY=${ruleWeekdays(r, anchor)
        .map((d) => ICS_DAYS[d])
        .join(',')}`,
    );
  if (r.frequency === 'monthly') parts.push(`BYMONTHDAY=${p.day}`);
  if (r.endsAfter) parts.push(`COUNT=${r.endsAfter}`);
  else if (r.endsOn) {
    const [y, m, d] = r.endsOn.split('-').map(Number) as [number, number, number];
    const last = zonedToUtc(y, m, d, 23 * 60 + 59, anchor.timeZone) + 59_000;
    parts.push(
      `UNTIL=${new Date(last)
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}/, '')}`,
    );
  }
  parts.push('WKST=MO');
  return parts.join(';');
}

const ICS_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
