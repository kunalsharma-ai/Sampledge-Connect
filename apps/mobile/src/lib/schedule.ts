import { SCHEDULE_MAX_LEAD_MS, SCHEDULE_MIN_LEAD_MS } from '@sampledge/contracts';

export interface SchedulePreset {
  key: string;
  label: string;
  at: Date;
}

const at = (base: Date, days: number, hour: number, minute = 0): Date => {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d;
};

/** Quick choices for "Send later", in local time. */
export function schedulePresets(now: Date): SchedulePreset[] {
  const inHour = new Date(Math.ceil((now.getTime() + 3_600_000) / 300_000) * 300_000);
  const out: SchedulePreset[] = [{ key: 'hour', label: 'In 1 hour', at: inHour }];
  if (now.getHours() < 17)
    out.push({ key: 'evening', label: 'This evening, 6 PM', at: at(now, 0, 18) });
  out.push({ key: 'tomorrow', label: 'Tomorrow, 9 AM', at: at(now, 1, 9) });
  // Next Monday, unless that is tomorrow (already offered).
  const toMonday = (8 - now.getDay()) % 7 || 7;
  if (toMonday > 1) out.push({ key: 'monday', label: 'Monday, 9 AM', at: at(now, toMonday, 9) });
  return out;
}

/** The next seven days, for a custom time. */
export function scheduleDays(now: Date): { key: string; label: string; date: Date }[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = at(now, i, 0);
    const label =
      i === 0
        ? 'Today'
        : i === 1
          ? 'Tomorrow'
          : date.toLocaleDateString([], { weekday: 'short', day: 'numeric' });
    return { key: String(i), label, date };
  });
}

/** Half-hour times from 7 AM to 9 PM. */
export const SCHEDULE_TIMES: { minutes: number; label: string }[] = Array.from(
  { length: 29 },
  (_, i) => {
    const minutes = 7 * 60 + i * 30;
    const d = new Date(2026, 0, 1, Math.floor(minutes / 60), minutes % 60);
    return { minutes, label: d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) };
  },
);

export function combineDayTime(day: Date, minutes: number): Date {
  const d = new Date(day);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d;
}

/** What is wrong with a send time, or null (same limits as the server). */
export function scheduleProblem(when: Date, now: Date): string | null {
  const lead = when.getTime() - now.getTime();
  if (lead < SCHEDULE_MIN_LEAD_MS) return 'Pick a time at least a minute from now.';
  if (lead > SCHEDULE_MAX_LEAD_MS) return 'Pick a time within the next year.';
  return null;
}

/** "Today, 6:00 PM", "Tomorrow, 9:00 AM" or "Mon 24 Nov, 9:00 AM". */
export function formatSendAt(iso: string, now: Date): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const days = Math.round((at(d, 0, 0).getTime() - at(now, 0, 0).getTime()) / 86_400_000);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Tomorrow, ${time}`;
  return `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`;
}
