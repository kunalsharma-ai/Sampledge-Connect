import { describe, expect, it } from 'vitest';
import { dndActive, effectiveStatus, inDndSchedule, type DndSchedule } from './status.js';

const night: DndSchedule = {
  enabled: true,
  timeZone: 'Asia/Kolkata',
  days: [1, 2, 3, 4, 5],
  start: '19:00',
  end: '08:00',
};

describe('do-not-disturb schedule', () => {
  it('handles quiet hours past midnight in the person’s time zone', () => {
    // Monday 20:00 IST = 14:30 UTC
    expect(inDndSchedule(night, new Date('2026-11-23T14:30:00Z'))).toBe(true);
    // Tuesday 07:00 IST (after Monday's start) = Monday 01:30 UTC
    expect(inDndSchedule(night, new Date('2026-11-24T01:30:00Z'))).toBe(true);
    // Monday 12:00 IST
    expect(inDndSchedule(night, new Date('2026-11-23T06:30:00Z'))).toBe(false);
    // Saturday 21:00 IST: Saturday is not a quiet day
    expect(inDndSchedule(night, new Date('2026-11-28T15:30:00Z'))).toBe(false);
    // Saturday 07:00 IST follows Friday's start
    expect(inDndSchedule(night, new Date('2026-11-28T01:30:00Z'))).toBe(true);
    expect(inDndSchedule({ ...night, enabled: false }, new Date('2026-11-23T14:30:00Z'))).toBe(
      false,
    );
  });

  it('handles same-day windows and expiring statuses', () => {
    const lunch: DndSchedule = {
      enabled: true,
      timeZone: 'UTC',
      days: [0, 1, 2, 3, 4, 5, 6],
      start: '12:00',
      end: '13:00',
    };
    expect(inDndSchedule(lunch, new Date('2026-11-23T12:30:00Z'))).toBe(true);
    expect(inDndSchedule(lunch, new Date('2026-11-23T13:00:00Z'))).toBe(false);
    const s = {
      availability: 'dnd' as const,
      emoji: '🎧',
      text: 'Focus',
      expiresAt: '2026-11-23T10:00:00.000Z',
    };
    expect(dndActive(s, null, new Date('2026-11-23T09:00:00Z'))).toBe(true);
    expect(dndActive(s, null, new Date('2026-11-23T10:00:00Z'))).toBe(false);
    expect(effectiveStatus(s, new Date('2026-11-23T11:00:00Z')).text).toBeNull();
  });
});
