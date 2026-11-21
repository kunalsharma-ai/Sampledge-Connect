import type { BookingPage } from '@sampledge/contracts';

/** "30 min · video · any host" style line for a booking page. */
export function bookingSummary(
  p: Pick<BookingPage, 'durationMinutes' | 'media' | 'mode' | 'hostIds'>,
): string {
  const parts = [durationLabel(p.durationMinutes), p.media === 'audio' ? 'audio call' : 'video'];
  if (p.hostIds.length > 1) parts.push(p.mode === 'all' ? 'all hosts attend' : 'any free host');
  return parts.join(' · ');
}

export function durationLabel(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** "With you and Mia Chen" */
export function hostLine(
  p: Pick<BookingPage, 'hostIds'>,
  selfId: string,
  nameOf: (userId: string) => string,
): string {
  const others = p.hostIds.filter((u) => u !== selfId).map((u) => nameOf(u));
  if (!others.length) return 'With you';
  return `With you and ${others.length === 1 ? others[0] : `${others.slice(0, -1).join(', ')} and ${others.at(-1)}`}`;
}

/** Lowercase letters, numbers and dashes, as the server requires (BookingSlugSchema). */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Why a link is not usable, or null. */
export function slugProblem(slug: string): string | null {
  if (slug.length < 3) return 'Use at least 3 characters for the link.';
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug))
    return 'Use lowercase letters, numbers and dashes in the link.';
  return null;
}

export const DURATIONS = [15, 30, 45, 60, 90] as const;
export const BUFFERS = [0, 5, 10, 15, 30] as const;
export const NOTICES = [
  { minutes: 0, label: 'Any time' },
  { minutes: 60, label: '1 hour' },
  { minutes: 4 * 60, label: '4 hours' },
  { minutes: 24 * 60, label: '1 day' },
  { minutes: 2 * 24 * 60, label: '2 days' },
] as const;
export const HORIZONS = [7, 14, 30, 60, 90] as const;

/**
 * The fields that differ between the saved page and the form, so an offline edit sends only
 * what you changed (and a co-host's change to another field is kept).
 */
export function bookingPatch<T extends Record<string, unknown>>(before: T, after: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(after) as (keyof T)[]) {
    const a = before[k];
    const b = after[k];
    const same = Array.isArray(a) && Array.isArray(b) ? a.join() === b.join() : a === b;
    if (!same) out[k] = b;
  }
  return out;
}
