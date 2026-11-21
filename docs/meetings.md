# Scheduled meetings and booking slots

Meetings run on the same self-hosted stack as calls (see `docs/calls.md`). Nothing external is used.

## Model

- Every meeting lives in a conversation, its **meeting chat**. Pick an existing conversation, or Connect creates one
  (a DM for one other person, otherwise a group named after the meeting). The organizer's card is posted in that chat
  and updates in place when the meeting moves or is cancelled.
- **Joining** a meeting starts or joins the meeting chat's call, so chat, files, call and history stay together.
- **RSVP**: going / maybe / not going. Moving the time resets everyone's response to "no response".
- **Reminders**: up to three offsets per meeting (default 10 min). A Redis-locked sweeper (every 30 s) sends each one once,
  live (`meeting:reminder`) and by push to devices without the app open. People who declined aren't reminded.
- **Working hours** per person, in their own time zone (`PUT /v1/me/working-hours`). Default Mon–Fri 09:00–17:30 UTC.
- **Find a time** (`POST /v1/meetings/find-times`): slots where the organizer and every attendee are inside their own
  working hours and not in another meeting they haven't declined. Busy blocks are returned without titles, so nobody
  sees what others are doing. DST-correct (Intl-based, no tz database dependency).

## API

| Method  | Path                      | Notes                                                                                                                                   |
| ------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| GET     | `/v1/meetings?from=&to=`  | My meetings overlapping the range (max 62 days). `includeCancelled=true` optional.                                                      |
| POST    | `/v1/meetings`            | `{ title, agenda?, startsAt, endsAt, timeZone?, media?, remindMinutes?, attendeeIds?, optionalAttendeeIds?, conversationId?, guests? }` |
| GET     | `/v1/meetings/:id`        | Attendees, or anyone who can read the meeting chat. Others get 404.                                                                     |
| PATCH   | `/v1/meetings/:id`        | Organizer only. `addAttendeeIds` adds people to the meeting chat too. `scope`, `recurrence` for series.                                 |
| POST    | `/v1/meetings/:id/cancel` | Organizer only. `{ scope?: 'occurrence' \| 'series' }`.                                                                                 |
| POST    | `/v1/meetings/:id/rsvp`   | `{ response: 'accepted' \| 'tentative' \| 'declined', scope? }`                                                                         |
| POST    | `/v1/meetings/find-times` | `{ attendeeIds, durationMinutes, from, to, stepMinutes?, limit?, ignoreMeetingId? }` → `{ slots, busy }`                                |
| GET/PUT | `/v1/me/working-hours`    | `{ timeZone, days: [{ day: 0-6, start: 'HH:MM', end: 'HH:MM' }] }`                                                                      |

Socket: `meeting:upsert` (a `Meeting`, to every attendee on create, change, cancel and RSVP) and `meeting:reminder`
`{ meeting, minutesBefore }`. Push data: `{ type: 'meeting', event: 'invite' | 'reminder' | 'updated' | 'cancelled', meetingId, conversationId, startsAt }`.
Chat card: `messageType: 'system'` with `metadata.meeting` (`MeetingSystemMetadata`).

## Sync across devices

- Every change (create, edit, cancel, RSVP, guest answers) is pushed live with `meeting:upsert` to every signed-in
  device of everyone invited, on web and mobile.
- The web calendar keeps a copy on the device, so it shows offline, and refetches when the connection returns.
- RSVPs made offline are saved on the device, shown at once, and sent when the connection returns (latest answer per
  meeting wins; answers the server refuses, such as for a cancelled meeting, are dropped).
- Scheduling and editing need a connection, so two devices can't create conflicting versions of a meeting.
- The recordings library refreshes on reconnect, every 20 seconds while open, and when the window comes back to the
  front.

## Recurring meetings

Create a meeting with `recurrence` to repeat it:

```json
{ "frequency": "weekly", "interval": 1, "weekdays": [1, 3], "endsAfter": 10 }
```

- `frequency`: `daily`, `weekly` (on `weekdays`, 0 = Sunday; defaults to the first meeting's day) or `monthly`
  (on the first meeting's day of the month; months without that day are skipped). `interval`: every 1 to 30.
- Ends after `endsAfter` meetings (2 to 200), on `endsOn` (a local date, at most 2 years out) or never.
- Every occurrence is its own meeting (own RSVPs, reminders and call) in the same meeting chat, with
  `meeting.series = { seriesId, recurrence, summary, detached }`. `summary` reads like "Weekly on Tuesday".
- Meetings keep the same local time in the organizer's time zone across daylight-saving changes.
- Series that never end are created 180 days ahead; a background job adds more as time passes.
- `scope: 'occurrence'` (default) changes, cancels or answers one meeting. `scope: 'series'` applies to every
  meeting that hasn't started. A series time change (or a new `recurrence`) recreates the upcoming meetings,
  so their answers reset and one-off changes are replaced. Other series changes keep answers.
- Guests are added and removed for the whole series. They get one invite with an `RRULE` (local time and
  `VTIMEZONE`), `EXDATE` for cancelled meetings, and a `RECURRENCE-ID` update when one meeting changes. Their
  one join link opens whichever meeting of the series is next, and their RSVP covers the series.

## Planned next

Public booking pages (pick a slot from a team's availability). Guests from outside the
organization (email invites with `.ics`, join links, lobby) are built: see `guests.md`. Recordings: `recordings.md`.
