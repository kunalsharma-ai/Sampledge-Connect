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
| PATCH   | `/v1/meetings/:id`        | Organizer only. `addAttendeeIds` adds people to the meeting chat too.                                                                   |
| POST    | `/v1/meetings/:id/cancel` | Organizer only.                                                                                                                         |
| POST    | `/v1/meetings/:id/rsvp`   | `{ response: 'accepted' \| 'tentative' \| 'declined' }`                                                                                 |
| POST    | `/v1/meetings/find-times` | `{ attendeeIds, durationMinutes, from, to, stepMinutes?, limit?, ignoreMeetingId? }` → `{ slots, busy }`                                |
| GET/PUT | `/v1/me/working-hours`    | `{ timeZone, days: [{ day: 0-6, start: 'HH:MM', end: 'HH:MM' }] }`                                                                      |

Socket: `meeting:upsert` (a `Meeting`, to every attendee on create, change, cancel and RSVP) and `meeting:reminder`
`{ meeting, minutesBefore }`. Push data: `{ type: 'meeting', event: 'invite' | 'reminder' | 'updated' | 'cancelled', meetingId, conversationId, startsAt }`.
Chat card: `messageType: 'system'` with `metadata.meeting` (`MeetingSystemMetadata`).

## Planned next

Public booking pages (pick a slot from a team's availability) and recurring meetings. Guests from outside the
organization (email invites with `.ics`, join links, lobby) are built: see `guests.md`. Recordings: `recordings.md`.
