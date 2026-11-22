import { describe, expect, it } from 'vitest';
import { availabilityTone, expiryFor, shiftTime, statusLine } from './status';

describe('status helpers', () => {
  const now = new Date(2026, 10, 21, 14, 0); // Saturday 2pm local

  it('clear-after choices', () => {
    expect(expiryFor('never', now)).toBeNull();
    expect(Date.parse(expiryFor('30m', now)!) - now.getTime()).toBe(30 * 60_000);
    const today = new Date(expiryFor('today', now)!);
    expect([today.getDate(), today.getHours(), today.getMinutes()]).toEqual([21, 23, 59]);
    const week = new Date(expiryFor('week', now)!);
    expect([week.getDay(), week.getDate()]).toEqual([0, 22]);
  });

  it('status line and expiry', () => {
    expect(statusLine(null, now)).toBeNull();
    expect(
      statusLine({ availability: 'busy', emoji: '📅', text: 'In a meeting', expiresAt: null }, now),
    ).toBe('Busy · 📅 In a meeting');
    const gone = new Date(now.getTime() - 1000).toISOString();
    expect(
      statusLine({ availability: 'away', emoji: null, text: 'x', expiresAt: gone }, now),
    ).toBeNull();
    const later = new Date(now.getTime() + 3_600_000).toISOString();
    expect(
      statusLine({ availability: 'auto', emoji: null, text: 'Lunch', expiresAt: later }, now),
    ).toMatch(/^Lunch · until /);
  });

  it('dot colour follows do-not-disturb and quiet hours', () => {
    expect(availabilityTone(null, null, now)).toBe('available');
    expect(
      availabilityTone(
        { availability: 'dnd', emoji: null, text: null, expiresAt: null },
        null,
        now,
      ),
    ).toBe('busy');
    expect(
      availabilityTone(
        null,
        {
          enabled: true,
          timeZone: 'UTC',
          days: [0, 1, 2, 3, 4, 5, 6],
          start: '00:00',
          end: '23:59',
        },
        now,
      ),
    ).toBe('busy');
  });

  it('shifts times round midnight', () => {
    expect(shiftTime('23:30', 30)).toBe('00:00');
    expect(shiftTime('00:00', -30)).toBe('23:30');
  });
});
