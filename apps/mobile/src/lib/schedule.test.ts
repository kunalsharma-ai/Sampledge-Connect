import { describe, expect, it } from 'vitest';
import {
  combineDayTime,
  formatSendAt,
  scheduleDays,
  schedulePresets,
  scheduleProblem,
} from './schedule';

describe('scheduling', () => {
  it('offers presets that fit the time of day', () => {
    const tuesdayMorning = new Date(2026, 10, 24, 10, 7);
    const p = schedulePresets(tuesdayMorning);
    expect(p.map((x) => x.key)).toEqual(['hour', 'evening', 'tomorrow', 'monday']);
    expect(p[0]!.at).toEqual(new Date(2026, 10, 24, 11, 10));
    expect(p[1]!.at).toEqual(new Date(2026, 10, 24, 18, 0));
    expect(p[2]!.at).toEqual(new Date(2026, 10, 25, 9, 0));
    expect(p[3]!.at).toEqual(new Date(2026, 10, 30, 9, 0));

    const sundayNight = new Date(2026, 10, 29, 21, 0);
    // No evening (it is past), and Monday is tomorrow so it is not repeated.
    expect(schedulePresets(sundayNight).map((x) => x.key)).toEqual(['hour', 'tomorrow']);
  });

  it('builds custom times and checks limits like the server', () => {
    const now = new Date(2026, 10, 24, 10, 0);
    const days = scheduleDays(now);
    expect(days).toHaveLength(7);
    expect(days[0]!.label).toBe('Today');
    expect(combineDayTime(days[1]!.date, 9 * 60 + 30)).toEqual(new Date(2026, 10, 25, 9, 30));
    expect(scheduleProblem(new Date(now.getTime() + 30_000), now)).toMatch(/minute/);
    expect(scheduleProblem(new Date(now.getTime() + 400 * 86_400_000), now)).toMatch(/year/);
    expect(scheduleProblem(new Date(now.getTime() + 3_600_000), now)).toBeNull();
  });

  it('formats send times relative to today', () => {
    const now = new Date(2026, 10, 24, 10, 0);
    expect(formatSendAt(new Date(2026, 10, 24, 18, 0).toISOString(), now)).toMatch(/^Today, /);
    expect(formatSendAt(new Date(2026, 10, 25, 9, 0).toISOString(), now)).toMatch(/^Tomorrow, /);
    expect(formatSendAt(new Date(2026, 10, 30, 9, 0).toISOString(), now)).not.toMatch(
      /Today|Tomorrow/,
    );
  });
});
