import {
  describeRecurrence,
  MAX_SERIES_OCCURRENCES,
  MAX_SERIES_YEARS,
  type Recurrence,
  type RecurrenceInput,
} from '@sampledge/contracts';

/** What the Repeat controls hold while you schedule or edit a meeting. */
export interface RepeatDraft {
  frequency: 'none' | 'daily' | 'weekly' | 'monthly';
  interval: number;
  /** 0 = Sunday. Weekly only. */
  weekdays: number[];
  ends: 'never' | 'after' | 'on';
  count: number;
  /** Local date, YYYY-MM-DD. */
  endsOn: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar date of a moment, YYYY-MM-DD. */
export function ymdOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Same day `n` months later (clamped to the month's last day). */
export function addMonthsYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return `${first.getUTCFullYear()}-${pad(first.getUTCMonth() + 1)}-${pad(Math.min(d, last))}`;
}

export function newRepeatDraft(start: Date | null): RepeatDraft {
  const s = start ?? new Date();
  return {
    frequency: 'none',
    interval: 1,
    weekdays: [s.getDay()],
    ends: 'never',
    count: 10,
    endsOn: addMonthsYmd(ymdOf(s), 3),
  };
}

/** Prefills the controls from a series' rule (when editing a recurring meeting). */
export function draftFromRecurrence(r: Recurrence, start: Date): RepeatDraft {
  const base = newRepeatDraft(start);
  return {
    frequency: r.frequency,
    interval: r.interval,
    weekdays: r.weekdays?.length ? [...r.weekdays] : base.weekdays,
    ends: r.endsAfter ? 'after' : r.endsOn ? 'on' : 'never',
    count: r.endsAfter ?? base.count,
    endsOn: r.endsOn ?? base.endsOn,
  };
}

/** The rule to send, or undefined for a one-off meeting. */
export function draftToRecurrence(d: RepeatDraft): RecurrenceInput | undefined {
  if (d.frequency === 'none') return undefined;
  return {
    frequency: d.frequency,
    interval: d.interval,
    ...(d.frequency === 'weekly' ? { weekdays: [...new Set(d.weekdays)].sort() } : {}),
    ...(d.ends === 'after' ? { endsAfter: d.count } : {}),
    ...(d.ends === 'on' ? { endsOn: d.endsOn } : {}),
  };
}

/** Why the server would refuse this rule, checked before sending. */
export function repeatProblem(d: RepeatDraft, start: Date | null): string | null {
  if (d.frequency === 'none') return null;
  if (d.interval < 1 || d.interval > 30) return 'Repeat every 1 to 30.';
  if (d.frequency === 'weekly' && d.weekdays.length === 0) return 'Pick at least one day.';
  if (d.ends === 'after' && (d.count < 2 || d.count > MAX_SERIES_OCCURRENCES))
    return `A series has 2 to ${MAX_SERIES_OCCURRENCES} meetings.`;
  if (d.ends === 'on' && start) {
    const first = ymdOf(start);
    if (d.endsOn < first) return 'The end date is before the first meeting.';
    if (d.endsOn > addMonthsYmd(first, MAX_SERIES_YEARS * 12))
      return `A series can run for at most ${MAX_SERIES_YEARS} years.`;
  }
  return null;
}

/** "Weekly on Tue, Thu, 10 times", or null for a one-off meeting. */
export function repeatSummary(d: RepeatDraft, start: Date | null, timeZone: string) {
  const r = draftToRecurrence(d);
  if (!r) return null;
  return describeRecurrence(r, (start ?? new Date()).toISOString(), timeZone);
}

/** Whether two rules mean the same thing (so an edit leaves the rule alone). */
export function sameRecurrence(a: RecurrenceInput | undefined, b: RecurrenceInput | undefined) {
  const norm = (r: RecurrenceInput | undefined) =>
    r
      ? JSON.stringify([
          r.frequency,
          r.interval ?? 1,
          r.frequency === 'weekly' ? [...new Set(r.weekdays ?? [])].sort() : null,
          r.endsAfter ?? null,
          r.endsOn ?? null,
        ])
      : 'none';
  return norm(a) === norm(b);
}
