import { describe, expect, it } from 'vitest';
import { describeRecurrence, RecurrenceSchema } from '@sampledge/contracts';
import { expand, toRRule, validateRule } from './recurrence.js';
import { buildCalendar } from './ics.js';

const rule = (r: unknown) => RecurrenceSchema.parse(r);
const iso = (d: Date[]) => d.map((x) => x.toISOString());
const far = new Date('2030-01-01T00:00:00Z');

describe('recurrence', () => {
  it('keeps the local time across a DST change (weekly, London)', () => {
    // 10:00 London on Tue 20 Oct 2026 (BST, UTC+1); clocks go back on Sun 25 Oct.
    const anchor = { startsAt: new Date('2026-10-20T09:00:00Z'), timeZone: 'Europe/London' };
    const { starts, complete } = expand(rule({ frequency: 'weekly', endsAfter: 3 }), anchor, far);
    expect(iso(starts)).toEqual([
      '2026-10-20T09:00:00.000Z',
      '2026-10-27T10:00:00.000Z',
      '2026-11-03T10:00:00.000Z',
    ]);
    expect(complete).toBe(true);
  });

  it('weekdays only, starting on the first matching day', () => {
    // Saturday 21 Nov 2026 09:00 UTC: the first meeting is Monday 23.
    const anchor = { startsAt: new Date('2026-11-21T09:00:00Z'), timeZone: 'UTC' };
    const r = rule({ frequency: 'weekly', weekdays: [1, 2, 3, 4, 5], endsAfter: 6 });
    expect(iso(expand(r, anchor, far).starts).map((s) => s.slice(0, 10))).toEqual([
      '2026-11-23',
      '2026-11-24',
      '2026-11-25',
      '2026-11-26',
      '2026-11-27',
      '2026-11-30',
    ]);
    expect(describeRecurrence(r, anchor.startsAt.toISOString(), 'UTC')).toBe(
      'Every weekday, 6 times',
    );
  });

  it('every 2 weeks on Mon and Thu, ending on a date', () => {
    const anchor = { startsAt: new Date('2026-11-23T14:00:00Z'), timeZone: 'UTC' };
    const r = rule({ frequency: 'weekly', interval: 2, weekdays: [4, 1], endsOn: '2026-12-10' });
    expect(iso(expand(r, anchor, far).starts).map((s) => s.slice(0, 10))).toEqual([
      '2026-11-23',
      '2026-11-26',
      '2026-12-07',
      '2026-12-10',
    ]);
    expect(toRRule(r, anchor)).toBe(
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;UNTIL=20261210T235959Z;WKST=MO',
    );
  });

  it('monthly on the 31st skips short months', () => {
    const anchor = { startsAt: new Date('2027-01-31T08:00:00Z'), timeZone: 'UTC' };
    const r = rule({ frequency: 'monthly', endsAfter: 3 });
    expect(iso(expand(r, anchor, far).starts).map((s) => s.slice(0, 10))).toEqual([
      '2027-01-31',
      '2027-03-31',
      '2027-05-31',
    ]);
    expect(toRRule(r, anchor)).toBe('FREQ=MONTHLY;BYMONTHDAY=31;COUNT=3;WKST=MO');
    expect(describeRecurrence(r, anchor.startsAt.toISOString(), 'UTC')).toBe(
      'Monthly on the 31st, 3 times',
    );
  });

  it('open-ended series stop at the horizon and continue after a given start', () => {
    const anchor = { startsAt: new Date('2026-11-23T09:00:00Z'), timeZone: 'UTC' };
    const r = rule({ frequency: 'daily' });
    const a = expand(r, anchor, new Date('2026-11-26T00:00:00Z'));
    expect(a.starts).toHaveLength(3);
    expect(a.complete).toBe(false);
    const b = expand(r, anchor, new Date('2026-11-28T00:00:00Z'), a.starts.at(-1)!);
    expect(iso(b.starts)).toEqual(['2026-11-26T09:00:00.000Z', '2026-11-27T09:00:00.000Z']);
  });

  it('rejects end dates before the start or too far out', () => {
    const anchor = { startsAt: new Date('2026-11-23T09:00:00Z'), timeZone: 'UTC' };
    expect(validateRule(rule({ frequency: 'daily', endsOn: '2026-11-01' }), anchor)).toMatch(
      /before/,
    );
    expect(validateRule(rule({ frequency: 'daily', endsOn: '2030-01-01' }), anchor)).toMatch(
      /at most/,
    );
    expect(() => rule({ frequency: 'daily', endsOn: '2027-01-01', endsAfter: 3 })).toThrow();
  });

  it('writes a series invite with local times, a time zone, EXDATE and an override', () => {
    const tz = 'Europe/Berlin';
    const base = {
      uid: 's1@sampledge-connect',
      sequence: 2,
      stamp: new Date('2026-11-21T12:00:00Z'),
      title: 'Standup',
      description: 'Daily',
      url: 'https://x.test/join/a.b',
      organizer: { name: 'Priya', email: 'priya@x.test' },
      attendee: { name: 'Anna', email: 'anna@y.test' },
      alarmMinutes: 10,
    };
    const ics = buildCalendar({
      method: 'REQUEST',
      timeZone: tz,
      tzFrom: new Date('2026-11-23T08:00:00Z'),
      tzTo: new Date('2027-06-01T00:00:00Z'),
      events: [
        {
          ...base,
          startsAt: new Date('2026-11-23T08:00:00Z'),
          endsAt: new Date('2026-11-23T08:15:00Z'),
          rrule: 'FREQ=DAILY;WKST=MO',
          exdates: [new Date('2026-11-25T08:00:00Z')],
        },
        {
          ...base,
          startsAt: new Date('2026-11-26T09:00:00Z'),
          endsAt: new Date('2026-11-26T09:15:00Z'),
          recurrenceId: new Date('2026-11-26T08:00:00Z'),
        },
      ],
    }).replace(/\r\n /g, '');
    expect(ics).toContain('BEGIN:VTIMEZONE\r\nTZID:Europe/Berlin');
    // Last Sunday of March 2027, 02:00 local: +0100 -> +0200.
    expect(ics).toContain(
      'BEGIN:DAYLIGHT\r\nDTSTART:20270328T020000\r\nTZOFFSETFROM:+0100\r\nTZOFFSETTO:+0200',
    );
    expect(ics).toContain('DTSTART;TZID=Europe/Berlin:20261123T090000');
    expect(ics).toContain('RRULE:FREQ=DAILY;WKST=MO');
    expect(ics).toContain('EXDATE;TZID=Europe/Berlin:20261125T090000');
    expect(ics).toContain('RECURRENCE-ID;TZID=Europe/Berlin:20261126T090000');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });
});
