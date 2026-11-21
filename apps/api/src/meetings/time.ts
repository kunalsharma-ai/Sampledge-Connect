/**
 * Time-zone arithmetic with Intl only (no tz database dependency): local wall-clock parts of an
 * instant in an IANA zone, and the inverse. Correct across DST changes.
 */
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  weekday: number; // 0 = Sunday
  minutes: number; // minutes since local midnight
}

export function localParts(ts: number, tz: string): LocalParts {
  const p: Record<string, string> = {};
  for (const x of fmt(tz).formatToParts(new Date(ts))) p[x.type] = x.value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    weekday: WEEKDAYS[p.weekday!] ?? 0,
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

/** Offset (ms) of `tz` from UTC at instant `ts`. */
export function offsetAt(ts: number, tz: string): number {
  const p: Record<string, string> = {};
  for (const x of fmt(tz).formatToParts(new Date(ts))) p[x.type] = x.value;
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return asUtc - Math.floor(ts / 1000) * 1000;
}

/** The instant at which the wall clock in `tz` reads the given local date and minute. */
export function zonedToUtc(year: number, month: number, day: number, minutes: number, tz: string) {
  const guess = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60);
  const first = guess - offsetAt(guess, tz);
  return guess - offsetAt(first, tz);
}

export const hhmmToMinutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
