'use client';
import * as React from 'react';
import type {
  CreateMeetingRequest,
  FindTimesRequest,
  FindTimesResponse,
  Meeting,
  MeetingReminderEvent,
  UpdateMeetingRequest,
  WorkingHours,
} from '@sampledge/contracts';
import { apiRequest } from './api';
import { useAuth } from './auth';
import { useEngine } from './engine';

const CACHE_KEY = 'meetings.cache';

/** Monday 00:00 local of the week containing `d`. */
export function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
export const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

export function useMeetingsApi() {
  const { getAccessToken } = useAuth();
  return React.useMemo(() => {
    const req = async <T>(method: string, path: string, body?: unknown) =>
      apiRequest<T>(method, path, { token: await getAccessToken(), body });
    return {
      list: (from: Date, to: Date) =>
        req<Meeting[]>(
          'GET',
          `/v1/meetings?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
        ),
      create: (body: CreateMeetingRequest) => req<Meeting>('POST', '/v1/meetings', body),
      update: (id: string, body: UpdateMeetingRequest) =>
        req<Meeting>('PATCH', `/v1/meetings/${id}`, body),
      cancel: (id: string) => req<Meeting>('POST', `/v1/meetings/${id}/cancel`),
      rsvp: (id: string, response: 'accepted' | 'tentative' | 'declined') =>
        req<Meeting>('POST', `/v1/meetings/${id}/rsvp`, { response }),
      guestLink: (id: string, guestId: string) =>
        req<{ url: string }>('GET', `/v1/meetings/${id}/guests/${guestId}/link`),
      resendGuest: (id: string, guestId: string) =>
        req<Meeting>('POST', `/v1/meetings/${id}/guests/${guestId}/resend`),
      findTimes: (body: FindTimesRequest) =>
        req<FindTimesResponse>('POST', '/v1/meetings/find-times', body),
      getWorkingHours: () => req<WorkingHours>('GET', '/v1/me/working-hours'),
      setWorkingHours: (wh: WorkingHours) => req<WorkingHours>('PUT', '/v1/me/working-hours', wh),
    };
  }, [getAccessToken]);
}

/**
 * Meetings in [from, to), kept live by socket events and cached in IndexedDB so the
 * calendar still shows (read-only) offline.
 */
export function useMeetings(from: Date, to: Date) {
  const { db, engine, state } = useEngine();
  const api = useMeetingsApi();
  const [items, setItems] = React.useState<Meeting[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const online = state.connectivity === 'online';
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  const inRange = React.useCallback(
    (m: Meeting) => m.status === 'scheduled' && m.startsAt < toIso && m.endsAt > fromIso,
    [fromIso, toIso],
  );

  React.useEffect(() => {
    let live = true;
    void db.meta.get(CACHE_KEY).then((row) => {
      if (live && row) setItems((s) => s ?? (row.value as Meeting[]).filter(inRange));
    });
    return () => {
      live = false;
    };
  }, [db, inRange]);

  const refresh = React.useCallback(async () => {
    try {
      const list = await api.list(new Date(fromIso), new Date(toIso));
      setItems(list);
      setError(null);
      const cached = ((await db.meta.get(CACHE_KEY))?.value as Meeting[] | undefined) ?? [];
      const merged = new Map(cached.map((m) => [m.meetingId, m]));
      for (const m of list) merged.set(m.meetingId, m);
      void db.meta.put({ key: CACHE_KEY, value: [...merged.values()].slice(-500) });
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api, db, fromIso, toIso]);

  React.useEffect(() => {
    if (online) void refresh();
  }, [online, refresh]);

  React.useEffect(
    () =>
      engine.onMeeting((e) => {
        if (e.type !== 'upsert') return;
        setItems((list) => {
          const rest = (list ?? []).filter((m) => m.meetingId !== e.meeting.meetingId);
          return inRange(e.meeting)
            ? [...rest, e.meeting].sort((a, b) => a.startsAt.localeCompare(b.startsAt))
            : rest;
        });
      }),
    [engine, inRange],
  );

  const upsertLocal = React.useCallback(
    (m: Meeting) =>
      setItems((list) => {
        const rest = (list ?? []).filter((x) => x.meetingId !== m.meetingId);
        return inRange(m)
          ? [...rest, m].sort((a, b) => a.startsAt.localeCompare(b.startsAt))
          : rest;
      }),
    [inRange],
  );

  return { items, error, refresh, upsertLocal, online };
}

/** The latest meeting reminder for this user, cleared after a while. */
export function useMeetingReminder() {
  const { engine } = useEngine();
  const [r, setR] = React.useState<MeetingReminderEvent | null>(null);
  React.useEffect(
    () =>
      engine.onMeeting((e) => {
        if (e.type === 'reminder') setR(e.reminder);
      }),
    [engine],
  );
  React.useEffect(() => {
    if (!r) return;
    const t = setTimeout(() => setR(null), 60_000);
    return () => clearTimeout(t);
  }, [r]);
  return [r, () => setR(null)] as const;
}

const dayFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
export const fmtDay = (iso: string | Date) => dayFmt.format(new Date(iso));
export const fmtTime = (iso: string | Date) => timeFmt.format(new Date(iso));
export const fmtRange = (a: string, b: string) => `${fmtDay(a)} · ${fmtTime(a)} – ${fmtTime(b)}`;
