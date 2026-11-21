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
- Working hours and booking pages changed on one device (or by another host) update live everywhere with
  `meetings:changed`; screens refetch after a reconnect.
- The recordings library updates live when a call recording is saved or any recording is deleted (`recording:changed`
  to the conversation's members), refreshes on reconnect, and picks up new chat clips within 20 seconds.
- See `sync-coverage.md` for every action.

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

On mobile, Schedule a meeting has a Repeat section (daily, weekly on chosen days, or monthly; every 1 to 30;
ending never, after a number of meetings, or on a date) with the same plain-English summary. The meeting
screen shows the rule and lets you answer for "This meeting" or "All upcoming". Answers work offline: an
all-upcoming answer shows on every upcoming meeting of the series at once, is sent once with
`scope: 'series'`, and answers are sent in the order you gave them (so declining one meeting after
accepting the series stays declined). Organizers edit "Only this meeting" or "This and all upcoming"
(where the rule and guests can change) and can cancel one meeting or all upcoming ones.
`scripts/e2e-recurring.cjs` runs this against a real server.

## Booking pages

A booking page is a public link (`/book/<slug>`) where people outside the organization pick a free
time with one person or a team. Hosts manage them from Meetings → Booking pages.

- **Free times** come from each host's working hours and meetings, the same as "find a time". A
  booking blocks that time everywhere: on every other page and in "find a time".
- **Who attends:** `any` books one free host (the one with the fewest meetings that day), `all`
  needs every host free and invites them all.
- **Settings:** length (10 to 240 min), gap kept before and after meetings, earliest booking
  (minimum notice), how many days ahead, audio or video, paused or taking bookings.
- **Booking** creates an ordinary meeting organized by a host, with the booker as an external
  guest: they get the calendar invite and join link by email (when SMTP is set up) and on the
  confirmation screen. Hosts get a notification and the meeting appears live on all their devices.
- **Safety:** the public page shows host names only, never emails. Booking is rate limited
  (10 per hour per IP), a slot is locked while it is booked and checked again before it is
  saved, so two people can't take the same time. Members can't book their own org's page as a guest.
- The public page refreshes its free times every 30 seconds and reloads them if a time was just taken.

| Method | Path                    | Who                                          |
| ------ | ----------------------- | -------------------------------------------- |
| GET    | `/v1/booking-pages`     | pages I host                                 |
| POST   | `/v1/booking-pages`     | create (the creator is always a host)        |
| PATCH  | `/v1/booking-pages/:id` | any host                                     |
| DELETE | `/v1/booking-pages/:id` | any host                                     |
| GET    | `/v1/book/:slug`        | public: title, hosts' names, window          |
| GET    | `/v1/book/:slug/slots`  | public: `from`, `to` (at most 14 days)       |
| POST   | `/v1/book/:slug`        | public: `startsAt`, `name`, `email`, `notes` |

## Planned next

Booking pages are on mobile too (Meetings → link icon): create, edit, pause, share and delete,
offline as well, and every change reaches each host's devices live through `booking:changed`
`{bookingPageId, page | null}`. The public page itself opens in the phone's browser. Guests from outside the
organization (email invites with `.ics`, join links, lobby) are built: see `guests.md`. Recordings: `recordings.md`.
