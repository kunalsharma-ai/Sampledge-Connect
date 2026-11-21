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
  const mailto = (email: string) => `mailto:${email.replace(/[\s"<>]/g, '')}`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Sampledge//Sampledge Connect//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${e.method}`,
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `SEQUENCE:${e.sequence}`,
    `DTSTAMP:${icsDate(e.stamp)}`,
    `DTSTART:${icsDate(e.startsAt)}`,
    `DTEND:${icsDate(e.endsAt)}`,
    `SUMMARY:${escapeText(e.title)}`,
    `DESCRIPTION:${escapeText(e.description)}`,
    `LOCATION:${escapeText(e.url)}`,
    `URL:${e.url}`,
    `ORGANIZER;CN=${paramValue(e.organizer.name)}:${mailto(e.organizer.email)}`,
    `ATTENDEE;CN=${paramValue(e.attendee.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:${mailto(e.attendee.email)}`,
    `STATUS:${e.method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    'TRANSP:OPAQUE',
    ...(e.method === 'REQUEST' && e.alarmMinutes !== null
      ? [
          'BEGIN:VALARM',
          'ACTION:DISPLAY',
          `DESCRIPTION:${escapeText(e.title)}`,
          `TRIGGER:-PT${Math.max(0, Math.round(e.alarmMinutes))}M`,
          'END:VALARM',
        ]
      : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
