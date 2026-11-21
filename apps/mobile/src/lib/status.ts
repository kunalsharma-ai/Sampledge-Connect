import {
  dndActive,
  effectiveStatus,
  type Availability,
  type DndSchedule,
  type UserStatus,
} from '@sampledge/contracts';

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  auto: 'Automatic',
  busy: 'Busy',
  away: 'Away',
  dnd: 'Do not disturb',
};

export const STATUS_PRESETS: { emoji: string; text: string; clear: ClearAfter }[] = [
  { emoji: '📅', text: 'In a meeting', clear: '1h' },
  { emoji: '🚗', text: 'Commuting', clear: '30m' },
  { emoji: '🎯', text: 'Focusing', clear: '4h' },
  { emoji: '🧪', text: 'In the field', clear: 'today' },
  { emoji: '🤒', text: 'Out sick', clear: 'today' },
  { emoji: '🌴', text: 'On holiday', clear: 'never' },
];

export type ClearAfter = 'never' | '30m' | '1h' | '4h' | 'today' | 'week';
export const CLEAR_AFTER: { key: ClearAfter; label: string }[] = [
  { key: 'never', label: "Don't clear" },
  { key: '30m', label: '30 minutes' },
  { key: '1h', label: '1 hour' },
  { key: '4h', label: '4 hours' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
];

/** When a status picked now with this choice clears itself (local time), or null. */
export function expiryFor(choice: ClearAfter, now: Date): string | null {
  const t = new Date(now);
  switch (choice) {
    case 'never':
      return null;
    case '30m':
      return new Date(now.getTime() + 30 * 60_000).toISOString();
    case '1h':
      return new Date(now.getTime() + 60 * 60_000).toISOString();
    case '4h':
      return new Date(now.getTime() + 4 * 60 * 60_000).toISOString();
    case 'today':
      t.setHours(23, 59, 0, 0);
      return t.toISOString();
    case 'week': {
      // Through Sunday night, as people read "this week".
      const toSunday = (7 - t.getDay()) % 7;
      t.setDate(t.getDate() + toSunday);
      t.setHours(23, 59, 0, 0);
      return t.toISOString();
    }
  }
}

export const CLEARED: UserStatus = {
  availability: 'auto',
  emoji: null,
  text: null,
  expiresAt: null,
};

/** "In a meeting · until 3:30 PM", or null when nothing is set. */
export function statusLine(s: UserStatus | null | undefined, now: Date): string | null {
  const e = effectiveStatus(s, now);
  const custom = [e.emoji, e.text].filter(Boolean).join(' ');
  const avail = e.availability === 'auto' ? '' : AVAILABILITY_LABEL[e.availability];
  const main = [avail, custom].filter(Boolean).join(' · ');
  if (!main) return null;
  return e.expiresAt ? `${main} · until ${untilLabel(e.expiresAt, now)}` : main;
}

function untilLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return time;
  return `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`;
}

/** Dot colour key for someone's availability right now. */
export function availabilityTone(
  s: UserStatus | null | undefined,
  schedule: DndSchedule | null | undefined,
  now: Date,
): 'available' | 'away' | 'busy' {
  if (dndActive(s, schedule, now)) return 'busy';
  const a = effectiveStatus(s, now).availability;
  return a === 'busy' ? 'busy' : a === 'away' ? 'away' : 'available';
}

/** HH:MM moved by whole minutes, wrapping round midnight. */
export function shiftTime(hhmm: string, minutes: number): string {
  const total = (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)) + minutes + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** "19:00" as the phone shows times ("7:00 PM" or "19:00"). */
export function clockLabel(hhmm: string): string {
  const d = new Date(2026, 0, 1, Number(hhmm.slice(0, 2)), Number(hhmm.slice(3, 5)));
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
