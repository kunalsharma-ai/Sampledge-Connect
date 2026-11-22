'use client';
import * as React from 'react';
import {
  DEFAULT_DND_SCHEDULE,
  dndActive,
  effectiveStatus,
  type Availability,
  type DndSchedule,
  type UserStatus,
} from '@sampledge/contracts';
import type { PresenceStatus } from '@sampledge/contracts';
import { useAuth } from './auth';
import { useEngine, type DirectoryEntry } from './engine';

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  auto: 'Available',
  busy: 'Busy',
  away: 'Appear away',
  dnd: 'Do not disturb',
};

/** Re-renders once a minute so expiring statuses and DND hours stay current. */
export function useMinuteClock(): Date {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/**
 * The dot and words people see for someone: offline when no device is connected, otherwise
 * their chosen availability, with scheduled quiet hours reading as do-not-disturb.
 */
export function presenceOf(
  u: DirectoryEntry | undefined,
  connected: boolean,
  at: Date,
): { dot: PresenceStatus; label: string; status: UserStatus; dnd: boolean } {
  const status = effectiveStatus(u?.userStatus, at);
  const dnd = dndActive(status, u?.dndSchedule, at);
  if (!connected) return { dot: 'offline', label: 'Offline', status, dnd };
  if (dnd) return { dot: 'dnd', label: 'Do not disturb', status, dnd };
  if (status.availability === 'busy') return { dot: 'dnd', label: 'Busy', status, dnd };
  if (status.availability === 'away') return { dot: 'away', label: 'Away', status, dnd };
  return { dot: 'online', label: 'Available', status, dnd };
}

/** "Clear after" choices for a custom status. */
export const CLEAR_AFTER = [
  { id: 'never', label: 'Don’t clear' },
  { id: '30m', label: '30 minutes' },
  { id: '1h', label: '1 hour' },
  { id: '4h', label: '4 hours' },
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
] as const;
export type ClearAfter = (typeof CLEAR_AFTER)[number]['id'];

export function clearAfterToDate(c: ClearAfter, now = new Date()): string | null {
  const d = new Date(now);
  switch (c) {
    case 'never':
      return null;
    case '30m':
      return new Date(now.getTime() + 30 * 60_000).toISOString();
    case '1h':
      return new Date(now.getTime() + 60 * 60_000).toISOString();
    case '4h':
      return new Date(now.getTime() + 4 * 60 * 60_000).toISOString();
    case 'today':
      d.setHours(23, 59, 59, 0);
      return d.toISOString();
    case 'week': {
      // End of Sunday.
      d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
      d.setHours(23, 59, 59, 0);
      return d.toISOString();
    }
  }
}

const localZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

/**
 * Your own status and quiet hours. Changes show at once on this device, wait in the offline
 * queue when there is no connection, and reach your other devices and everyone else live.
 */
export function useMyStatus() {
  const { engine, directory, patchDirectory } = useEngine();
  const { session } = useAuth();
  const me = session!.user.userId;
  const entry = directory.get(me);
  const now = useMinuteClock();
  const status = effectiveStatus(entry?.userStatus, now);
  const schedule: DndSchedule = entry?.dndSchedule ?? {
    ...DEFAULT_DND_SCHEDULE,
    timeZone: localZone(),
  };
  const dnd = dndActive(status, entry?.dndSchedule, now);

  const setStatus = React.useCallback(
    (next: UserStatus) => {
      const cleared = next.availability === 'auto' && !next.text && !next.emoji;
      patchDirectory(me, { userStatus: cleared ? undefined : next });
      void engine.queueAction({
        key: 'my-status',
        method: 'PUT',
        path: '/v1/me/status',
        body: next,
        label: 'Update your status',
      });
    },
    [engine, me, patchDirectory],
  );

  const setSchedule = React.useCallback(
    (next: DndSchedule) => {
      patchDirectory(me, { dndSchedule: next });
      void engine.queueAction({
        key: 'my-dnd-schedule',
        method: 'PUT',
        path: '/v1/me/dnd-schedule',
        body: next,
        label: 'Update quiet hours',
      });
    },
    [engine, me, patchDirectory],
  );

  return { status, schedule, dnd, setStatus, setSchedule, localZone: localZone() };
}
