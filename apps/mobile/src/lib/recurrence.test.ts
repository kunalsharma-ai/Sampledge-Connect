import { describe, expect, it } from 'vitest';
import {
  addMonthsYmd,
  draftFromRecurrence,
  draftToRecurrence,
  newRepeatDraft,
  repeatProblem,
  repeatSummary,
  sameRecurrence,
} from './recurrence';

// Tuesday 24 November 2026, 10:00 local.
const start = new Date(2026, 10, 24, 10, 0);

describe('repeat controls', () => {
  it('a new meeting does not repeat; weekly defaults to its own weekday', () => {
    const d = newRepeatDraft(start);
    expect(draftToRecurrence(d)).toBeUndefined();
    expect(repeatSummary(d, start, 'UTC')).toBeNull();
    const w = draftToRecurrence({ ...d, frequency: 'weekly' });
    expect(w).toEqual({ frequency: 'weekly', interval: 1, weekdays: [2] });
  });

  it('builds the rule with its end', () => {
    const d = { ...newRepeatDraft(start), frequency: 'weekly' as const, weekdays: [4, 2, 2] };
    expect(draftToRecurrence({ ...d, ends: 'after', count: 8 })).toEqual({
      frequency: 'weekly',
      interval: 1,
      weekdays: [2, 4],
      endsAfter: 8,
    });
    expect(
      draftToRecurrence({ ...d, frequency: 'monthly', ends: 'on', endsOn: '2027-03-31' }),
    ).toEqual({
      frequency: 'monthly',
      interval: 1,
      endsOn: '2027-03-31',
    });
    expect(repeatSummary({ ...d, ends: 'after', count: 8 }, start, 'UTC')).toBe(
      'Weekly on Tue, Thu, 8 times',
    );
  });

  it('months clamp to the last day', () => {
    expect(addMonthsYmd('2026-11-30', 3)).toBe('2027-02-28');
    expect(addMonthsYmd('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsYmd('2026-11-24', -1)).toBe('2026-10-24');
    expect(addMonthsYmd('2026-11-24', 14)).toBe('2028-01-24');
  });

  it('checks the rules the server enforces', () => {
    const d = { ...newRepeatDraft(start), frequency: 'weekly' as const };
    expect(repeatProblem(d, start)).toBeNull();
    expect(repeatProblem({ ...d, weekdays: [] }, start)).toMatch(/at least one day/);
    expect(repeatProblem({ ...d, ends: 'after', count: 1 }, start)).toMatch(/2 to 200/);
    expect(repeatProblem({ ...d, ends: 'on', endsOn: '2026-11-01' }, start)).toMatch(/before/);
    expect(repeatProblem({ ...d, ends: 'on', endsOn: '2029-01-01' }, start)).toMatch(/2 years/);
  });

  it('round-trips a series rule and spots real changes', () => {
    const r = { frequency: 'weekly' as const, interval: 2, weekdays: [1, 3], endsAfter: 6 };
    const d = draftFromRecurrence(r, start);
    expect(d.ends).toBe('after');
    expect(sameRecurrence(draftToRecurrence(d), r)).toBe(true);
    expect(sameRecurrence(draftToRecurrence({ ...d, count: 7 }), r)).toBe(false);
    expect(sameRecurrence({ frequency: 'daily' }, { frequency: 'daily', interval: 1 })).toBe(true);
  });
});
