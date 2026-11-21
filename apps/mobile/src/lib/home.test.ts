import { describe, expect, it } from 'vitest';
import { homeSummary, sortMyTasks } from './home';

describe('home', () => {
  it('summary line', () => {
    expect(homeSummary({ unread: 0, forYou: 0, meetingsToday: 0, approvals: 0 })).toMatch(
      /all caught up/,
    );
    expect(homeSummary({ unread: 3, forYou: 0, meetingsToday: 1, approvals: 2 })).toBe(
      'You have 3 unread, 1 meeting today and 2 approvals waiting.',
    );
    expect(homeSummary({ unread: 0, forYou: 2, meetingsToday: 0, approvals: 0 })).toBe(
      'You have 2 new for you.',
    );
  });

  it('overdue first, then by due date, then newest; done left out', () => {
    const now = Date.parse('2026-11-21T12:00:00Z');
    const t = (
      id: string,
      dueAt: string | null,
      status = 'open',
      createdAt = '2026-11-01T00:00:00Z',
    ) => ({ id, dueAt, status, createdAt }) as never;
    const out = sortMyTasks(
      [
        t('later', '2026-11-25T00:00:00Z'),
        t('none-new', null, 'open', '2026-11-20T00:00:00Z'),
        t('overdue', '2026-11-20T00:00:00Z'),
        t('done', '2026-11-19T00:00:00Z', 'done'),
        t('soon', '2026-11-22T00:00:00Z'),
        t('none-old', null),
      ],
      now,
    ).map((x: { id: string }) => x.id);
    expect(out).toEqual(['overdue', 'soon', 'later', 'none-new', 'none-old']);
  });
});
