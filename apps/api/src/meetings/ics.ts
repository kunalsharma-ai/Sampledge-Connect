import { localParts, offsetAt as tzOffsetAt } from './time.js';

/**
 * iCalendar (RFC 5545) invites for external guests, in the iTIP (RFC 5546) shape that
 * Outlook, Gmail and Apple Calendar recognize: METHOD:REQUEST for an invite or a change,
 * METHOD:CANCEL to take it off their calendar. One UID per meeting; SEQUENCE increases with
 * every change so calendars replace the old copy instead of adding a second one.
 */
export interface IcsEvent {
  method: 'REQUEST' | 'CANCEL';
  uid: string;
  sequence: number;
  startsAt: Date;
  endsAt: Date;
  /** When this version was produced (DTSTAMP). */
  stamp: Date;
  title: string;
  description: string;
  /** The guest's join link (LOCATION and URL). */
  url: string;
  organizer: { name: string; email: string };
  attendee: { name: string; email: string };
  /** Minutes before start for a reminder alarm (omitted when null). */
  alarmMinutes: number | null;
}

/** TEXT value escaping (RFC 5545 §3.3.11). */
export function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Quoted parameter values (CN=...) can't hold DQUOTE or control characters. */
function paramValue(s: string): string {
  const clean = s.replace(/["\p{Cc}]/gu, '').trim();
  return `"${clean}"`;
}

/** 20261121T120000Z */
export function icsDate(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/** Folds a content line at 75 octets without splitting a UTF-8 character (§3.1). */
export function foldLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Back up to a character boundary (continuation bytes are 10xxxxxx).
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
    parts.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74; // continuation lines start with a space
  }
  return parts.join('\r\n ');
}

export function buildIcs(e: IcsEvent): string {
  return buildCalendar({ method: e.method, events: [e] });
}

/** One VEVENT of a calendar: a plain meeting, a series master, or one changed occurrence. */
export interface IcsVEvent extends Omit<IcsEvent, 'method'> {
  /** RRULE value (series master only). */
  rrule?: string;
  /** Occurrences removed from the series (original start times). */
  exdates?: Date[];
  /** This VEVENT replaces the occurrence originally starting at this time. */
  recurrenceId?: Date;
  /** STATUS:CANCELLED (a cancelled occurrence in a REQUEST, or anything in a CANCEL). */
  cancelled?: boolean;
}

/**
 * A full VCALENDAR. With `timeZone` (recurring meetings), times are written as local times
 * with TZID and a VTIMEZONE covering [tzFrom, tzTo], so repeats keep their local time
 * across daylight-saving changes. Without it, times are UTC.
 */
export function buildCalendar(c: {
  method: 'REQUEST' | 'CANCEL';
  events: IcsVEvent[];
  timeZone?: string;
  tzFrom?: Date;
  tzTo?: Date;
}): string {
  const tz = c.timeZone && c.timeZone !== 'UTC' ? c.timeZone : null;
  const when = (prop: string, d: Date) =>
    tz ? `${prop};TZID=${tz}:${localIcsDate(d, tz)}` : `${prop}:${icsDate(d)}`;
  const mailto = (email: string) => `mailto:${email.replace(/[\s"<>]/g, '')}`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Sampledge//SampConnect//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${c.method}`,
    ...(tz
      ? vtimezone(
          tz,
          c.tzFrom ?? c.events[0]!.startsAt,
          c.tzTo ?? new Date(c.events[0]!.startsAt.getTime() + 2 * 366 * 86_400_000),
        )
      : []),
  ];
  for (const e of c.events) {
    const cancelled = c.method === 'CANCEL' || !!e.cancelled;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      ...(e.recurrenceId ? [when('RECURRENCE-ID', e.recurrenceId)] : []),
      `SEQUENCE:${e.sequence}`,
      `DTSTAMP:${icsDate(e.stamp)}`,
      when('DTSTART', e.startsAt),
      when('DTEND', e.endsAt),
      ...(e.rrule ? [`RRULE:${e.rrule}`] : []),
      ...(e.exdates ?? []).map((d) => when('EXDATE', d)),
      `SUMMARY:${escapeText(e.title)}`,
      `DESCRIPTION:${escapeText(e.description)}`,
      `LOCATION:${escapeText(e.url)}`,
      `URL:${e.url}`,
      `ORGANIZER;CN=${paramValue(e.organizer.name)}:${mailto(e.organizer.email)}`,
      `ATTENDEE;CN=${paramValue(e.attendee.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:${mailto(e.attendee.email)}`,
      `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
      'TRANSP:OPAQUE',
      ...(!cancelled && e.alarmMinutes !== null
        ? [
            'BEGIN:VALARM',
            'ACTION:DISPLAY',
            `DESCRIPTION:${escapeText(e.title)}`,
            `TRIGGER:-PT${Math.max(0, Math.round(e.alarmMinutes))}M`,
            'END:VALARM',
          ]
        : []),
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/** 20261124T100000: the wall-clock time in `tz`. */
export function localIcsDate(d: Date, tz: string): string {
  const p = localParts(d.getTime(), tz);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}${pad(p.month)}${pad(p.day)}T${pad(Math.floor(p.minutes / 60))}${pad(p.minutes % 60)}00`;
}

const offsetText = (ms: number) => {
  const m = Math.round(ms / 60_000);
  const a = Math.abs(m);
  return `${m < 0 ? '-' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}${String(a % 60).padStart(2, '0')}`;
};

/**
 * VTIMEZONE for an IANA zone between two instants, built from the zone's actual offset
 * changes (found with Intl, to the minute), one STANDARD/DAYLIGHT block per change.
 */
export function vtimezone(tz: string, from: Date, to: Date): string[] {
  const start = from.getTime() - 86_400_000;
  const end = to.getTime() + 86_400_000;
  const changes: { at: number; before: number; after: number }[] = [];
  let prevT = start;
  let prev = tzOffsetAt(start, tz);
  for (let t = start + 86_400_000; t <= end; t += 86_400_000) {
    const o = tzOffsetAt(t, tz);
    if (o !== prev) {
      let lo = prevT;
      let hi = t;
      while (hi - lo > 60_000) {
        const mid = Math.floor((lo + hi) / 2 / 60_000) * 60_000;
        if (tzOffsetAt(mid, tz) === prev) lo = mid;
        else hi = mid;
      }
      changes.push({ at: hi, before: prev, after: o });
      prev = o;
    }
    prevT = t;
  }
  const offsets = [tzOffsetAt(start, tz), ...changes.map((c) => c.after)];
  const std = Math.min(...offsets);
  const block = (onset: string, before: number, after: number) => {
    const kind = after > std ? 'DAYLIGHT' : 'STANDARD';
    return [
      `BEGIN:${kind}`,
      `DTSTART:${onset}`,
      `TZOFFSETFROM:${offsetText(before)}`,
      `TZOFFSETTO:${offsetText(after)}`,
      `END:${kind}`,
    ];
  };
  const initial = tzOffsetAt(start, tz);
  const out = ['BEGIN:VTIMEZONE', `TZID:${tz}`, ...block('19700101T000000', initial, initial)];
  for (const c of changes) {
    // Onset is the local time just before the change, in the old offset.
    const local = new Date(c.at + c.before)
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, '');
    out.push(...block(local, c.before, c.after));
  }
  out.push('END:VTIMEZONE');
  return out;
}
