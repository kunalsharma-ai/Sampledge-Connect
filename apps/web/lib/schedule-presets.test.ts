import { describe, expect, it } from 'vitest';
import { schedulePresets } from './schedule-presets';

describe('schedule presets', () => {
  it('offers today 17:00 only when it is far enough away', () => {
    const morning = new Date(2026, 10, 18, 10, 0); // Wednesday
    const labels = schedulePresets(morning).map((p) => p.label);
    expect(labels).toEqual(['In 1 hour', 'Today at 17:00', 'Tomorrow at 9:00', 'Monday at 9:00']);
    const late = new Date(2026, 10, 18, 16, 45);
    expect(schedulePresets(late).map((p) => p.label)).not.toContain('Today at 17:00');
  });

  it('always picks a future Monday', () => {
    const monday = new Date(2026, 10, 16, 8, 0);
    const next = schedulePresets(monday).find((p) => p.label.startsWith('Monday'))!.at;
    expect(next.getDay()).toBe(1);
    expect(next.getDate()).toBe(23);
    for (const p of schedulePresets(monday))
      expect(p.at.getTime()).toBeGreaterThan(monday.getTime());
  });
});
