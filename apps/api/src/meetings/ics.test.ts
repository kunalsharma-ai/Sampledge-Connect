import { describe, expect, it } from 'vitest';
import { buildIcs, escapeText, foldLine, icsDate } from './ics.js';
import { formatWhen, guestEmail } from './guest-email.js';

describe('ics', () => {
  it('escapes text values', () => {
    expect(escapeText('a, b; c\\d\nnext')).toBe(String.raw`a\, b\; c\\d\nnext`);
  });

  it('folds at 75 octets without splitting UTF-8 characters', () => {
    const line = `SUMMARY:${'é'.repeat(80)}`;
    const folded = foldLine(line);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(Buffer.byteLength(p)).toBeLessThanOrEqual(75);
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join('')).toBe(line);
    expect(folded).not.toContain('�');
  });

  it('builds a REQUEST and a CANCEL with UTC times', () => {
    const base = {
      uid: 'm1@sampledge-connect',
      sequence: 3,
      startsAt: new Date('2026-11-24T09:30:00Z'),
      endsAt: new Date('2026-11-24T10:00:00Z'),
      stamp: new Date('2026-11-21T12:00:00Z'),
      title: 'Review',
      description: 'Agenda',
      url: 'https://x.test/join/a.b',
      organizer: { name: 'Priya "P" Owner', email: 'priya@x.test' },
      attendee: { name: 'Anna', email: 'anna@y.test' },
      alarmMinutes: 10,
    };
    const req = buildIcs({ ...base, method: 'REQUEST' });
    expect(icsDate(base.startsAt)).toBe('20261124T093000Z');
    expect(req).toContain('DTSTART:20261124T093000Z\r\n');
    expect(req).toContain('SEQUENCE:3\r\n');
    expect(req).toContain('ORGANIZER;CN="Priya P Owner":mailto:priya@x.test');
    expect(req).toContain('TRIGGER:-PT10M');
    expect(req.endsWith('END:VCALENDAR\r\n')).toBe(true);
    const cancel = buildIcs({ ...base, method: 'CANCEL' });
    expect(cancel).toContain('METHOD:CANCEL');
    expect(cancel).toContain('STATUS:CANCELLED');
    expect(cancel).not.toContain('VALARM');
  });
});

describe('guest emails', () => {
  it('shows the time in the meeting zone and escapes HTML', () => {
    expect(
      formatWhen(
        new Date('2026-11-24T09:30:00Z'),
        new Date('2026-11-24T10:00:00Z'),
        'Asia/Kolkata',
      ),
    ).toMatch(/^Tuesday,? 24 November 2026, 15:00 – 15:30 \(Asia\/Kolkata\)$/);
    const mail = guestEmail('invite', {
      title: '<b>Q4</b>',
      agenda: '',
      startsAt: new Date('2026-11-24T09:30:00Z'),
      endsAt: new Date('2026-11-24T10:00:00Z'),
      timeZone: 'UTC',
      organizerName: 'Priya',
      organizationName: 'Acme',
      guestName: 'Anna',
      url: 'https://x.test/join/a.b',
    });
    expect(mail.subject).toBe('Invitation: <b>Q4</b>');
    expect(mail.html).toContain('&lt;b&gt;Q4&lt;/b&gt;');
    expect(mail.html).not.toContain('<b>Q4</b>');
    expect(mail.text).toContain('Join the meeting: https://x.test/join/a.b');
  });
});
