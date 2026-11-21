/** Date and time labels in this phone's time zone. */

export const deviceTimeZone = (): string =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar day key, e.g. 2026-11-25. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
}

/** "Today", "Tomorrow", "Yesterday" or "Tue 25 Nov". */
export function dayLabel(d: Date, now = new Date()): string {
  const diff = Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return d.toLocaleDateString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

export function clock(d: Date | string): string {
  return new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** "14:00 – 14:30". */
export function timeRange(startsAt: string, endsAt: string): string {
  return `${clock(startsAt)} – ${clock(endsAt)}`;
}

export function minutesBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 60_000);
}

export function durationLabel(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
}

/** "in 12 min", "now", "in 2 h", "ended". */
export function relativeStart(startsAt: string, endsAt: string, now = Date.now()): string {
  const s = Date.parse(startsAt);
  const e = Date.parse(endsAt);
  if (now >= e) return 'Ended';
  if (now >= s) return 'Now';
  const min = Math.round((s - now) / 60_000);
  if (min < 60) return `In ${Math.max(1, min)} min`;
  if (min < 24 * 60) return `In ${Math.round(min / 60)} h`;
  return dayLabel(new Date(s));
}

/** Joining opens 15 minutes before the start and closes at the end. */
export function canJoinNow(startsAt: string, endsAt: string, now = Date.now()): boolean {
  return now >= Date.parse(startsAt) - 15 * 60_000 && now < Date.parse(endsAt);
}

/** Offset label of a time zone at a moment, e.g. "GMT+5:30". */
export function zoneLabel(timeZone: string, at = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName');
    return part?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}
